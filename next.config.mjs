/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The demo surface lives alongside a Foundry project and a TypeScript proving pipeline.
  // Neither belongs in the web bundle; `app/` is the only tree Next needs to look at.
  outputFileTracingExcludes: {
    '*': ['./lib/**', './out/**', './cache/**', './contracts/**', './scratch/**'],
  },
};

export default nextConfig;
