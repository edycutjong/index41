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
