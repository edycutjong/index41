// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol";

/**
 * @title EvmV1Fixture
 * @notice Builds `encodedTransaction` blobs in the exact shape Attestcoin commits to, so the
 *         unit tests exercise the REAL {EvmV1Decoder} rather than a hand-rolled stand-in.
 *
 * @dev The encoding is `abi.encode(uint8 txType, bytes[] chunks)`, where
 *
 *          chunks[0] = common transaction fields
 *          chunks[1] = type-specific fields
 *          chunks[2] = type-specific continuation (types 3 and 4 only)
 *          chunks[last] = receipt fields
 *
 *      Every field layout below was read out of the shipped decoder source
 *      (usc-contracts 0.1.2, contracts/decoding/EvmV1Decoder.sol), not guessed. If the
 *      protocol changes the encoding, these fixtures fail loudly — which is the point.
 */
library EvmV1Fixture {
    bytes32 internal constant SWAP_SIG = keccak256("Swap(address,uint256,uint256,uint256,uint256,address)");

    struct LogSpec {
        address emitter;
        bytes32[] topics;
        bytes data;
    }

    struct TxSpec {
        uint8 txType;
        uint64 nonce;
        uint64 gasLimit;
        address from;
        bool toIsNull;
        address to;
        uint256 value;
        bytes data;
        uint128 maxFeePerGas;
        uint128 maxPriorityFeePerGas;
        uint8 receiptStatus;
        uint64 receiptGasUsed;
        LogSpec[] logs;
    }

    // -------------------------------------------------------------------------------------
    // Log builders
    // -------------------------------------------------------------------------------------

    /// @notice A Uniswap V2 `Swap` log: two indexed addresses, four uint256 amounts in the payload.
    function swapLog(address pool, uint256 a0In, uint256 a1In, uint256 a0Out, uint256 a1Out)
        internal
        pure
        returns (LogSpec memory l)
    {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = SWAP_SIG;
        topics[1] = bytes32(uint256(uint160(pool)));
        topics[2] = bytes32(uint256(uint160(pool)));
        l.emitter = pool;
        l.topics = topics;
        l.data = abi.encode(a0In, a1In, a0Out, a1Out);
    }

    /// @notice A `Swap` log whose payload is the wrong length — used to prove the guard fires.
    function malformedSwapLog(address pool) internal pure returns (LogSpec memory l) {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = SWAP_SIG;
        l.emitter = pool;
        l.topics = topics;
        l.data = abi.encode(uint256(1), uint256(2));
    }

    /// @notice Any other event — noise the claim must ignore.
    function otherLog(address emitter, bytes32 sig) internal pure returns (LogSpec memory l) {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = sig;
        l.emitter = emitter;
        l.topics = topics;
        l.data = abi.encode(uint256(1));
    }

    function oneLog(LogSpec memory a) internal pure returns (LogSpec[] memory out) {
        out = new LogSpec[](1);
        out[0] = a;
    }

    function twoLogs(LogSpec memory a, LogSpec memory b) internal pure returns (LogSpec[] memory out) {
        out = new LogSpec[](2);
        out[0] = a;
        out[1] = b;
    }

    // -------------------------------------------------------------------------------------
    // Encoder
    // -------------------------------------------------------------------------------------

    function encode(TxSpec memory s) internal pure returns (bytes memory) {
        bytes[] memory chunks = s.txType <= 2 ? new bytes[](3) : new bytes[](4);

        chunks[0] = abi.encode(s.nonce, s.gasLimit, s.from, s.toIsNull, s.to, s.value, s.data);

        if (s.txType == 0) {
            chunks[1] = abi.encode(uint128(s.maxFeePerGas), uint256(27), bytes32(uint256(1)), bytes32(uint256(2)));
        } else if (s.txType == 1) {
            chunks[1] = abi.encode(
                uint64(1),
                uint128(s.maxFeePerGas),
                new EvmV1Decoder.AccessListEntryBytes32[](0),
                uint8(0),
                bytes32(uint256(1)),
                bytes32(uint256(2))
            );
        } else if (s.txType == 2) {
            chunks[1] = abi.encode(
                uint64(1),
                uint128(s.maxPriorityFeePerGas),
                uint128(s.maxFeePerGas),
                new EvmV1Decoder.AccessListEntryBytes32[](0),
                uint8(0),
                bytes32(uint256(1)),
                bytes32(uint256(2))
            );
        } else {
            // Types 3 and 4 share the same chunk 1 and split the signature into chunk 2.
            chunks[1] = abi.encode(
                uint64(1),
                uint128(s.maxPriorityFeePerGas),
                uint128(s.maxFeePerGas),
                new EvmV1Decoder.AccessListEntryUint256[](0)
            );
            if (s.txType == 3) {
                chunks[2] = abi.encode(uint256(7), new bytes32[](0), uint8(0), bytes32(uint256(1)), bytes32(uint256(2)));
            } else {
                chunks[2] = abi.encode(
                    new EvmV1Decoder.AuthorizationListEntry[](0), uint8(0), bytes32(uint256(1)), bytes32(uint256(2))
                );
            }
        }

        chunks[chunks.length - 1] = _receiptChunk(s);

        return abi.encode(s.txType, chunks);
    }

    function _receiptChunk(TxSpec memory s) private pure returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](s.logs.length);
        for (uint256 i = 0; i < s.logs.length; ++i) {
            logs[i] = EvmV1Decoder.LogEntryTuple({
                address_: s.logs[i].emitter, topics: s.logs[i].topics, data: s.logs[i].data
            });
        }
        return abi.encode(s.receiptStatus, s.receiptGasUsed, logs, hex"00");
    }
}
