/**
 * Client for the Attestcoin proof-gen API's BY-INDEX batch endpoint.
 *
 *     POST /api/v1/proof-batch/{chain_key}
 *     [{ "headerNumber": 25764741, "txIndexes": [14, 15, 16] }]
 *
 * The SDK's `proofProvider.service.ProofBuilder` only speaks
 * `/proof-by-tx` and `/proof-batch-by-tx`; the by-INDEX batch endpoint has no
 * SDK binding and no official example, so index41 binds it here.
 *
 * Why this endpoint and not three `getProof` calls:
 *
 *  - It returns ONE shared continuity proof for the whole range instead of one
 *    per transaction. Three legs of a sandwich live in the same block, so the
 *    continuity proof is provably identical — paying for it three times is
 *    calldata index41 does not have gas to waste.
 *  - `ContinuityProofBuilder.mergeProofs` is NOT a way around this: it THROWS on
 *    non-contiguous ranges, and three proofs for one block are not a contiguous
 *    ascending range.
 *  - Asking by index (not by hash) is what the mechanism actually needs: the
 *    claim is about POSITIONS, and this is the only endpoint keyed by position.
 */

import { CC3 } from './config.js';

export interface MerkleProofEntry {
  hash: string;
  isLeft: boolean;
}

export interface TransactionMerkleProof {
  root: string;
  siblings: MerkleProofEntry[];
}

export interface ContinuityProof {
  lowerEndpointDigest: string;
  roots: string[];
}

export interface BatchMerkleProofEntry {
  txHash?: string;
  txBytes?: string;
  merkleProof: TransactionMerkleProof;
}

export interface BatchedContinuityResponse {
  chainKey: number;
  fromHeader: number;
  toHeader: number;
  continuityProof: ContinuityProof;
  /** headerNumber -> txIndex -> entry, both keys stringified integers. */
  merkleProofs: Record<string, Record<string, BatchMerkleProofEntry>>;
  cached: boolean;
  generatedAt: string;
}

export interface ProofQuery {
  headerNumber: number;
  txIndexes?: number[];
}

export interface ProverError {
  code: string;
  message: string;
  retriable: boolean;
  block_number?: number | null;
  last_attested_block?: number | null;
}

export class ProverApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ProverError | string,
  ) {
    const detail =
      typeof body === 'string'
        ? body
        : `${body.code}: ${body.message} (retriable=${body.retriable}` +
          (body.last_attested_block != null ? `, lastAttested=${body.last_attested_block}` : '') +
          ')';
    super(`proof-gen API HTTP ${status} — ${detail}`);
    this.name = 'ProverApiError';
  }
}

async function readError(res: Response): Promise<never> {
  const text = await res.text();
  try {
    throw new ProverApiError(res.status, JSON.parse(text) as ProverError);
  } catch (err) {
    if (err instanceof ProverApiError) throw err;
    throw new ProverApiError(res.status, text.slice(0, 500));
  }
}

/** `GET /api/v1/attested-height/{chain_key}` — the tip the proof service will serve. */
export async function attestedHeight(chainKey: number, baseUrl: string = CC3.proverUrl): Promise<number> {
  const res = await fetch(`${baseUrl}/api/v1/attested-height/${chainKey}`);
  if (!res.ok) await readError(res);
  const body = (await res.json()) as { attestedHeight: number | null };
  if (body.attestedHeight == null) throw new Error(`chain key ${chainKey} reports no attested height`);
  return body.attestedHeight;
}

/** `GET /api/v1/health` */
export async function health(baseUrl: string = CC3.proverUrl) {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  if (!res.ok) await readError(res);
  return (await res.json()) as {
    status: string;
    cc3_rpc_connected: boolean;
    eth_rpc_connected: boolean;
    uptime_seconds: number;
  };
}

