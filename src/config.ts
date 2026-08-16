/**
 * Credentials live in ~/.config/creditcoin/, never in this repository.
 * Nothing here ever writes a key back to disk or logs one.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { blockProver } from '@gluwa/usc-sdk';

import { surfaceWork } from './surfaces.js';

export const CC3 = {
  chainId: 102031,
  rpcUrl: 'https://rpc.cc3-testnet.creditcoin.network',
  explorer: 'https://creditcoin-testnet.blockscout.com',
  proverUrl: 'https://prover.cc3-testnet.creditcoin.network',
} as const;

/** Attestcoin source-chain KEY (not an EVM chain id). 1 = Sepolia, 3 = Ethereum mainnet. */
export const ETHEREUM_CHAIN_KEY = 3;

/**
 * The Attestcoin native query verifier precompile — taken from the SDK's own constant rather
 * than retyped, so a protocol move relocates us for free.
 */
export const VERIFIER_PRECOMPILE = blockProver.BLOCK_PROVER_PRECOMPILE_ADDRESS;
surfaceWork('blockProver.BLOCK_PROVER_PRECOMPILE_ADDRESS');

/**
 * Creditcoin's pre-deployed `EvmV1Decoder`. Its functions are `public`, so the library is an
 * EXTERNAL one: Index41 links against this address on CC3, and the pipeline calls the very same
 * copy off-chain through {@link https://www.npmjs.com/package/@gluwa/usc-sdk | utils.decoder}
 * so the preflight decode is byte-for-byte the decode the contract will perform.
 */
export const EVM_V1_DECODER = '0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f';

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
