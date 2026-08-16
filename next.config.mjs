/** @type {import('next').NextConfig} */

/**
 * The evidence allowlist, mirrored from `app/_lib/links.ts`.
 *
 * `GET /evidence/<path>` reads these files off disk at request time, and the path it joins is
 * computed rather than literal — so Next's tracer cannot see them and a serverless deployment
 * would ship the route without the files it exists to serve. Every allowlisted link would answer
 * "allowlisted but not present in this checkout". They are therefore named here explicitly.
 *
 * If a file is added to `EVIDENCE`, add it here too. `npm run e2e` fails on a dead evidence link.
 */
const EVIDENCE_FILES = [
  './README.md',
  './LICENSE',
  './docs/PIPELINE.md',
  './docs/DEPLOYMENT.md',
  './docs/deployment.json',
  './docs/pipeline-output.txt',
  './docs/pipeline-output-deployment.txt',
  './docs/pipeline-output-local-prover.txt',
  './docs/pipeline-output-replay.txt',
  './docs/spike-output.txt',
  './docs/bench-output.txt',
  './data/proof-artifact.json',
  './data/sandwich-25764741.json',
  './contracts/src/Index41.sol',
  './src/prove.ts',
  './src/audit.ts',
  './src/proof-sources.ts',
  './src/prover-api.ts',
  './scripts/capture-proof.mjs',
];

const nextConfig = {
  reactStrictMode: true,
  // This repository is public and judge-facing: Next 16 otherwise writes AGENTS.md and CLAUDE.md
  // into the repo root on `next dev`. Those files do not belong here.
  agentRules: false,
  //
  // `outputFileTracingExcludes` used to sit here, excluding `./lib/**`, `./out/**` and `./cache/**`
  // to keep the Foundry project out of the web bundle. It is deliberately gone. Those patterns are
  // matched against every traced path, including inside `node_modules`, so `./lib/**` also matched
  // `next/dist/server/lib/**` and the deployed function booted without `./lib/source-maps` —
  // every route answered 500, with a clean build and no warning. Nothing under `app/` imports the
  // Foundry tree, so the tracer never had a reason to include it; the exclusion bought nothing and
  // cost the whole deployment. Upload size is handled by `.vercelignore` instead, which is scoped
  // to the repository root and cannot reach into a dependency.
  // The key is `**`, not `/evidence/[...path]`. A route-specific key silently matches nothing here
  // — verified by inspecting `.next/server/app/evidence/[...path]/route.js.nft.json`, which traced
  // 0 of these files under the route key and all of them under `**`. The cost of the broad key is
  // ~150 KB of text added to every function; the cost of the narrow one was eighteen dead links.
  outputFileTracingIncludes: {
    '**': EVIDENCE_FILES,
  },
};

export default nextConfig;