/** `POST /api/v1/proof-batch/{chain_key}` — proofs BY BLOCK POSITION, one shared continuity proof. */
export async function proofBatchByIndex(
  chainKey: number,
  queries: ProofQuery[],
  baseUrl: string = CC3.proverUrl,
  timeoutMs = 180_000,
): Promise<BatchedContinuityResponse> {
  const res = await fetch(`${baseUrl}/api/v1/proof-batch/${chainKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(queries),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) await readError(res);
  return (await res.json()) as BatchedContinuityResponse;
}

// ---------------------------------------------------------------------------------------------
// Adaptive attestation waiting
//
// The official examples wait for a block to become provable by calling
// `waitUntilHeightAttested` on a FLAT 15s poll with a 20-minute ceiling — a fixed schedule that
// knows nothing about how far behind the attestation actually is.
//
// The proof-gen API already tells you. Its `ErrorResponse` carries `retriable` and, on
// `BlockNotReady`, `block_number` and `last_attested_block`. Subtract them and you know exactly
// how many source-chain blocks the attestation is behind; multiply by the source chain's block
// time and you have the earliest instant at which retrying can possibly succeed. Neither field is
// touched by any official example, and neither has an SDK binding.
// ---------------------------------------------------------------------------------------------

/** Ethereum mainnet slot time. The unit the attestation lag is denominated in. */
export const SOURCE_BLOCK_SECONDS = 12;

/** Never sleep longer than this between probes, however far behind the attestation is. */
export const MAX_BACKOFF_MS = 60_000;

/** Never sleep less than this — the attested height is cached server-side and moves in steps. */
export const MIN_BACKOFF_MS = 3_000;

export interface RetriableContract {
  /** Did the prover answer an unattested height with a structured, retriable error? */
  honoured: boolean;
  code: string;
  retriable: boolean;
  blockNumber: number | null;
  lastAttestedBlock: number | null;
  /** What the adaptive poller would sleep, given that answer. */
  backoffMs: number;
  raw: string;
}

/**
 * Turns a `BlockNotReady` response into a wait, using the numbers the prover actually reported.
 * Falls back to a flat interval only when the prover declines to say how far behind it is —
 * which is the one case where the official examples' fixed schedule is the honest answer.
 */
export function backoffFor(err: ProverError, flatMs = 15_000): number {
  if (!err.retriable) return 0;
  const target = err.block_number;
  const attested = err.last_attested_block;
  if (target == null || attested == null || target <= attested) return flatMs;
  const behind = target - attested;
  return Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, behind * SOURCE_BLOCK_SECONDS * 1000));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Asks the prover for a height it certainly cannot serve, and reports whether it answered with
 * the retriable contract the adaptive poller is built on.
 *
 * This is a preflight, not a demo: {@link waitForProvable} only trusts `retriable` +
 * `last_attested_block` if this probe says the prover honours them. If it does not, the poller
 * degrades to the flat schedule instead of silently sleeping on a field that is not there.
 */
export async function probeRetriableContract(
  chainKey: number,
  baseUrl: string = CC3.proverUrl,
): Promise<RetriableContract> {
  const tip = await attestedHeight(chainKey, baseUrl);
  // A few blocks above the attested tip and — crucially — still comfortably below the source
  // chain's head. Overshoot and the prover answers `BlockNotOnSourceChain` (404, "does not exist
  // yet"), which is a different error carrying neither `block_number` nor `last_attested_block`.
  // `BlockNotReady` (422) is the one the adaptive poller is built on, and it only appears in the
  // window between what is attested and what mainnet has already produced.
  const unattainable = tip + 3;
  try {
    await proofBatchByIndex(chainKey, [{ headerNumber: unattainable, txIndexes: [0] }], baseUrl, 30_000);
    return {
      honoured: false,
      code: '<none>',
      retriable: false,
      blockNumber: unattainable,
      lastAttestedBlock: tip,
      backoffMs: 15_000,
      raw: `prover served a proof for height ${unattainable}, which is ${unattainable - tip} blocks above its own attested tip`,
    };
  } catch (err) {
    if (!(err instanceof ProverApiError) || typeof err.body === 'string') {
      return {
        honoured: false,
        code: '<unstructured>',
        retriable: false,
        blockNumber: null,
        lastAttestedBlock: null,
        backoffMs: 15_000,
        raw: String(err),
      };
    }
    const body = err.body;
    return {
      honoured: body.retriable === true && body.last_attested_block != null,
      code: body.code,
      retriable: body.retriable,
      blockNumber: body.block_number ?? null,
      lastAttestedBlock: body.last_attested_block ?? null,
      backoffMs: backoffFor(body),
      raw: `HTTP ${err.status} ${body.code}: ${body.message}`,
    };
  }
}

export interface WaitReport {
  /** Attempts made against the prover, including the successful one. */
  attempts: number;
  /** Total time slept, in ms. Zero for a historical block. */
  sleptMs: number;
  /** The sleeps the poller chose, in order — the evidence that the schedule was adaptive. */
  schedule: number[];
  attestedAtStart: number;
  attestedAtEnd: number;
}

/**
 * Blocks until the prover will serve `headerNumber`, sleeping exactly as long as its own
 * `last_attested_block` says is necessary. Historical blocks return on the first attempt with
 * zero sleep, which is the normal case for index41 and is reported as such rather than hidden.
 */
export async function waitForProvable(
  chainKey: number,
  headerNumber: number,
  opts: { baseUrl?: string; adaptive?: boolean; timeoutMs?: number } = {},
): Promise<WaitReport> {
  const baseUrl = opts.baseUrl ?? CC3.proverUrl;
  const adaptive = opts.adaptive ?? true;
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000);

  const attestedAtStart = await attestedHeight(chainKey, baseUrl);
  const report: WaitReport = {
    attempts: 0,
    sleptMs: 0,
    schedule: [],
    attestedAtStart,
    attestedAtEnd: attestedAtStart,
  };

  for (;;) {
    report.attempts += 1;
    const tip = await attestedHeight(chainKey, baseUrl);
    report.attestedAtEnd = tip;
    if (tip >= headerNumber) return report;

    if (Date.now() > deadline) {
      throw new Error(
        `block ${headerNumber} is still unattested after ${report.attempts} attempts ` +
          `(attested tip ${tip}, ${headerNumber - tip} blocks behind)`,
      );
    }

    const synthetic: ProverError = {
      code: 'BlockNotReady',
      message: `height ${headerNumber} is above the attested tip`,
      retriable: true,
      block_number: headerNumber,
      last_attested_block: tip,
    };
    const ms = adaptive ? backoffFor(synthetic) : 15_000;
    report.schedule.push(ms);
    report.sleptMs += ms;
    await sleep(ms);
  }
}

/** Pulls one leg out of the two-level `merkleProofs` map, failing loudly if the prover omitted it. */
export function leg(
  batch: BatchedContinuityResponse,
  headerNumber: number,
  txIndex: number,
): Required<BatchMerkleProofEntry> {
  const perBlock = batch.merkleProofs[String(headerNumber)];
  if (!perBlock) {
    throw new Error(
      `proof batch has no block ${headerNumber}; it carries ${Object.keys(batch.merkleProofs).join(', ') || '<nothing>'}`,
    );
  }
  const entry = perBlock[String(txIndex)];
  if (!entry) {
    throw new Error(
      `proof batch for block ${headerNumber} has no txIndex ${txIndex}; it carries ${Object.keys(perBlock).join(', ')}`,
    );
  }
  if (!entry.txBytes) throw new Error(`proof batch entry ${headerNumber}/${txIndex} has no txBytes`);
  if (!entry.merkleProof?.siblings?.length) {
    throw new Error(`proof batch entry ${headerNumber}/${txIndex} has an empty merkle path`);
  }
  return { txHash: entry.txHash ?? '', txBytes: entry.txBytes, merkleProof: entry.merkleProof };
}

/**
 * Reads the block position straight out of the merkle path's laterality, in plain
 * TypeScript. This is the INDEPENDENT check: the number the Creditcoin precompile
 * returns must equal this, and both must equal the position mainnet reports.
 *
 * Each sibling is one bit, leaf -> root, least significant first:
 * a sibling on the LEFT means our node sat on the RIGHT, so that bit is 1.
 */
export function indexFromLaterality(proof: TransactionMerkleProof): number {
  let index = 0;
  proof.siblings.forEach((sibling, bit) => {
    if (sibling.isLeft) index |= 1 << bit;
  });
  return index;
}

/** `RLLLRRRR` — the raw bit-string the position is decoded from, for display. */
export function lateralityBits(proof: TransactionMerkleProof): string {
  return proof.siblings.map((s) => (s.isLeft ? 'L' : 'R')).join('');
}
