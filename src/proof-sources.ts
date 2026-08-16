/**
 * Where a proof comes from — and why index41 refuses to care.
 *
 * Every official Attestcoin example does exactly one thing: `new proofProvider.service.ProofBuilder(
 * chainKey, PROOF_BUILDER_URL).getProof(txHash)`. That makes a single hosted service the root of
 * trust for a protocol whose entire selling point is that you do not have to trust anybody. If
 * `prover.cc3-testnet.creditcoin.network` served a merkle path for the wrong transaction, the
 * examples would submit it.
 *
 * index41 treats the hosted prover as a convenience and nothing more. Three sources sit behind one
 * interface, tried in order, and the pipeline is indifferent to which one answers:
 *
 *   1. {@link HostedByIndexSource}  — `POST /api/v1/proof-batch/{chain_key}`, keyed by BLOCK
 *      POSITION. No SDK binding, no official example. It is the only endpoint that asks the
 *      question index41 actually asks ("give me positions 14, 15 and 16"), and it returns ONE
 *      continuity proof shared by all three legs instead of three copies of the same bytes.
 *   2. {@link HostedByHashSource}   — the SDK's own `proofProvider.service.ProofBuilder`, via its
 *      untouched `getBatchProof`. Same host, different endpoint and different code path, so it
 *      survives a by-index outage.
 *   3. {@link LocalRawSource}       — `proofProvider.raw.RawProofBuilder` over
 *      `SimpleBlockProvider`. NO hosted prover at all: the merkle tree is rebuilt from mainnet
 *      transactions and the continuity proof from Creditcoin's own attestations. Point it at any
 *      Ethereum RPC and index41 keeps working with the prover URL switched off.
 *
 * Because every source returns the same bundle, {@link auditBundle} can hold all of them to the
 * same standard, and the local one is what makes that audit meaningful: two independent
 * constructions of the same merkle root is a cross-check, not a checksum.
 */

import type { JsonRpcApiProvider } from 'ethers';
import { chainInfo, encoding, proofProvider } from '@gluwa/usc-sdk';

import { CachingBlockProvider } from './caching-block-provider.js';
import { CC3 } from './config.js';
import {
  type BatchedContinuityResponse,
  type ContinuityProof,
  type TransactionMerkleProof,
  leg as legOf,
  proofBatchByIndex,
} from './prover-api.js';

/** One transaction we want proven, named the way the claimant names it. */
export interface LegRequest {
  role: 'front-run' | 'victim' | 'back-run';
  hash: string;
  /** The position mainnet reports. index41 never trusts it — the precompile must reproduce it. */
  expectedIndex: number;
}

/** One transaction, proven. */
export interface ProvenLegProof extends LegRequest {
  txIndex: number;
  txHash: string;
  txBytes: string;
  merkleProof: TransactionMerkleProof;
}

/** Everything a claim needs, from whichever source produced it. */
export interface ProofBundle {
  source: string;
  blockNumber: number;
  chainKey: number;
  continuityProof: ContinuityProof;
  legs: ProvenLegProof[];
  elapsedMs: number;
  notes: string[];
}

/**
 * The seam. Deliberately narrower than the SDK's `ProofProvider` (which is hash-keyed and returns
 * one proof per call): index41 asks for a whole sandwich at once, because the shared continuity
 * proof only exists if you ask for the legs together.
 */
export interface ProofSource {
  readonly name: string;
  /** Human-readable statement of what this source trusts. Printed on every run. */
  readonly trusts: string;
  fetch(chainKey: number, blockNumber: number, legs: LegRequest[]): Promise<ProofBundle>;
}

function sortByRequest(legs: LegRequest[], found: Map<number, Omit<ProvenLegProof, keyof LegRequest>>) {
  return legs.map((l) => {
    const hit = found.get(l.expectedIndex);
    if (!hit) throw new Error(`source returned no proof for ${l.role} at index ${l.expectedIndex}`);
    return { ...l, ...hit };
  });
}

// -------------------------------------------------------------------------------------------
// 1. Hosted, by block position — the endpoint nothing else uses
// -------------------------------------------------------------------------------------------

export class HostedByIndexSource implements ProofSource {
  readonly name = 'hosted:proof-batch (by block position)';
  readonly trusts: string;

