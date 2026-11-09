import os
from sqlalchemy import create_engine, inspect, text, String, Integer, Boolean, Text, UniqueConstraint, LargeBinary
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

url = os.getenv("DATABASE_URL", "sqlite:///./equiprent.db")
if url.startswith("postgres://"):
    url = url.replace("postgres://", "postgresql+psycopg2://", 1)
elif url.startswith("postgresql://"):
    url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
engine = create_engine(url, pool_pre_ping=True)
Session = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Metadata(Base):
    __tablename__ = "metadata"
    hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner: Mapped[str] = mapped_column(String(42), index=True)
    body: Mapped[str] = mapped_column(Text)


class Equipment(Base):
    __tablename__ = "equipment"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # on-chain id
    owner: Mapped[str] = mapped_column(String(42), index=True)
    metadata_uri: Mapped[str] = mapped_column(Text)
    daily_rate: Mapped[str] = mapped_column(String(40))  # wei as string
    deposit: Mapped[str] = mapped_column(String(40))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Rental(Base):
    __tablename__ = "rentals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # on-chain id
    equipment_id: Mapped[int] = mapped_column(Integer, index=True)
    renter: Mapped[str] = mapped_column(String(42), index=True)
    owner: Mapped[str] = mapped_column(String(42), index=True, default="")
    start: Mapped[int] = mapped_column(Integer)
    end: Mapped[int] = mapped_column(Integer)
    fee: Mapped[str] = mapped_column(String(40))
    deposit: Mapped[str] = mapped_column(String(40))
    fee_bps: Mapped[int] = mapped_column(Integer)
    owner_handover: Mapped[bool] = mapped_column(Boolean, default=False)
    renter_handover: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="Requested")
    to_owner: Mapped[str] = mapped_column(String(40), default="0")
    to_renter: Mapped[str] = mapped_column(String(40), default="0")
    returned_at: Mapped[int] = mapped_column(Integer, default=0)  # chain time of reportReturn
    disputed_at: Mapped[int] = mapped_column(Integer, default=0)  # chain time of openDispute
    pending_end: Mapped[int] = mapped_column(Integer, default=0)  # requested extension end, 0 when none
    pending_fee: Mapped[str] = mapped_column(String(40), default="0")  # extension fee held in escrow


class Verification(Base):
    """Platform attestation for a listing. The signature is over a message naming the contract, equipment, owner,
    level and expiry, so anyone can check it against the platform's verifier address."""
    __tablename__ = "verifications"
    equipment_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    level: Mapped[int] = mapped_column(Integer)  # 2 Verified, 3 Inspected
    issued_at: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer)
    signature: Mapped[str] = mapped_column(Text)
    note: Mapped[str] = mapped_column(Text, default="")
    metadata_hash: Mapped[str] = mapped_column(String(64), default="")  # listing details this attestation covers
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Evidence(Base):
    __tablename__ = "evidence"
    __table_args__ = (UniqueConstraint("rental_id", "sha256"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rental_id: Mapped[int] = mapped_column(Integer, index=True)
    submitter: Mapped[str] = mapped_column(String(42))
    note: Mapped[str] = mapped_column(Text, default="")
    filename: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(60))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    data: Mapped[bytes] = mapped_column(LargeBinary, default=b"")  # legacy rows only, new files go to the bucket
    storage_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    anchored: Mapped[bool] = mapped_column(Boolean, default=False)  # hash recorded on-chain
    created_at: Mapped[int] = mapped_column(Integer)


class ChainEvent(Base):
    __tablename__ = "chain_events"
    __table_args__ = (UniqueConstraint("tx_hash", "log_index"),)
    pk: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tx_hash: Mapped[str] = mapped_column(String(66))
    log_index: Mapped[int] = mapped_column(Integer)
    block_number: Mapped[int] = mapped_column(Integer, index=True)
    event_name: Mapped[str] = mapped_column(String(40))


class SyncState(Base):
    __tablename__ = "sync_state"
    key: Mapped[str] = mapped_column(String(20), primary_key=True)
    block: Mapped[int] = mapped_column(Integer)


# Columns added after the first release. create_all never alters existing tables, so add them here.
_NEW_COLUMNS = {
    "rentals": [("returned_at", "INTEGER DEFAULT 0"), ("disputed_at", "INTEGER DEFAULT 0"),
                ("pending_end", "INTEGER DEFAULT 0"), ("pending_fee", "VARCHAR(40) DEFAULT '0'")],
    "evidence": [("storage_key", "VARCHAR(200)")],
    "verifications": [("metadata_hash", "VARCHAR(64) DEFAULT ''")],
}


def init():
    Base.metadata.create_all(engine)
    insp = inspect(engine)
    with engine.begin() as c:
        for table, cols in _NEW_COLUMNS.items():
            have = {x["name"] for x in insp.get_columns(table)}
            for name, ddl in cols:
                if name not in have:
                    c.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
