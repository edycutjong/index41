/**
 * From proven bytes to a ruling.
 *
 * Everything in this file happens off-chain BEFORE the claim is submitted, and every fact it
 * derives is derived the way the contract will derive it — because it uses the same decoder. Not a
 * reimplementation of `EvmV1Decoder` in TypeScript: literally Creditcoin's deployed copy of
 * `EvmV1Decoder`, called over `eth_call` through `utils.decoder.decodeEvmV1Transaction`. Index41
 * links against that library at 0x731c…F9F on CC3; the pipeline reads the same address.
 *
 * That is what makes the preflight worth having. A claim that fails here would have failed on
 * chain with an opaque precompile revert; failing here costs nothing and names the clause.
 *
 * The one claimant-supplied field, `numeraireIsToken0`, is derived here too, from the front-run's
 * own Swap log. Getting it wrong is self-defeating rather than exploitable — the contract requires
 * the numeraire to flow IN on the front-run and OUT on the back-run, so a flipped flag turns the
 * purchase into an apparent sale and the claim reverts.
 */

import { Contract, type JsonRpcApiProvider, type Wallet, id } from 'ethers';
import { utils } from '@gluwa/usc-sdk';

import { EVM_V1_DECODER, VERIFIER_PRECOMPILE } from './config.js';
import type { ProofBundle } from './proof-sources.js';
import { readArtifact } from './artifacts.js';
import { surfaceWork } from './surfaces.js';

/** `Swap(address,uint256,uint256,uint256,uint256,address)` — Uniswap V2 and every fork of it. */
export const UNISWAP_V2_SWAP = id('Swap(address,uint256,uint256,uint256,uint256,address)');

/** `TransactionVerified(uint64,uint64,uint64)`, emitted by the precompile itself, once per leg. */
export const TRANSACTION_VERIFIED = id('TransactionVerified(uint64,uint64,uint64)');

export interface SwapAmounts {
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
}

export interface DecodedLeg {
  role: string;
  txIndex: number;
  txType: number;
  from: string;
  to: string;
  receiptStatus: number;
  gasUsed: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Every log this leg emitted, as the on-chain decoder sees them. */
  logCount: number;
  /** Pool addresses this leg saw emit a Uniswap-V2 `Swap`. */
  swapEmitters: string[];
  swaps: Map<string, SwapAmounts[]>;
  /** Aggregate estimateGas across the decoder round-trips, when tracking is on. */
  decodeGas?: bigint;
}

export function decoderContract(rpc: JsonRpcApiProvider): Contract {
  const { abi } = readArtifact('EvmV1Decoder');
  return new Contract(EVM_V1_DECODER, abi as never, rpc);
}

function feeCaps(decoded: Awaited<ReturnType<typeof utils.decoder.decodeEvmV1Transaction>>): {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
} {
  // Mirrors Index41._feeCaps exactly: legacy and type-1 have no separate tip field, so `gasPrice`
  // fills both slots — it is the total price-per-gas the sender committed to.
  switch (decoded.type) {
    case 0:
      return { maxFeePerGas: decoded.data.type0.gasPrice, maxPriorityFeePerGas: decoded.data.type0.gasPrice };
    case 1:
      return { maxFeePerGas: decoded.data.type1.gasPrice, maxPriorityFeePerGas: decoded.data.type1.gasPrice };
    case 2:
      return {
        maxFeePerGas: decoded.data.type2.maxFeePerGas,
        maxPriorityFeePerGas: decoded.data.type2.maxPriorityFeePerGas,
      };
    case 3:
      return {
        maxFeePerGas: decoded.data.type3.maxFeePerGas,
        maxPriorityFeePerGas: decoded.data.type3.maxPriorityFeePerGas,
      };
    default:
      return {
        maxFeePerGas: decoded.data.type4.maxFeePerGas,
        maxPriorityFeePerGas: decoded.data.type4.maxPriorityFeePerGas,
      };
  }
}

