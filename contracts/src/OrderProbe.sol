// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {INativeQueryVerifier, NativeQueryVerifierLib} from "./interfaces/INativeQueryVerifier.sol";

/**
 * @title OrderProbe
 * @notice The day-one spike contract: it answers the two questions index41 rests on,
 *         on the live network, before a single line of product code is written.
 *
 *         1. Does `calculateTxIndex` really recover a mainnet transaction's ordinal
 *            position inside its block from merkle-path laterality alone?
 *         2. Do THREE `verifyAndEmit` calls fit in ONE Creditcoin transaction under
 *            the 75,000,000 `MAX_GAS_CAP`?
 *
 * @dev This is a probe, not the product. It asserts ordering and nothing else — no
 *      bond, no payout, no harm accounting. The real claim contract replaces it.
 *
 *      All three transactions must come from the SAME source-chain block, so they
 *      share ONE continuity proof: N transactions amortize one continuity proof
 *      instead of paying for N.
 */
contract OrderProbe {
    /// @notice The Attestcoin native query verifier precompile (0x...0FD2).
    INativeQueryVerifier public immutable VERIFIER;

    /// @notice Emitted once the three positions are recovered and proven ascending.
    event OrderProven(
        uint64 indexed chainKey, uint64 indexed height, uint64 frontRunIndex, uint64 victimIndex, uint64 backRunIndex
    );

    error WrongLegCount(uint256 encodedCount, uint256 proofCount);
    error VerificationFailed(uint256 leg);
    /// @dev Position is a fact once recovered; if it does not read front < victim < back, there was no sandwich.
    error NotAscending(uint64 frontRunIndex, uint64 victimIndex, uint64 backRunIndex);

    constructor() {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
    }

    /**
     * @notice Recovers the block position of a transaction from its merkle proof.
     * @dev Free `view` — costs nothing, which is why the spike calls it before spending gas.
     */
    function txIndexOf(INativeQueryVerifier.MerkleProof calldata merkleProof) external view returns (uint64) {
        return VERIFIER.calculateTxIndex(merkleProof);
    }

    /// @notice Batch form of {txIndexOf}, still a free `view`.
    function txIndexesOf(INativeQueryVerifier.MerkleProof[] calldata merkleProofs)
        external
        view
        returns (uint64[] memory indexes)
    {
        indexes = new uint64[](merkleProofs.length);
        for (uint256 i = 0; i < merkleProofs.length; ++i) {
            indexes[i] = VERIFIER.calculateTxIndex(merkleProofs[i]);
        }
    }

    /**
     * @notice Proves three same-block source-chain transactions and asserts their ordering.
     * @param chainKey Attestcoin source-chain key (3 = Ethereum mainnet).
     * @param height Source-chain block number shared by all three transactions.
     * @param encodedTransactions `abiEncode(tx, rx)` for the front-run, victim and back-run.
     * @param merkleProofs Merkle authentication path for each, in the same order.
     * @param continuityProof ONE continuity proof, shared by all three — same block.
     * @return frontRunIndex victimIndex backRunIndex The recovered ordinal positions.
     */
    function proveOrder(
        uint64 chainKey,
        uint64 height,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external returns (uint64 frontRunIndex, uint64 victimIndex, uint64 backRunIndex) {
        if (encodedTransactions.length != 3 || merkleProofs.length != 3) {
            revert WrongLegCount(encodedTransactions.length, merkleProofs.length);
        }

        // No on-chain batch verify exists. Three sequential calls, one shared continuity proof.
        for (uint256 i = 0; i < 3; ++i) {
            bool ok = VERIFIER.verifyAndEmit(chainKey, height, encodedTransactions[i], merkleProofs[i], continuityProof);
            if (!ok) revert VerificationFailed(i);
        }

        frontRunIndex = VERIFIER.calculateTxIndex(merkleProofs[0]);
        victimIndex = VERIFIER.calculateTxIndex(merkleProofs[1]);
        backRunIndex = VERIFIER.calculateTxIndex(merkleProofs[2]);

        if (!(frontRunIndex < victimIndex && victimIndex < backRunIndex)) {
            revert NotAscending(frontRunIndex, victimIndex, backRunIndex);
        }

        emit OrderProven(chainKey, height, frontRunIndex, victimIndex, backRunIndex);
    }
}
