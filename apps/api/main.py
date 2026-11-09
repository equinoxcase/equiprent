import base64, binascii, hashlib, hmac, json, os, time
from fastapi import FastAPI, Depends, HTTPException, Header, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import select
import db, storage, verification

SECRET = os.getenv("AUTH_SECRET", "")
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "http://localhost:8000")
ARBITER = os.getenv("ARBITER_ADDRESS", "").lower()
if not SECRET:
    raise RuntimeError("Set AUTH_SECRET to a long random string")

app = FastAPI(title="EquipRent API")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])
db.init()


def _sign(addr: str, exp: int) -> str:
    return hmac.new(SECRET.encode(), f"{addr}|{exp}".encode(), hashlib.sha256).hexdigest()


def current_user(authorization: str = Header(default="")) -> str:
    try:
        addr, exp, sig = authorization.removeprefix("Bearer ").split(".")
        if int(exp) < time.time() or not hmac.compare_digest(sig, _sign(addr, int(exp))):
            raise ValueError
        return addr
    except Exception:
        raise HTTPException(401, "Sign in with your wallet first")


@app.get("/health")
def health():
    with db.Session() as s:
        row = s.get(db.SyncState, "head")
        return {"ok": True, "indexed_block": row.block if row else None}


# ---- Wallet sign-in: sign a timestamped message, receive a 12h token ----
@app.get("/auth/message")
def auth_message(address: str):
    return {"message": f"Sign in to EquipRent\nAddress: {address.lower()}\nIssued: {int(time.time())}"}


class Verify(BaseModel):
    message: str
    signature: str


@app.post("/auth/verify")
def auth_verify(v: Verify):
    try:
        lines = v.message.split("\n")
        claimed = lines[1].removeprefix("Address: ")
        issued = int(lines[2].removeprefix("Issued: "))
        signer = Account.recover_message(encode_defunct(text=v.message), signature=v.signature).lower()
    except Exception:
        raise HTTPException(400, "Bad signature")
    if signer != claimed or abs(time.time() - issued) > 300:
        raise HTTPException(401, "Signature rejected or expired")
    exp = int(time.time()) + 12 * 3600
    return {"token": f"{signer}.{exp}.{_sign(signer, exp)}"}


# ---- Off-chain listing metadata. The hash in the URI anchors it on-chain. ----
class Meta(BaseModel):
    category: str
    title: str
    location: str
    description: str = ""
    images: list[str] = []
    verification_level: int = 1


@app.post("/metadata")
def create_metadata(m: Meta, user: str = Depends(current_user)):
    data = m.model_dump()
    data["verification_level"] = 1  # levels come from platform attestations, never from the client
    body = json.dumps(data, sort_keys=True)
    h = hashlib.sha256(body.encode()).hexdigest()
    with db.Session() as s:
        if not s.get(db.Metadata, h):
            s.add(db.Metadata(hash=h, owner=user, body=body))
            s.commit()
    return {"hash": h, "uri": f"{PUBLIC_API_URL}/metadata/{h}"}


@app.get("/metadata/{h}")
def read_metadata(h: str):
    with db.Session() as s:
        row = s.get(db.Metadata, h)
        if not row:
            raise HTTPException(404, "Not found")
        return json.loads(row.body)


# ---- Marketplace reads, backed by the chain indexer ----
def _meta_hash(e: db.Equipment) -> str:
    return e.metadata_uri.rsplit("/", 1)[-1]


def _equip_out(s, e: db.Equipment):
    meta = s.get(db.Metadata, e.metadata_uri.rsplit("/", 1)[-1])
    body = json.loads(meta.body) if meta else None
    v = s.get(db.Verification, e.id)
    level = verification.attested_level(v, e.owner, _meta_hash(e))
    if body is not None:
        body["verification_level"] = level  # overrides whatever the stored metadata claims
    proof = None
    if level > 1:
        proof = {"level": level, "issued_at": v.issued_at, "expires_at": v.expires_at, "signature": v.signature,
                 "signer": verification.SIGNER,
                 "message": verification.message(e.id, e.owner, v.level, v.issued_at, v.expires_at, v.metadata_hash)}
    return {"id": e.id, "owner": e.owner, "daily_rate_wei": e.daily_rate, "deposit_wei": e.deposit,
            "active": e.active, "metadata": body, "verification": proof}