function decodeSwapData(data: string): SwapAmounts {
  const hex = data.replace(/^0x/, '');
  if (hex.length !== 256) throw new Error(`Swap payload is ${hex.length / 2} bytes, expected 128`);
  const word = (n: number) => BigInt('0x' + hex.slice(n * 64, n * 64 + 64));
  return { amount0In: word(0), amount1In: word(1), amount0Out: word(2), amount1Out: word(3) };
}

/** Decodes one proven leg through Creditcoin's deployed `EvmV1Decoder`. */
export async function decodeLeg(
  decoder: Contract,
  role: string,
  txIndex: number,
  txBytes: string,
  trackGas = false,
): Promise<DecodedLeg> {
  // One `eth_call` into Creditcoin's deployed EvmV1Decoder — the same library address Index41
  // links against on chain, so the preflight decode is the decode the contract will perform.
  surfaceWork('utils.decoder.decodeEvmV1Transaction');
  surfaceWork('EvmV1Decoder (deployed library)');
  const decoded = await utils.decoder.decodeEvmV1Transaction(txBytes, decoder, { trackGas });
  const { commonTx, receipt } = decoded.data;
  const caps = feeCaps(decoded);

  const swaps = new Map<string, SwapAmounts[]>();
  for (const log of receipt.receiptLogs) {
    if (log.topics[0]?.toLowerCase() !== UNISWAP_V2_SWAP.toLowerCase()) continue;
    const pool = log.address_.toLowerCase();
    const list = swaps.get(pool) ?? [];
    list.push(decodeSwapData(log.data));
    swaps.set(pool, list);
  }

  return {
    role,
    txIndex,
    txType: decoded.type,
    from: commonTx.from,
    to: commonTx.to,
    receiptStatus: receipt.receiptStatus,
    gasUsed: receipt.receiptGasUsed,
    maxFeePerGas: caps.maxFeePerGas,
    maxPriorityFeePerGas: caps.maxPriorityFeePerGas,
    logCount: receipt.receiptLogs.length,
    swapEmitters: [...swaps.keys()],
    swaps,
    ...(decoded.gasUsed !== undefined ? { decodeGas: decoded.gasUsed } : {}),
  };
}

// -------------------------------------------------------------------------------------------
// Shape
// -------------------------------------------------------------------------------------------

export interface Shape {
  pool: string;
  numeraireIsToken0: boolean;
  searcher: string;
  victim: string;
  victimEntrypoint: string;
  frontNumeraireIn: bigint;
  victimNumeraireIn: bigint;
  backNumeraireOut: bigint;
  harm: bigint;
}

function sums(legs: SwapAmounts[], numeraireIsToken0: boolean) {
  let inAmt = 0n;
  let outAmt = 0n;
  for (const s of legs) {
    inAmt += numeraireIsToken0 ? s.amount0In : s.amount1In;
    outAmt += numeraireIsToken0 ? s.amount0Out : s.amount1Out;
  }
  return { in: inAmt, out: outAmt };
}

/**
 * Derives the pool and the numeraire orientation from the proven logs, then reproduces every
 * clause of `Index41._assertShape` and `_harm` off-chain. Throws with the clause that would have
 * failed rather than letting the chain say `0x` back at you.
 */
