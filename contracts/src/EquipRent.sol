// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// MVP core: registry, agreement, native BOT escrow, settlement and a basic dispute path.
/// Split into separate contracts later. The admin can never touch escrowed funds.
contract EquipRent is ReentrancyGuard, Pausable, Ownable {
    enum Status { None, Requested, Accepted, HandedOver, Returned, Disputed, Closed }

    struct Equipment {
        address owner;
        string metadataURI; // IPFS URI, content hash anchored by the URI
        uint128 dailyRate;
        uint128 deposit;
        bool active;
    }

    struct Rental {
        uint256 equipmentId;
        address owner;
        address renter;
        uint64 start;
        uint64 end;
        uint64 returnedAt; // set when the renter reports return
        uint64 disputedAt;
        uint128 fee;
        uint128 deposit;
        uint16 feeBps; // locked at request time
        bool ownerHandover;
        bool renterHandover;
        Status status;
        uint64 extEnd;   // pending extension: requested new end date, 0 when none
        uint128 extFee;  // pending extension: extra rental fee held in escrow
        uint128 rate;    // daily rate locked at request time
    }

    uint16 public constant MAX_FEE_BPS = 1500;
    uint64 public constant HANDOVER_GRACE = 2 days;
    uint64 public constant RETURN_WINDOW = 3 days; // owner must confirm or dispute
    uint64 public constant ARBITER_WINDOW = 14 days;
    uint64 public constant LATE_GRACE = 6 hours; // returns this close to the end date are not late

    uint16 public platformFeeBps = 1000;
    address public arbiter;
    uint256 public accruedFees;
    uint256 public nextEquipmentId = 1;
    uint256 public nextRentalId = 1;

    mapping(uint256 => Equipment) public equipment;
    mapping(uint256 => Rental) public rentals;
    mapping(uint256 => uint256[]) private _accepted; // equipmentId => live (accepted, not closed) rental ids
    mapping(uint256 => uint256) private _slot; // rentalId => 1-based index in _accepted[equipmentId]
    mapping(address => uint256) public balances; // pull payments

    event EquipmentRegistered(uint256 indexed id, address indexed owner, string uri, uint128 dailyRate, uint128 deposit);
    event EquipmentUpdated(uint256 indexed id, string uri, uint128 dailyRate, uint128 deposit, bool active);
    event RentalRequested(uint256 indexed id, uint256 indexed equipmentId, address indexed renter, uint64 start, uint64 end, uint128 fee, uint128 deposit, uint16 feeBps);
    event RentalAccepted(uint256 indexed id);
    event RentalCancelled(uint256 indexed id);
    event HandoverConfirmed(uint256 indexed id, address by);
    event ReturnReported(uint256 indexed id, uint64 at);
    event DisputeOpened(uint256 indexed id, address by, uint64 at);
    event ExtensionRequested(uint256 indexed id, uint64 newEnd, uint128 fee);
    event ExtensionApproved(uint256 indexed id, uint64 newEnd, uint128 newTotalFee);
    event ExtensionCancelled(uint256 indexed id);
    event RentalSettled(uint256 indexed id, uint256 toOwner, uint256 toRenter, uint256 platformFee);
    event Withdrawn(address indexed to, uint256 amount);
    event EvidenceSubmitted(uint256 indexed id, address indexed by, bytes32 hash);

    error NotOwner();
    error NotRenter();
    error BadState();
    error BadInput();
    error Overlap();
    error TooEarly();
    error Conflict();

    constructor(address _arbiter) Ownable(msg.sender) {
        arbiter = _arbiter;
    }

    // ---------- Registry ----------

    function registerEquipment(string calldata uri, uint128 dailyRate, uint128 deposit) external whenNotPaused returns (uint256 id) {
        if (dailyRate == 0) revert BadInput();
        id = nextEquipmentId++;
        equipment[id] = Equipment(msg.sender, uri, dailyRate, deposit, true);
        emit EquipmentRegistered(id, msg.sender, uri, dailyRate, deposit);
    }

    function updateEquipment(uint256 id, string calldata uri, uint128 dailyRate, uint128 deposit, bool active) external {
        Equipment storage e = equipment[id];
        if (e.owner != msg.sender) revert NotOwner();
        if (dailyRate == 0) revert BadInput();
        e.metadataURI = uri;
        e.dailyRate = dailyRate;
        e.deposit = deposit;
        e.active = active;
        emit EquipmentUpdated(id, uri, dailyRate, deposit, active);
    }

    // ---------- Booking and escrow ----------

    /// Renter pays fee + deposit up front. Funds stay in escrow until settlement.
    function requestRental(uint256 equipmentId, uint64 start, uint64 end) external payable whenNotPaused returns (uint256 id) {
        Equipment storage e = equipment[equipmentId];
        if (!e.active || e.owner == msg.sender) revert BadInput();
        if (start < block.timestamp || end <= start) revert BadInput();

        uint256 days_ = (uint256(end - start) + 1 days - 1) / 1 days;
        uint256 fee = days_ * e.dailyRate;
        if (msg.value != fee + e.deposit) revert BadInput();

        id = nextRentalId++;
        rentals[id] = Rental({
            equipmentId: equipmentId,
            owner: e.owner,
            renter: msg.sender,
            start: start,
            end: end,
            returnedAt: 0,
            disputedAt: 0,
            fee: uint128(fee),
            deposit: e.deposit,
            feeBps: platformFeeBps,
            ownerHandover: false,
            renterHandover: false,
            status: Status.Requested,
            extEnd: 0,
            extFee: 0,
            rate: e.dailyRate
        });
        emit RentalRequested(id, equipmentId, msg.sender, start, end, uint128(fee), e.deposit, platformFeeBps);
    }

    function acceptRental(uint256 id) external whenNotPaused {
        Rental storage r = rentals[id];
        if (r.owner != msg.sender) revert NotOwner();
        if (r.status != Status.Requested) revert BadState();
        if (r.start < block.timestamp) revert BadState();

        uint256[] storage list = _accepted[r.equipmentId];
        for (uint256 i; i < list.length; ++i) {
            Rental storage o = rentals[list[i]];
            if (r.start < o.end && o.start < r.end) revert Overlap(); // anti double-booking
        }
        list.push(id);
        _slot[id] = list.length;
        r.status = Status.Accepted;
        emit RentalAccepted(id);
    }

    /// Owner rejects, or renter withdraws, before acceptance. Full refund.
    function cancelRequest(uint256 id) external {
        Rental storage r = rentals[id];
        if (msg.sender != r.owner && msg.sender != r.renter) revert NotRenter();
        if (r.status != Status.Requested) revert BadState();
        r.status = Status.Closed;
        balances[r.renter] += uint256(r.fee) + r.deposit;
        emit RentalCancelled(id);
    }

    function confirmHandover(uint256 id) external {
        Rental storage r = rentals[id];
        if (r.status != Status.Accepted) revert BadState();
        if (msg.sender == r.owner) r.ownerHandover = true;
        else if (msg.sender == r.renter) r.renterHandover = true;
        else revert NotRenter();
        emit HandoverConfirmed(id, msg.sender);
        if (r.ownerHandover && r.renterHandover) r.status = Status.HandedOver;
    }

    /// Non-cooperation path: handover never confirmed, renter gets everything back.
    function cancelUnstarted(uint256 id) external {
        Rental storage r = rentals[id];
        if (msg.sender != r.renter) revert NotRenter();
        if (r.status != Status.Accepted) revert BadState();
        if (r.renterHandover) revert BadState(); // renter already confirmed receiving it, use a dispute instead
        if (block.timestamp < r.start + HANDOVER_GRACE) revert TooEarly();
        r.status = Status.Closed;
        _release(id);
        balances[r.renter] += uint256(r.fee) + r.deposit;
        emit RentalCancelled(id);
    }

    function reportReturn(uint256 id) external {
        Rental storage r = rentals[id];
        if (msg.sender != r.renter) revert NotRenter();
        if (r.status != Status.HandedOver) revert BadState();
        r.status = Status.Returned;
        r.returnedAt = uint64(block.timestamp);
        _refundExt(r, id); // returning ends the rental, so an unanswered extension is refunded
        emit ReturnReported(id, r.returnedAt);
    }

    /// Owner confirms the return: normal settlement, with a late fee if it came back after the end date.
    function confirmReturn(uint256 id) external nonReentrant {
        Rental storage r = rentals[id];
        if (msg.sender != r.owner) revert NotOwner();
        if (r.status != Status.Returned) revert BadState();
        _settleReturned(id);
    }

    /// Owner stayed silent past the window, renter triggers normal settlement.
    function settleAfterSilence(uint256 id) external nonReentrant {
        Rental storage r = rentals[id];
        if (r.status != Status.Returned) revert BadState();
        if (block.timestamp < r.returnedAt + RETURN_WINDOW) revert TooEarly();
        _settleReturned(id);
    }

    // ---------- Extensions ----------

    /// Renter asks for more time and escrows the extra fee. Needs the owner's approval.
    function requestExtension(uint256 id, uint64 newEnd) external payable whenNotPaused {
        Rental storage r = rentals[id];
        if (msg.sender != r.renter) revert NotRenter();
        if (r.status != Status.HandedOver) revert BadState();
        if (r.extFee != 0) revert BadState(); // one pending request at a time
        if (newEnd <= r.end) revert BadInput();
        uint256 days_ = (uint256(newEnd - r.end) + 1 days - 1) / 1 days;
        uint256 fee = days_ * r.rate;
        if (msg.value != fee) revert BadInput();
        r.extEnd = newEnd;
        r.extFee = uint128(fee);
        emit ExtensionRequested(id, newEnd, uint128(fee));
    }

    function approveExtension(uint256 id) external {
        Rental storage r = rentals[id];
        if (msg.sender != r.owner) revert NotOwner();
        if (r.status != Status.HandedOver || r.extFee == 0) revert BadState();
        uint256[] storage list = _accepted[r.equipmentId];
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == id) continue;
            Rental storage o = rentals[list[i]];
            if (r.end < o.end && o.start < r.extEnd) revert Overlap(); // extension would collide with another booking
        }
        r.fee += r.extFee;
        r.end = r.extEnd;
        r.extEnd = 0;
        r.extFee = 0;
        emit ExtensionApproved(id, r.end, r.fee);
    }

    /// Owner rejects or renter withdraws a pending extension. Full refund of the extra fee.
    function cancelExtension(uint256 id) external {
        Rental storage r = rentals[id];
        if (msg.sender != r.owner && msg.sender != r.renter) revert NotRenter();
        if (r.status != Status.HandedOver || r.extFee == 0) revert BadState();
        _refundExt(r, id);
    }

    // ---------- Disputes ----------

    /// Allowed while handed over, inside the return window, or once handover has stalled past the grace period.
    /// A stalled handover can be disputed by the owner, or by a renter who already confirmed receiving the machine.
    function openDispute(uint256 id) external {
        Rental storage r = rentals[id];
        bool isOwner = msg.sender == r.owner;
        if (!isOwner && msg.sender != r.renter) revert NotRenter();
        bool inReturnWindow = r.status == Status.Returned && block.timestamp < r.returnedAt + RETURN_WINDOW;
        bool stalledHandover = r.status == Status.Accepted
            && block.timestamp >= r.start + HANDOVER_GRACE
            && (isOwner || r.renterHandover);
        if (r.status != Status.HandedOver && !inReturnWindow && !stalledHandover) revert BadState();
        r.status = Status.Disputed;
        r.disputedAt = uint64(block.timestamp);
        _refundExt(r, id);
        emit DisputeOpened(id, msg.sender, r.disputedAt);
    }

    /// Anchors the hash of an off-chain evidence file with a block timestamp. Either party, any live stage.
    function submitEvidence(uint256 id, bytes32 hash) external {
        Rental storage r = rentals[id];
        if (msg.sender != r.owner && msg.sender != r.renter) revert NotRenter();
        if (r.status == Status.None || r.status == Status.Requested || r.status == Status.Closed) revert BadState();
        emit EvidenceSubmitted(id, msg.sender, hash);
    }

    /// Arbiter splits the escrow. The total can never exceed what the renter paid.
    function resolveDispute(uint256 id, uint256 ownerAmount) external nonReentrant {
        Rental storage r = rentals[id];
        if (msg.sender != arbiter) revert NotOwner();
        if (msg.sender == r.owner || msg.sender == r.renter) revert Conflict(); // conflict of interest
        if (r.status != Status.Disputed) revert BadState();
        uint256 total = uint256(r.fee) + r.deposit;
        if (ownerAmount > total) revert BadInput();
        _settle(id, ownerAmount, total - ownerAmount);
    }

    /// Arbiter missed the deadline: neutral default so funds never stay locked.
    function resolveStale(uint256 id) external nonReentrant {
        Rental storage r = rentals[id];
        if (r.status != Status.Disputed) revert BadState();
        if (block.timestamp < r.disputedAt + ARBITER_WINDOW) revert TooEarly();
        _settle(id, r.fee, r.deposit);
    }

    // ---------- Settlement ----------

    /// Late fee: one day's rent per late day after the grace period, taken from the deposit, never more than the deposit.
    function _settleReturned(uint256 id) private {
        Rental storage r = rentals[id];
        uint256 pen;
        if (r.returnedAt > r.end + LATE_GRACE) {
            uint256 lateDays = (uint256(r.returnedAt - r.end) + 1 days - 1) / 1 days;
            pen = lateDays * r.rate;
            if (pen > r.deposit) pen = r.deposit;
        }
        _settle(id, uint256(r.fee) + pen, uint256(r.deposit) - pen);
    }

    function _refundExt(Rental storage r, uint256 id) private {
        if (r.extFee == 0) return;
        balances[r.renter] += r.extFee;
        r.extFee = 0;
        r.extEnd = 0;
        emit ExtensionCancelled(id);
    }

    function _settle(uint256 id, uint256 ownerGross, uint256 renterAmount) private {
        Rental storage r = rentals[id];
        _refundExt(r, id);
        r.status = Status.Closed;
        _release(id);
        uint256 fee = (uint256(r.fee) * r.feeBps) / 10_000;
        if (fee > ownerGross) fee = ownerGross;
        uint256 toOwner = ownerGross - fee;
        accruedFees += fee;
        balances[r.owner] += toOwner;
        balances[r.renter] += renterAmount;
        emit RentalSettled(id, toOwner, renterAmount, fee);
    }

    /// Drops a closed rental from its equipment's live list so the double-booking check stays cheap.
    function _release(uint256 id) private {
        uint256 slot = _slot[id];
        if (slot == 0) return;
        uint256[] storage list = _accepted[rentals[id].equipmentId];
        uint256 last = list[list.length - 1];
        list[slot - 1] = last;
        _slot[last] = slot;
        list.pop();
        delete _slot[id];
    }

    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert BadInput();
        balances[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    // ---------- Admin: can touch fees and settings only, never escrow ----------

    function withdrawFees(address to) external onlyOwner nonReentrant {
        uint256 amount = accruedFees;
        accruedFees = 0;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "transfer failed");
    }

    function setPlatformFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert BadInput();
        platformFeeBps = bps; // applies to new rentals only
    }

    function setArbiter(address a) external onlyOwner {
        arbiter = a;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
