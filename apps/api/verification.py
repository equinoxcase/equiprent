"""Platform-signed verification levels. A listing is Registered (1) unless it holds a valid, unexpired,
unrevoked attestation signed by the platform verifier key. Levels: 2 Verified, 3 Inspected."""
import os, time
from eth_account import Account
from eth_account.messages import encode_defunct

KEY = os.getenv("VERIFIER_PRIVATE_KEY", "")
ADMINS = {a.strip().lower() for a in os.getenv("ADMIN_ADDRESSES", "").split(",") if a.strip()}
CONTRACT = os.getenv("CONTRACT_ADDRESS", "").lower()
CHAIN_ID = os.getenv("CHAIN_ID", "677")
SIGNER = Account.from_key(KEY).address.lower() if KEY else ""


def message(equipment_id: int, owner: str, level: int, issued_at: int, expires_at: int, metadata_hash: str) -> str:
    """metadata_hash pins the listing details (name, location, category, description) that were reviewed.
    If the owner changes them, the hash no longer matches and the badge stops applying until it is re-granted."""
    return (f"EquipRent verification\nChain: {CHAIN_ID}\nContract: {CONTRACT}\nEquipment: {equipment_id}\n"
            f"Owner: {owner.lower()}\nMetadata: {metadata_hash}\nLevel: {level}\nIssued: {issued_at}\nExpires: {expires_at}")


def sign(equipment_id: int, owner: str, level: int, issued_at: int, expires_at: int, metadata_hash: str) -> str:
    msg = encode_defunct(text=message(equipment_id, owner, level, issued_at, expires_at, metadata_hash))
    return Account.sign_message(msg, private_key=KEY).signature.hex()


def attested_level(v, owner: str, current_hash: str) -> int:
    """Returns the level the attestation currently supports, or 1."""
    if not v or not SIGNER or v.revoked or v.expires_at <= time.time():
        return 1
    if not v.metadata_hash or v.metadata_hash != current_hash:
        return 1  # the listing changed since it was reviewed
    try:
        msg = encode_defunct(text=message(v.equipment_id, owner, v.level, v.issued_at, v.expires_at, v.metadata_hash))
        sig = v.signature if v.signature.startswith("0x") else "0x" + v.signature
        if Account.recover_message(msg, signature=sig).lower() != SIGNER:
            return 1
    except Exception:
        return 1
    return v.level if v.level in (2, 3) else 1
