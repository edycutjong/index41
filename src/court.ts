/**
 * Standing up the court: deploy Index41 on CC3, bond a relay behind its no-sandwich promise, and
 * declare which entry points that relay claims to route.
 *
 * The deployment record lives in `docs/deployment.json` and is committed, so a judge can point a
 * block explorer at the same contract this pipeline claims against. Re-running the pipeline reuses
 * it; there is no flag to make it deploy again.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Contract, ContractFactory, type JsonRpcApiProvider, type Wallet, formatEther } from 'ethers';

import { REPO_ROOT, readArtifact } from './artifacts.js';
import { CC3, EVM_V1_DECODER } from './config.js';

export const DEPLOYMENT_FILE = join(REPO_ROOT, 'docs', 'deployment.json');

export interface Deployment {
  network: string;
  chainId: number;
  index41: string;
  evmV1Decoder: string;
  deployer: string;
  deployTx: string;
  deployBlock: number;
  deployedAt: string;
  explorer: string;
}

/**
 * Every court ever deployed, oldest first. A ledger rather than a single record because
 * `proveSandwich` burns its query ids: one sandwich can only ever be ruled on once per contract,
 * so demonstrating a second, independent proving run (the local-prover one, for instance) requires
 * a second court — and both deserve to stay on the record.
 */
export function readDeployments(path = DEPLOYMENT_FILE): Deployment[] {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Deployment | Deployment[];
  return Array.isArray(raw) ? raw : [raw];
}

export function readDeployment(path = DEPLOYMENT_FILE): Deployment | null {
  const all = readDeployments(path);
  return all.length ? all[all.length - 1]! : null;
}

function appendDeployment(d: Deployment, path = DEPLOYMENT_FILE): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...readDeployments(path), d], null, 2) + '\n');
}

export function index41At(address: string, runner: JsonRpcApiProvider | Wallet): Contract {
  const { abi } = readArtifact('Index41');
  return new Contract(address, abi as never, runner);
}

/**
 * Returns the live court, deploying one only if `docs/deployment.json` does not already name a
 * contract that still has code at its address.
 */
export async function ensureCourt(
  wallet: Wallet,
  provider: JsonRpcApiProvider,
  log: (line: string) => void,
  /**
   * `record: false` deploys without appending to `docs/deployment.json`. The benchmark stands up
   * one throwaway court per trial — those are measurement scaffolding, not proven runs, and
   * writing them into the deployment ledger would drown the three runs a judge actually reads.
   */
  { fresh = false, record = true } = {},
): Promise<{ deployment: Deployment; contract: Contract; freshlyDeployed: boolean }> {
  const existing = fresh ? null : readDeployment();
  if (existing && existing.chainId === CC3.chainId) {
    const code = await provider.getCode(existing.index41);
    if (code !== '0x') {
      log(`reusing Index41 at ${existing.index41} (deployed ${existing.deployedAt})`);
      return { deployment: existing, contract: index41At(existing.index41, provider), freshlyDeployed: false };
    }
    log(`recorded Index41 at ${existing.index41} has no code on this network — deploying a new one`);
  }

  // requireLinked: EvmV1Decoder is an EXTERNAL library, so unlinked bytecode would deploy fine and
  // then revert on the first decode. Better to refuse here.
  const { abi, bytecode } = readArtifact('Index41', { requireLinked: true });
  log('deploying Index41 (linked against the on-chain EvmV1Decoder)…');
  const factory = new ContractFactory(abi as never, bytecode, wallet);
  const deployed = await factory.deploy();
  const tx = deployed.deploymentTransaction()!;
  const receipt = await tx.wait();
  const address = await deployed.getAddress();

  const deployment: Deployment = {
    network: 'cc3-testnet',
    chainId: CC3.chainId,
    index41: address,
    evmV1Decoder: EVM_V1_DECODER,
    deployer: wallet.address,
    deployTx: tx.hash,
    deployBlock: receipt!.blockNumber,
    deployedAt: new Date().toISOString(),
    explorer: `${CC3.explorer}/address/${address}`,
  };
  if (record) appendDeployment(deployment);
  log(`Index41        ${address}  (deploy gas ${receipt!.gasUsed})`);
  log(`explorer       ${deployment.explorer}`);

  return { deployment, contract: index41At(address, provider), freshlyDeployed: true };
}

export interface RelayState {
  relay: string;
  bond: bigint;
  covers: boolean;
  bondTx?: string;
  coverageTx?: string;
}

/**
 * Makes sure the relay is actually standing behind its promise for the entry point the victim's
 * transaction called — the entry point is read out of the PROOF, so this cannot be faked by
 * declaring coverage for something else.
 */
export async function ensureRelay(
  court: Contract,
  wallet: Wallet,
  relay: string,
  entrypoint: string,
  minBond: bigint,
  log: (line: string) => void,
): Promise<RelayState> {
  const writer = court.connect(wallet) as Contract;
  const state: RelayState = {
    relay,
    bond: (await court.bondOf!(relay)) as bigint,
    covers: (await court.covers!(relay, entrypoint)) as boolean,
  };

  if (state.bond < minBond) {
    const top = minBond - state.bond;
    log(`bonding ${formatEther(top)} CTC for relay ${relay}…`);
    const tx = await writer.postBondFor!(relay, { value: top });
    await tx.wait();
    state.bondTx = tx.hash;
    state.bond = (await court.bondOf!(relay)) as bigint;
  }

  if (!state.covers) {
    if (wallet.address.toLowerCase() !== relay.toLowerCase()) {
      throw new Error(
        `only the relay itself can declare coverage: signer is ${wallet.address}, relay is ${relay}`,
      );
    }
    log(`declaring coverage of entry point ${entrypoint}…`);
    const tx = await writer.declareCoverage!(entrypoint, true);
    await tx.wait();
    state.coverageTx = tx.hash;
    state.covers = (await court.covers!(relay, entrypoint)) as boolean;
  }

  return state;
}
