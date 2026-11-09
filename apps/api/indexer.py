"""Chain indexer. Tries eth_getLogs first. If the RPC blocks it (BOT Chain's public RPC does),
falls back to scanning blocks and reading receipts of transactions sent to the contract."""
import os, time, logging
from web3 import Web3
from sqlalchemy.dialects import postgresql, sqlite
import db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("indexer")

RPC = os.environ["RPC_URL"]
ADDR = Web3.to_checksum_address(os.environ["CONTRACT_ADDRESS"])
CONFIRMATIONS = int(os.getenv("CONFIRMATIONS", "3"))
START_BLOCK = int(os.getenv("START_BLOCK", "0"))
CHAIN_ID = int(os.getenv("CHAIN_ID", "677"))
BATCH = int(os.getenv("BATCH", "50"))

EVENTS = {
    "EquipmentRegistered": [("id", "uint256", 1), ("owner", "address", 1), ("uri", "string", 0), ("dailyRate", "uint128", 0), ("deposit", "uint128", 0)],
    "EquipmentUpdated": [("id", "uint256", 1), ("uri", "string", 0), ("dailyRate", "uint128", 0), ("deposit", "uint128", 0), ("active", "bool", 0)],
    "RentalRequested": [("id", "uint256", 1), ("equipmentId", "uint256", 1), ("renter", "address", 1), ("start", "uint64", 0), ("end", "uint64", 0), ("fee", "uint128", 0), ("deposit", "uint128", 0), ("feeBps", "uint16", 0)],
    "RentalAccepted": [("id", "uint256", 1)],
    "RentalCancelled": [("id", "uint256", 1)],
    "HandoverConfirmed": [("id", "uint256", 1), ("by", "address", 0)],
    "ReturnReported": [("id", "uint256", 1), ("at", "uint64", 0)],
    "DisputeOpened": [("id", "uint256", 1), ("by", "address", 0), ("at", "uint64", 0)],
    "ExtensionRequested": [("id", "uint256", 1), ("newEnd", "uint64", 0), ("fee", "uint128", 0)],
    "ExtensionApproved": [("id", "uint256", 1), ("newEnd", "uint64", 0), ("newTotalFee", "uint128", 0)],
    "ExtensionCancelled": [("id", "uint256", 1)],
    "EvidenceSubmitted": [("id", "uint256", 1), ("by", "address", 1), ("hash", "bytes32", 0)],
    "RentalSettled": [("id", "uint256", 1), ("toOwner", "uint256", 0), ("toRenter", "uint256", 0), ("platformFee", "uint256", 0)],
}
ABI = [{"type": "event", "name": n, "anonymous": False,
        "inputs": [{"name": a, "type": t, "indexed": bool(i)} for a, t, i in args]} for n, args in EVENTS.items()]

w3 = Web3(Web3.HTTPProvider(RPC))
contract = w3.eth.contract(address=ADDR, abi=ABI)
TOPICS = {Web3.to_hex(w3.keccak(text=f"{n}({','.join(t for _, t, _ in a)})")): n for n, a in EVENTS.items()}


def fetch_logs(frm: int, to: int):
    try:
        return w3.eth.get_logs({"fromBlock": frm, "toBlock": to, "address": ADDR})
    except Exception as e:
        log.info("get_logs unavailable (%s), scanning blocks", str(e)[:60])
    out = []
    for n in range(frm, to + 1):
        blk = w3.eth.get_block(n, full_transactions=True)
        for tx in blk["transactions"]:
            if tx.get("to") and Web3.to_checksum_address(tx["to"]) == ADDR:
                out += [l for l in w3.eth.get_transaction_receipt(tx["hash"])["logs"] if l["address"] == ADDR]
    return out


def apply(s, name: str, a: dict):
    if name == "EquipmentRegistered":
        s.merge(db.Equipment(id=a["id"], owner=a["owner"].lower(), metadata_uri=a["uri"],
                             daily_rate=str(a["dailyRate"]), deposit=str(a["deposit"]), active=True))
    elif name == "EquipmentUpdated":
        e = s.get(db.Equipment, a["id"])
        if e:
            e.metadata_uri, e.daily_rate, e.deposit, e.active = a["uri"], str(a["dailyRate"]), str(a["deposit"]), a["active"]
    elif name == "RentalRequested":
        eq = s.get(db.Equipment, a["equipmentId"])
        s.merge(db.Rental(id=a["id"], equipment_id=a["equipmentId"], renter=a["renter"].lower(),
                          owner=eq.owner if eq else "", start=a["start"], end=a["end"], fee=str(a["fee"]),
                          deposit=str(a["deposit"]), fee_bps=a["feeBps"], status="Requested"))
    elif name == "EvidenceSubmitted":
        s.query(db.Evidence).filter_by(rental_id=a["id"], sha256=bytes(a["hash"]).hex()).update({"anchored": True})
    else:
        r = s.get(db.Rental, a["id"])
        if not r:
            return
        if name == "RentalAccepted": r.status = "Accepted"
        elif name == "RentalCancelled": r.status = "Cancelled"
        elif name == "ReturnReported": r.status, r.returned_at = "Returned", a["at"]
        elif name == "DisputeOpened": r.status, r.disputed_at = "Disputed", a["at"]
        elif name == "ExtensionRequested": r.pending_end, r.pending_fee = a["newEnd"], str(a["fee"])
        elif name == "ExtensionApproved":
            r.end, r.fee, r.pending_end, r.pending_fee = a["newEnd"], str(a["newTotalFee"]), 0, "0"
        elif name == "ExtensionCancelled": r.pending_end, r.pending_fee = 0, "0"
        elif name == "HandoverConfirmed":
            if a["by"].lower() == r.owner: r.owner_handover = True
            if a["by"].lower() == r.renter: r.renter_handover = True
            if r.owner_handover and r.renter_handover: r.status = "HandedOver"
        elif name == "RentalSettled":
            r.status, r.to_owner, r.to_renter = "Closed", str(a["toOwner"]), str(a["toRenter"])
            r.pending_end, r.pending_fee = 0, "0"


def run():
    db.init()
    if w3.eth.chain_id != CHAIN_ID:
        raise SystemExit(f"Wrong chain: RPC reports {w3.eth.chain_id}, expected {CHAIN_ID}")
    while True:
        try:
            with db.Session() as s:
                st = s.get(db.SyncState, "head")
                nxt = (st.block + 1) if st else START_BLOCK
                head = w3.eth.block_number - CONFIRMATIONS
                if nxt > head:
                    time.sleep(5); continue
                to = min(head, nxt + BATCH - 1)
                for lg in sorted(fetch_logs(nxt, to), key=lambda l: (l["blockNumber"], l["logIndex"])):
                    name = TOPICS.get(Web3.to_hex(lg["topics"][0]))
                    if not name: continue
                    tx, idx = Web3.to_hex(lg["transactionHash"]), lg["logIndex"]
                    if s.query(db.ChainEvent).filter_by(tx_hash=tx, log_index=idx).first(): continue
                    args = dict(getattr(contract.events, name)().process_log(lg)["args"])
                    apply(s, name, args)
                    s.add(db.ChainEvent(tx_hash=tx, log_index=idx, block_number=lg["blockNumber"], event_name=name))
                s.merge(db.SyncState(key="head", block=to))
                s.commit()
                log.info("indexed through block %s", to)
        except Exception:
            log.exception("indexer error, retrying")
            time.sleep(10)


if __name__ == "__main__":
    run()