  constructor(private readonly baseUrl: string = CC3.proverUrl) {
    this.trusts = `${baseUrl} — POST /api/v1/proof-batch/{chain_key}`;
  }

  async fetch(chainKey: number, blockNumber: number, legs: LegRequest[]): Promise<ProofBundle> {
    const t0 = Date.now();
    const batch: BatchedContinuityResponse = await proofBatchByIndex(
      chainKey,
      [{ headerNumber: blockNumber, txIndexes: legs.map((l) => l.expectedIndex) }],
      this.baseUrl,
    );
    if (batch.chainKey !== chainKey) throw new Error(`prover answered for chainKey ${batch.chainKey}`);

    const found = new Map<number, Omit<ProvenLegProof, keyof LegRequest>>();
    for (const l of legs) {
      const entry = legOf(batch, blockNumber, l.expectedIndex);
      found.set(l.expectedIndex, {
        txIndex: l.expectedIndex,
        txHash: entry.txHash,
        txBytes: entry.txBytes,
        merkleProof: entry.merkleProof,
      });
    }

    return {
      source: this.name,
      chainKey,
      blockNumber,
      continuityProof: batch.continuityProof,
      legs: sortByRequest(legs, found),
      elapsedMs: Date.now() - t0,
      notes: [
        `fromHeader=${batch.fromHeader} toHeader=${batch.toHeader} cached=${batch.cached}`,
        `${batch.continuityProof.roots.length} continuity roots, fetched ONCE for all ${legs.length} legs`,
      ],
    };
  }
}

// -------------------------------------------------------------------------------------------
// 2. Hosted, by transaction hash — the SDK's own client, on its untouched batch method
// -------------------------------------------------------------------------------------------

export class HostedByHashSource implements ProofSource {
  readonly name = 'hosted:ProofBuilder.getBatchProof (SDK, by tx hash)';
  readonly trusts: string;
  private readonly builder: proofProvider.service.ProofBuilder;

  constructor(chainKey: number, baseUrl: string = CC3.proverUrl) {
    this.builder = new proofProvider.service.ProofBuilder(chainKey, baseUrl);
    this.trusts = `${baseUrl} — POST /api/v1/proof-batch-by-tx/{chain_key}, via the SDK client`;
  }

  async fetch(chainKey: number, blockNumber: number, legs: LegRequest[]): Promise<ProofBundle> {
    const t0 = Date.now();
    const result = await this.builder.getBatchProof(legs.map((l) => l.hash));
    if (!result.success || !result.data) throw new Error(result.error ?? 'getBatchProof returned no data');
    const data = result.data;

    const perBlock = data.merkleProofs.get(blockNumber);
    if (!perBlock) {
      throw new Error(`batch carries blocks ${[...data.merkleProofs.keys()].join(', ')}, not ${blockNumber}`);
    }

    const found = new Map<number, Omit<ProvenLegProof, keyof LegRequest>>();
    for (const [txIndex, entry] of perBlock) {
      found.set(txIndex, {
        txIndex,
        txHash: entry.txHash,
        txBytes: entry.txBytes,
        merkleProof: entry.merkleProof,
      });
    }

    return {
      source: this.name,
      chainKey,
      blockNumber,
      continuityProof: data.continuityProof,
      legs: sortByRequest(legs, found),
      elapsedMs: Date.now() - t0,
      notes: [
        `fromHeader=${data.fromHeader} toHeader=${data.toHeader} cached=${data.cached}`,
        `${data.continuityProof.roots.length} continuity roots`,
      ],
    };
  }
}

// -------------------------------------------------------------------------------------------
// 3. Local — no hosted prover in the loop at all
// -------------------------------------------------------------------------------------------

export class LocalRawSource implements ProofSource {
  readonly name = 'local:RawProofBuilder (no hosted prover)';
  readonly trusts: string;
  private readonly builder: proofProvider.raw.RawProofBuilder;
  private readonly blocks: CachingBlockProvider;

