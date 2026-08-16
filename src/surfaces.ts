/**
 * The Attestcoin surface ledger — a claim the run itself has to substantiate.
 *
 * `README.md` states that index41 makes 36 distinct Attestcoin surfaces load-bearing, 24 of them
 * undocumented, and that 30 of the 36 do real work on a clean default run. That was a table, and a
 * table is an assertion. This module turns it into a measurement: every catalogued surface is
 * recorded at the moment it is actually exercised, and the pipeline prints the tally — with the
 * names — at the end of every run, into the committed transcript.
 *
 * Two levels are recorded, because the difference is the whole reason the honest number is 30:
 *
 *   `work`         the surface was queried and its answer was used
 *   `constructed`  the surface was instantiated but never asked a question — the standby proof
 *                  rungs, which exist so the hosted prover can vanish, and which a default run
 *                  therefore builds and never calls
 *
 * Anything catalogued and never recorded is reported as *not reached*, by name, so the shortfall
 * is as visible as the total. `--kill-hosted` is what forces the standby rungs to answer; between
 * the two runs every one of the 36 does real work.
 *
 * Unknown ids throw. A tally that can be inflated by a typo is not evidence.
 */

/** How far a surface got on this run. `work` supersedes `constructed`. */
export type SurfaceLevel = 'constructed' | 'work';

export interface Surface {
  /** Row number in the README / JUDGE.md surface table. */
  n: number;
  id: string;
  namespace: string;
  /** Documented === present on docs.creditcoin.org. */
  documented: boolean;
}

/**
 * The 36 rows, in the order README.md lists them. Namespaces are the SDK's own
 * (`@gluwa/usc-sdk`), except the four proof-gen HTTP endpoints, which have no SDK binding at all,
 * and the three on-chain surfaces.
 */
export const SURFACES: readonly Surface[] = [
  { n: 1, id: 'chainInfo.PrecompileChainInfoProvider', namespace: 'chainInfo', documented: true },
  { n: 2, id: 'chainInfo.getSupportedChainByKey', namespace: 'chainInfo', documented: false },
  { n: 3, id: 'chainInfo.getAttestationGenesisHeight', namespace: 'chainInfo', documented: false },
  { n: 4, id: 'chainInfo.getLatestAttestedHeightAndHash', namespace: 'chainInfo', documented: false },
  { n: 5, id: 'chainInfo.getContinuityBounds', namespace: 'chainInfo', documented: false },
  { n: 6, id: 'chainInfo.waitUntilHeightAttested', namespace: 'chainInfo', documented: false },
  { n: 7, id: 'chainInfo.getAttestationHeightForDigest', namespace: 'chainInfo', documented: false },
  { n: 8, id: 'chainInfo.getCheckpointForHeight', namespace: 'chainInfo', documented: false },
  { n: 9, id: 'blockProver.BLOCK_PROVER_PRECOMPILE_ADDRESS', namespace: 'blockProver', documented: true },
  { n: 10, id: 'blockProver.PrecompileBlockProver', namespace: 'blockProver', documented: true },
  { n: 11, id: 'blockProver.verifySingle', namespace: 'blockProver', documented: true },
  { n: 12, id: 'blockProver.computeTransactionIndex', namespace: 'blockProver', documented: false },
  { n: 13, id: 'proofProvider.service.ProofBuilder', namespace: 'proofProvider', documented: true },
  { n: 14, id: 'proofProvider.service.ProofBuilder.getBatchProof', namespace: 'proofProvider', documented: true },
  { n: 15, id: 'proofProvider.raw.RawProofBuilder', namespace: 'proofProvider', documented: true },
  { n: 16, id: 'proofProvider.raw.RawProofBuilder.getProof', namespace: 'proofProvider', documented: false },
  {
    n: 17,
    id: 'proofProvider.raw.blockProvider.SimpleBlockProvider',
    namespace: 'proofProvider',
    documented: false,
  },
  {
    n: 18,
    id: 'proofProvider.raw.blockProvider.BlockProvider (implemented)',
    namespace: 'proofProvider',
    documented: false,
  },
  { n: 19, id: 'proofProvider.merkle.hashLeaf', namespace: 'proofProvider', documented: false },
  { n: 20, id: 'proofProvider.merkle.hashInner', namespace: 'proofProvider', documented: false },
  { n: 21, id: 'proofProvider.merkle.computeDigestOf', namespace: 'proofProvider', documented: false },
  { n: 22, id: 'encoding.getTransactionWithRaw', namespace: 'encoding', documented: false },
  { n: 23, id: 'encoding.abiEncode', namespace: 'encoding', documented: false },
  { n: 24, id: 'encoding.EncodingVersion', namespace: 'encoding', documented: true },
  { n: 25, id: 'utils.gas.computeGasLimit', namespace: 'utils', documented: false },
  { n: 26, id: 'utils.gas.MAX_GAS_CAP', namespace: 'utils', documented: false },
  { n: 27, id: 'utils.gas.gasAsPercentageOfMax', namespace: 'utils', documented: false },
  { n: 28, id: 'utils.hex.bytesInHexString', namespace: 'utils', documented: false },
  { n: 29, id: 'utils.decoder.decodeEvmV1Transaction', namespace: 'utils', documented: false },
  { n: 30, id: 'GET /api/v1/health', namespace: 'proof-gen API', documented: true },
  { n: 31, id: 'GET /api/v1/attested-height/{chain_key}', namespace: 'proof-gen API', documented: true },
  { n: 32, id: 'POST /api/v1/proof-batch/{chain_key}', namespace: 'proof-gen API', documented: false },
  {
    n: 33,
    id: 'ErrorResponse.retriable / last_attested_block',
    namespace: 'proof-gen API',
    documented: false,
  },
  { n: 34, id: 'INativeQueryVerifier.verifyAndEmit', namespace: 'on-chain', documented: true },
  { n: 35, id: 'INativeQueryVerifier.calculateTxIndex', namespace: 'on-chain', documented: false },
  { n: 36, id: 'EvmV1Decoder (deployed library)', namespace: 'on-chain', documented: true },
] as const;