@app.get("/equipment")
def list_equipment(category: str | None = None, q: str | None = None, owner: str | None = None,
                   include_inactive: bool = False, limit: int = Query(50, le=100), offset: int = 0):
    with db.Session() as s:
        stmt = select(db.Equipment)
        if not include_inactive:
            stmt = stmt.where(db.Equipment.active)
        if owner:
            stmt = stmt.where(db.Equipment.owner == owner.lower())
        rows = s.scalars(stmt.order_by(db.Equipment.id.desc()).limit(limit).offset(offset)).all()
        out = [_equip_out(s, e) for e in rows]
    if category:
        out = [o for o in out if o["metadata"] and o["metadata"]["category"] == category]
    if q:
        out = [o for o in out if o["metadata"] and q.lower() in o["metadata"]["title"].lower()]
    return out


@app.get("/equipment/{eid}")
def get_equipment(eid: int):
    with db.Session() as s:
        e = s.get(db.Equipment, eid)
        if not e:
            raise HTTPException(404, "Not found")
        return _equip_out(s, e)


@app.get("/rentals")
def my_rentals(user: str = Depends(current_user)):
    with db.Session() as s:
        rows = s.scalars(select(db.Rental).where((db.Rental.renter == user) | (db.Rental.owner == user))
                         .order_by(db.Rental.id.desc())).all()
        return [{c.name: getattr(r, c.name) for c in r.__table__.columns} for r in rows]


# ---- Dispute evidence. Files live in object storage; the hash is anchored on-chain by the submitter. ----
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_BYTES = 5 * 1024 * 1024
OPEN_STATES = {"Accepted", "HandedOver", "Returned", "Disputed"}


class EvidenceIn(BaseModel):
    note: str = ""
    filename: str
    content_type: str
    data_b64: str


def _access(s, rid: int, user: str):
    r = s.get(db.Rental, rid)
    if not r:
        raise HTTPException(404, "Rental not found")
    party = user in (r.owner, r.renter)
    if not party and not (ARBITER and user == ARBITER):
        raise HTTPException(403, "Only the parties and the arbiter can see this")
    return r, party


def _ev_out(e: db.Evidence):
    return {"id": e.id, "rental_id": e.rental_id, "submitter": e.submitter, "note": e.note,
            "filename": e.filename, "content_type": e.content_type, "size": e.size,
            "sha256": e.sha256, "anchored": e.anchored, "created_at": e.created_at}


@app.post("/rentals/{rid}/evidence")
def add_evidence(rid: int, body: EvidenceIn, user: str = Depends(current_user)):
    if body.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Use a JPEG, PNG, WebP or PDF file")
    if len(body.data_b64) > MAX_BYTES * 4 // 3 + 16:
        raise HTTPException(413, "File is larger than 5 MB")
    try:
        raw = base64.b64decode(body.data_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "File data is not valid")
    if not raw or len(raw) > MAX_BYTES:
        raise HTTPException(413, "File is empty or larger than 5 MB")
    digest = hashlib.sha256(raw).hexdigest()
    key = f"evidence/{rid}/{digest}"
    with db.Session() as s:
        r, party = _access(s, rid, user)
        if not party:
            raise HTTPException(403, "The arbiter can’t submit evidence")
        if r.status not in OPEN_STATES:
            raise HTTPException(409, "Evidence can be added once the rental is accepted and until it closes")
        e = s.scalars(select(db.Evidence).where(db.Evidence.rental_id == rid, db.Evidence.sha256 == digest)).first()
        if not e:
            if storage.enabled():
                try:
                    storage.put(key, raw, body.content_type)
                except Exception:
                    raise HTTPException(503, "File storage is unavailable, try again shortly")
            e = db.Evidence(rental_id=rid, submitter=user, note=body.note[:500], filename=body.filename[:200],
                            content_type=body.content_type, size=len(raw), sha256=digest,
                            data=b"" if storage.enabled() else raw, storage_key=key if storage.enabled() else None,
                            anchored=False, created_at=int(time.time()))
            s.add(e)
            s.commit()
        return _ev_out(e)


