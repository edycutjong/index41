/**
 * The one function that decides what the page is allowed to show.
 *
 * Two sources of truth, both real, and the page always says which one it used:
 *
 *   LIVE CHAIN READ   — `eth_getTransactionReceipt` against a public CC3 testnet node, right now.
 *                       The indices come out of the Attestcoin precompile's own logs.
 *   CACHED PROOF      — `data/proof-artifact.json`, written by `scripts/capture-proof.mjs`, which
 *                       reads the same receipt plus the merkle paths from the proof service and
 *                       refuses to write a file it could not verify. It is a recording of a real
 *                       read, not a substitute for one.
 *
 * There is no third source. If both are unavailable the page renders an explicit failure state.
 * It never renders numbers it cannot attribute.
 */

import artifactJson from '@/data/proof-artifact.json';
import { CC3, indexFromLaterality, readClaimReceipt, type DecodedRuling } from './chain';

export type Artifact = typeof artifactJson;
export const artifact: Artifact = artifactJson;

export type ProvenanceMode = 'live-chain-read' | 'cached-proof-artifact';

export interface Leg {
  role: string;
  label: string;
  blurb: string;
  /** The position the precompile emitted on-chain. */
  index: number;
  /** The position independently recovered from the merkle path's shape. */
  indexFromPath: number;
  agrees: boolean;
  txHash: string;
  txBytes: number;
  laterality: string;
  siblings: Array<{ hash: string; isLeft: boolean }>;
  merkleRoot: string;
}

export interface ProofView {
  provenance: {
    mode: ProvenanceMode;
    /** ISO instant of the chain read, or of the capture the page fell back to. */
    at: string;
    rpc: string;
    /** Present only when a live read was attempted and failed. */
    liveError?: string;
    capturedAt: string;
  };
  claim: DecodedRuling['claim'];
  ruling: DecodedRuling['ruling'];
  harmPaid: DecodedRuling['harmPaid'];
  verified: DecodedRuling['verified'];
  legs: Leg[];
  source: Artifact['source'];
  contract: Artifact['contract'];
  network: Artifact['network'];
  ordered: boolean;
}

/**
 * Join a ruling to the merkle paths that justify it.
 *
 * The join key is the index the CHAIN reported. If the artifact has no path for a position the
 * chain emitted, that is a contradiction and this throws rather than quietly dropping a row.
 *
 * `rpc` is the endpoint actually attempted for this call — `CC3.rpcUrl` (which respects
 * `NEXT_PUBLIC_CC3_RPC` if set) for a live read, or the artifact's recorded endpoint for a cached
 * one. It is never assumed to be the artifact's endpoint just because the artifact exists.
 */
function assemble(
  ruling: DecodedRuling,
  mode: ProvenanceMode,
  at: string,
  rpc: string,
  liveError?: string,
): ProofView {
  const legs: Leg[] = ruling.verified.map((v) => {
    const recorded = artifact.legs.find((l) => l.index === v.txIndex);
    if (!recorded) {
      throw new Error(`the chain emitted position ${v.txIndex} but no merkle path is recorded for it`);
    }
    const indexFromPath = indexFromLaterality(recorded.laterality);
    return {
      role: recorded.role,
      label: recorded.label,
      blurb: recorded.blurb,
      index: v.txIndex,
      indexFromPath,
      agrees: indexFromPath === v.txIndex,
      txHash: recorded.txHash,
      txBytes: recorded.txBytes,
      laterality: recorded.laterality,
      siblings: recorded.siblings,
      merkleRoot: recorded.merkleRoot,
    };
  });

  return {
    provenance: { mode, at, rpc, liveError, capturedAt: artifact.capturedAt },
    claim: ruling.claim,
    ruling: ruling.ruling,
    harmPaid: ruling.harmPaid,
    verified: ruling.verified,
    legs,
    source: artifact.source,
    contract: artifact.contract,
    network: artifact.network,
    ordered: ruling.ruling.frontIndex < ruling.ruling.victimIndex && ruling.ruling.victimIndex < ruling.ruling.backIndex,
  };
}

/** The ruling exactly as `capture-proof.mjs` recorded it, reshaped into the same decoded form. */
export function rulingFromArtifact(): DecodedRuling {
  return {
    claim: {
      txHash: artifact.claim.txHash,
      relay: artifact.claim.from,
      index41: artifact.claim.to,
      blockNumber: artifact.claim.blockNumber,
      blockHash: artifact.claim.blockHash,
      status: artifact.claim.status,
      gasUsed: artifact.claim.gasUsed,
      gasPercentOfCap: artifact.claim.gasPercentOfCap,
      logCount: artifact.claim.logCount,
    },
    verified: artifact.verifiedLogs.map((v) => ({
      logIndex: v.logIndex,
      emitter: v.emitter,
      chainKey: v.chainKey,
      height: v.height,
      txIndex: v.txIndex,
    })),
    ruling: artifact.ruling,
    harmPaid: artifact.harmPaid,
  };
}

/**
 * Try the chain. Fall back to the recording. Say which happened, every time.
 * `timeoutMs` is short on purpose: a judge should never watch a spinner.
 */
export async function getProofView(timeoutMs = 6500): Promise<ProofView> {
  try {
    const live = await readClaimReceipt(timeoutMs);
    return assemble(live, 'live-chain-read', new Date().toISOString(), CC3.rpcUrl);
  } catch (err) {
    return assemble(
      rulingFromArtifact(),
      'cached-proof-artifact',
      artifact.capturedAt,
      artifact.network.rpc,
      err instanceof Error ? err.message : String(err),
    );
  }
}