export function deriveShape(front: DecodedLeg, victim: DecodedLeg, back: DecodedLeg): Shape {
  // The pool is the Swap emitter common to all three legs. Note it is emphatically NOT the
  // transactions' `to`: the searcher's legs call a bot contract and the victim calls a router, so
  // requiring `to` equality would reject genuine sandwiches. The log emitter is equally provable.
  const common = front.swapEmitters.filter(
    (p) => victim.swapEmitters.includes(p) && back.swapEmitters.includes(p),
  );
  if (common.length === 0) {
    throw new Error(
      'no AMM pool emitted a Uniswap-V2 Swap in all three legs — ' +
        `front ${front.swapEmitters.join(',') || 'none'} · victim ${victim.swapEmitters.join(',') || 'none'} · ` +
        `back ${back.swapEmitters.join(',') || 'none'}`,
    );
  }
  const pool = common[0]!;

  // Orientation: the numeraire is whichever side the front-run PAYS IN and takes none of back out.
  const asToken0 = sums(front.swaps.get(pool)!, true);
  const asToken1 = sums(front.swaps.get(pool)!, false);
  let numeraireIsToken0: boolean;
  if (asToken0.in > 0n && asToken0.out === 0n) numeraireIsToken0 = true;
  else if (asToken1.in > 0n && asToken1.out === 0n) numeraireIsToken0 = false;
  else {
    throw new Error(
      `the front-run is not a one-way purchase at ${pool}: token0 in=${asToken0.in} out=${asToken0.out}, ` +
        `token1 in=${asToken1.in} out=${asToken1.out}`,
    );
  }

  const f = sums(front.swaps.get(pool)!, numeraireIsToken0);
  const v = sums(victim.swaps.get(pool)!, numeraireIsToken0);
  const b = sums(back.swaps.get(pool)!, numeraireIsToken0);

  // Every check below is the off-chain twin of a `revert` in Index41.
  if (!(front.txIndex < victim.txIndex && victim.txIndex < back.txIndex)) {
    throw new Error(`NotAscending(${front.txIndex}, ${victim.txIndex}, ${back.txIndex})`);
  }
  if (front.from.toLowerCase() !== back.from.toLowerCase()) {
    throw new Error(`SearcherMismatch(${front.from}, ${back.from})`);
  }
  if (victim.from.toLowerCase() === front.from.toLowerCase()) {
    throw new Error(`VictimIsSearcher(${front.from})`);
  }
  for (const leg of [front, victim, back]) {
    if (leg.receiptStatus !== 1) throw new Error(`TransactionReverted(${leg.role})`);
  }
  if (f.in === 0n || f.out !== 0n) throw new Error(`FrontRunNotABuy(${f.in}, ${f.out})`);
  if (v.in === 0n) throw new Error(`VictimTradedOtherWay(${v.in})`);
  if (b.out === 0n || b.in !== 0n) throw new Error(`BackRunNotASell(${b.in}, ${b.out})`);
  if (front.maxPriorityFeePerGas < victim.maxPriorityFeePerGas) {
    throw new Error(`FrontRunDidNotOutbid(${front.maxPriorityFeePerGas}, ${victim.maxPriorityFeePerGas})`);
  }
  if (b.out <= f.in) throw new Error(`NoRealizedProfit(${f.in}, ${b.out})`);

  return {
    pool,
    numeraireIsToken0,
    searcher: front.from,
    victim: victim.from,
    victimEntrypoint: victim.to,
    frontNumeraireIn: f.in,
    victimNumeraireIn: v.in,
    backNumeraireOut: b.out,
    harm: b.out - f.in,
  };
}

// -------------------------------------------------------------------------------------------
// Submission
// -------------------------------------------------------------------------------------------

export interface ClaimStruct {
  relay: string;
  chainKey: number;
  blockHeight: number;
  pool: string;
  numeraireIsToken0: boolean;
  lowerEndpointDigest: string;
  continuityRoots: string[];
  legs: Array<{
    encodedTransaction: string;
    merkleRoot: string;
    siblings: Array<{ hash: string; isLeft: boolean }>;
  }>;
}

export function buildClaim(bundle: ProofBundle, relay: string, shape: Shape): ClaimStruct {
  return {
    relay,
    chainKey: bundle.chainKey,
    blockHeight: bundle.blockNumber,
    pool: shape.pool,
    numeraireIsToken0: shape.numeraireIsToken0,
    lowerEndpointDigest: bundle.continuityProof.lowerEndpointDigest,
    continuityRoots: bundle.continuityProof.roots,
    legs: bundle.legs.map((l) => ({
      encodedTransaction: l.txBytes,
      merkleRoot: l.merkleProof.root,
      siblings: l.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    })),
  };
}

export interface GasBudget {
  calldataBytes: number;
  computedLimit: bigint;
  cappedLimit: bigint;
  /** `utils.gas.gasAsPercentageOfMax` — integer basis-point division, truncates below 0.01pt. */
  percentOfCapBefore: number;
  /** Full-precision `computedLimit / MAX_GAS_CAP`, for display where the truncation matters. */
  exactPercentOfCapBefore: number;
}

