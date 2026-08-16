// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Index41} from "../src/Index41.sol";
import {Index41Base, StubbornVictim} from "./helpers/Index41Base.sol";

/**
 * @title Index41BondTest
 * @notice The relay's side of the bargain: posting the bond, declaring what it routes, and the
 *         unbonding clock that stops a relay walking out ahead of a claim.
 */
contract Index41BondTest is Index41Base {
    address internal relay2 = makeAddr("relay2");

    function setUp() public override {
        super.setUp();
        vm.deal(relay2, 100 ether);
        vm.deal(bystander, 10 ether);
    }

    // -----------------------------------------------------------------------------------
    // Posting
    // -----------------------------------------------------------------------------------

    function test_SetUpBondIsCredited() public view {
        assertEq(court.bondOf(relay), 100 ether);
        assertEq(address(court).balance, 100 ether);
    }

    function test_PostBondAccumulates() public {
        vm.prank(relay);
        court.postBond{value: 5 ether}();
        assertEq(court.bondOf(relay), 105 ether);
    }

    function test_PostBondEmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(court));
        emit Index41.BondPosted(relay2, 7 ether, 7 ether);
        vm.prank(relay2);
        court.postBond{value: 7 ether}();
    }

    function test_PostBondZeroReverts() public {
        vm.prank(relay2);
        vm.expectRevert(Index41.ZeroBondAmount.selector);
        court.postBond{value: 0}();
    }

    function test_PostBondForCreditsTheNamedRelay() public {
        vm.prank(bystander);
        court.postBondFor{value: 3 ether}(relay2);
        assertEq(court.bondOf(relay2), 3 ether, "a treasury may fund an operator");
        assertEq(court.bondOf(bystander), 0, "and gains no bond of its own");
    }

    function test_PostBondForZeroAddressReverts() public {
        vm.prank(bystander);
        vm.expectRevert(Index41.ZeroAddressInput.selector);
        court.postBondFor{value: 1 ether}(address(0));
    }

    function test_BondsAreSegregatedPerRelay() public {
        vm.prank(relay2);
        court.postBond{value: 9 ether}();
        assertEq(court.bondOf(relay), 100 ether);
        assertEq(court.bondOf(relay2), 9 ether);
    }

    // -----------------------------------------------------------------------------------
    // Coverage
    // -----------------------------------------------------------------------------------

    function test_DeclareCoverageSetsTheFlag() public view {
        assertTrue(court.covers(relay, ROUTER));
    }

    function test_CoverageDefaultsToFalse() public view {
        assertFalse(court.covers(relay, BOT_ENTRY));
    }

    function test_CoverageIsPerRelay() public view {
        assertFalse(court.covers(relay2, ROUTER), "one relay's promise is not another's");
    }

    function test_CoverageCanBeRevoked() public {
        vm.prank(relay);
        court.declareCoverage(ROUTER, false);
        assertFalse(court.covers(relay, ROUTER));
    }

    function test_DeclareCoverageZeroAddressReverts() public {
        vm.prank(relay);
        vm.expectRevert(Index41.ZeroAddressInput.selector);
        court.declareCoverage(address(0), true);
    }

    function test_DeclareCoverageEmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(court));
        emit Index41.CoverageDeclared(relay2, ROUTER, true);
        vm.prank(relay2);
        court.declareCoverage(ROUTER, true);
    }

    /// @dev Access control: coverage is keyed by msg.sender, so nobody can declare for a relay.
    function test_BystanderCannotDeclareCoverageForARelay() public {
        vm.prank(bystander);
        court.declareCoverage(ROUTER, true);
        assertFalse(court.covers(relay2, ROUTER), "the declaration lands on the caller, not a victim");
        assertTrue(court.covers(bystander, ROUTER));
    }

    // -----------------------------------------------------------------------------------
    // Unbonding
    // -----------------------------------------------------------------------------------

    function test_RequestUnbondWithoutBondReverts() public {
        vm.prank(relay2);
        vm.expectRevert(abi.encodeWithSelector(Index41.NoBondPosted.selector, relay2));
        court.requestUnbond();
    }

    function test_RequestUnbondSetsTheClock() public {
        vm.prank(relay);
        court.requestUnbond();
        assertEq(court.unbondReadyAt(relay), uint64(block.timestamp) + 3 days);
    }

    function test_WithdrawWithoutRequestReverts() public {
        vm.prank(relay);
        vm.expectRevert(Index41.UnbondNotRequested.selector);
        court.withdrawBond(1 ether);
    }

    function test_WithdrawBeforeTheDelayReverts() public {
        vm.prank(relay);
        court.requestUnbond();
        uint64 readyAt = court.unbondReadyAt(relay);

        vm.warp(readyAt - 1);
        vm.prank(relay);
        vm.expectRevert(abi.encodeWithSelector(Index41.UnbondNotReady.selector, readyAt));
        court.withdrawBond(1 ether);
    }

    function test_WithdrawAfterTheDelaySucceeds() public {
        vm.prank(relay);
        court.requestUnbond();
        vm.warp(block.timestamp + 3 days);

        uint256 before = relay.balance;
        vm.prank(relay);
        court.withdrawBond(40 ether);

        assertEq(relay.balance, before + 40 ether);
        assertEq(court.bondOf(relay), 60 ether);
    }

    function test_WithdrawMoreThanBondedReverts() public {
        vm.prank(relay);
        court.requestUnbond();
        vm.warp(block.timestamp + 3 days);

        vm.prank(relay);
        vm.expectRevert(abi.encodeWithSelector(Index41.InsufficientBond.selector, 101 ether, 100 ether));
        court.withdrawBond(101 ether);
    }

    function test_WithdrawZeroReverts() public {
        vm.prank(relay);
        court.requestUnbond();
        vm.warp(block.timestamp + 3 days);

        vm.prank(relay);
        vm.expectRevert(Index41.ZeroBondAmount.selector);
        court.withdrawBond(0);
    }

    function test_WithdrawConsumesTheRequest() public {
        vm.prank(relay);
        court.requestUnbond();
        vm.warp(block.timestamp + 3 days);

        vm.prank(relay);
        court.withdrawBond(1 ether);

        assertEq(court.unbondReadyAt(relay), 0);
        vm.prank(relay);
        vm.expectRevert(Index41.UnbondNotRequested.selector);
        court.withdrawBond(1 ether);
    }

    function test_ToppingUpCancelsAPendingUnbond() public {
        vm.prank(relay);
        court.requestUnbond();
        assertGt(court.unbondReadyAt(relay), 0);

        vm.prank(relay);
        court.postBond{value: 1 wei}();
        assertEq(court.unbondReadyAt(relay), 0, "re-arming the promise cancels the exit");
    }

    /// @dev Access control: a relay's bond is reachable only by that relay.
    function test_BystanderCannotWithdrawARelaysBond() public {
        vm.prank(relay);
        court.requestUnbond();
        vm.warp(block.timestamp + 3 days);

        vm.prank(bystander);
        vm.expectRevert(Index41.UnbondNotRequested.selector);
        court.withdrawBond(1 ether);

        assertEq(court.bondOf(relay), 100 ether, "untouched");
    }

    /// @dev Access control: one relay's unbond request does not unlock another's bond.
    function test_OneRelaysRequestDoesNotUnlockAnothers() public {
        vm.prank(relay2);
        court.postBond{value: 5 ether}();
        vm.prank(relay2);
        court.requestUnbond();
        vm.warp(block.timestamp + 3 days);

        vm.prank(relay2);
        vm.expectRevert(abi.encodeWithSelector(Index41.InsufficientBond.selector, 100 ether, 5 ether));
        court.withdrawBond(100 ether);
    }

    /// @dev Withdrawal falls back to reverting the whole call, not a deferred credit like the
    ///      claim payout — a relay pulling its own bond is not the sympathetic case a victim is.
    function test_WithdrawToARelayThatRejectsEtherReverts() public {
        StubbornVictim stubbornRelay = new StubbornVictim();
        vm.deal(address(stubbornRelay), 10 ether);

        vm.prank(address(stubbornRelay));
        court.postBond{value: 5 ether}();

        vm.prank(address(stubbornRelay));
        court.requestUnbond();
        vm.warp(block.timestamp + 3 days);

        vm.prank(address(stubbornRelay));
        vm.expectRevert(Index41.TransferFailed.selector);
        court.withdrawBond(1 ether);

        assertEq(court.bondOf(address(stubbornRelay)), 5 ether, "a reverted transfer must not debit the bond");
    }

    function test_WithdrawEmitsEvent() public {
        vm.prank(relay);
        court.requestUnbond();
        vm.warp(block.timestamp + 3 days);

        vm.expectEmit(true, false, false, true, address(court));
        emit Index41.BondWithdrawn(relay, 10 ether, 90 ether);
        vm.prank(relay);
        court.withdrawBond(10 ether);
    }
}
