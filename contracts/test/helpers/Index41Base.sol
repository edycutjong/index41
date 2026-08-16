// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";

import {Index41} from "../../src/Index41.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "../../src/interfaces/INativeQueryVerifier.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";
import {EvmV1Fixture} from "./EvmV1Fixture.sol";

/**
 * @title Index41Base
 * @notice Shared fixture for the Index41 unit tests.
 *
 * @dev The default scenario is the real one: Ethereum mainnet block 25764741, searcher
 *      0x11111215… bracketing victim 0x51f400b9… at positions 14 / 15 / 16 around Uniswap V2
 *      pool 0xd91c72da…. Every rejection test is that scenario with exactly one thing changed,
 *      which is the only way to be sure the rejection is caused by the thing under test.
 */
abstract contract Index41Base is Test {
    using EvmV1Fixture for EvmV1Fixture.TxSpec;

    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000FD2;

    // The live fixture — see data/sandwich-25764741.json.
    uint64 internal constant CHAIN_KEY_MAINNET = 3;
    uint64 internal constant CHAIN_KEY_SEPOLIA = 1;
    uint64 internal constant HEIGHT = 25_764_741;
    address internal constant SEARCHER = 0x11111215b72E894C60F24E91ac2c8cCb1D373911;
    address internal constant VICTIM = 0x51f400b9770aD2BDdb7CF74664F5Cd1DAF6A1410;
    address internal constant POOL = 0xd91c72dA93288f00385E3c2EaD75623EbEdf9272;
    address internal constant BOT_ENTRY = 0x672061B75F770331b0c7C2a566a9Ac0A9BA331D2;
    address internal constant ROUTER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;

    /// @dev One block, one tree, one root.
    bytes32 internal constant ROOT = keccak256("index41:block-25764741:tx-root");
    bytes32 internal constant OTHER_ROOT = keccak256("index41:block-25764742:tx-root");

    /// @dev Merkle depth. 8 siblings is what the live mainnet block actually carried.
    uint8 internal constant DEPTH = 8;

    Index41 internal court;
    MockVerifier internal verifier;

    address internal relay = makeAddr("relay");
    address internal bystander = makeAddr("bystander");

    /// @notice Everything a claim is made of, flattened so a test can change exactly one field.
    struct Scenario {
        uint64 chainKey;
        uint64 height;
        address relay;
        address pool;
        bool numeraireIsToken0;
        uint256 legCount;
        // positions
        uint64 frontIndex;
        uint64 victimIndex;
        uint64 backIndex;
        // senders
        address frontFrom;
        address victimFrom;
        address backFrom;
        // entry points
        address frontTo;
        address victimTo;
        address backTo;
        // transaction types
        uint8 frontType;
        uint8 victimType;
        uint8 backType;
        // fee bids
        uint128 frontPriority;
        uint128 victimPriority;
        uint128 backPriority;
        // receipt status
        uint8 frontStatus;
        uint8 victimStatus;
        uint8 backStatus;
        // pools that actually emitted the Swap
        address frontPool;
        address victimPool;
        address backPool;
        // numeraire flows
        uint256 frontNumeraireIn;
        uint256 frontNumeraireOut;
        uint256 victimNumeraireIn;
        uint256 backNumeraireIn;
        uint256 backNumeraireOut;
        // merkle roots
        bytes32 frontRoot;
        bytes32 victimRoot;
        bytes32 backRoot;
        // malformed-log switch
        bool frontMalformed;
        // extra front-run swap, to prove multi-swap legs are summed
        uint256 frontExtraNumeraireIn;
        /// @dev Which slot the Swap logs put the numeraire in. Normally equal to
        ///      `numeraireIsToken0`; deliberately disagreeing with it is how the tests prove a
        ///      wrong flag is self-defeating rather than exploitable.
        bool logsMirrored;
    }

    function setUp() public virtual {
        MockVerifier impl = new MockVerifier();
        vm.etch(PRECOMPILE, address(impl).code);
        verifier = MockVerifier(PRECOMPILE);

        court = new Index41();

        vm.deal(relay, 1_000 ether);
        vm.prank(relay);
        court.postBond{value: 100 ether}();
        vm.prank(relay);
        court.declareCoverage(ROUTER, true);
    }

    // -------------------------------------------------------------------------------------
    // Scenario
    // -------------------------------------------------------------------------------------

    function _defaults() internal pure returns (Scenario memory s) {
        s.chainKey = CHAIN_KEY_MAINNET;
        s.height = HEIGHT;
        s.pool = POOL;
        s.numeraireIsToken0 = false; // WETH is token1 in a TOKEN/WETH pool
        s.legCount = 3;

        s.frontIndex = 14;
        s.victimIndex = 15;
        s.backIndex = 16;

        s.frontFrom = SEARCHER;
        s.victimFrom = VICTIM;
        s.backFrom = SEARCHER;

        s.frontTo = BOT_ENTRY;
        s.victimTo = ROUTER;
        s.backTo = BOT_ENTRY;

        s.frontType = 2;
        s.victimType = 2;
        s.backType = 2;

        // The live block: front-run outbids the victim, back-run pays through the nose for the exit.
        s.frontPriority = 42_377_075;
        s.victimPriority = 39_283_274;
        s.backPriority = 1_333_361_052;

        s.frontStatus = 1;
        s.victimStatus = 1;
        s.backStatus = 1;

        s.frontPool = POOL;
        s.victimPool = POOL;
        s.backPool = POOL;

        s.frontNumeraireIn = 10 ether;
        s.frontNumeraireOut = 0;
        s.victimNumeraireIn = 4 ether;
        s.backNumeraireIn = 0;
        s.backNumeraireOut = 11 ether; // realized profit: 1 ether

        s.frontRoot = ROOT;
        s.victimRoot = ROOT;
        s.backRoot = ROOT;
    }

    function _claim(Scenario memory s) internal view returns (Index41.Claim memory c) {
        c.relay = s.relay == address(0) ? relay : s.relay;
        c.chainKey = s.chainKey;
        c.blockHeight = s.height;
        c.pool = s.pool;
        c.numeraireIsToken0 = s.numeraireIsToken0;
        c.lowerEndpointDigest = keccak256("lower-endpoint");
        c.continuityRoots = _continuityRoots();

        c.legs = new Index41.LegBundle[](s.legCount);
        if (s.legCount > 0) c.legs[0] = _front(s);
        if (s.legCount > 1) c.legs[1] = _victim(s);
        if (s.legCount > 2) c.legs[2] = _back(s);
        for (uint256 i = 3; i < s.legCount; ++i) {
            c.legs[i] = _back(s);
        }
    }

    /// @dev Places numeraire/counter amounts into the token0/token1 slots of a Uniswap V2 `Swap`.
    function _swap(
        bool mirrored,
        address pool,
        uint256 numeraireIn,
        uint256 numeraireOut,
        uint256 counterIn,
        uint256 counterOut
    ) private pure returns (EvmV1Fixture.LogSpec memory) {
        return mirrored
            ? EvmV1Fixture.swapLog(pool, numeraireIn, counterIn, numeraireOut, counterOut)
            : EvmV1Fixture.swapLog(pool, counterIn, numeraireIn, counterOut, numeraireOut);
    }

    function _front(Scenario memory s) private pure returns (Index41.LegBundle memory) {
        EvmV1Fixture.LogSpec[] memory logs;
        if (s.frontMalformed) {
            logs = EvmV1Fixture.oneLog(EvmV1Fixture.malformedSwapLog(s.frontPool));
        } else if (s.frontExtraNumeraireIn > 0) {
            logs = EvmV1Fixture.twoLogs(
                _swap(s.logsMirrored, s.frontPool, s.frontNumeraireIn, s.frontNumeraireOut, 0, 1000 ether),
                _swap(s.logsMirrored, s.frontPool, s.frontExtraNumeraireIn, 0, 0, 100 ether)
            );
        } else {
            logs = EvmV1Fixture.twoLogs(
                EvmV1Fixture.otherLog(s.frontPool, keccak256("Sync(uint112,uint112)")),
                _swap(s.logsMirrored, s.frontPool, s.frontNumeraireIn, s.frontNumeraireOut, 0, 1000 ether)
            );
        }
        return
            _leg(s.frontRoot, s.frontIndex, s.frontType, s.frontFrom, s.frontTo, s.frontPriority, s.frontStatus, logs);
    }

    function _victim(Scenario memory s) private pure returns (Index41.LegBundle memory) {
        EvmV1Fixture.LogSpec[] memory logs = EvmV1Fixture.oneLog(
            s.victimNumeraireIn > 0
                ? _swap(s.logsMirrored, s.victimPool, s.victimNumeraireIn, 0, 0, 300 ether)
                : _swap(s.logsMirrored, s.victimPool, 0, 1 ether, 300 ether, 0)
        );
        return _leg(
            s.victimRoot, s.victimIndex, s.victimType, s.victimFrom, s.victimTo, s.victimPriority, s.victimStatus, logs
        );
    }

    function _back(Scenario memory s) private pure returns (Index41.LegBundle memory) {
        EvmV1Fixture.LogSpec[] memory logs = EvmV1Fixture.oneLog(
            _swap(s.logsMirrored, s.backPool, s.backNumeraireIn, s.backNumeraireOut, 1000 ether, 0)
        );
        return _leg(s.backRoot, s.backIndex, s.backType, s.backFrom, s.backTo, s.backPriority, s.backStatus, logs);
    }

    /// @notice Builds a merkle path straight from a laterality string, e.g. "RLLLRRRR".
    /// @dev This is the mainnet evidence expressed as a test: those eight characters are what
    ///      block 25764741 actually carried for the front-run leg.
    function pathFromPattern(bytes memory pattern)
        internal
        pure
        returns (INativeQueryVerifier.MerkleProofEntry[] memory sib)
    {
        sib = new INativeQueryVerifier.MerkleProofEntry[](pattern.length);
        for (uint256 i = 0; i < pattern.length; ++i) {
            sib[i] = INativeQueryVerifier.MerkleProofEntry({
                hash: keccak256(abi.encode("pattern", i)), isLeft: pattern[i] == "L"
            });
        }
    }

    function _leg(
        bytes32 root,
        uint64 index,
        uint8 txType,
        address from,
        address to,
        uint128 priority,
        uint8 status,
        EvmV1Fixture.LogSpec[] memory logs
    ) private pure returns (Index41.LegBundle memory bundle) {
        EvmV1Fixture.TxSpec memory spec;
        spec.txType = txType;
        spec.nonce = index;
        spec.gasLimit = 250_000;
        spec.from = from;
        spec.to = to;
        spec.value = 0;
        spec.data = hex"a9059cbb";
        spec.maxPriorityFeePerGas = priority;
        spec.maxFeePerGas = priority + 20_000_000_000;
        spec.receiptStatus = status;
        spec.receiptGasUsed = 180_000;
        spec.logs = logs;

        bundle.encodedTransaction = EvmV1Fixture.encode(spec);
        bundle.merkleRoot = root;
        bundle.siblings = pathFor(index);
    }

    // -------------------------------------------------------------------------------------
    // Merkle paths — the laterality IS the index
    // -------------------------------------------------------------------------------------

    /// @notice Builds an authentication path whose left/right pattern encodes `index`.
    function pathFor(uint64 index) internal pure returns (INativeQueryVerifier.MerkleProofEntry[] memory sib) {
        sib = new INativeQueryVerifier.MerkleProofEntry[](DEPTH);
        for (uint256 i = 0; i < DEPTH; ++i) {
            sib[i] = INativeQueryVerifier.MerkleProofEntry({
                hash: keccak256(abi.encode("sibling", index, i)), isLeft: (index >> i) & 1 == 1
            });
        }
    }

    function _continuityRoots() internal pure returns (bytes32[] memory roots) {
        roots = new bytes32[](10);
        for (uint256 i = 0; i < 10; ++i) {
            roots[i] = keccak256(abi.encode("continuity", i));
        }
    }

    // -------------------------------------------------------------------------------------
    // Canonical query-id derivation, mirrored so the tests do not trust the contract's own copy.
    // -------------------------------------------------------------------------------------

    function queryId(uint64 chainKey, uint64 blockHeight, uint256 txIndex) internal pure returns (bytes32 id) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            id := keccak256(ptr, 72)
        }
    }
}

/// @notice A victim that refuses ether, to prove the payout falls back to a pull.
contract StubbornVictim {
    receive() external payable {
        revert("no thanks");
    }
}

/// @notice A victim that burns more gas than the push payout forwards.
contract GasHungryVictim {
    uint256[] private junk;

    receive() external payable {
        for (uint256 i = 0; i < 50; ++i) {
            junk.push(i);
        }
    }
}
