// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol";

import {INativeQueryVerifier} from "./interfaces/INativeQueryVerifier.sol";
import {USCBase} from "./base/USCBase.sol";

/**
 * @title Index41
 * @notice A bonded fair-ordering court on Creditcoin.
 *
 *         A relay posts a CTC bond behind a public promise — *route through us and you will
 *         not be sandwiched*. A user sandwiched anyway submits three proven Ethereum
 *         transactions from one block. This contract recovers each transaction's **ordinal
 *         position inside that block**, asserts the sandwich shape, computes the attacker's
 *         realized profit from the proven logs, and pays the victim out of the bond.
 *
 *         144 unit tests cover it — `npm test` prints the per-suite table:
 *         Index41MechanismTest 19 · Index41BondTest 27 · Index41ClaimTest 53 · Index41HarmTest 24 ·
 *         OrderProbeTest 17 · USCBaseExecuteTest 4.
 *
 * @dev THE ONE THING NOTHING ELSE CAN DO
 *
 *      Ordering is not in any payload. A transaction does not carry "I was 15th"; no oracle
 *      reports it; no `eth_call` can be proven for it. Attestcoin's merkle authentication
 *      path, however, *is* the position: every sibling contributes one bit of laterality,
 *      leaf-to-root, and `INativeQueryVerifier.calculateTxIndex` reads it back out. That is
 *      the entire foundation of this contract, and deleting it deletes the product.
 *
 *      THE PROTOCOL FACTS THIS CONTRACT IS BUILT ON (verified, not assumed)
 *
 *      1. The precompile at 0x…0FD2 exposes exactly `verifyAndEmit` and `calculateTxIndex`.
 *         There is no on-chain batch verify, so a three-transaction claim is three sequential
 *         `verifyAndEmit` calls in one Creditcoin transaction. Measured on CC3 testnet:
 *         292,376 gas for three verifications plus three index recoveries plus the ordering
 *         assertion — 0.390% of the 75,000,000 MAX_GAS_CAP (292,376 / 75,000,000; the SDK's own
 *         `utils.gas.gasAsPercentageOfMax` truncates this to 0.38%, see docs/PIPELINE.md).
 *      2. Attestcoin proves transaction HISTORY, not STATE. The merkle root commits
 *         `abiEncode(tx, rx)`. Post-state is never committed. Therefore harm here is the
 *         attacker's *realized profit*, read from logs that are inside the proof — never a
 *         counterfactual against a pre-sandwich reserve ratio, which would require state
 *         this protocol cannot prove.
 *      3. Because all three legs come from one block they share ONE continuity proof and,
 *         more usefully, ONE merkle root. `sameBlock` is therefore enforced structurally by
 *         {LegBundle.merkleRoot} equality, not merely trusted.
 *      4. `EvmV1Decoder` returns `from`, `to`, `value`, `nonce`, `gasLimit`, receipt status,
 *         gas used and the full log set for free from the same bytes the precompile already
 *         verified. This contract spends its selective-decode budget only on the fee caps,
 *         which live in the type-specific chunk and are the one thing not free.
 *
 *      HONEST LIMITS, stated in the code rather than the pitch:
 *
 *      * The *effective* priority fee of a transaction is `min(maxPriorityFeePerGas,
 *        maxFeePerGas - baseFee)`, and `baseFee` lives in the block header, which the merkle
 *        root does not commit. So {_feeCaps} compares the **declared bid**, normalising a
 *        legacy transaction's `gasPrice` into both slots. The bid comparison is a corroborating
 *        check; the ordering assertion is the load-bearing one, and it is fully provable.
 *      * Harm is denominated in the pool's numeraire (wei of WETH, in the demo) and paid 1:1
 *        in CTC wei. A production deployment prices one against the other; a price feed is the
 *        hook, and pretending otherwise would be dishonest.
 *      * This contract proves the sandwich. It does not prove the victim *routed through* the
 *        relay — that binding is the relay's signed routing receipt. The nearest provable
 *        substitute is implemented: a relay must {declareCoverage} for the entry point the
 *        victim's transaction actually called, and the victim's `to` is read out of the proof.
 */
