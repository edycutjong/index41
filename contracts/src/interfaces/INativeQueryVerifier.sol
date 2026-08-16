// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title INativeQueryVerifier
 * @notice The Attestcoin native query verifier precompile on Creditcoin.
 *
 * @dev The precompile exposes EXACTLY two functions. There is no on-chain batch
 *      verification: `PrecompileBlockProver.verifyBatch` in the TypeScript SDK is a
 *      client-side convenience and is not reachable from Solidity. Verifying N
 *      transactions on-chain means N sequential `verifyAndEmit` calls in one
 *      Creditcoin transaction, sharing one continuity proof.
 *
 *      `calculateTxIndex` is the surface index41 is built on: it is a free `view`
 *      that recovers a transaction's ordinal position inside its source-chain block
 *      purely from the left/right laterality of its merkle authentication path.
 *      Every sibling in the path is one bit of the index — the position is never
 *      carried in any payload, it is the shape of the proof itself.
 *
 *      Interface mirrors the upstream Gluwa USC contracts (MIT):
 *      gluwa/usc-testnet-bridge-examples — contracts/src/VerifierInterface.sol
 */
interface INativeQueryVerifier {
    struct MerkleProofEntry {
        bytes32 hash;
        bool isLeft;
    }

    struct MerkleProof {
        bytes32 root;
        MerkleProofEntry[] siblings;
    }

    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool);

    function calculateTxIndex(MerkleProof calldata merkle_proof) external view returns (uint64);
}

library NativeQueryVerifierLib {
    /// @dev 4050 decimal.
    address internal constant PRECOMPILE_ADDRESS = 0x0000000000000000000000000000000000000FD2;

    function getVerifier() internal pure returns (INativeQueryVerifier) {
        return INativeQueryVerifier(PRECOMPILE_ADDRESS);
    }
}
