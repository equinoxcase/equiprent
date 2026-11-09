"""One-off: move evidence files stored in the database into the bucket. Safe to re-run.
Run once after setting the S3_* variables:  python migrate_evidence.py"""
import hashlib
from sqlalchemy import select
import db, storage

if not storage.enabled():
    raise SystemExit("Set S3_BUCKET and the other S3_* variables first")
db.init()
moved = 0
with db.Session() as s:
    for e in s.scalars(select(db.Evidence).where(db.Evidence.storage_key.is_(None))).all():
        if hashlib.sha256(e.data).hexdigest() != e.sha256:
            print(f"skip evidence {e.id}: stored bytes do not match the recorded hash")
            continue
        key = f"evidence/{e.rental_id}/{e.sha256}"
        storage.put(key, e.data, e.content_type)
        e.storage_key, e.data = key, b""
        moved += 1
    s.commit()
print(f"moved {moved} files")
