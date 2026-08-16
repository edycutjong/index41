// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Index41} from "../src/Index41.sol";
import {INativeQueryVerifier} from "../src/interfaces/INativeQueryVerifier.sol";
import {Index41Base} from "./helpers/Index41Base.sol";

/**
 * @title Index41MechanismTest
 * @notice The mechanism itself: wiring, constants, and position recovery from merkle laterality.
 */
contract Index41MechanismTest is Index41Base {
    // -----------------------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------------------

    function test_VerifierIsThePrecompileAddress() public view {
        assertEq(address(court.VERIFIER()), PRECOMPILE, "must talk to 0x...0FD2 and nothing else");
    }

    function test_SwapSignatureMatchesTheRealUniswapV2Topic() public view {
        assertEq(
            court.UNISWAP_V2_SWAP(),
            0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822,
            "topic0 of Swap(address,uint256,uint256,uint256,uint256,address)"
        );
    }

    function test_ChainKeysAreAttestcoinKeysNotChainIds() public view {
        assertEq(court.ETHEREUM_MAINNET(), 3, "mainnet is chain KEY 3, not chain id 1");
        assertEq(court.ETHEREUM_SEPOLIA(), 1, "sepolia is chain KEY 1, not chain id 11155111");
    }

    function test_UnbondDelayIsThreeDays() public view {
        assertEq(court.UNBOND_DELAY(), 3 days);
    }

    function test_StartsWithNoClaims() public view {
        assertEq(court.claimCount(), 0);
    }

    // -----------------------------------------------------------------------------------
    // Position recovery — the one thing nothing else can do
    // -----------------------------------------------------------------------------------

    /// @dev The three laterality patterns below are what Ethereum mainnet block 25764741
    ///      actually carried. See docs/spike-output.txt.
    ///
    ///      IMPORTANT — what this asserts against: `court.VERIFIER()` is `vm.etch`'d to
    ///      `MockVerifier` in this suite (unit tests run on a bare EVM; the real precompile at
    ///      0x...0FD2 has no code there), and `MockVerifier.calculateTxIndex` is a from-scratch
    ///      Solidity reimplementation of the laterality algorithm, not the precompile. These
    ///      three tests prove the mock decodes these exact mainnet paths to 14/15/16 — they do
    ///      NOT exercise the real precompile.
    ///
    ///      The precompile itself was independently confirmed against these same three paths on
    ///      CC3 testnet: OrderProbe's live `proveOrder` call returned `[14, 15, 16]` from
    ///      `INativeQueryVerifier.calculateTxIndex` at the real precompile address, transcript at
    ///      docs/spike-output.txt section 7 (tx
    ///      0x42f725dd8c875185b216b6bbda01d37e12f605c4e8dbd832e7649a8abeeedd02), and again in the
    ///      deployment run at docs/DEPLOYMENT.md (tx
    ///      0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810).
    function test_MockDecodesLiveMainnetLateralityToFourteen() public view {
        assertEq(court.txIndexOf(ROOT, pathFromPattern("RLLLRRRR")), 14, "front-run: 0b00001110");
    }

    function test_MockDecodesLiveMainnetLateralityToFifteen() public view {
        assertEq(court.txIndexOf(ROOT, pathFromPattern("LLLLRRRR")), 15, "victim: 0b00001111");
    }

    function test_MockDecodesLiveMainnetLateralityToSixteen() public view {
        assertEq(court.txIndexOf(ROOT, pathFromPattern("RRRRLRRR")), 16, "back-run: 0b00010000");
    }

    function test_AllLeftIsTopOfBlockIsZero() public view {
        assertEq(court.txIndexOf(ROOT, pathFromPattern("RRRRRRRR")), 0, "no left siblings means position 0");
    }

    function test_PositionFortyOne() public view {
        // 41 = 0b00101001 -> bits 0, 3, 5 set, LSB first.
        assertEq(court.txIndexOf(ROOT, pathFromPattern("LRRLRLRR")), 41);
    }

    function test_TxIndexOfRoundTripsEveryPositionInTheTree() public view {
        for (uint64 i = 0; i < 256; ++i) {
            assertEq(court.txIndexOf(ROOT, pathFor(i)), i, "laterality must round-trip");
        }
    }

    function test_TxIndexOfIsAViewAndCostsNoState() public {
        uint256 snapshot = vm.snapshotState();
        court.txIndexOf(ROOT, pathFor(14));
        assertTrue(vm.revertToState(snapshot), "view calls change nothing");
    }

    function test_EmptyPathIsPositionZero() public view {
        INativeQueryVerifier.MerkleProofEntry[] memory none = new INativeQueryVerifier.MerkleProofEntry[](0);
        assertEq(court.txIndexOf(ROOT, none), 0);
    }

    // -----------------------------------------------------------------------------------
    // Replay namespace
    // -----------------------------------------------------------------------------------

    function test_ClaimIdIsDeterministic() public view {
        bytes32 a = court.claimIdFor(3, HEIGHT, ROOT, 14, 15, 16);
        bytes32 b = court.claimIdFor(3, HEIGHT, ROOT, 14, 15, 16);
        assertEq(a, b);
    }

    function test_ClaimIdChangesWithEveryComponent() public view {
        bytes32 base = court.claimIdFor(3, HEIGHT, ROOT, 14, 15, 16);
        assertTrue(base != court.claimIdFor(1, HEIGHT, ROOT, 14, 15, 16), "chain key");
        assertTrue(base != court.claimIdFor(3, HEIGHT + 1, ROOT, 14, 15, 16), "height");
        assertTrue(base != court.claimIdFor(3, HEIGHT, OTHER_ROOT, 14, 15, 16), "root");
        assertTrue(base != court.claimIdFor(3, HEIGHT, ROOT, 13, 15, 16), "front index");
        assertTrue(base != court.claimIdFor(3, HEIGHT, ROOT, 14, 15, 17), "back index");
    }

    function test_ProcessedQueriesStartsEmpty() public view {
        assertFalse(court.processedQueries(queryId(3, HEIGHT, 14)));
        assertFalse(court.processedQueries(queryId(3, HEIGHT, 15)));
        assertFalse(court.processedQueries(queryId(3, HEIGHT, 16)));
    }

    // -----------------------------------------------------------------------------------
    // The generic USCBase path is deliberately closed
    // -----------------------------------------------------------------------------------

    function test_GenericExecuteIsDisabled() public {
        vm.expectRevert(abi.encodeWithSelector(Index41.GenericExecuteDisabled.selector, uint8(7)));
        court.execute(7, CHAIN_KEY_MAINNET, HEIGHT, hex"00", ROOT, pathFor(15), keccak256("lower"), _continuityRoots());
    }

    /// @dev The anti-griefing property: nobody can burn a victim's query id outside a claim.
    function test_GenericExecuteCannotPoisonALeg() public {
        vm.prank(bystander);
        vm.expectRevert(abi.encodeWithSelector(Index41.GenericExecuteDisabled.selector, uint8(0)));
        court.execute(0, CHAIN_KEY_MAINNET, HEIGHT, hex"00", ROOT, pathFor(15), keccak256("lower"), _continuityRoots());

        assertFalse(court.processedQueries(queryId(CHAIN_KEY_MAINNET, HEIGHT, 15)), "no id may be consumed");

        // ...and the real claim still goes through afterwards.
        (uint256 harm,) = court.proveSandwich(_claim(_defaults()));
        assertEq(harm, 1 ether);
    }

    function test_BareTransferIsRejected() public {
        vm.deal(bystander, 1 ether);
        vm.prank(bystander);
        (bool ok,) = address(court).call{value: 1 ether}("");
        assertFalse(ok, "ether with no relay to credit has nowhere to go");
    }
}