/**
 * `computedLimit / MAX_GAS_CAP`, done in floating point rather than the SDK's integer
 * basis-point division. `utils.gas.gasAsPercentageOfMax` computes `(gas * 10000) / MAX_GAS_CAP`
 * with integer division and then divides by 100, which truncates: 292,376 gas over a 75,000,000
 * cap is 0.389835%, but the SDK helper returns 0.38% because `(292376 * 10000) / 75000000 = 38`
 * (bp) truncates before the percent conversion. The gas figures here are all well inside
 * `Number`'s exact-integer range, so this is exact, not an approximation.
 */
function exactPercentOfMax(gas: bigint): number {
  surfaceWork('utils.gas.MAX_GAS_CAP');
  return (Number(gas) / Number(utils.gas.MAX_GAS_CAP)) * 100;
}

/**
 * The budget, computed with the SDK's own gas helpers rather than a local rule of thumb.
 * `computeGasLimit` estimates and — when `pallet-evm` refuses to propagate a precompile revert
 * reason during estimation, which it does — falls back to a continuity-length heuristic. Whatever
 * it returns is then held against `MAX_GAS_CAP`, the 75,000,000 ceiling a Creditcoin block enforces.
 */
export async function budgetGas(
  rpc: JsonRpcApiProvider,
  contract: Contract,
  calldata: string,
  from: string,
  continuityLength: number,
): Promise<GasBudget> {
  surfaceWork('utils.gas.computeGasLimit');
  const computedLimit = await utils.gas.computeGasLimit(rpc, contract, calldata, from, continuityLength);
  surfaceWork('utils.gas.MAX_GAS_CAP');
  const cappedLimit = computedLimit > utils.gas.MAX_GAS_CAP ? utils.gas.MAX_GAS_CAP : computedLimit;
  surfaceWork('utils.hex.bytesInHexString');
  surfaceWork('utils.gas.gasAsPercentageOfMax');
  return {
    calldataBytes: utils.hex.bytesInHexString(calldata),
    computedLimit,
    cappedLimit,
    percentOfCapBefore: utils.gas.gasAsPercentageOfMax(computedLimit),
    exactPercentOfCapBefore: exactPercentOfMax(computedLimit),
  };
}

export interface SubmissionResult {
  txHash: string;
  blockNumber: number;
  status: number;
  gasUsed: bigint;
  /** `utils.gas.gasAsPercentageOfMax` — truncated, see `exactPercentOfMax` doc comment above. */
  percentOfCap: number;
  exactPercentOfCap: number;
  /** Positions the PRECOMPILE itself reported, one per `verifyAndEmit`. */
  verifiedIndices: number[];
  events: Array<{ name: string; args: string[] }>;
}

export async function submitClaim(
  index41: Contract,
  wallet: Wallet,
  claim: ClaimStruct,
  gasLimit: bigint,
): Promise<SubmissionResult> {
  const tx = await (index41.connect(wallet) as Contract).proveSandwich!(claim, { gasLimit });
  const receipt = await tx.wait();
  if (!receipt) throw new Error(`no receipt for ${tx.hash}`);

  const events: SubmissionResult['events'] = [];
  const verifiedIndices: number[] = [];
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() === VERIFIER_PRECOMPILE.toLowerCase() &&
      log.topics[0] === TRANSACTION_VERIFIED
    ) {
      verifiedIndices.push(Number(BigInt(log.data)));
      continue;
    }
    try {
      const parsed = index41.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed) events.push({ name: parsed.name, args: parsed.args.map((a: unknown) => String(a)) });
    } catch {
      /* not ours */
    }
  }

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status ?? 0,
    gasUsed: receipt.gasUsed,
    percentOfCap: utils.gas.gasAsPercentageOfMax(receipt.gasUsed),
    exactPercentOfCap: exactPercentOfMax(receipt.gasUsed),
    verifiedIndices,
    events,
  };
}
