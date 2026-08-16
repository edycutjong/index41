// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Index41} from "../src/Index41.sol";
import {Index41Base} from "./helpers/Index41Base.sol";

/**
 * @title Index41ClaimTest
 * @notice The claim path: one happy case built from the live mainnet sandwich, then that same
 *         case with exactly one thing broken, once per rule.
 */
contract Index41ClaimTest is Index41Base {
    // -----------------------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------------------

    function test_HappyPath_ReturnsHarmAndPayout() public {
        (uint256 harm, uint256 paid) = court.proveSandwich(_claim(_defaults()));
        assertEq(harm, 1 ether, "11 out minus 10 in");
        assertEq(paid, 1 ether, "the bond covers it");
    }

    function test_HappyPath_PaysTheProvenVictim() public {
        uint256 before = VICTIM.balance;
        court.proveSandwich(_claim(_defaults()));
        assertEq(VICTIM.balance, before + 1 ether);
    }

    function test_HappyPath_DebitsTheRelayBond() public {
        court.proveSandwich(_claim(_defaults()));
        assertEq(court.bondOf(relay), 99 ether);
    }

    function test_HappyPath_EmitsSandwichProven() public {
        vm.expectEmit(true, true, false, true, address(court));
        emit Index41.SandwichProven(SEARCHER, HEIGHT, 14, 15, 16, 1 ether, 1 ether);
        court.proveSandwich(_claim(_defaults()));
    }

    function test_HappyPath_EmitsHarmPaid() public {
        vm.expectEmit(true, true, false, true, address(court));
        emit Index41.HarmPaid(VICTIM, relay, 1 ether);
        court.proveSandwich(_claim(_defaults()));
    }

    function test_HappyPath_RecordsTheVerdict() public {
        court.proveSandwich(_claim(_defaults()));
        assertEq(court.claimCount(), 1);

        Index41.Verdict memory v = court.verdictAt(0);
        assertEq(v.relay, relay);
        assertEq(v.searcher, SEARCHER);
        assertEq(v.victim, VICTIM);
        assertEq(v.blockHeight, HEIGHT);
        assertEq(v.frontIndex, 14);
        assertEq(v.victimIndex, 15);
        assertEq(v.backIndex, 16);
        assertEq(v.harm, 1 ether);
        assertEq(v.paid, 1 ether);
    }

    function test_HappyPath_BurnsAllThreeLegQueryIds() public {
        court.proveSandwich(_claim(_defaults()));
        assertTrue(court.processedQueries(queryId(CHAIN_KEY_MAINNET, HEIGHT, 14)), "front-run leg");
        assertTrue(court.processedQueries(queryId(CHAIN_KEY_MAINNET, HEIGHT, 15)), "victim leg");
        assertTrue(court.processedQueries(queryId(CHAIN_KEY_MAINNET, HEIGHT, 16)), "back-run leg");
    }

    function test_HappyPath_BurnsTheCompositeClaimId() public {
        court.proveSandwich(_claim(_defaults()));
        assertTrue(court.processedQueries(court.claimIdFor(CHAIN_KEY_MAINNET, HEIGHT, ROOT, 14, 15, 16)));
    }

    function test_HappyPath_CallsThePrecompileOncePerLeg() public {
        court.proveSandwich(_claim(_defaults()));
        assertEq(verifier.verifyCalls(), 3, "no on-chain batch verify exists; three calls, one transaction");
    }

    function test_HappyPath_IsPermissionlessAndPaysTheVictimNotTheSubmitter() public {
        uint256 victimBefore = VICTIM.balance;
        uint256 submitterBefore = bystander.balance;

        vm.prank(bystander);
        court.proveSandwich(_claim(_defaults()));

        assertEq(VICTIM.balance, victimBefore + 1 ether, "the proof names the payee");
        assertEq(bystander.balance, submitterBefore, "front-running a claim earns nothing");
    }

    function test_HappyPath_WorksOnSepolia() public {
        Index41Base.Scenario memory s = _defaults();
        s.chainKey = CHAIN_KEY_SEPOLIA;
        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 1 ether);
    }

    function test_HappyPath_WhenNumeraireIsToken0() public {
        Index41Base.Scenario memory s = _defaults();
        s.numeraireIsToken0 = true;
        s.logsMirrored = true;
        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 1 ether, "pool token order must not change the answer");
    }

    function test_HappyPath_LegacyTransactions() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontType = 0;
        s.victimType = 0;
        s.backType = 0;
        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 1 ether, "type 0: gasPrice fills both fee slots");
    }

    function test_HappyPath_AccessListTransactions() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontType = 1;
        s.victimType = 1;
        s.backType = 1;
        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 1 ether, "type 1");
    }

    function test_HappyPath_BlobAndDelegationTransactions() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontType = 3; // blob-carrying
        s.victimType = 4; // EIP-7702 delegation
        s.backType = 2;
        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 1 ether, "types 3 and 4 carry their signature in a fourth chunk");
    }

    function test_HappyPath_IgnoresNonSwapLogs() public {
        // The front-run fixture carries a Sync log alongside its Swap; it must not be counted.
        (uint256 harm,) = court.proveSandwich(_claim(_defaults()));
        assertEq(harm, 1 ether);
    }

    function test_HappyPath_NonContiguousPositionsAreFine() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontIndex = 3;
        s.victimIndex = 97;
        s.backIndex = 210;
        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 1 ether, "ordering is what matters, not adjacency");
    }

    // -----------------------------------------------------------------------------------
    // Input shape
    // -----------------------------------------------------------------------------------

    function test_RejectTwoLegs() public {
        Index41Base.Scenario memory s = _defaults();
        s.legCount = 2;
        vm.expectRevert(abi.encodeWithSelector(Index41.WrongLegCount.selector, 2));
        court.proveSandwich(_claim(s));
    }

    function test_RejectFourLegs() public {
        Index41Base.Scenario memory s = _defaults();
        s.legCount = 4;
        vm.expectRevert(abi.encodeWithSelector(Index41.WrongLegCount.selector, 4));
        court.proveSandwich(_claim(s));
    }

    function test_RejectZeroLegs() public {
        Index41Base.Scenario memory s = _defaults();
        s.legCount = 0;
        vm.expectRevert(abi.encodeWithSelector(Index41.WrongLegCount.selector, 0));
        court.proveSandwich(_claim(s));
    }

    function test_RejectUnsupportedChainKey() public {
        Index41Base.Scenario memory s = _defaults();
        s.chainKey = 42;
        vm.expectRevert(abi.encodeWithSelector(Index41.UnsupportedChainKey.selector, uint64(42)));
        court.proveSandwich(_claim(s));
    }

    function test_RejectZeroPool() public {
        Index41Base.Scenario memory s = _defaults();
        s.pool = address(0);
        vm.expectRevert(Index41.ZeroAddressInput.selector);
        court.proveSandwich(_claim(s));
    }

    function test_RejectUnbondedRelay() public {
        Index41Base.Scenario memory s = _defaults();
        s.relay = bystander;
        vm.expectRevert(abi.encodeWithSelector(Index41.NoBondPosted.selector, bystander));
        court.proveSandwich(_claim(s));
    }

    // -----------------------------------------------------------------------------------
    // Same block
    // -----------------------------------------------------------------------------------

    function test_RejectLegsFromDifferentBlocks_StructurallyByRoot() public {
        Index41Base.Scenario memory s = _defaults();
        s.backRoot = OTHER_ROOT;
        vm.expectRevert(abi.encodeWithSelector(Index41.MerkleRootMismatch.selector, 2, ROOT, OTHER_ROOT));
        court.proveSandwich(_claim(s));
    }

    function test_RejectLegsFromDifferentBlocks_MiddleLeg() public {
        Index41Base.Scenario memory s = _defaults();
        s.victimRoot = OTHER_ROOT;
        vm.expectRevert(abi.encodeWithSelector(Index41.MerkleRootMismatch.selector, 1, ROOT, OTHER_ROOT));
        court.proveSandwich(_claim(s));
    }

    function test_RejectWrongHeightAtThePrecompile() public {
        verifier.attest(CHAIN_KEY_MAINNET, HEIGHT, ROOT);

        Index41Base.Scenario memory s = _defaults();
        s.height = HEIGHT + 1; // this root does not belong to that block
        vm.expectRevert(abi.encodeWithSelector(Index41.VerificationFailed.selector, 0));
        court.proveSandwich(_claim(s));
    }

    function test_AttestedBlockStillProvesFine() public {
        verifier.attest(CHAIN_KEY_MAINNET, HEIGHT, ROOT);
        (uint256 harm,) = court.proveSandwich(_claim(_defaults()));
        assertEq(harm, 1 ether);
    }

    function test_RejectWhenThePrecompileReverts() public {
        verifier.attest(CHAIN_KEY_MAINNET, HEIGHT, OTHER_ROOT);
        verifier.setRevertInsteadOfReport(true);
        vm.expectRevert("MockVerifier: block not attested");
        court.proveSandwich(_claim(_defaults()));
    }

    // -----------------------------------------------------------------------------------
    // The ordering assertion
    // -----------------------------------------------------------------------------------

    function test_RejectVictimBeforeFrontRun() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontIndex = 20;
        vm.expectRevert(abi.encodeWithSelector(Index41.NotAscending.selector, uint64(20), uint64(15), uint64(16)));
        court.proveSandwich(_claim(s));
    }

    function test_RejectBackRunBeforeVictim() public {
        Index41Base.Scenario memory s = _defaults();
        s.backIndex = 2;
        vm.expectRevert(abi.encodeWithSelector(Index41.NotAscending.selector, uint64(14), uint64(15), uint64(2)));
        court.proveSandwich(_claim(s));
    }

    function test_RejectCompletelyReversedOrder() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontIndex = 16;
        s.backIndex = 14;
        vm.expectRevert(abi.encodeWithSelector(Index41.NotAscending.selector, uint64(16), uint64(15), uint64(14)));
        court.proveSandwich(_claim(s));
    }

    /// @dev Two legs at the same position are the same transaction, so the replay guard fires first.
    function test_RejectDuplicatePositionWithinOneClaim() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontIndex = 15;
        vm.expectRevert(
            abi.encodeWithSelector(Index41.QueryAlreadyProcessed.selector, queryId(CHAIN_KEY_MAINNET, HEIGHT, 15))
        );
        court.proveSandwich(_claim(s));
    }

    // -----------------------------------------------------------------------------------
    // The sandwich shape
    // -----------------------------------------------------------------------------------

    function test_RejectDifferentSearchersOnTheOuterLegs() public {
        Index41Base.Scenario memory s = _defaults();
        s.backFrom = bystander;
        vm.expectRevert(abi.encodeWithSelector(Index41.SearcherMismatch.selector, SEARCHER, bystander));
        court.proveSandwich(_claim(s));
    }

    function test_RejectSearcherClaimingAgainstThemselves() public {
        Index41Base.Scenario memory s = _defaults();
        s.victimFrom = SEARCHER;
        vm.expectRevert(abi.encodeWithSelector(Index41.VictimIsSearcher.selector, SEARCHER));
        court.proveSandwich(_claim(s));
    }

    function test_RejectUncoveredEntrypoint() public {
        Index41Base.Scenario memory s = _defaults();
        s.victimTo = bystander;
        vm.expectRevert(abi.encodeWithSelector(Index41.EntrypointNotCovered.selector, relay, bystander));
        court.proveSandwich(_claim(s));
    }

    function test_RejectAfterCoverageIsRevoked() public {
        vm.prank(relay);
        court.declareCoverage(ROUTER, false);
        vm.expectRevert(abi.encodeWithSelector(Index41.EntrypointNotCovered.selector, relay, ROUTER));
        court.proveSandwich(_claim(_defaults()));
    }

    function test_RejectDifferentPoolOnTheBackRun() public {
        Index41Base.Scenario memory s = _defaults();
        s.backPool = bystander;
        vm.expectRevert(abi.encodeWithSelector(Index41.PoolNotTouched.selector, 2, POOL));
        court.proveSandwich(_claim(s));
    }

    function test_RejectDifferentPoolOnTheVictimLeg() public {
        Index41Base.Scenario memory s = _defaults();
        s.victimPool = bystander;
        vm.expectRevert(abi.encodeWithSelector(Index41.PoolNotTouched.selector, 1, POOL));
        court.proveSandwich(_claim(s));
    }

    function test_RejectRevertedVictimTransaction() public {
        Index41Base.Scenario memory s = _defaults();
        s.victimStatus = 0;
        vm.expectRevert(abi.encodeWithSelector(Index41.TransactionReverted.selector, 1));
        court.proveSandwich(_claim(s));
    }

    function test_RejectRevertedFrontRun() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontStatus = 0;
        vm.expectRevert(abi.encodeWithSelector(Index41.TransactionReverted.selector, 0));
        court.proveSandwich(_claim(s));
    }

    function test_RejectFrontRunThatSoldInsteadOfBought() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontNumeraireOut = 1 ether;
        vm.expectRevert(abi.encodeWithSelector(Index41.FrontRunNotABuy.selector, 10 ether, 1 ether));
        court.proveSandwich(_claim(s));
    }

    function test_RejectBackRunThatBoughtInsteadOfSold() public {
        Index41Base.Scenario memory s = _defaults();
        s.backNumeraireIn = 1 ether;
        vm.expectRevert(abi.encodeWithSelector(Index41.BackRunNotASell.selector, 1 ether, 11 ether));
        court.proveSandwich(_claim(s));
    }

    function test_RejectVictimTradingTheOtherWay() public {
        Index41Base.Scenario memory s = _defaults();
        s.victimNumeraireIn = 0; // victim sells into the pool instead of buying
        vm.expectRevert(abi.encodeWithSelector(Index41.VictimTradedOtherWay.selector, 0));
        court.proveSandwich(_claim(s));
    }

    function test_RejectFrontRunThatDidNotOutbidTheVictim() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontPriority = 1;
        s.victimPriority = 2;
        vm.expectRevert(abi.encodeWithSelector(Index41.FrontRunDidNotOutbid.selector, 1, 2));
        court.proveSandwich(_claim(s));
    }

    function test_AcceptEqualPriorityBids() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontPriority = 5;
        s.victimPriority = 5;
        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 1 ether, "the rule is >=, not >");
    }

    function test_RejectMalformedSwapPayload() public {
        Index41Base.Scenario memory s = _defaults();
        s.frontMalformed = true;
        vm.expectRevert(abi.encodeWithSelector(Index41.MalformedSwapLog.selector, 0, 64));
        court.proveSandwich(_claim(s));
    }

    /// @dev Declaring the wrong side of the pool as the numeraire is self-defeating, not exploitable.
    function test_WrongNumeraireSideIsSelfDefeating() public {
        Index41Base.Scenario memory s = _defaults();
        s.numeraireIsToken0 = true; // ...but the logs still put it in token1
        // Reading the wrong side turns the front-run's purchase into an apparent sale.
        vm.expectRevert(abi.encodeWithSelector(Index41.FrontRunNotABuy.selector, 0, 1000 ether));
        court.proveSandwich(_claim(s));
    }

    // -----------------------------------------------------------------------------------
    // Replay — the game rule
    // -----------------------------------------------------------------------------------

    function test_TheSameSandwichCannotBeClaimedTwice() public {
        court.proveSandwich(_claim(_defaults()));
        vm.expectRevert(
            abi.encodeWithSelector(Index41.QueryAlreadyProcessed.selector, queryId(CHAIN_KEY_MAINNET, HEIGHT, 14))
        );
        court.proveSandwich(_claim(_defaults()));
    }

    function test_ReplayFromADifferentSubmitterAlsoFails() public {
        court.proveSandwich(_claim(_defaults()));
        vm.prank(bystander);
        vm.expectRevert(
            abi.encodeWithSelector(Index41.QueryAlreadyProcessed.selector, queryId(CHAIN_KEY_MAINNET, HEIGHT, 14))
        );
        court.proveSandwich(_claim(_defaults()));
    }

    /// @dev Re-dressing the claim with fresh outer legs still cannot re-spend the victim's position.
    function test_ReplayWithFreshOuterLegsStillFails() public {
        court.proveSandwich(_claim(_defaults()));

        Index41Base.Scenario memory s = _defaults();
        s.frontIndex = 13;
        s.backIndex = 17;
        vm.expectRevert(
            abi.encodeWithSelector(Index41.QueryAlreadyProcessed.selector, queryId(CHAIN_KEY_MAINNET, HEIGHT, 15))
        );
        court.proveSandwich(_claim(s));
    }

    function test_ReplayPaysNothingTwice() public {
        court.proveSandwich(_claim(_defaults()));
        uint256 balanceAfterFirst = VICTIM.balance;
        uint256 bondAfterFirst = court.bondOf(relay);

        vm.expectRevert();
        court.proveSandwich(_claim(_defaults()));

        assertEq(VICTIM.balance, balanceAfterFirst);
        assertEq(court.bondOf(relay), bondAfterFirst);
        assertEq(court.claimCount(), 1);
    }

    /// @dev A different block is a different sandwich, and remains claimable.
    function test_ADifferentBlockIsADifferentSandwich() public {
        court.proveSandwich(_claim(_defaults()));

        Index41Base.Scenario memory s = _defaults();
        s.height = HEIGHT + 1;
        s.frontRoot = OTHER_ROOT;
        s.victimRoot = OTHER_ROOT;
        s.backRoot = OTHER_ROOT;

        (uint256 harm,) = court.proveSandwich(_claim(s));
        assertEq(harm, 1 ether);
        assertEq(court.claimCount(), 2);
    }
}
