// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EquipRent} from "../src/EquipRent.sol";

contract EquipRentTest is Test {
    EquipRent er;
    address admin = address(this);
    address arbiter = makeAddr("arbiter");
    address owner_ = makeAddr("owner");
    address renter = makeAddr("renter");

    function setUp() public {
        er = new EquipRent(arbiter);
        vm.deal(renter, 10 ether);
        vm.prank(owner_);
        er.registerEquipment("ipfs://generator", 0.08 ether, 0.1 ether);
    }

    function _bookAndStart() internal returns (uint256 id) {
        vm.prank(renter);
        id = er.requestRental{value: 0.5 ether}(1, uint64(block.timestamp + 1 days), uint64(block.timestamp + 6 days));
        vm.prank(owner_);
        er.acceptRental(id);
        vm.prank(owner_);
        er.confirmHandover(id);
        vm.prank(renter);
        er.confirmHandover(id);
    }

    function test_happyPath() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.reportReturn(id);
        vm.prank(owner_);
        er.confirmReturn(id);

        // fee 0.4, platform 10% = 0.04, owner 0.36, renter deposit 0.1
        assertEq(er.balances(owner_), 0.36 ether);
        assertEq(er.balances(renter), 0.1 ether);
        assertEq(er.accruedFees(), 0.04 ether);
    }

    function test_noDoubleBooking() public {
        _bookAndStart();
        vm.prank(renter);
        uint256 id2 = er.requestRental{value: 0.5 ether}(1, uint64(block.timestamp + 2 days), uint64(block.timestamp + 7 days));
        vm.prank(owner_);
        vm.expectRevert(EquipRent.Overlap.selector);
        er.acceptRental(id2);
    }

    function test_arbiterCannotExceedEscrow() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.openDispute(id);
        vm.prank(arbiter);
        vm.expectRevert(EquipRent.BadInput.selector);
        er.resolveDispute(id, 1 ether);
    }

    function test_silentOwnerCannotLockFunds() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.reportReturn(id);
        vm.warp(block.timestamp + 3 days);
        er.settleAfterSilence(id);
        assertEq(er.balances(renter), 0.1 ether);
    }

    function test_adminCannotWithdrawEscrow() public {
        _bookAndStart();
        er.withdrawFees(admin); // sends only accruedFees, which is zero here
        assertEq(address(er).balance, 0.5 ether);
    }

    function test_evidenceOnlyByParties() public {
        uint256 id = _bookAndStart();
        vm.expectRevert(EquipRent.NotRenter.selector);
        er.submitEvidence(id, keccak256("photo"));
        vm.prank(renter);
        vm.expectEmit(true, true, false, true);
        emit EquipRent.EvidenceSubmitted(id, renter, keccak256("photo"));
        er.submitEvidence(id, keccak256("photo"));
    }

    function test_arbiterCannotBeAParty() public {
        uint256 id = _bookAndStart();
        er.setArbiter(renter);
        vm.prank(renter);
        er.openDispute(id);
        vm.prank(renter);
        vm.expectRevert(EquipRent.Conflict.selector);
        er.resolveDispute(id, 0);
    }

    function test_arbiterSplitPaysOut() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.openDispute(id);
        vm.prank(arbiter);
        er.resolveDispute(id, 0.3 ether); // owner 0.3 gross, fee 0.04, renter 0.2
        assertEq(er.balances(owner_), 0.26 ether);
        assertEq(er.balances(renter), 0.2 ether);
        assertEq(er.accruedFees(), 0.04 ether);
    }


    // ---------- Stalled handover ----------

    function _accepted() internal returns (uint256 id) {
        vm.prank(renter);
        id = er.requestRental{value: 0.5 ether}(1, uint64(block.timestamp + 1 days), uint64(block.timestamp + 6 days));
        vm.prank(owner_);
        er.acceptRental(id);
    }

    function test_ownerCanDisputeStalledHandover() public {
        uint256 id = _accepted();
        vm.prank(owner_);
        vm.expectRevert(EquipRent.BadState.selector);
        er.openDispute(id); // too early
        vm.warp(block.timestamp + 3 days); // start + grace
        vm.prank(owner_);
        er.openDispute(id);
        vm.prank(arbiter);
        er.resolveDispute(id, 0.1 ether);
        assertEq(er.balances(owner_) + er.balances(renter) + er.accruedFees(), 0.5 ether);
    }

    function test_renterNeedsConfirmedHandoverToDisputeStalled() public {
        uint256 id = _accepted();
        vm.warp(block.timestamp + 3 days);
        vm.prank(renter);
        vm.expectRevert(EquipRent.BadState.selector);
        er.openDispute(id);
        vm.prank(renter);
        er.confirmHandover(id);
        vm.prank(renter);
        er.openDispute(id);
    }

    function test_renterWhoConfirmedCannotCancelUnstarted() public {
        uint256 id = _accepted();
        vm.prank(renter);
        er.confirmHandover(id);
        vm.warp(block.timestamp + 3 days);
        vm.prank(renter);
        vm.expectRevert(EquipRent.BadState.selector);
        er.cancelUnstarted(id);
    }

    // ---------- Double-booking list ----------

    function test_closedRentalFreesTheSlot() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.reportReturn(id);
        vm.prank(owner_);
        er.confirmReturn(id);
        vm.prank(renter);
        uint256 id2 = er.requestRental{value: 0.5 ether}(1, uint64(block.timestamp + 2 days), uint64(block.timestamp + 7 days));
        vm.prank(owner_);
        er.acceptRental(id2);
    }

    // ---------- Fuzz ----------

    function testFuzz_splitConservesEscrow(uint256 ownerAmount, uint16 bps) public {
        bps = uint16(bound(bps, 0, 1500));
        ownerAmount = bound(ownerAmount, 0, 0.5 ether);
        er.setPlatformFeeBps(bps);
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.openDispute(id);
        vm.prank(arbiter);
        er.resolveDispute(id, ownerAmount);
        assertEq(er.balances(owner_) + er.balances(renter) + er.accruedFees(), 0.5 ether);
        assertEq(address(er).balance, 0.5 ether);
    }


    // ---------- Late returns ----------

    function test_lateReturnTakesOneDayRentPerLateDay() public {
        uint256 id = _bookAndStart();
        vm.warp(block.timestamp + 7 days); // end is +6 days, so one day late
        vm.prank(renter);
        er.reportReturn(id);
        vm.prank(owner_);
        er.confirmReturn(id);
        // fee 0.4, late 0.08. platform 10% of 0.4 = 0.04. owner 0.44, renter deposit 0.1 - 0.08
        assertEq(er.balances(owner_), 0.44 ether);
        assertEq(er.balances(renter), 0.02 ether);
        assertEq(er.accruedFees(), 0.04 ether);
    }

    function test_lateFeeCannotExceedDeposit() public {
        uint256 id = _bookAndStart();
        vm.warp(block.timestamp + 6 days + 10 days);
        vm.prank(renter);
        er.reportReturn(id);
        vm.prank(owner_);
        er.confirmReturn(id);
        assertEq(er.balances(renter), 0);
        assertEq(er.balances(owner_), 0.4 ether - 0.04 ether + 0.1 ether);
    }

    function test_returnInsideGraceIsNotLate() public {
        uint256 id = _bookAndStart();
        vm.warp(block.timestamp + 6 days + 5 hours);
        vm.prank(renter);
        er.reportReturn(id);
        vm.prank(owner_);
        er.confirmReturn(id);
        assertEq(er.balances(renter), 0.1 ether);
    }

    // ---------- Extensions ----------

    function test_extensionApprovedThenSettles() public {
        uint256 id = _bookAndStart();
        uint64 end = uint64(block.timestamp + 6 days);
        vm.prank(renter);
        er.requestExtension{value: 0.16 ether}(id, end + 2 days);
        vm.prank(owner_);
        er.approveExtension(id);
        vm.warp(end + 2 days);
        vm.prank(renter);
        er.reportReturn(id);
        vm.prank(owner_);
        er.confirmReturn(id);
        // fee 0.56, platform 0.056, owner 0.504, renter deposit 0.1, no late fee
        assertEq(er.balances(owner_), 0.504 ether);
        assertEq(er.balances(renter), 0.1 ether);
        assertEq(er.accruedFees(), 0.056 ether);
    }

    function test_extensionNeedsExactPayment() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        vm.expectRevert(EquipRent.BadInput.selector);
        er.requestExtension{value: 0.1 ether}(id, uint64(block.timestamp + 8 days));
    }

    function test_onlyOwnerApprovesExtension() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.requestExtension{value: 0.16 ether}(id, uint64(block.timestamp + 8 days));
        vm.prank(renter);
        vm.expectRevert(EquipRent.NotOwner.selector);
        er.approveExtension(id);
    }

    function test_extensionBlockedByNextBooking() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        uint256 next = er.requestRental{value: 0.26 ether}(1, uint64(block.timestamp + 7 days), uint64(block.timestamp + 9 days));
        vm.prank(owner_);
        er.acceptRental(next);
        vm.prank(renter);
        er.requestExtension{value: 0.16 ether}(id, uint64(block.timestamp + 8 days));
        vm.prank(owner_);
        vm.expectRevert(EquipRent.Overlap.selector);
        er.approveExtension(id);
    }

    function test_cancelExtensionRefunds() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.requestExtension{value: 0.16 ether}(id, uint64(block.timestamp + 8 days));
        vm.prank(owner_);
        er.cancelExtension(id); // owner rejects
        assertEq(er.balances(renter), 0.16 ether);
        vm.prank(owner_);
        vm.expectRevert(EquipRent.BadState.selector);
        er.approveExtension(id);
    }

    function test_returnRefundsPendingExtension() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.requestExtension{value: 0.16 ether}(id, uint64(block.timestamp + 8 days));
        vm.prank(renter);
        er.reportReturn(id);
        assertEq(er.balances(renter), 0.16 ether);
    }

    function test_disputeRefundsPendingExtension() public {
        uint256 id = _bookAndStart();
        vm.prank(renter);
        er.requestExtension{value: 0.16 ether}(id, uint64(block.timestamp + 8 days));
        vm.prank(owner_);
        er.openDispute(id);
        assertEq(er.balances(renter), 0.16 ether);
        vm.prank(arbiter);
        er.resolveDispute(id, 0.5 ether); // escrow is still only fee + deposit
    }

    receive() external payable {}
}
