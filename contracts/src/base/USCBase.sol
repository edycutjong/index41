// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {INativeQueryVerifier, NativeQueryVerifierLib} from "../interfaces/INativeQueryVerifier.sol";

/**
 * @title USCBase
 * @notice The canonical Attestcoin Smart Contract (ASC) base: it holds the block-prover
 *         precompile handle, owns the replay namespace, and provides the two internal
 *         helpers every ASC needs — `_verifyProof` and `_computeQueryId`.
 *
 * @dev In-repo transcription of the upstream Gluwa USC base contract (MIT,
 *      gluwa/usc-testnet-bridge-examples — contracts/src/USCBase.sol). It is written here
 *      rather than vendored because the published usc-contracts package ships only the
 *      decoding and write-ability trees; the ASC base is documentation-and-examples-only.
 *
 *      The replay namespace is the part that matters for index41. `_computeQueryId` keys a
 *      query by `(chainKey, blockHeight, txIndex)` — and `txIndex` is obtained from
 *      `calculateTxIndex`, i.e. from the laterality of the merkle path. The canonical
 *      protocol therefore already treats *block position* as part of a transaction's
 *      identity. index41 promotes that from bookkeeping to the entire business logic.
 */
abstract contract USCBase {
    /// @notice The Attestcoin block-prover precompile at 0x0000000000000000000000000000000000000FD2.
    INativeQueryVerifier public immutable VERIFIER;

    /// @notice Replay namespace: keccak(chainKey, blockHeight, txIndex) => consumed.
    mapping(bytes32 => bool) public processedQueries;

    constructor() {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
    }

    /// @dev Business hook for the generic single-transaction path below.
    function _processAndEmitEvent(uint8 action, bytes32 queryId, bytes memory encodedTransaction) internal virtual;

    /**
     * @notice Generic single-transaction ASC entry point: verify one proven source-chain
     *         transaction, burn its query id, then run business logic.
     */
    function execute(
        uint8 action,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool success) {
        bytes32 queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings);

        require(!processedQueries[queryId], "Query already processed");

        bool verified = _verifyProof(
            chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots
        );
        require(verified, "Proof of inclusion verification failed");

        processedQueries[queryId] = true;

        _processAndEmitEvent(action, queryId, encodedTransaction);

        return true;
    }

    /// @dev Calls the precompile once. Reverts inside the precompile when the proof is bad;
    ///      returns false only where the precompile chooses to report rather than revert.
    function _verifyProof(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) internal returns (bool verified) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});

        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        verified = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);

        return verified;
    }

    /// @dev `txIndex` here is recovered from merkle-path laterality by the precompile.
    function _computeQueryId(
        uint64 chainKey,
        uint64 blockHeight,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings
    ) internal view returns (bytes32 queryId) {
        INativeQueryVerifier.MerkleProof memory merkle_proof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});

        uint256 txIndex = VERIFIER.calculateTxIndex(merkle_proof);

        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            queryId := keccak256(ptr, 72)
        }
    }
}
