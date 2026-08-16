/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This repository is public and judge-facing: Next 16 otherwise writes AGENTS.md and CLAUDE.md
  // into the repo root on `next dev`. Those files do not belong here.
  agentRules: false,
  // The demo surface lives alongside a Foundry project and a TypeScript proving pipeline.
  // Neither belongs in the web bundle; `app/` is the only tree Next needs to look at.
  outputFileTracingExcludes: {
    '*': ['./lib/**', './out/**', './cache/**', './contracts/**', './scratch/**'],
  },
};

export default nextConfig;
