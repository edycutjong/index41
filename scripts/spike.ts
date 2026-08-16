/**
 * spike.ts — the day-one gate. Everything index41 claims rests on this file.
 *
 * The question: can Creditcoin read the ORDINAL POSITION of a transaction inside
 * an Ethereum mainnet block? Not its contents — its position. Nothing in a
 * transaction payload carries "I was 15th"; no oracle reports it. Attestcoin's
 * `INativeQueryVerifier.calculateTxIndex` recovers it from the left/right
 * laterality of the merkle authentication path, one bit per sibling.
 *
 * End to end, against the live network, with no mocks anywhere:
 *
 *   1. connect to CC3 testnet (chainId 102031) with the deployer key from ~/.config
 *   2. PrecompileChainInfoProvider — is chain key 3 (Ethereum mainnet) supported,
 *      what is attested, where are the continuity bounds for our block
 *   3. re-verify a REAL mainnet sandwich against mainnet RPCs (block + positions)
 *   4. POST /api/v1/proof-batch/3 — three merkle proofs, ONE shared continuity proof
 *   5. calculateTxIndex for each, via free eth_call, BEFORE spending any gas
 *   6. assert the recovered indices equal the real ones and are strictly ascending
 *   7. the gas gate: 3x verifyAndEmit in ONE transaction, versus MAX_GAS_CAP (75M)
 *
 * Run:  npm run spike
 */

import { readFileSync } from 'node:fs';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, formatUnits, id } from 'ethers';
import { blockProver, chainInfo, utils } from '@gluwa/usc-sdk';

import { CC3, ETHEREUM_CHAIN_KEY, VERIFIER_PRECOMPILE, loadAccount } from '../src/config.js';
import { getTx, hexToNum } from '../src/eth.js';
import {
  attestedHeight,
  health,
  indexFromLaterality,
  lateralityBits,
  leg,
  proofBatchByIndex,
  type TransactionMerkleProof,
} from '../src/prover-api.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUTPUT = join(ROOT, 'docs', 'spike-output.txt');

// ---------------------------------------------------------------- logging

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, '');
function log(line = '') {
  console.log(line);
  appendFileSync(OUTPUT, line + '\n');
}
const rule = (title = '') => log(title ? `\n── ${title} ${'─'.repeat(Math.max(0, 72 - title.length))}` : '─'.repeat(76));

// ---------------------------------------------------------------- target

interface Leg {
  index: number;
  hash: string;
  from: string;
  to: string | null;
  effectiveGasPriceGwei: number;
}
interface Sandwich {
  chainKey: number;
  chain: string;
  blockNumber: number;
  blockHash: string;
  pool: string;
  poolProtocol: string;
  searcher: string;
  frontRun: Leg;
  victim: Leg;
  backRun: Leg;
}

const targetFile = process.argv.includes('--sandwich')
  ? process.argv[process.argv.indexOf('--sandwich') + 1]!
  : join(ROOT, 'data', 'sandwich-25764741.json');

const sandwich = JSON.parse(readFileSync(targetFile, 'utf8')) as Sandwich;
const LEGS: Array<{ role: string; leg: Leg }> = [
  { role: 'front-run', leg: sandwich.frontRun },
  { role: 'victim   ', leg: sandwich.victim },
  { role: 'back-run ', leg: sandwich.backRun },
];

// ---------------------------------------------------------------- helpers

const VERIFIER_ABI = [
  'function calculateTxIndex((bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkle_proof) view returns (uint64)',
  'function verifyAndEmit(uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) returns (bool)',
];

