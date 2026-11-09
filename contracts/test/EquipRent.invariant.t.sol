// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EquipRent} from "../src/EquipRent.sol";

/// Drives random, valid-looking call sequences against the escrow. Reverts are expected and ignored.
contract Handler is Test {
    EquipRent public er;
    address public admin;
    address public arbiter;
    address public owner_;
    address public sink = makeAddr("sink");
    address[3] public renters;
    uint256 public ghostIn;
    uint256 public ghostOut;

    constructor(EquipRent _er, address _admin, address _arbiter) {
        er = _er;
        admin = _admin;
        arbiter = _arbiter;
        owner_ = makeAddr("owner");
        for (uint256 i; i < 3; ++i) {
            renters[i] = makeAddr(string(abi.encodePacked("renter", vm.toString(i))));
            vm.deal(renters[i], 1000 ether);
        }
        vm.prank(owner_);
        er.registerEquipment("ipfs://generator", 0.08 ether, 0.1 ether);
    }

    function _id(uint256 seed) internal view returns (uint256) {
        uint256 n = er.nextRentalId();
        return n > 1 ? 1 + seed % (n - 1) : 1;
    }

    function request(uint256 who, uint256 delay, uint256 len) external {
        address r = renters[who % 3];
        uint64 start = uint64(block.timestamp + 1 + (delay % 3) * 1 days);
        uint64 end = start + uint64((1 + len % 5) * 1 days);
        (, , uint128 rate, uint128 dep, ) = er.equipment(1);
        uint256 value = uint256((1 + len % 5)) * rate + dep;
        vm.prank(r);
        er.requestRental{value: value}(1, start, end);
        ghostIn += value;
    }

    function accept(uint256 seed) external { vm.prank(owner_); er.acceptRental(_id(seed)); }
    function cancelRequest(uint256 seed, uint256 who) external { vm.prank(who % 2 == 0 ? owner_ : renters[who % 3]); er.cancelRequest(_id(seed)); }
    function handoverOwner(uint256 seed) external { vm.prank(owner_); er.confirmHandover(_id(seed)); }
    function handoverRenter(uint256 seed, uint256 who) external { vm.prank(renters[who % 3]); er.confirmHandover(_id(seed)); }
    function cancelUnstarted(uint256 seed, uint256 who) external { vm.prank(renters[who % 3]); er.cancelUnstarted(_id(seed)); }
    function report(uint256 seed, uint256 who) external { vm.prank(renters[who % 3]); er.reportReturn(_id(seed)); }
    function confirmReturn(uint256 seed) external { vm.prank(owner_); er.confirmReturn(_id(seed)); }
    function silence(uint256 seed) external { er.settleAfterSilence(_id(seed)); }
    function dispute(uint256 seed, uint256 who) external { vm.prank(who % 2 == 0 ? owner_ : renters[who % 3]); er.openDispute(_id(seed)); }
    function resolve(uint256 seed, uint256 amount) external { vm.prank(arbiter); er.resolveDispute(_id(seed), amount % 1 ether); }
    function resolveStale(uint256 seed) external { er.resolveStale(_id(seed)); }

    function withdraw(uint256 who) external {
        address a = who % 4 == 0 ? owner_ : renters[who % 3];
        uint256 amount = er.balances(a);
        vm.prank(a);
        er.withdraw();
        ghostOut += amount;
    }

    function withdrawFees() external {
        uint256 amount = er.accruedFees();
        vm.prank(admin);
        er.withdrawFees(sink);
        ghostOut += amount;
    }

    function requestExt(uint256 seed, uint256 extra) external {
        uint256 id = _id(seed);
        (,,,, uint64 end,,,,,,,,,,,) = er.rentals(id);
        uint256 d = 1 + extra % 3;
        (, , uint128 rate, , ) = er.equipment(1);
        uint256 value = d * rate;
        (, , address r, , , , , , , , , , , , , ) = er.rentals(id);
        vm.prank(r);
        er.requestExtension{value: value}(id, end + uint64(d * 1 days));
        ghostIn += value;
    }
    function approveExt(uint256 seed) external { vm.prank(owner_); er.approveExtension(_id(seed)); }
    function cancelExt(uint256 seed, uint256 who) external { vm.prank(who % 2 == 0 ? owner_ : renters[who % 3]); er.cancelExtension(_id(seed)); }

    function warp(uint256 secs) external { vm.warp(block.timestamp + secs % 20 days); }
}

contract EquipRentInvariantTest is Test {
    EquipRent er;
    Handler h;

    function setUp() public {
        er = new EquipRent(makeAddr("arbiter"));
        h = new Handler(er, address(this), makeAddr("arbiter"));
        targetContract(address(h));
    }

    /// Contract balance equals what is owed to parties, plus fees, plus escrow (fee, deposit, pending extension) of every open rental.
    function invariant_balanceMatchesObligations() public view {
        uint256 owed = er.accruedFees() + er.balances(h.owner_());
        for (uint256 i; i < 3; ++i) owed += er.balances(h.renters(i));
        uint256 escrow;
        for (uint256 i = 1; i < er.nextRentalId(); ++i) {
            (,,,,,,, uint128 fee, uint128 dep,,,, EquipRent.Status st,, uint128 ext,) = er.rentals(i);
            if (st != EquipRent.Status.Closed) escrow += uint256(fee) + dep + ext;
        }
        assertEq(address(er).balance, owed + escrow);
    }

    /// Nothing leaves the contract except through withdraw and withdrawFees.
    function invariant_balanceMatchesFlows() public view {
        assertEq(address(er).balance, h.ghostIn() - h.ghostOut());
    }
}
