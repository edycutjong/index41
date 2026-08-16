/**
 * Where "source" links point — without ever inventing a URL.
 *
 * This repository has no public remote while the hackathon is running, so the site refuses to
 * print a github.com address it cannot guarantee resolves. Instead every evidence link goes to
 * `/evidence/<path>`, an allowlisted read-only view of the very files the claim rests on, served
 * by the app itself. Set `NEXT_PUBLIC_REPO_URL` once the repo is public and every link below
 * retargets to it — no other change needed.
 */

/** Empty until the repository is public. Never guessed. */
export const REPO_URL = (process.env.NEXT_PUBLIC_REPO_URL ?? '').replace(/\/+$/, '');

/** Files a visitor may read. Anything not on this list is a 404 — this is not a file browser. */
export const EVIDENCE = [
  'README.md',
  'LICENSE',
  'docs/PIPELINE.md',
  'docs/DEPLOYMENT.md',
  'docs/deployment.json',
  'docs/pipeline-output.txt',
  'docs/pipeline-output-deployment.txt',
  'docs/pipeline-output-local-prover.txt',
  'docs/pipeline-output-replay.txt',
  'docs/spike-output.txt',
  'data/proof-artifact.json',
  'data/sandwich-25764741.json',
  'contracts/src/Index41.sol',
  'src/prove.ts',
  'src/audit.ts',
  'src/proof-sources.ts',
  'src/prover-api.ts',
  'scripts/capture-proof.mjs',
] as const;

export type EvidencePath = (typeof EVIDENCE)[number];

/** A link that resolves today, and becomes a GitHub link the moment the repo is public. */
export function sourceHref(path: EvidencePath): string {
  return REPO_URL ? `${REPO_URL}/blob/main/${path}` : `/evidence/${path}`;
}

/** External targets open in a new tab; the in-app evidence view does not need to. */
export const sourceLinkProps = REPO_URL ? { target: '_blank', rel: 'noreferrer noopener' } : {};
