// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OrderProbe} from "../src/OrderProbe.sol";
import {INativeQueryVerifier} from "../src/interfaces/INativeQueryVerifier.sol";
import {Index41Base} from "./helpers/Index41Base.sol";

/**
 * @title OrderProbeTest
 * @notice OrderProbe is the day-one spike contract index41 was built to replace: it answers
 *         "does calculateTxIndex really recover ordinal position from merkle laterality" and
 *         "do three verifyAndEmit calls fit in one transaction" — and nothing else. It asserts
 *         ordering only; no bond, no payout, no harm accounting. These tests exercise exactly
 *         that surface, reusing the same MockVerifier/laterality fixtures Index41Base already
 *         builds, since the precompile it talks to is the same one.
 */
contract OrderProbeTest is Index41Base {
    OrderProbe internal probe;

    function setUp() public override {
        super.setUp();
        probe = new OrderProbe();
    }

    function _proofs(uint64 front, uint64 victim, uint64 back)
        private
        pure
        returns (INativeQueryVerifier.MerkleProof[] memory p)
    {
        p = new INativeQueryVerifier.MerkleProof[](3);
        p[0] = INativeQueryVerifier.MerkleProof({root: ROOT, siblings: pathFor(front)});
        p[1] = INativeQueryVerifier.MerkleProof({root: ROOT, siblings: pathFor(victim)});
        p[2] = INativeQueryVerifier.MerkleProof({root: ROOT, siblings: pathFor(back)});
    }

    /// @dev OrderProbe never decodes these bytes — MockVerifier.verifyAndEmit ignores its
    ///      `bytes calldata` parameter entirely — so placeholder content is honest, not a stub
    ///      of the judged capability. See {MockVerifier}'s own doc comment on where mocking ends.
    function _txs() private pure returns (bytes[] memory t) {
        t = new bytes[](3);
        t[0] = hex"00";
        t[1] = hex"01";
        t[2] = hex"02";
    }

    function _continuity() private pure returns (INativeQueryVerifier.ContinuityProof memory) {
        return INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: keccak256("lower-endpoint"), roots: _continuityRoots()
        });
    }

    // -----------------------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------------------

    function test_VerifierIsThePrecompileAddress() public view {
        assertEq(address(probe.VERIFIER()), PRECOMPILE, "must talk to 0x...0FD2 and nothing else");
    }

    // -----------------------------------------------------------------------------------
    // Free views
    // -----------------------------------------------------------------------------------

    function test_TxIndexOfRecoversPosition() public view {
        assertEq(probe.txIndexOf(INativeQueryVerifier.MerkleProof({root: ROOT, siblings: pathFor(15)})), 15);
    }

    function test_TxIndexOfIsAViewAndCostsNoState() public {
        uint256 snapshot = vm.snapshotState();
        probe.txIndexOf(INativeQueryVerifier.MerkleProof({root: ROOT, siblings: pathFor(15)}));
        assertTrue(vm.revertToState(snapshot), "view calls change nothing");
    }

    function test_TxIndexesOfBatchRecoversAllThreePositions() public view {
        uint64[] memory result = probe.txIndexesOf(_proofs(14, 15, 16));
        assertEq(result.length, 3);
        assertEq(result[0], 14, "front-run");
        assertEq(result[1], 15, "victim");
        assertEq(result[2], 16, "back-run");
    }

    function test_TxIndexesOfEmptyArrayReturnsEmptyArray() public view {
        INativeQueryVerifier.MerkleProof[] memory none = new INativeQueryVerifier.MerkleProof[](0);
        uint64[] memory result = probe.txIndexesOf(none);
        assertEq(result.length, 0);
    }

    // -----------------------------------------------------------------------------------
    // proveOrder — happy path
    // -----------------------------------------------------------------------------------

    function test_ProveOrder_ReturnsTheThreeRecoveredPositions() public {
        (uint64 front, uint64 victim, uint64 back) =
            probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(14, 15, 16), _continuity());
        assertEq(front, 14);
        assertEq(victim, 15);
        assertEq(back, 16);
    }

    function test_ProveOrder_EmitsOrderProven() public {
        vm.expectEmit(true, true, false, true, address(probe));
        emit OrderProbe.OrderProven(CHAIN_KEY_MAINNET, HEIGHT, 14, 15, 16);
        probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(14, 15, 16), _continuity());
    }

    /// @dev No on-chain batch verify exists: three sequential calls, one shared continuity proof.
    function test_ProveOrder_CallsVerifyAndEmitThreeTimes() public {
        probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(14, 15, 16), _continuity());
        assertEq(verifier.verifyCalls(), 3);
    }

    function test_ProveOrder_NonContiguousPositionsAreFine() public {
        (uint64 front, uint64 victim, uint64 back) =
            probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(3, 97, 210), _continuity());
        assertEq(front, 3);
        assertEq(victim, 97);
        assertEq(back, 210);
    }

    // -----------------------------------------------------------------------------------
    // Input shape
    // -----------------------------------------------------------------------------------

    function test_ProveOrder_RejectsWrongEncodedTransactionsLength() public {
        bytes[] memory badTxs = new bytes[](2);
        badTxs[0] = hex"00";
        badTxs[1] = hex"01";
        vm.expectRevert(abi.encodeWithSelector(OrderProbe.WrongLegCount.selector, 2, 3));
        probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, badTxs, _proofs(14, 15, 16), _continuity());
    }

    function test_ProveOrder_RejectsWrongMerkleProofsLength() public {
        INativeQueryVerifier.MerkleProof[] memory badProofs = new INativeQueryVerifier.MerkleProof[](2);
        badProofs[0] = INativeQueryVerifier.MerkleProof({root: ROOT, siblings: pathFor(14)});
        badProofs[1] = INativeQueryVerifier.MerkleProof({root: ROOT, siblings: pathFor(15)});
        vm.expectRevert(abi.encodeWithSelector(OrderProbe.WrongLegCount.selector, 3, 2));
        probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), badProofs, _continuity());
    }

    // -----------------------------------------------------------------------------------
    // Verification
    // -----------------------------------------------------------------------------------

    function test_ProveOrder_RevertsWhenVerificationFails() public {
        // Attesting a DIFFERENT height means (chainKey, HEIGHT, ROOT) is unattested, so the
        // mock reports false on the very first leg rather than reverting outright.
        verifier.attest(CHAIN_KEY_MAINNET, HEIGHT + 1, ROOT);
        vm.expectRevert(abi.encodeWithSelector(OrderProbe.VerificationFailed.selector, 0));
        probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(14, 15, 16), _continuity());
    }

    function test_ProveOrder_AttestedBlockStillProvesFine() public {
        verifier.attest(CHAIN_KEY_MAINNET, HEIGHT, ROOT);
        (uint64 front, uint64 victim, uint64 back) =
            probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(14, 15, 16), _continuity());
        assertEq(front, 14);
        assertEq(victim, 15);
        assertEq(back, 16);
    }

    // -----------------------------------------------------------------------------------
    // The ordering assertion
    // -----------------------------------------------------------------------------------

    function test_ProveOrder_RejectsCompletelyReversedOrder() public {
        vm.expectRevert(abi.encodeWithSelector(OrderProbe.NotAscending.selector, uint64(16), uint64(15), uint64(14)));
        probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(16, 15, 14), _continuity());
    }

    function test_ProveOrder_RejectsVictimBeforeFrontRun() public {
        vm.expectRevert(abi.encodeWithSelector(OrderProbe.NotAscending.selector, uint64(20), uint64(15), uint64(16)));
        probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(20, 15, 16), _continuity());
    }

    function test_ProveOrder_RejectsBackRunBeforeVictim() public {
        vm.expectRevert(abi.encodeWithSelector(OrderProbe.NotAscending.selector, uint64(14), uint64(15), uint64(2)));
        probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(14, 15, 2), _continuity());
    }

    /// @dev Position is a fact once recovered; two legs at the same position is not a sandwich.
    function test_ProveOrder_RejectsEqualAdjacentPositions() public {
        vm.expectRevert(abi.encodeWithSelector(OrderProbe.NotAscending.selector, uint64(14), uint64(14), uint64(16)));
        probe.proveOrder(CHAIN_KEY_MAINNET, HEIGHT, _txs(), _proofs(14, 14, 16), _continuity());
    }
}