contract Index41 is USCBase {
    // ---------------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------------

    /// @notice Attestcoin source-chain key for Ethereum mainnet. (A chain KEY, not a chain id.)
    uint64 public constant ETHEREUM_MAINNET = 3;

    /// @notice Attestcoin source-chain key for Ethereum Sepolia.
    uint64 public constant ETHEREUM_SEPOLIA = 1;

    /// @notice `Swap(address,uint256,uint256,uint256,uint256,address)` — Uniswap V2 and every fork of it.
    bytes32 public constant UNISWAP_V2_SWAP = keccak256("Swap(address,uint256,uint256,uint256,uint256,address)");

    /// @notice A relay may not pull its bond out from under a claim that is already in flight.
    uint64 public constant UNBOND_DELAY = 3 days;

    /// @notice Gas forwarded to the victim on the push payout. Enough for an EOA, not enough to be interesting.
    uint256 private constant PAYOUT_GAS = 30_000;

    /// @notice A Uniswap V2 `Swap` payload is exactly four uint256 words.
    uint256 private constant SWAP_DATA_LENGTH = 128;

    // ---------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------

    /// @notice One proven source-chain transaction: the verified bytes plus its merkle path.
    struct LegBundle {
        bytes encodedTransaction;
        bytes32 merkleRoot;
        INativeQueryVerifier.MerkleProofEntry[] siblings;
    }

    /**
     * @notice A complete sandwich claim.
     * @param relay The bonded relay being claimed against.
     * @param chainKey Attestcoin source-chain key (3 = Ethereum mainnet).
     * @param blockHeight The source-chain block all three legs live in.
     * @param pool The AMM pool that emitted `Swap` in all three legs.
     * @param numeraireIsToken0 Whether the pool's numeraire (WETH, in the demo) is token0.
     *        A wrong value is self-defeating, not exploitable: {_assertShape} requires the
     *        numeraire to flow IN on the front-run and OUT on the back-run, so flipping this
     *        flag turns both amounts to zero and the claim reverts.
     * @param lowerEndpointDigest Shared continuity proof — one block, one proof.
     * @param continuityRoots Shared continuity proof roots.
     * @param legs Exactly three: front-run, victim, back-run, in that order.
     */
    struct Claim {
        address relay;
        uint64 chainKey;
        uint64 blockHeight;
        address pool;
        bool numeraireIsToken0;
        bytes32 lowerEndpointDigest;
        bytes32[] continuityRoots;
        LegBundle[] legs;
    }

    /// @notice Everything this contract knows about one leg after the precompile has spoken.
    struct ProvenLeg {
        uint64 txIndex;
        uint8 txType;
        address from;
        address to;
        uint64 gasUsed;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        uint256 numeraireIn;
        uint256 numeraireOut;
        uint256 counterIn;
        uint256 counterOut;
        uint256 swapCount;
        bytes32 queryId;
    }

    /// @notice The court's ruling, kept for the record.
    struct Verdict {
        address relay;
        address searcher;
        address victim;
        uint64 blockHeight;
        uint64 frontIndex;
        uint64 victimIndex;
        uint64 backIndex;
        uint256 harm;
        uint256 paid;
        uint64 ruledAt;
    }

    // ---------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------

    /// @notice CTC bonded by each relay, in wei.
    mapping(address => uint256) public bondOf;

    /// @notice Timestamp from which a relay may withdraw. Zero means no pending request.
    mapping(address => uint64) public unbondReadyAt;

    /// @notice relay => transaction `to` the relay claims to route. Read out of the proof, not trusted.
    mapping(address => mapping(address => bool)) public covers;

    /// @notice Payouts that could not be pushed to the victim, awaiting {withdrawPayout}.
    mapping(address => uint256) public deferredPayout;

    /// @notice claimId => the ruling.
    mapping(bytes32 => Verdict) public verdicts;

    /// @notice Every claim ever ruled on, in order.
    bytes32[] public claimIds;

    uint256 private _entered;

    // ---------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------

    event BondPosted(address indexed relay, uint256 amount, uint256 total);
    event UnbondRequested(address indexed relay, uint64 readyAt);
    event BondWithdrawn(address indexed relay, uint256 amount, uint256 remaining);
    event CoverageDeclared(address indexed relay, address indexed entrypoint, bool covered);

    /// @notice The hero event: position inside an Ethereum block, settled on Creditcoin.
    event SandwichProven(
        address indexed searcher,
        uint64 indexed blockHeight,
        uint64 frontIndex,
        uint64 victimIndex,
        uint64 backIndex,
        uint256 harm,
        uint256 paid
    );

    event HarmPaid(address indexed victim, address indexed relay, uint256 amount);
    event PayoutDeferred(address indexed victim, uint256 amount);
    event BondExhausted(address indexed relay, uint256 shortfall);

    // ---------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------

    error WrongLegCount(uint256 given);
    error UnsupportedChainKey(uint64 chainKey);
    error ZeroAddressInput();
    error ZeroBondAmount();
    error NoBondPosted(address relay);
    error EntrypointNotCovered(address relay, address entrypoint);

    error MerkleRootMismatch(uint256 leg, bytes32 expected, bytes32 given);
    error QueryAlreadyProcessed(bytes32 queryId);
    error VerificationFailed(uint256 leg);
    error UnsupportedTransactionType(uint256 leg, uint8 txType);
    error TransactionReverted(uint256 leg);

    error PoolNotTouched(uint256 leg, address pool);
    error MalformedSwapLog(uint256 leg, uint256 dataLength);
    error NotAscending(uint64 frontIndex, uint64 victimIndex, uint64 backIndex);
    error SearcherMismatch(address front, address back);
    error VictimIsSearcher(address searcher);
    error FrontRunNotABuy(uint256 numeraireIn, uint256 numeraireOut);
    error BackRunNotASell(uint256 numeraireIn, uint256 numeraireOut);
    error VictimTradedOtherWay(uint256 numeraireIn);
    error FrontRunDidNotOutbid(uint256 frontBid, uint256 victimBid);
    error NoRealizedProfit(uint256 spent, uint256 recovered);

    error UnbondNotRequested();
    error UnbondNotReady(uint64 readyAt);
    error InsufficientBond(uint256 requested, uint256 available);
    error NothingToWithdraw();
    error TransferFailed();
    error Reentrancy();

    /// @dev The generic single-transaction path is deliberately closed. See {_processAndEmitEvent}.
    error GenericExecuteDisabled(uint8 action);

    // ---------------------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------------------

    modifier nonReentrant() {
        _enter();
        _;
        _exit();
    }

    function _enter() private {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
    }

    function _exit() private {
        _entered = 0;
    }

    // ---------------------------------------------------------------------------------
    // Relay side: the promise
    // ---------------------------------------------------------------------------------

    /// @notice Bond CTC behind a no-sandwich promise. Topping up cancels any pending unbond.
    function postBond() external payable {
        _postBond(msg.sender);
    }

    /// @notice Bond on another address's behalf — a treasury funding an operator, for instance.
    function postBondFor(address relay) external payable {
        if (relay == address(0)) revert ZeroAddressInput();
        _postBond(relay);
    }

    function _postBond(address relay) private {
        if (msg.value == 0) revert ZeroBondAmount();
        uint256 total = bondOf[relay] + msg.value;
        bondOf[relay] = total;
        // Re-arming the promise: you cannot be halfway out the door and still covered.
        if (unbondReadyAt[relay] != 0) {
            unbondReadyAt[relay] = 0;
            emit UnbondRequested(relay, 0);
        }
        emit BondPosted(relay, msg.value, total);
    }

    /**
     * @notice Declare that this relay routes transactions sent to `entrypoint`.
     * @dev The victim's transaction `to` is decoded out of the proof and checked against this
     *      set. It is the closest provable substitute for a signed routing receipt.
     */
    function declareCoverage(address entrypoint, bool covered) external {
        if (entrypoint == address(0)) revert ZeroAddressInput();
        covers[msg.sender][entrypoint] = covered;
        emit CoverageDeclared(msg.sender, entrypoint, covered);
    }

    /// @notice Start the unbonding clock. A relay may not exit ahead of a claim.
    function requestUnbond() external {
        if (bondOf[msg.sender] == 0) revert NoBondPosted(msg.sender);
        uint64 readyAt = uint64(block.timestamp) + UNBOND_DELAY;
        unbondReadyAt[msg.sender] = readyAt;
        emit UnbondRequested(msg.sender, readyAt);
    }

    /// @notice Withdraw bond after {UNBOND_DELAY}. Each withdrawal consumes its request.
    function withdrawBond(uint256 amount) external nonReentrant {
        uint64 readyAt = unbondReadyAt[msg.sender];
        if (readyAt == 0) revert UnbondNotRequested();
        if (block.timestamp < readyAt) revert UnbondNotReady(readyAt);

        uint256 available = bondOf[msg.sender];
        if (amount == 0) revert ZeroBondAmount();
        if (amount > available) revert InsufficientBond(amount, available);

        uint256 remaining = available - amount;
        bondOf[msg.sender] = remaining;
        unbondReadyAt[msg.sender] = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit BondWithdrawn(msg.sender, amount, remaining);
    }

    // ---------------------------------------------------------------------------------
    // Victim side: the claim
    // ---------------------------------------------------------------------------------

    /**
     * @notice Prove a sandwich and pay the victim from the relay's bond.
     *
     * @dev Permissionless on purpose. The payout goes to the address the proof says was
     *      sandwiched, not to whoever submits the proof, so there is nothing to gain by
     *      front-running a claim — which would be an ironic way to lose this argument.
     *
     * @param c The claim. See {Claim}.
     * @return harm The attacker's realized profit, in numeraire wei.
     * @return paid What the bond could actually cover.
     */
    function proveSandwich(Claim calldata c) external nonReentrant returns (uint256 harm, uint256 paid) {
        if (c.legs.length != 3) revert WrongLegCount(c.legs.length);
        if (c.chainKey != ETHEREUM_MAINNET && c.chainKey != ETHEREUM_SEPOLIA) revert UnsupportedChainKey(c.chainKey);
        if (c.relay == address(0) || c.pool == address(0)) revert ZeroAddressInput();

        uint256 bond = bondOf[c.relay];
        if (bond == 0) revert NoBondPosted(c.relay);

        // One block, one merkle tree, one root. Enforced, not assumed.
        bytes32 root = c.legs[0].merkleRoot;
        for (uint256 i = 1; i < 3; ++i) {
            if (c.legs[i].merkleRoot != root) revert MerkleRootMismatch(i, root, c.legs[i].merkleRoot);
        }

        ProvenLeg memory front = _proveLeg(c, 0);
        ProvenLeg memory victim = _proveLeg(c, 1);
        ProvenLeg memory back = _proveLeg(c, 2);

        _assertShape(c, front, victim, back);

        harm = _harm(front, back);
        paid = harm > bond ? bond : harm;
        bondOf[c.relay] = bond - paid;
        if (harm > paid) emit BondExhausted(c.relay, harm - paid);

        _record(c, front, victim, back, harm, paid);

        emit SandwichProven(front.from, c.blockHeight, front.txIndex, victim.txIndex, back.txIndex, harm, paid);

        _payout(victim.from, c.relay, paid);
    }

    /// @notice Collect a payout that could not be pushed at claim time.
    function withdrawPayout() external nonReentrant {
        uint256 amount = deferredPayout[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        deferredPayout[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------------------------
    // The mechanism
    // ---------------------------------------------------------------------------------

    /**
     * @dev Verify one leg with the precompile, burn its query id, recover its position, and
     *      decode everything the proof already contains.
     *
     *      `_computeQueryId` and `_verifyProof` are the inherited {USCBase} helpers — the
     *      replay namespace is the canonical `(chainKey, blockHeight, txIndex)` one, which
     *      means a leg burned here is burned for every ASC convention on this chain. The
     *      extra `calculateTxIndex` call is deliberate: the canonical helper computes the
     *      index and throws it away, and paying a few hundred gas to reuse the canonical id
     *      derivation is worth more than saving it.
     */
    function _proveLeg(Claim calldata c, uint256 i) private returns (ProvenLeg memory p) {
        LegBundle calldata leg = c.legs[i];

        p.queryId = _computeQueryId(c.chainKey, c.blockHeight, leg.merkleRoot, leg.siblings);
        // Replay protection is the game rule here, not hygiene: one sandwich, one payout.
        if (processedQueries[p.queryId]) revert QueryAlreadyProcessed(p.queryId);
        processedQueries[p.queryId] = true;

        bool verified = _verifyProof(
            c.chainKey,
            c.blockHeight,
            leg.encodedTransaction,
            leg.merkleRoot,
            leg.siblings,
            c.lowerEndpointDigest,
            c.continuityRoots
        );
        if (!verified) revert VerificationFailed(i);

        p.txIndex =
            VERIFIER.calculateTxIndex(INativeQueryVerifier.MerkleProof({root: leg.merkleRoot, siblings: leg.siblings}));

        _decodeLeg(c, i, leg.encodedTransaction, p);
    }

    /// @dev Everything below this line is read out of bytes the precompile has already verified.
    function _decodeLeg(Claim calldata c, uint256 i, bytes memory encoded, ProvenLeg memory p) private pure {
        p.txType = EvmV1Decoder.getTransactionType(encoded);
        if (!EvmV1Decoder.isValidTransactionType(p.txType)) revert UnsupportedTransactionType(i, p.txType);

        // Free from the common chunk: sender, entry point, nonce, gas limit, value, calldata.
        EvmV1Decoder.CommonTxFields memory common = EvmV1Decoder.decodeCommonTxFields(encoded);
        p.from = common.from;
        p.to = common.to;

        // Free from the receipt chunk: status, gas used, the full log set.
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encoded);
        if (receipt.receiptStatus != 1) revert TransactionReverted(i);
        p.gasUsed = receipt.receiptGasUsed;

        // Not free: the fee caps live in the type-specific chunk, which is why we spend a
        // selective decode on them and on nothing else.
        (p.maxFeePerGas, p.maxPriorityFeePerGas) = _feeCaps(p.txType, encoded);

        EvmV1Decoder.LogEntry[] memory swaps = EvmV1Decoder.getLogsByEventSignature(receipt, UNISWAP_V2_SWAP);
        _sumSwaps(swaps, i, c.pool, c.numeraireIsToken0, p);
        if (p.swapCount == 0) revert PoolNotTouched(i, c.pool);
    }

    /**
     * @dev Normalises the fee bid across all five EVM transaction types.
     *      Legacy and type-1 transactions have no separate priority field, so `gasPrice`
     *      fills both slots — it is the total price-per-gas the sender committed to.
     */
    function _feeCaps(uint8 txType, bytes memory encoded)
        private
        pure
        returns (uint256 maxFeePerGas, uint256 maxPriorityFeePerGas)
    {
        if (txType == 0) {
            EvmV1Decoder.LegacyFields memory f = EvmV1Decoder.decodeTypeSpecificFieldsType0(encoded);
            return (f.gasPrice, f.gasPrice);
        }
        if (txType == 1) {
            EvmV1Decoder.Type1Fields memory f = EvmV1Decoder.decodeTypeSpecificFieldsType1(encoded);
            return (f.gasPrice, f.gasPrice);
        }
        if (txType == 2) {
            EvmV1Decoder.Type2Fields memory f = EvmV1Decoder.decodeTypeSpecificFieldsType2(encoded);
            return (f.maxFeePerGas, f.maxPriorityFeePerGas);
        }
        if (txType == 3) {
            EvmV1Decoder.Type3Fields memory f = EvmV1Decoder.decodeTypeSpecificFieldsType3(encoded);
            return (f.maxFeePerGas, f.maxPriorityFeePerGas);
        }
        EvmV1Decoder.Type4Fields memory f4 = EvmV1Decoder.decodeTypeSpecificFieldsType4(encoded);
        return (f4.maxFeePerGas, f4.maxPriorityFeePerGas);
    }

    /// @dev Sums every `Swap` this leg caused at `pool`. A leg may hit the pool more than once.
    function _sumSwaps(
        EvmV1Decoder.LogEntry[] memory swaps,
        uint256 i,
        address pool,
        bool numeraireIsToken0,
        ProvenLeg memory p
    ) private pure {
        for (uint256 k = 0; k < swaps.length; ++k) {
            if (swaps[k].address_ != pool) continue;
            if (swaps[k].data.length != SWAP_DATA_LENGTH) revert MalformedSwapLog(i, swaps[k].data.length);

            (uint256 a0In, uint256 a1In, uint256 a0Out, uint256 a1Out) =
                abi.decode(swaps[k].data, (uint256, uint256, uint256, uint256));

            if (numeraireIsToken0) {
                p.numeraireIn += a0In;
                p.numeraireOut += a0Out;
                p.counterIn += a1In;
                p.counterOut += a1Out;
            } else {
                p.numeraireIn += a1In;
                p.numeraireOut += a1Out;
                p.counterIn += a0In;
                p.counterOut += a0Out;
            }
            unchecked {
                ++p.swapCount;
            }
        }
    }

    /// @dev The sandwich shape. Every clause is a fact carried by the proof.
    function _assertShape(Claim calldata c, ProvenLeg memory front, ProvenLeg memory victim, ProvenLeg memory back)
        private
        view
    {
        // THE assertion. Position, recovered from merkle laterality, is now a fact.
        if (!(front.txIndex < victim.txIndex && victim.txIndex < back.txIndex)) {
            revert NotAscending(front.txIndex, victim.txIndex, back.txIndex);
        }

        // One searcher on both outer legs.
        if (front.from != back.from) revert SearcherMismatch(front.from, back.from);
        // Nobody gets to sandwich themselves and then bill the relay for it.
        if (victim.from == front.from) revert VictimIsSearcher(front.from);

        // The relay must actually have promised to route this entry point.
        if (!covers[c.relay][victim.to]) revert EntrypointNotCovered(c.relay, victim.to);

        // Front-run buys the counter asset with the numeraire...
        if (front.numeraireIn == 0 || front.numeraireOut != 0) {
            revert FrontRunNotABuy(front.numeraireIn, front.numeraireOut);
        }
        // ...the victim is pushed through in the same direction...
        if (victim.numeraireIn == 0) revert VictimTradedOtherWay(victim.numeraireIn);
        // ...and the back-run sells it straight back out.
        if (back.numeraireOut == 0 || back.numeraireIn != 0) {
            revert BackRunNotASell(back.numeraireIn, back.numeraireOut);
        }

        // Corroborating, not load-bearing — see the contract-level note on baseFee.
        if (front.maxPriorityFeePerGas < victim.maxPriorityFeePerGas) {
            revert FrontRunDidNotOutbid(front.maxPriorityFeePerGas, victim.maxPriorityFeePerGas);
        }
    }

    /**
     * @dev Harm is the attacker's REALIZED PROFIT: numeraire committed on the way in versus
     *      numeraire taken back out. Both numbers are inside the proof. This is deliberately
     *      not "the victim's loss against the pre-sandwich reserve ratio" — that is a
     *      counterfactual over state Attestcoin does not commit, and a contract that pretended
     *      to prove it would be lying.
     */
    function _harm(ProvenLeg memory front, ProvenLeg memory back) private pure returns (uint256) {
        if (back.numeraireOut <= front.numeraireIn) {
            revert NoRealizedProfit(front.numeraireIn, back.numeraireOut);
        }
        return back.numeraireOut - front.numeraireIn;
    }

    function _record(
        Claim calldata c,
        ProvenLeg memory front,
        ProvenLeg memory victim,
        ProvenLeg memory back,
        uint256 harm,
        uint256 paid
    ) private {
        bytes32 claimId = claimIdFor(
            c.chainKey, c.blockHeight, c.legs[0].merkleRoot, front.txIndex, victim.txIndex, back.txIndex
        );
        // Unreachable while the per-leg ids are burned above; kept because the invariant
        // "one sandwich, one payout" should not depend on a single mechanism.
        if (processedQueries[claimId]) revert QueryAlreadyProcessed(claimId);
        processedQueries[claimId] = true;

        verdicts[claimId] = Verdict({
            relay: c.relay,
            searcher: front.from,
            victim: victim.from,
            blockHeight: c.blockHeight,
            frontIndex: front.txIndex,
            victimIndex: victim.txIndex,
            backIndex: back.txIndex,
            harm: harm,
            paid: paid,
            ruledAt: uint64(block.timestamp)
        });
        claimIds.push(claimId);
    }

    function _payout(address victim, address relay, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = victim.call{value: amount, gas: PAYOUT_GAS}("");
        if (ok) {
            emit HarmPaid(victim, relay, amount);
        } else {
            deferredPayout[victim] += amount;
            emit PayoutDeferred(victim, amount);
        }
    }

    // ---------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------

    /// @notice Recover a transaction's position inside its block. Free — a `view` on the precompile.
    function txIndexOf(bytes32 merkleRoot, INativeQueryVerifier.MerkleProofEntry[] calldata siblings)
        external
        view
        returns (uint64)
    {
        return VERIFIER.calculateTxIndex(INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings}));
    }

    /// @notice The identity of a sandwich: the block, its tree, and the three positions inside it.
    function claimIdFor(
        uint64 chainKey,
        uint64 blockHeight,
        bytes32 merkleRoot,
        uint64 frontIndex,
        uint64 victimIndex,
        uint64 backIndex
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(chainKey, blockHeight, merkleRoot, frontIndex, victimIndex, backIndex));
    }

    function claimCount() external view returns (uint256) {
        return claimIds.length;
    }

    function verdictAt(uint256 i) external view returns (Verdict memory) {
        return verdicts[claimIds[i]];
    }

    // ---------------------------------------------------------------------------------
    // USCBase hook
    // ---------------------------------------------------------------------------------

    /**
     * @dev The inherited {USCBase-execute} single-transaction path is closed, on purpose.
     *
     *      `execute` burns a query id before running business logic. If it were open, anyone
     *      could call it on the victim's transaction and permanently poison that leg, making
     *      the sandwich unclaimable for free. In a court, the replay namespace is a game rule,
     *      so nothing outside {proveSandwich} is allowed to spend it. Reverting here reverts
     *      the whole call, so no query id is consumed.
     */
    function _processAndEmitEvent(uint8 action, bytes32, bytes memory) internal pure override {
        revert GenericExecuteDisabled(action);
    }

    /// @dev Bonds arrive through {postBond}; a bare transfer has no relay to credit.
    receive() external payable {
        revert ZeroBondAmount();
    }
}
