/**
 * Auditing a proof before spending gas on it.
 *
 * A proof source hands index41 four things: transaction bytes, a merkle path, a continuity proof,
 * and a claim about which position in the block the transaction occupied. The official examples
 * forward all four to the precompile and let the chain decide. That works, but it means a bad or
 * hostile prover is discovered only after a failed transaction, and it means "trustless" is a
 * property of the chain rather than of the client.
 *
 * Every one of those four claims can be checked here, for free, with the SDK's own primitives:
 *
 *   LEAF      `encoding.abiEncode(tx, receipt, V1)` over the transaction as mainnet reports it must
 *             equal the `txBytes` the prover served. The merkle leaf is `abiEncode(tx, rx)`, so if
 *             this matches, the prover did not substitute a transaction.
 *   MERKLE    folding `merkle.hashLeaf(txBytes)` up through the siblings with `merkle.hashInner`
 *             must reproduce the stated root. This is the same walk the precompile does.
 *   POSITION  the laterality of that same path is the position, one bit per sibling — decoded
 *             independently here, and then again on-chain by `calculateTxIndex`.
 *   CONTINUITY chaining `merkle.computeDigestOf` from `lowerEndpointDigest` across every root must
 *             land on a digest Creditcoin itself already holds, found via
 *             `getAttestationHeightForDigest` or `getCheckpointForHeight`. That is the step that
 *             binds an off-chain blob to on-chain state, and it is what makes a prover swap safe.
 *
 * If all four hold, the bytes are correct no matter who produced them — which is the whole reason
 * index41 is willing to run without the hosted prover at all.
 */

import type { JsonRpcApiProvider, TransactionReceipt } from 'ethers';
import { chainInfo, encoding, proofProvider } from '@gluwa/usc-sdk';

import type { ProofBundle } from './proof-sources.js';
import type { TransactionMerkleProof } from './prover-api.js';
import { surfaceWork } from './surfaces.js';

export interface LegAudit {
  role: string;
  txHash: string;
  /** `RLLLRRRR` — the raw laterality the position is decoded from. */
  laterality: string;
  indexFromLaterality: number;
  merkleRootRecomputed: string;
  merkleOk: boolean;
  /** Null when the mainnet re-encode was not requested. */
  leafMatchesMainnet: boolean | null;
  txBytesLength: number;
}

export interface ContinuityAudit {
  lowerEndpointDigest: string;
  roots: number;
  /** Block heights the roots cover, inclusive. */
  fromHeight: number;
  toHeight: number;
  /** The digest the chain of roots lands on. */
  topDigest: string;
  /** How Creditcoin recognised that digest. */
  boundTo: 'attestation' | 'checkpoint' | 'NOTHING';
  boundAtHeight: number | null;
}

export interface BundleAudit {
  source: string;
  singleRoot: string;
  legs: LegAudit[];
  continuity: ContinuityAudit;
  ok: boolean;
  failures: string[];
}

/** One bit per sibling, leaf → root, least significant first. A left sibling means we were right. */
export function indexFromLaterality(proof: TransactionMerkleProof): number {
  let index = 0;
  proof.siblings.forEach((sibling, bit) => {
    if (sibling.isLeft) index |= 1 << bit;
  });
  return index;
}

export function lateralityBits(proof: TransactionMerkleProof): string {
  return proof.siblings.map((s) => (s.isLeft ? 'L' : 'R')).join('');
}

/** Walks the authentication path with the SDK's own hashers. Same algorithm as the precompile. */
export function recomputeRoot(txBytes: string, proof: TransactionMerkleProof): string {
  surfaceWork('proofProvider.merkle.hashLeaf');
  let node = proofProvider.merkle.hashLeaf(txBytes);
  for (const sibling of proof.siblings) {
    surfaceWork('proofProvider.merkle.hashInner');
    node = sibling.isLeft
      ? proofProvider.merkle.hashInner(sibling.hash, node)
      : proofProvider.merkle.hashInner(node, sibling.hash);
  }
  return node;
}

/**
 * Re-encodes a transaction from mainnet and compares it to the bytes the prover served.
 * `encoding.abiEncode` is the exact function that produced the merkle leaves in the first place.
 */
export async function reencodeFromSource(rpc: JsonRpcApiProvider, txHash: string): Promise<string> {
  surfaceWork('encoding.getTransactionWithRaw');
  const tx = await encoding.getTransactionWithRaw(rpc, txHash);
  if (!tx) throw new Error(`mainnet has no transaction ${txHash}`);
  const receipt: TransactionReceipt | null = await rpc.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`mainnet has no receipt for ${txHash}`);
  surfaceWork('encoding.abiEncode');
  surfaceWork('encoding.EncodingVersion');
  return encoding.abiEncode(tx, receipt, encoding.EncodingVersion.V1).abi;
}

