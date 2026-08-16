/**
 * Foundry artifacts, and the one thing about them that is not obvious.
 *
 * `EvmV1Decoder` exposes `public` library functions, which makes it an EXTERNAL library: its code
 * is not inlined into Index41, and Index41's bytecode ships with a placeholder where the library
 * address belongs. Creditcoin has a copy already deployed on CC3 testnet, so `foundry.toml`
 * carries a `[profile.cc3]` that links against it — which is why deployment must run under that
 * profile and why {@link readArtifact} refuses bytecode that still contains a placeholder.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface Artifact {
  abi: unknown[];
  bytecode: string;
}

/** `__$…$__` is solc's unlinked-library marker. Deploying that would fail on the first decode. */
const PLACEHOLDER = /__\$[0-9a-fA-F]{34}\$__/;

export function readArtifact(name: string, { requireLinked = false } = {}): Artifact {
  const path = join(REPO_ROOT, 'out', `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`missing Foundry artifact ${path} — run \`forge build\` (or \`npm run build:cc3\`) first`);
  }
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: unknown[]; bytecode: { object: string } };
  const bytecode = json.bytecode.object;
  if (requireLinked && PLACEHOLDER.test(bytecode)) {
    throw new Error(
      `${name} bytecode still contains an unlinked library placeholder.\n` +
        `EvmV1Decoder is an external library; build with FOUNDRY_PROFILE=cc3 so it links against ` +
        `Creditcoin's deployed copy.`,
    );
  }
  return { abi: json.abi, bytecode };
}

/** Rebuild under the CC3 profile so `EvmV1Decoder` is linked to the on-chain library. */
export function buildLinked(): void {
  execFileSync('forge', ['build'], {
    cwd: REPO_ROOT,
    env: { ...process.env, FOUNDRY_PROFILE: 'cc3' },
    stdio: 'inherit',
  });
}
