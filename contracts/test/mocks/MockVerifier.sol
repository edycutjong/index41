// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {INativeQueryVerifier} from "../../src/interfaces/INativeQueryVerifier.sol";

/**
 * @title MockVerifier
 * @notice Stand-in for the Attestcoin block-prover precompile, used ONLY by the unit tests.
 *
 * @dev This is the one legitimate place to mock. The unit tests must drive positions to
 *      arbitrary values — "front=9, victim=2, back=5" — to exercise every rejection path, and
 *      no honest merkle path produces that on demand.
 *
 *      The judged capability itself is never mocked. `scripts/spike.ts` calls the REAL
 *      precompile at 0x…0FD2 against Ethereum mainnet block 25764741 and recovers 14 / 15 / 16,
 *      cross-checked four independent ways; `OrderProbe` is deployed on CC3 testnet with a live
 *      `proveOrder` transaction in the same block. The demo path touches no mock.
 *
 *      `calculateTxIndex` here is not a stub returning a stored answer — it is the real
 *      algorithm, reimplemented: leaf-to-root, one bit per sibling, LSB first, and a sibling
 *      sitting on the LEFT means our node sat on the right, so that bit is a 1. Verified
 *      against the three live mainnet paths in `docs/spike-output.txt`:
 *
 *          RLLLRRRR -> 0b00001110 = 14
 *          LLLLRRRR -> 0b00001111 = 15
 *          RRRRLRRR -> 0b00010000 = 16
 */
contract MockVerifier is INativeQueryVerifier {
    /// @notice keccak(chainKey, height, root) => this block is attested with this transaction root.
    mapping(bytes32 => bool) public attested;

    /// @notice When true, only attested (chainKey, height, root) triples verify.
    /// @dev Defaults are all zero-valued on purpose: the mock is installed with `vm.etch`, which
    ///      copies runtime code but NOT constructor-initialised storage. Anything that had to be
    ///      set in a constructor would silently arrive as false.
    bool public rejectUnknownBlocks;

    /// @notice When true an unattested block reverts; otherwise `verifyAndEmit` returns false.
    bool public revertInsteadOfReport;

    uint256 public verifyCalls;

    event TransactionVerified(uint64 indexed chainKey, uint64 indexed height, uint64 indexed txIndex);

    // -------------------------------------------------------------------------------------
    // Test control surface
    // -------------------------------------------------------------------------------------

    function attest(uint64 chainKey, uint64 height, bytes32 root) external {
        attested[keccak256(abi.encode(chainKey, height, root))] = true;
        rejectUnknownBlocks = true;
    }

    function setRevertInsteadOfReport(bool v) external {
        revertInsteadOfReport = v;
    }

    // -------------------------------------------------------------------------------------
    // INativeQueryVerifier
    // -------------------------------------------------------------------------------------

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata
    ) external override returns (bool) {
        verifyCalls += 1;

        if (rejectUnknownBlocks && !attested[keccak256(abi.encode(chainKey, height, merkleProof.root))]) {
            if (revertInsteadOfReport) revert("MockVerifier: block not attested");
            return false;
        }

        emit TransactionVerified(chainKey, height, _indexFromLaterality(merkleProof.siblings));
        return true;
    }

    function calculateTxIndex(MerkleProof calldata merkle_proof) external pure override returns (uint64) {
        return _indexFromLaterality(merkle_proof.siblings);
    }

    /// @dev Every sibling is one bit. Position is the shape of the proof.
    function _indexFromLaterality(MerkleProofEntry[] calldata siblings) private pure returns (uint64 index) {
        uint64 bit = 1;
        for (uint256 i = 0; i < siblings.length; ++i) {
            if (siblings[i].isLeft) index |= bit;
            if (bit > type(uint64).max / 2) break; // a 2^64-leaf block is not a thing
            bit <<= 1;
        }
    }
}