/**
 * Full audit. `reencode` is optional because it costs two mainnet round-trips per leg; when it is
 * supplied — and on the default path it is — the audit no longer takes the prover's word for
 * anything at all.
 */
export async function auditBundle(
  bundle: ProofBundle,
  info: chainInfo.ChainInfoProvider,
  reencode?: (txHash: string) => Promise<string>,
): Promise<BundleAudit> {
  const failures: string[] = [];

  const roots = new Set(bundle.legs.map((l) => l.merkleProof.root));
  if (roots.size !== 1) {
    failures.push(`legs of one block carry ${roots.size} different merkle roots`);
  }
  const singleRoot = bundle.legs[0]?.merkleProof.root ?? '0x';

  const legs: LegAudit[] = [];
  for (const l of bundle.legs) {
    const recomputed = recomputeRoot(l.txBytes, l.merkleProof);
    const merkleOk = recomputed.toLowerCase() === l.merkleProof.root.toLowerCase();
    if (!merkleOk) failures.push(`${l.role}: merkle path folds to ${recomputed}, not ${l.merkleProof.root}`);

    const decoded = indexFromLaterality(l.merkleProof);
    if (decoded !== l.expectedIndex) {
      failures.push(`${l.role}: laterality decodes to position ${decoded}, mainnet says ${l.expectedIndex}`);
    }
    if (l.txHash && l.txHash.toLowerCase() !== l.hash.toLowerCase()) {
      failures.push(`${l.role}: source returned ${l.txHash} for position ${l.expectedIndex}, expected ${l.hash}`);
    }

    let leafMatchesMainnet: boolean | null = null;
    if (reencode) {
      const mine = await reencode(l.hash);
      leafMatchesMainnet = mine.toLowerCase() === l.txBytes.toLowerCase();
      if (!leafMatchesMainnet) {
        failures.push(
          `${l.role}: abiEncode(tx, receipt) from mainnet is ${mine.length / 2 - 1} bytes and does not match ` +
            `the ${l.txBytes.length / 2 - 1} bytes the source served`,
        );
      }
    }

    legs.push({
      role: l.role,
      txHash: l.hash,
      laterality: lateralityBits(l.merkleProof),
      indexFromLaterality: decoded,
      merkleRootRecomputed: recomputed,
      merkleOk,
      leafMatchesMainnet,
      txBytesLength: l.txBytes.length / 2 - 1,
    });
  }

  const continuity = await auditContinuity(bundle, info);
  if (continuity.boundTo === 'NOTHING') {
    failures.push(
      `continuity proof chains to digest ${continuity.topDigest} at height ${continuity.toHeight}, ` +
        'which Creditcoin holds as neither an attestation nor a checkpoint',
    );
  }

  return { source: bundle.source, singleRoot, legs, continuity, ok: failures.length === 0, failures };
}

/**
 * The binding step. `computeDigestOf(height, root, prevDigest)` is the same recurrence the
 * attestation chain uses, so folding it across the continuity roots — starting from
 * `lowerEndpointDigest`, which is the digest of the block *before* the range — must reproduce a
 * digest Creditcoin already stores. Finding it there is what turns an untrusted blob into a
 * statement about attested history.
 */
export async function auditContinuity(
  bundle: ProofBundle,
  info: chainInfo.ChainInfoProvider,
): Promise<ContinuityAudit> {
  const { lowerEndpointDigest, roots } = bundle.continuityProof;
  let digest = lowerEndpointDigest;
  let height = bundle.blockNumber;
  for (const root of roots) {
    surfaceWork('proofProvider.merkle.computeDigestOf');
    digest = proofProvider.merkle.computeDigestOf(height, root, digest);
    height += 1;
  }
  const toHeight = height - 1;

  let boundTo: ContinuityAudit['boundTo'] = 'NOTHING';
  let boundAtHeight: number | null = null;

  surfaceWork('chainInfo.getAttestationHeightForDigest');
  const attestation = await info.getAttestationHeightForDigest(bundle.chainKey, digest);
  if (attestation.exists) {
    boundTo = 'attestation';
    boundAtHeight = attestation.height;
  } else {
    // The upper endpoint of a continuity range is frequently a CHECKPOINT rather than a full
    // attestation. Both are on-chain; only the lookup differs, and the examples use neither.
    surfaceWork('chainInfo.getCheckpointForHeight');
    const checkpoint = await info.getCheckpointForHeight(bundle.chainKey, toHeight);
    if (checkpoint.exists && checkpoint.hash.toLowerCase() === digest.toLowerCase()) {
      boundTo = 'checkpoint';
      boundAtHeight = toHeight;
    }
  }

  return {
    lowerEndpointDigest,
    roots: roots.length,
    fromHeight: bundle.blockNumber,
    toHeight,
    topDigest: digest,
    boundTo,
    boundAtHeight,
  };
}