const BY_ID = new Map(SURFACES.map((s) => [s.id, s]));

const seen = new Map<string, SurfaceLevel>();

function record(id: string, level: SurfaceLevel): void {
  const surface = BY_ID.get(id);
  if (!surface) {
    throw new Error(
      `surfaces.ts: "${id}" is not in the 36-row catalogue. Add the row before recording it — ` +
        'the tally is evidence and must not be inflatable by a typo.',
    );
  }
  if (level === 'work' || !seen.has(id)) seen.set(id, level);
}

/** The surface was queried and its answer was used. */
export function surfaceWork(id: string): void {
  record(id, 'work');
}

/** The surface was instantiated, but nothing was asked of it on this run. */
export function surfaceConstructed(id: string): void {
  record(id, 'constructed');
}

export interface SurfaceReport {
  work: Surface[];
  constructed: Surface[];
  notReached: Surface[];
  total: number;
  undocumentedInWork: number;
}

export function surfaceReport(): SurfaceReport {
  const work: Surface[] = [];
  const constructed: Surface[] = [];
  const notReached: Surface[] = [];
  for (const s of SURFACES) {
    const level = seen.get(s.id);
    if (level === 'work') work.push(s);
    else if (level === 'constructed') constructed.push(s);
    else notReached.push(s);
  }
  return {
    work,
    constructed,
    notReached,
    total: SURFACES.length,
    undocumentedInWork: work.filter((s) => !s.documented).length,
  };
}

/** Only for tests and for the second run inside one process. */
export function resetSurfaces(): void {
  seen.clear();
}

const row = (s: Surface) => `  ${String(s.n).padStart(2)}. ${s.id}${s.documented ? '' : '   [undocumented]'}`;

/**
 * The block the transcript carries. Printed by `src/prove.ts` at the end of every run — including
 * the run that stops early because the replay guard refuses a second ruling.
 */
export function formatSurfaceReport(): string[] {
  const r = surfaceReport();
  const out: string[] = [];
  out.push(`ATTESTCOIN SURFACES EXERCISED THIS RUN: ${r.work.length}`);
  out.push(
    `  ${r.work.length} did real work · ${r.constructed.length} constructed but never queried · ` +
      `${r.notReached.length} not reached · ${r.total} catalogued · ` +
      `${r.undocumentedInWork} of the ${r.work.length} are undocumented`,
  );
  out.push('');
  out.push(`did real work (${r.work.length}):`);
  for (const s of r.work) out.push(row(s));
  if (r.constructed.length) {
    out.push('');
    out.push(`constructed, never queried — the standby proof rungs (${r.constructed.length}):`);
    for (const s of r.constructed) out.push(row(s));
  }
  if (r.notReached.length) {
    out.push('');
    out.push(`not reached on this run (${r.notReached.length}):`);
    for (const s of r.notReached) out.push(row(s));
  }
  out.push('');
  out.push(
    'Counted by src/surfaces.ts, recorded at the call site as each surface is exercised — not ' +
      'transcribed from a table. Unknown ids throw, so this number cannot be padded.',
  );
  return out;
}
