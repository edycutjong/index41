/**
 * Credentials live in ~/.config/creditcoin/, never in this repository.
 * Nothing here ever writes a key back to disk or logs one.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CC3 = {
  chainId: 102031,
  rpcUrl: 'https://rpc.cc3-testnet.creditcoin.network',
  explorer: 'https://creditcoin-testnet.blockscout.com',
  proverUrl: 'https://prover.cc3-testnet.creditcoin.network',
} as const;

/** Attestcoin source-chain KEY (not an EVM chain id). 1 = Sepolia, 3 = Ethereum mainnet. */
export const ETHEREUM_CHAIN_KEY = 3;

/** The Attestcoin native query verifier precompile. */
export const VERIFIER_PRECOMPILE = '0x0000000000000000000000000000000000000FD2';

export const DEFAULT_KEYFILE = join(homedir(), '.config', 'creditcoin', 'index41-testnet.json');

interface KeyFile {
  network?: string;
  chainId?: number;
  accounts: Record<string, { address: string; privateKey: string }>;
}

/**
 * Reads one account out of the local credentials file.
 * Fails loudly — a missing key must never silently degrade into a mock run.
 */
export function loadAccount(name: string, keyfile = DEFAULT_KEYFILE): { address: string; privateKey: string } {
  let raw: string;
  try {
    raw = readFileSync(keyfile, 'utf8');
  } catch (err) {
    throw new Error(
      `cannot read credentials at ${keyfile}: ${(err as Error).message}\n` +
        `index41 reads keys from ~/.config/creditcoin/ and never from this repository.`,
    );
  }
  const parsed = JSON.parse(raw) as KeyFile;
  const account = parsed.accounts?.[name];
  if (!account?.privateKey) throw new Error(`credentials file ${keyfile} has no accounts.${name}.privateKey`);
  return account;
}