  /**
   * @param sourceRpc  An Ethereum mainnet JSON-RPC provider — where the merkle tree is rebuilt from.
   * @param cc3Rpc     Creditcoin, read through the chain-info precompile — where the continuity
   *                   proof's attestation bounds come from.
   */
  constructor(chainKey: number, sourceRpc: JsonRpcApiProvider, cc3Rpc: JsonRpcApiProvider) {
    this.blocks = CachingBlockProvider.wrapping(sourceRpc);
    this.builder = new proofProvider.raw.RawProofBuilder(
      chainKey,
      this.blocks,
      new chainInfo.PrecompileChainInfoProvider(cc3Rpc),
      encoding.EncodingVersion.V1,
    );
    this.trusts = 'an Ethereum RPC + the Creditcoin chain-info precompile. No proof service.';
  }

  /**
   * @dev Not `getBatchProof`. Three legs of one block collapse to `fromHeader === toHeader`, and
   *      `ContinuityProofBuilder.createForHeights` rejects `toHeight <= fromHeight` outright — the
   *      SDK's batch path cannot express a single-block batch, which is exactly index41's case.
   *      `getProof` per leg is the working call, and since all three legs share a block the three
   *      continuity proofs must come back byte-identical. That is asserted here rather than
   *      assumed, and it is also why `mergeProofs` is not used: it throws on non-contiguous
   *      ranges, and three proofs for one block are not a range at all.
   */
  async fetch(chainKey: number, blockNumber: number, legs: LegRequest[]): Promise<ProofBundle> {
    const t0 = Date.now();
    const found = new Map<number, Omit<ProvenLegProof, keyof LegRequest>>();
    let shared: ContinuityProof | null = null;

    for (const l of legs) {
      const result = await this.builder.getProof(l.hash);
      if (!result.success || !result.data) throw new Error(`${l.role}: ${result.error ?? 'no data'}`);
      const d = result.data;
      if (d.headerNumber !== blockNumber) {
        throw new Error(`${l.role} rebuilt from block ${d.headerNumber}, expected ${blockNumber}`);
      }
      if (shared === null) {
        shared = d.continuityProof;
      } else {
        const a = JSON.stringify(shared);
        const b = JSON.stringify(d.continuityProof);
        if (a !== b) throw new Error(`${l.role} produced a different continuity proof for the same block`);
      }
      found.set(d.txIndex, {
        txIndex: d.txIndex,
        txHash: d.txHash,
        txBytes: d.txBytes,
        merkleProof: d.merkleProof,
      });
    }
    if (!shared) throw new Error('no legs requested');

    return {
      source: this.name,
      chainKey,
      blockNumber,
      continuityProof: shared,
      legs: sortByRequest(legs, found),
      elapsedMs: Date.now() - t0,
      notes: [
        `${shared.roots.length} continuity roots, rebuilt from Creditcoin attestations`,
        `merkle tree rebuilt from mainnet transactions — ${this.blocks.summary()}`,
        'the three per-leg continuity proofs came back byte-identical, as one block requires',
      ],
    };
  }
}

// -------------------------------------------------------------------------------------------
// The ladder
// -------------------------------------------------------------------------------------------

export interface LadderAttempt {
  source: string;
  ok: boolean;
  elapsedMs: number;
  error?: string;
}

/**
 * Tries each source in order and returns the first bundle produced, recording what happened to the
 * ones before it. There is no flag to arm this and no environment variable to enable it: falling
 * through to a prover you run yourself is the default behaviour of the pipeline.
 */
export async function fetchFromLadder(
  sources: ProofSource[],
  chainKey: number,
  blockNumber: number,
  legs: LegRequest[],
  onAttempt?: (a: LadderAttempt) => void,
): Promise<{ bundle: ProofBundle; attempts: LadderAttempt[] }> {
  const attempts: LadderAttempt[] = [];
  for (const source of sources) {
    const t0 = Date.now();
    try {
      const bundle = await source.fetch(chainKey, blockNumber, legs);
      const a: LadderAttempt = { source: source.name, ok: true, elapsedMs: Date.now() - t0 };
      attempts.push(a);
      onAttempt?.(a);
      return { bundle, attempts };
    } catch (err) {
      const a: LadderAttempt = {
        source: source.name,
        ok: false,
        elapsedMs: Date.now() - t0,
        error: (err as Error).message.split('\n')[0],
      };
      attempts.push(a);
      onAttempt?.(a);
    }
  }
  throw new Error(
    `every proof source failed:\n${attempts.map((a) => `  ${a.source}: ${a.error}`).join('\n')}`,
  );
}
