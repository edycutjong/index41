// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Index41} from "../src/Index41.sol";
import {Index41Base, StubbornVictim, GasHungryVictim} from "./helpers/Index41Base.sol";

/**
 * @title Index41HarmTest
 * @notice Harm arithmetic, bond exhaustion, and getting the money to the victim.
 *
 * @dev Harm is the attacker's REALIZED PROFIT — numeraire committed on the way in versus
 *      numeraire taken back out, both read from logs the merkle root already commits to. It is
 *      deliberately not a counterfactual against a pre-sandwich reserve ratio: Attestcoin proves
 *      transaction history, not state, and a contract claiming otherwise would be lying.
 */
contract Index41HarmTest is Index41Base {
    address internal poorRelay = makeAddr("poorRelay");

    function setUp() public override {
        super.setUp();
        vm.deal(poorRelay, 10 ether);
    }

    function _bondPoorRelay(uint256 amount) internal {
        vm.prank(poorRelay);
        court.postBond{value: amount}();
        vm.prank(poorRelay);
        court.declareCoverage(ROUTER, true);
    }

    // -----------------------------------------------------------------------------------
    // Arithmetic
    // -----------------------------------------------------------------------------------

    function test_HarmIsBackRunOutMinusFrontRunIn() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontNumeraireIn = 3 ether;
        s.backNumeraireOut = 7.5 ether;
        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 4.5 ether);
    }

    function test_HarmOfExactlyOneWei() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontNumeraireIn = 10 ether;
        s.backNumeraireOut = 10 ether + 1;
        (uint256 harm, uint256 paid) = court.proveSandwich(_claim(s));
        assertEq(harm, 1);
        assertEq(paid, 1);
    }

    function test_BreakEvenSandwichIsNotHarm() public {
        Index41Base.Scenario memory s = _defaults();
        s.backNumeraireOut = s.frontNumeraireIn;
        vm.expectRevert(abi.encodeWithSelector(Index41.NoRealizedProfit.selector, 10 ether, 10 ether));
        court.proveSandwich(_claim(s));
    }

    function test_LosingSandwichIsNotHarm() public {
        Index41Base.Scenario memory s = _defaults();
        s.backNumeraireOut = 9 ether;
        vm.expectRevert(abi.encodeWithSelector(Index41.NoRealizedProfit.selector, 10 ether, 9 ether));
        court.proveSandwich(_claim(s));
    }

    /// @dev A leg may hit the pool more than once; every Swap it caused counts.
    function test_MultipleSwapsInOneLegAreSummed() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontExtraNumeraireIn = 2 ether; // total committed becomes 12 ether
        vm.expectRevert(abi.encodeWithSelector(Index41.NoRealizedProfit.selector, 12 ether, 11 ether));
        court.proveSandwich(_claim(s));
    }

    function test_MultipleSwapsChangeTheHarmNotJustTheCheck() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontExtraNumeraireIn = 2 ether;
        s.backNumeraireOut = 15 ether;
        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 3 ether, "15 out minus (10 + 2) in");
    }

    function test_LargeHarmDoesNotOverflow() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontNumeraireIn = 1;
        s.backNumeraireOut = type(uint128).max;
        (uint256 harm, uint256 paid) = court.proveSandwich(_claim(s));
        assertEq(harm, uint256(type(uint128).max) - 1);
        assertEq(paid, 100 ether, "capped at the bond");
    }

    // -----------------------------------------------------------------------------------
    // Bond exhaustion
    // -----------------------------------------------------------------------------------

    function test_PayoutIsCappedAtTheBond() public {
        _bondPoorRelay(0.25 ether);

        Index41Base.Scenario memory s = _defaults();
        s.relay = poorRelay;

        (uint256 harm, uint256 paid) = court.proveSandwich(_claim(s));
        assertEq(harm, 1 ether, "the harm is what it is");
        assertEq(paid, 0.25 ether, "the bond is what it is");
    }

    function test_ExhaustedBondGoesToZero() public {
        _bondPoorRelay(0.25 ether);
        Index41Base.Scenario memory s = _defaults();
        s.relay = poorRelay;
        court.proveSandwich(_claim(s));
        assertEq(court.bondOf(poorRelay), 0);
    }

    function test_ExhaustedBondEmitsTheShortfall() public {
        _bondPoorRelay(0.25 ether);
        Index41Base.Scenario memory s = _defaults();
        s.relay = poorRelay;

        vm.expectEmit(true, false, false, true, address(court));
        emit Index41.BondExhausted(poorRelay, 0.75 ether);
        court.proveSandwich(_claim(s));
    }

    function test_ExhaustedBondStillPaysWhatItCan() public {
        _bondPoorRelay(0.25 ether);
        Index41Base.Scenario memory s = _defaults();
        s.relay = poorRelay;

        uint256 before = VICTIM.balance;
        court.proveSandwich(_claim(s));
        assertEq(VICTIM.balance, before + 0.25 ether);
    }

    function test_ASecondClaimAgainstAnEmptyBondIsRejected() public {
        _bondPoorRelay(0.25 ether);
        Index41Base.Scenario memory s = _defaults();
        s.relay = poorRelay;
        court.proveSandwich(_claim(s));

        Index41Base.Scenario memory s2 = _defaults();
        s2.relay = poorRelay;
        s2.height = HEIGHT + 5;
        s2.frontRoot = OTHER_ROOT;
        s2.victimRoot = OTHER_ROOT;
        s2.backRoot = OTHER_ROOT;

        vm.expectRevert(abi.encodeWithSelector(Index41.NoBondPosted.selector, poorRelay));
        court.proveSandwich(_claim(s2));
    }

    function test_ExactlyEnoughBondPaysInFull() public {
        _bondPoorRelay(1 ether);
        Index41Base.Scenario memory s = _defaults();
        s.relay = poorRelay;

        (uint256 harm, uint256 paid) = court.proveSandwich(_claim(s));
        assertEq(harm, paid);
        assertEq(court.bondOf(poorRelay), 0);
    }

    function test_ClaimsDoNotTouchOtherRelaysBonds() public {
        _bondPoorRelay(1 ether);
        Index41Base.Scenario memory s = _defaults();
        s.relay = poorRelay;
        court.proveSandwich(_claim(s));
        assertEq(court.bondOf(relay), 100 ether, "the other relay is not on the hook");
    }

    function test_TheVerdictRecordsTheShortfall() public {
        _bondPoorRelay(0.25 ether);
        Index41Base.Scenario memory s = _defaults();
        s.relay = poorRelay;
        court.proveSandwich(_claim(s));

        Index41.Verdict memory v = court.verdictAt(0);
        assertEq(v.harm, 1 ether);
        assertEq(v.paid, 0.25 ether);
        assertGt(v.harm, v.paid, "under-collateralised, and the record says so");
    }

    // -----------------------------------------------------------------------------------
    // Getting the money to the victim
    // -----------------------------------------------------------------------------------

    function test_PayoutIsDeferredWhenTheVictimRejectsEther() public {
        StubbornVictim stubborn = new StubbornVictim();

        Index41Base.Scenario memory s = _defaults();
        s.victimFrom = address(stubborn);

        court.proveSandwich(_claim(s));
        assertEq(court.deferredPayout(address(stubborn)), 1 ether, "credited, not lost");
        assertEq(address(stubborn).balance, 0);
    }

    function test_DeferredPayoutEmitsItsOwnEvent() public {
        StubbornVictim stubborn = new StubbornVictim();
        Index41Base.Scenario memory s = _defaults();
        s.victimFrom = address(stubborn);

        vm.expectEmit(true, false, false, true, address(court));
        emit Index41.PayoutDeferred(address(stubborn), 1 ether);
        court.proveSandwich(_claim(s));
    }

    function test_DeferredPayoutCanBePulled() public {
        GasHungryVictim hungry = new GasHungryVictim();

        Index41Base.Scenario memory s = _defaults();
        s.victimFrom = address(hungry);
        court.proveSandwich(_claim(s));

        assertEq(court.deferredPayout(address(hungry)), 1 ether, "30k gas was not enough to push");

        vm.prank(address(hungry));
        court.withdrawPayout();

        assertEq(address(hungry).balance, 1 ether);
        assertEq(court.deferredPayout(address(hungry)), 0);
    }

    function test_WithdrawPayoutWithNothingOwedReverts() public {
        vm.prank(bystander);
        vm.expectRevert(Index41.NothingToWithdraw.selector);
        court.withdrawPayout();
    }

    function test_WithdrawPayoutCannotBeDrainedTwice() public {
        GasHungryVictim hungry = new GasHungryVictim();
        Index41Base.Scenario memory s = _defaults();
        s.victimFrom = address(hungry);
        court.proveSandwich(_claim(s));

        vm.prank(address(hungry));
        court.withdrawPayout();

        vm.prank(address(hungry));
        vm.expectRevert(Index41.NothingToWithdraw.selector);
        court.withdrawPayout();
    }

    function test_ABystanderCannotStealADeferredPayout() public {
        StubbornVictim stubborn = new StubbornVictim();
        Index41Base.Scenario memory s = _defaults();
        s.victimFrom = address(stubborn);
        court.proveSandwich(_claim(s));

        vm.prank(bystander);
        vm.expectRevert(Index41.NothingToWithdraw.selector);
        court.withdrawPayout();

        assertEq(court.deferredPayout(address(stubborn)), 1 ether, "still the victim's");
    }

    function test_AVictimThatCannotReceiveAtAllStaysCredited() public {
        StubbornVictim stubborn = new StubbornVictim();
        Index41Base.Scenario memory s = _defaults();
        s.victimFrom = address(stubborn);
        court.proveSandwich(_claim(s));

        vm.prank(address(stubborn));
        vm.expectRevert(Index41.TransferFailed.selector);
        court.withdrawPayout();

        assertEq(court.deferredPayout(address(stubborn)), 1 ether, "the credit survives a failed pull");
    }

    function test_ContractBalanceMatchesOutstandingObligations() public {
        court.proveSandwich(_claim(_defaults()));
        assertEq(address(court).balance, 99 ether, "bond out, nothing stranded");
        assertEq(court.bondOf(relay), 99 ether);
    }
}