function artifact(name: string): { abi: unknown[]; bytecode: string } {
  const path = join(ROOT, 'out', `${name}.sol`, `${name}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`missing Foundry artifact ${path} — run \`forge build\` first`);
  }
  const json = JSON.parse(raw) as { abi: unknown[]; bytecode: { object: string } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

class SpikeFailure extends Error {}

function assert(condition: boolean, message: string) {
  if (!condition) throw new SpikeFailure(message);
}

// ---------------------------------------------------------------- main

async function main() {
  const startedAt = new Date().toISOString();
  log('index41 — SDK SPIKE');
  log('proving that transaction A executed BEFORE transaction B inside an Ethereum block');
  log(`run at ${startedAt}`);

  // ------------------------------------------------------------ 1. CC3
  rule('1. Creditcoin CC3 testnet');

  const { privateKey } = loadAccount('deployer');
  const provider = new JsonRpcProvider(CC3.rpcUrl, CC3.chainId, { staticNetwork: true });
  const wallet = new Wallet(privateKey, provider);
  const net = await provider.getNetwork();
  assert(Number(net.chainId) === CC3.chainId, `expected chainId ${CC3.chainId}, RPC reported ${net.chainId}`);

  const balance = await provider.getBalance(wallet.address);
  const cc3Head = await provider.getBlockNumber();
  const feeData = await provider.getFeeData();

  log(`rpc            ${CC3.rpcUrl}`);
  log(`chainId        ${net.chainId}`);
  log(`head           ${cc3Head}`);
  log(`signer         ${wallet.address}`);
  log(`balance        ${formatEther(balance)} CTC`);
  log(`gasPrice       ${feeData.gasPrice ? formatUnits(feeData.gasPrice, 'gwei') + ' gwei' : 'n/a'}`);
  assert(balance > 0n, `signer ${wallet.address} has no CTC — cannot run the gas gate`);

  // --------------------------------------- 2. chain info + attested height
  rule('2. Attestcoin chain info (PrecompileChainInfoProvider, 0x…0fd3)');

  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(provider);
  const supported = await chainInfoProvider.getSupportedChains();
  for (const c of supported) {
    const name = Buffer.from(c.chainName.replace(/^0x/, ''), 'hex').toString('utf8');
    log(`chain key ${String(c.chainKey).padStart(2)}   chainId ${String(c.chainId).padEnd(9)} ${name}`);
  }

  const ethereum = await chainInfoProvider.getSupportedChainByKey(ETHEREUM_CHAIN_KEY);
  assert(ethereum !== null, `chain key ${ETHEREUM_CHAIN_KEY} is NOT supported on this network`);
  assert(ethereum!.chainId === 1, `chain key ${ETHEREUM_CHAIN_KEY} maps to chainId ${ethereum!.chainId}, not 1`);

  const genesis = await chainInfoProvider.getAttestationGenesisHeight(ETHEREUM_CHAIN_KEY);
  const tip = await chainInfoProvider.getLatestAttestedHeightAndHash(ETHEREUM_CHAIN_KEY);
  const proverAttested = await attestedHeight(ETHEREUM_CHAIN_KEY);
  const proverHealth = await health();

  log('');
  log(`attestation genesis        ${genesis}`);
  log(`latest attested (chain)    ${tip.height}  ${tip.hash}  isAttestation=${tip.isAttestation}`);
  log(`latest attested (prover)   ${proverAttested}`);
  log(`prover health              ${proverHealth.status} cc3=${proverHealth.cc3_rpc_connected} eth=${proverHealth.eth_rpc_connected}`);
  assert(tip.exists, `chain key ${ETHEREUM_CHAIN_KEY} has no attestations at all`);
  assert(
    sandwich.blockNumber <= tip.height,
    `target block ${sandwich.blockNumber} is ABOVE the attested tip ${tip.height} — not provable yet`,
  );
  log(`target block ${sandwich.blockNumber} is ${tip.height - sandwich.blockNumber} blocks below the attested tip`);

  const bounds = await chainInfoProvider.getContinuityBounds(ETHEREUM_CHAIN_KEY, sandwich.blockNumber);
  log(
    `continuity bounds          parent ${bounds.parentHeight} (attestation=${bounds.parentIsAttestation}) ` +
      `child ${bounds.childHeight} (attestation=${bounds.childIsAttestation}) isAttested=${bounds.isAttested}`,
  );
  assert(bounds.isAttested, `block ${sandwich.blockNumber} reports isAttested=false`);

  // ------------------------------------- 3. re-verify the sandwich on mainnet
  rule('3. The sandwich, re-verified against Ethereum mainnet');

  log(`block          ${sandwich.blockNumber}  ${sandwich.blockHash}`);
  log(`pool           ${sandwich.pool}  (${sandwich.poolProtocol})`);
  log(`searcher       ${sandwich.searcher}`);
  log('');
  for (const { role, leg: l } of LEGS) {
    const onchain = await getTx(l.hash);
    assert(
      hexToNum(onchain.blockNumber) === sandwich.blockNumber,
      `${l.hash} is in block ${hexToNum(onchain.blockNumber)}, not ${sandwich.blockNumber}`,
    );
    assert(
      hexToNum(onchain.transactionIndex) === l.index,
      `${l.hash} sits at index ${hexToNum(onchain.transactionIndex)}, not ${l.index}`,
    );
    assert(
      onchain.from.toLowerCase() === l.from.toLowerCase(),
      `${l.hash} was sent by ${onchain.from}, not ${l.from}`,
    );
    log(`index ${String(l.index).padStart(3)}  ${role}  ${l.hash}`);
    log(`           from ${l.from}  ${l.effectiveGasPriceGwei.toFixed(9)} gwei effective`);
  }
  assert(
    sandwich.frontRun.from.toLowerCase() === sandwich.backRun.from.toLowerCase(),
    'front-run and back-run were not sent by the same searcher',
  );
  assert(
    sandwich.victim.from.toLowerCase() !== sandwich.searcher.toLowerCase(),
    'the victim is the searcher — not a sandwich',
  );
  log('');
  log('mainnet agrees: same block, same pool, same searcher on the outer two, ascending positions.');
  log('index41 does not trust any of the above. It is the ground truth the precompile must reproduce.');

  // ---------------------------------------------- 4. fetch proofs by INDEX
  rule('4. Proofs — POST /api/v1/proof-batch/3 (by block position)');

  const txIndexes = LEGS.map(({ leg: l }) => l.index);
  const t0 = Date.now();
  const batch = await proofBatchByIndex(ETHEREUM_CHAIN_KEY, [
    { headerNumber: sandwich.blockNumber, txIndexes },
  ]);
  const fetchMs = Date.now() - t0;

  log(`request        [{"headerNumber":${sandwich.blockNumber},"txIndexes":[${txIndexes.join(',')}]}]`);
  log(`response       chainKey=${batch.chainKey} fromHeader=${batch.fromHeader} toHeader=${batch.toHeader} cached=${batch.cached} in ${fetchMs}ms`);
  log(`continuity     lowerEndpointDigest ${batch.continuityProof.lowerEndpointDigest}`);
  log(`               ${batch.continuityProof.roots.length} roots — ONE proof shared by all three legs`);
  assert(batch.chainKey === ETHEREUM_CHAIN_KEY, `prover returned chainKey ${batch.chainKey}`);
  assert(batch.continuityProof.roots.length > 0, 'continuity proof carries no roots');

  const legs = LEGS.map(({ role, leg: l }) => {
    const entry = leg(batch, sandwich.blockNumber, l.index);
    assert(
      entry.txHash.toLowerCase() === l.hash.toLowerCase(),
      `prover returned ${entry.txHash} for index ${l.index}, expected ${l.hash}`,
    );
    return { role, expectedIndex: l.index, ...entry };
  });

  const roots = new Set(legs.map((l) => l.merkleProof.root));
  assert(roots.size === 1, `three legs of one block returned ${roots.size} different merkle roots`);
  log(`merkle root    ${[...roots][0]}  (identical for all three — one block, one tree)`);
  log('');
  log('the authentication paths, leaf → root (L = sibling on the left, so our node was on the right):');
  log('');
  for (const l of legs) {
    const bits = lateralityBits(l.merkleProof);
    const offchain = indexFromLaterality(l.merkleProof);
    log(
      `  ${l.role}  ${bits}  ->  ${String(offchain).padStart(3)}   ` +
        `(${l.merkleProof.siblings.length} siblings, txBytes ${l.txBytes.length / 2 - 1} bytes)`,
    );
    assert(
      offchain === l.expectedIndex,
      `laterality of ${l.txHash} decodes to ${offchain}, but mainnet says ${l.expectedIndex}`,
    );
  }
  log('');
  log('decoded independently in TypeScript, one bit per sibling. Creditcoin must now agree.');

  // --------------------------- 5. calculateTxIndex — free view, no gas spent
  rule('5. calculateTxIndex — free eth_call against the precompile (0x…0FD2)');

  const verifier = new Contract(VERIFIER_PRECOMPILE, VERIFIER_ABI, provider);
  const recovered: number[] = [];
  for (const l of legs) {
    const proof = l.merkleProof as TransactionMerkleProof;
    const value: bigint = await verifier.calculateTxIndex!({
      root: proof.root,
      siblings: proof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    });
    recovered.push(Number(value));
    log(`  ${l.role}  precompile.calculateTxIndex -> ${value}   (expected ${l.expectedIndex})`);
  }

  // the same call, through the SDK, to prove the surface is bound and not hand-rolled
  const prover = new blockProver.PrecompileBlockProver(provider);
  const viaSdk: number[] = [];
  for (const l of legs) {
    // the SDK returns the precompile's uint64 as a bigint despite its `number` signature
    viaSdk.push(Number(await prover.computeTransactionIndex(l.merkleProof as never)));
  }
  log(`  SDK blockProver.computeTransactionIndex -> [${viaSdk.join(', ')}]`);

  // ------------------------------------------------------- 6. the assertion
  rule('6. THE ASSERTION');

  const expected = legs.map((l) => l.expectedIndex);
  for (let i = 0; i < 3; i++) {
    assert(
      recovered[i] === expected[i],
      `precompile recovered index ${recovered[i]} for ${legs[i]!.txHash}, mainnet says ${expected[i]}`,
    );
    assert(viaSdk[i] === expected[i], `SDK recovered ${viaSdk[i]} for leg ${i}, mainnet says ${expected[i]}`);
  }
  const [front, victim, back] = recovered as [number, number, number];
  assert(front < victim && victim < back, `recovered indices are not ascending: ${front}, ${victim}, ${back}`);

  log(`  index ${front}   searcher buy     ${legs[0]!.txHash}`);
  log(`  index ${victim}   the victim       ${legs[1]!.txHash}`);
  log(`  index ${back}   searcher sell    ${legs[2]!.txHash}`);
  log('');
  log(`  ${front} < ${victim} < ${back}   — front-run BEFORE victim BEFORE back-run.`);
  log('  Creditcoin just read the position of a transaction inside an Ethereum block.');
  log('  Cost so far: zero gas. calculateTxIndex is a view.');

  // -------------------------------------------------------- 7. the gas gate
  rule('7. THE GAS GATE — 3x verifyAndEmit in ONE Creditcoin transaction');

  const { abi, bytecode } = artifact('OrderProbe');
  const factory = new ContractFactory(abi as never, bytecode, wallet);
  log('deploying OrderProbe (calls verifyAndEmit three times, then asserts ordering)…');
  const deployed = await factory.deploy();
  const probe = deployed as unknown as Contract;
  const deployTx = deployed.deploymentTransaction()!;
  const deployReceipt = await deployTx.wait();
  const probeAddress = await probe.getAddress();
  log(`OrderProbe     ${probeAddress}`);
  log(`deploy tx      ${deployTx.hash}  (gas ${deployReceipt!.gasUsed})`);
  log(`explorer       ${CC3.explorer}/address/${probeAddress}`);

  const encodedTransactions = legs.map((l) => l.txBytes);
  const merkleProofs = legs.map((l) => ({
    root: l.merkleProof.root,
    siblings: l.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
  }));
  const continuityProof = {
    lowerEndpointDigest: batch.continuityProof.lowerEndpointDigest,
    roots: batch.continuityProof.roots,
  };
  const args = [
    ETHEREUM_CHAIN_KEY,
    sandwich.blockNumber,
    encodedTransactions,
    merkleProofs,
    continuityProof,
  ] as const;

  const calldata = probe.interface.encodeFunctionData('proveOrder', args as never);
  log(`calldata       ${calldata.length / 2 - 1} bytes`);

  // free first: does it even succeed?
  const proveOrder = probe.getFunction('proveOrder');
  const simulated = await proveOrder.staticCall(...args);
  log(`eth_call       proveOrder -> [${(simulated as bigint[]).join(', ')}]  (no gas spent)`);

  let gasLimit: bigint;
  try {
    const estimate = await proveOrder.estimateGas(...args);
    gasLimit = (estimate * 12n) / 10n;
    // Full-precision percentage, not utils.gas.gasAsPercentageOfMax: that helper does integer
    // basis-point division and truncates (e.g. it prints 0.38% where the exact figure is 0.390%).
    const exactPct = (Number(estimate) / Number(utils.gas.MAX_GAS_CAP)) * 100;
    log(`estimateGas    ${estimate}  (${exactPct.toFixed(3)}% of MAX_GAS_CAP)`);
  } catch (err) {
    // pallet-evm does not propagate precompile revert reasons during estimation
    log(`estimateGas    FAILED (${(err as Error).message.split('\n')[0]}) — falling back to SDK computeGasLimit`);
    gasLimit = await utils.gas.computeGasLimit(
      provider,
      probe,
      calldata,
      wallet.address,
      continuityProof.roots.length,
    );
    log(`computeGasLimit ${gasLimit}`);
  }

  const capped = gasLimit > utils.gas.MAX_GAS_CAP ? utils.gas.MAX_GAS_CAP : gasLimit;
  log(`sending with gasLimit ${capped}…`);
  const tx = await proveOrder(...args, { gasLimit: capped });
  const receipt = await tx.wait();

  const used = receipt!.gasUsed;
  // Full-precision, not the truncating SDK helper — see the comment above.
  const pct = (Number(used) / Number(utils.gas.MAX_GAS_CAP)) * 100;
  log('');
  log(`CC3 tx hash    ${tx.hash}`);
  log(`block          ${receipt!.blockNumber}   status ${receipt!.status}`);
  log(`explorer       ${CC3.explorer}/tx/${tx.hash}`);
  log(`GAS USED       ${used}`);
  log(`MAX_GAS_CAP    ${utils.gas.MAX_GAS_CAP}`);
  log(`               ${pct.toFixed(3)}% of the cap — ${used <= utils.gas.MAX_GAS_CAP ? 'FITS' : 'DOES NOT FIT'}`);
  assert(receipt!.status === 1, `proveOrder transaction reverted (status ${receipt!.status})`);
  assert(used <= utils.gas.MAX_GAS_CAP, `3x verifyAndEmit used ${used}, over MAX_GAS_CAP`);

  const parsed = receipt!.logs
    .map((l: { topics: readonly string[]; data: string }) => {
      try {
        return probe.interface.parseLog({ topics: [...l.topics], data: l.data });
      } catch {
        return null;
      }
    })
    .filter((l: unknown): l is NonNullable<typeof l> => l !== null);
  for (const event of parsed) {
    log(`event          ${event.name}(${event.args.map((a: unknown) => String(a)).join(', ')})`);
  }

  // The strongest evidence is not our own event — it is the PRECOMPILE's.
  // `TransactionVerified(uint64 indexed chainKey, uint64 indexed height, uint64 transactionIndex)`
  // is emitted by 0x…0FD2 itself, once per verifyAndEmit, and it carries the position.
  const VERIFIED_TOPIC = id('TransactionVerified(uint64,uint64,uint64)');
  const emitted: number[] = [];
  for (const l of receipt!.logs) {
    if (l.address.toLowerCase() !== VERIFIER_PRECOMPILE.toLowerCase()) continue;
    if (l.topics[0] !== VERIFIED_TOPIC) continue;
    const emittedChainKey = Number(BigInt(l.topics[1]!));
    const emittedHeight = Number(BigInt(l.topics[2]!));
    const emittedIndex = Number(BigInt(l.data));
    emitted.push(emittedIndex);
    log(
      `precompile     TransactionVerified(chainKey=${emittedChainKey}, height=${emittedHeight}, txIndex=${emittedIndex})`,
    );
    assert(emittedChainKey === ETHEREUM_CHAIN_KEY, `precompile emitted chainKey ${emittedChainKey}`);
    assert(emittedHeight === sandwich.blockNumber, `precompile emitted height ${emittedHeight}`);
  }
  log(`               ${receipt!.logs.length} logs total`);
  assert(emitted.length === 3, `expected 3 TransactionVerified logs from the precompile, got ${emitted.length}`);
  for (let i = 0; i < 3; i++) {
    assert(
      emitted[i] === expected[i],
      `precompile's own event says index ${emitted[i]} for leg ${i}, mainnet says ${expected[i]}`,
    );
  }
  log('               the precompile ITSELF reports 14, 15, 16 — not our contract, not our script.');

  // ------------------------------------------------------------- verdict
  rule('VERDICT');
  log('');
  log('  calculateTxIndex recovers block position from merkle laterality:  YES');
  log(`  indices returned:                                                 ${front}, ${victim}, ${back}`);
  log(`  strictly ascending (front < victim < back):                       YES`);
  log(`  3x verifyAndEmit in one transaction under MAX_GAS_CAP:            YES (${pct.toFixed(3)}%)`);
  log('');
  log('  The premise holds. index41 is de-risked.');
  log('');
  log(`  OrderProbe     ${probeAddress}`);
  log(`  proveOrder tx  ${tx.hash}`);
  rule();
  log(`finished ${new Date().toISOString()}`);
  log(`evidence written to ${OUTPUT}`);
}

main().catch((err) => {
  const failure = err instanceof SpikeFailure ? 'SPIKE ASSERTION FAILED' : 'SPIKE ERROR';
  log('');
  rule(failure);
  log(String(err?.stack ?? err));
  log('');
  log('  The premise does NOT hold as written. Do not build on it until this is resolved.');
  process.exitCode = 1;
});