@app.get("/rentals/{rid}/evidence")
def list_evidence(rid: int, user: str = Depends(current_user)):
    with db.Session() as s:
        _access(s, rid, user)
        rows = s.scalars(select(db.Evidence).where(db.Evidence.rental_id == rid).order_by(db.Evidence.id)).all()
        return [_ev_out(e) for e in rows]


@app.get("/evidence/{eid}/file")
def evidence_file(eid: int, user: str = Depends(current_user)):
    with db.Session() as s:
        e = s.get(db.Evidence, eid)
        if not e:
            raise HTTPException(404, "Not found")
        _access(s, e.rental_id, user)
        try:
            raw = storage.get(e.storage_key) if e.storage_key else e.data
        except Exception:
            raise HTTPException(503, "File storage is unavailable, try again shortly")
        if hashlib.sha256(raw).hexdigest() != e.sha256:
            raise HTTPException(500, "Stored file does not match its recorded hash")
        return Response(raw, media_type=e.content_type,
                        headers={"X-Content-Type-Options": "nosniff",
                                 "Content-Disposition": f'attachment; filename="evidence-{e.id}"'})


@app.get("/disputes")
def disputes(user: str = Depends(current_user)):
    if not ARBITER or user != ARBITER:
        raise HTTPException(403, "Arbiter only")
    with db.Session() as s:
        rows = s.scalars(select(db.Rental).where(db.Rental.status == "Disputed").order_by(db.Rental.id)).all()
        out = []
        for r in rows:
            d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
            d["evidence_count"] = len(s.scalars(select(db.Evidence.id).where(db.Evidence.rental_id == r.id)).all())
            out.append(d)
        return out


# ---- Platform verification. Admin wallets (ADMIN_ADDRESSES) grant and revoke; the API signs with VERIFIER_PRIVATE_KEY. ----
def admin_user(user: str = Depends(current_user)) -> str:
    if user not in verification.ADMINS:
        raise HTTPException(403, "Admin only")
    return user


@app.get("/verifier")
def verifier():
    return {"address": verification.SIGNER or None, "levels": {"2": "Verified", "3": "Inspected"}}


class VerifyIn(BaseModel):
    equipment_id: int
    level: int
    days: int = 365
    note: str = ""


@app.post("/admin/verifications")
def grant_verification(v: VerifyIn, admin: str = Depends(admin_user)):
    if not verification.SIGNER:
        raise HTTPException(503, "VERIFIER_PRIVATE_KEY is not set on the API")
    if v.level not in (2, 3):
        raise HTTPException(400, "Level must be 2 (Verified) or 3 (Inspected)")
    if not 1 <= v.days <= 730:
        raise HTTPException(400, "Days must be between 1 and 730")
    with db.Session() as s:
        e = s.get(db.Equipment, v.equipment_id)
        if not e:
            raise HTTPException(404, "Equipment not found. Wait for the indexer if it was just listed")
        now = int(time.time())
        exp = now + v.days * 86400
        mh = _meta_hash(e)
        sig = verification.sign(e.id, e.owner, v.level, now, exp, mh)
        s.merge(db.Verification(equipment_id=e.id, level=v.level, issued_at=now, expires_at=exp,
                                signature=sig, note=v.note[:500], metadata_hash=mh, revoked=False))
        s.commit()
        return {"equipment_id": e.id, "level": v.level, "expires_at": exp}


@app.delete("/admin/verifications/{eid}")
def revoke_verification(eid: int, admin: str = Depends(admin_user)):
    with db.Session() as s:
        v = s.get(db.Verification, eid)
        if not v:
            raise HTTPException(404, "No attestation for that equipment")
        v.revoked = True
        s.commit()
        return {"equipment_id": eid, "revoked": True}


@app.get("/admin/verifications")
def list_verifications(admin: str = Depends(admin_user)):
    with db.Session() as s:
        rows = s.scalars(select(db.Verification).order_by(db.Verification.equipment_id)).all()
        out = []
        for r in rows:
            d = {c.name: getattr(r, c.name) for c in r.__table__.columns if c.name not in ("signature", "metadata_hash")}
            e = s.get(db.Equipment, r.equipment_id)
            meta = s.get(db.Metadata, _meta_hash(e)) if e else None
            d["title"] = json.loads(meta.body).get("title") if meta else None
            d["stale"] = not e or r.metadata_hash != _meta_hash(e)  # listing changed after it was reviewed
            out.append(d)
        return out
