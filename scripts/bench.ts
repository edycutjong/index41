/**
 * bench.ts — repeated-run latency for the three paths that matter, with p50/p95.
 *
 *   npm run bench                 # all three paths, real network, real chain
 *   npm run bench -- --n-hosted 30 --n-local 3 --n-e2e 3
 *
 * There is no offline mode, no mock and no `--dry-run`. Every trial talks to the real hosted
 * prover, the real Ethereum mainnet RPCs and the real Creditcoin CC3 testnet, and the end-to-end
 * path lands a real transaction on chain each time. A benchmark that could be satisfied by a
 * `setTimeout` would prove nothing about this product.
 *
 * The input is fixed rather than random: every trial proves the SAME committed sandwich
 * (`data/sandwich-25764741.json` — Ethereum mainnet block 25,764,741, positions 14 / 15 / 16), so
 * run-to-run variance is network and chain, never workload. That fixture is this benchmark's seed.
 *
 * Three paths:
 *
 *   1. hosted-proof fetch      `POST /api/v1/proof-batch/3` — one round trip, three legs, one
 *                              shared continuity proof.
 *   2. local proof build       `proofProvider.raw.RawProofBuilder` over a cold cache. No proof
 *                              service at all: the merkle tree is rebuilt from mainnet and the
 *                              continuity proof from Creditcoin's own attestations. This is what
 *                              index41 costs when the prover is gone, and it is the number that
 *                              says what the hosted prover is actually worth.
 *   3. end-to-end prove→ruling three transaction hashes in, one confirmed on-chain ruling out:
 *                              fetch → audit → decode → free dry-run → claim → submit → receipt.
 *                              Court deployment and bonding are SETUP and are not timed — a relay
 *                              bonds once and then many claims settle against it.
 *
 * Every trial is correctness-gated: the positions must decode to 14 / 15 / 16, the merkle root
 * must match every other trial's, and an end-to-end trial must produce a status-1 receipt carrying
 * three `TransactionVerified` logs with `paid == computed`. A failed check exits non-zero and the
 * numbers are not printed as if they were valid.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { blockProver, chainInfo } from '@gluwa/usc-sdk';

import { REPO_ROOT } from '../src/artifacts.js';
import { auditBundle, reencodeFromSource } from '../src/audit.js';
import { budgetGas, buildClaim, decodeLeg, decoderContract, deriveShape, submitClaim } from '../src/claim.js';
import type { DecodedLeg } from '../src/claim.js';
import { CC3, ETHEREUM_CHAIN_KEY, loadAccount } from '../src/config.js';
import { ensureCourt, ensureRelay } from '../src/court.js';
import { MAINNET_RPCS, getTx, hexToNum } from '../src/eth.js';
import { HostedByIndexSource, LocalRawSource, type LegRequest } from '../src/proof-sources.js';

const MIN_BOND = 10n ** 18n;
const OUTPUT = join(REPO_ROOT, 'docs', 'bench-output.txt');

const argv = process.argv.slice(2);
const num = (name: string, fallback: number): number => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(argv[i + 1]);
  if (!Number.isInteger(v) || v < 1) throw new Error(`--${name} needs a positive integer`);
  return v;
};

/**
 * Trial counts. The hosted path is cheap, so it gets enough samples for p95 to mean something.
 * The local path costs ~200s of mainnet round-trips per trial and the end-to-end path spends real
 * gas, so both are deliberately small — and the report says so rather than dressing a max up as a
 * percentile.
 */
const N_HOSTED = num('n-hosted', 20);
const N_LOCAL = num('n-local', 5);
const N_E2E = num('n-e2e', 5);
/** One discarded trial per path: DNS, TLS, JIT and the SDK's first-call cost are not the product. */
const WARMUP = 1;

const lines: string[] = [];
function say(text = ''): void {
  console.log(text);
  lines.push(text);
}
function rule(title = ''): void {
  say(title ? `\n── ${title} ${'─'.repeat(Math.max(1, 74 - title.length))}` : '─'.repeat(78));
}

/** Nearest-rank percentile on the sorted samples — no interpolation, no invented data points. */
function percentile(sorted: number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

interface Stats {
  path: string;
  n: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
  /** True when p95 is simply the slowest observation, because n is too small to resolve a tail. */
  p95IsMax: boolean;
}

function stats(path: string, samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = percentile(sorted, 95);
  return {
    path,
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p95IsMax: p95 === sorted[sorted.length - 1]!,
  };
}

const ms = (n: number) => `${n.toLocaleString('en-US')} ms`;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) {
    failures += 1;
    say(`  FAIL  ${label} — ${detail}`);
  }
}

async function main() {
  const started = new Date();
  say('index41 — BENCHMARK');
  say('repeated-run latency for the proving pipeline, p50 / p95, real network and real chain');
  say(`run at ${started.toISOString()}`);
  say(`node ${process.version} · ${process.platform}/${process.arch}`);
  say('');
  say('There is no offline mode and no mock. Every trial below is a real round trip; every');
  say('end-to-end trial lands a real transaction on Creditcoin CC3 testnet.');

  // ---------------------------------------------------------------- fixture (the seed)
  rule('Fixture — the same sandwich, every trial');
  const fixture = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data', 'sandwich-25764741.json'), 'utf8'),
  ) as { frontRun: { hash: string }; victim: { hash: string }; backRun: { hash: string } };
  const hashes = [fixture.frontRun.hash, fixture.victim.hash, fixture.backRun.hash];
  const roles = ['front-run', 'victim', 'back-run'] as const;

  const cc3 = new JsonRpcProvider(CC3.rpcUrl, CC3.chainId, { staticNetwork: true });
  const mainnet = new JsonRpcProvider(MAINNET_RPCS[0]!, 1, { staticNetwork: true });
  const { privateKey } = loadAccount('deployer');
  const wallet = new Wallet(privateKey, cc3);

  const legs: LegRequest[] = [];
  let blockNumber = -1;
  for (let i = 0; i < 3; i++) {
    const tx = await getTx(hashes[i]!);
    const height = hexToNum(tx.blockNumber);
    if (blockNumber < 0) blockNumber = height;
    if (height !== blockNumber) throw new Error(`${hashes[i]} is in block ${height}, not ${blockNumber}`);
    legs.push({ role: roles[i]!, hash: hashes[i]!, expectedIndex: hexToNum(tx.transactionIndex) });
  }
  const EXPECTED = [14, 15, 16];
  say(`data/sandwich-25764741.json · Ethereum mainnet block ${blockNumber}`);
  for (const l of legs) say(`  ${l.role.padEnd(10)} position ${String(l.expectedIndex).padStart(3)}  ${l.hash}`);
  check(
    'fixture positions',
    legs.map((l) => l.expectedIndex).join(',') === EXPECTED.join(','),
    `mainnet reports ${legs.map((l) => l.expectedIndex).join('/')}, expected ${EXPECTED.join('/')}`,
  );
  say('');
  say(`trials: hosted ${N_HOSTED} · local ${N_LOCAL} · end-to-end ${N_E2E} · ${WARMUP} warm-up each, discarded`);

  /** Every trial's merkle root must be this one. Two proof sources agreeing on it is the point. */
  let canonicalRoot: string | null = null;
  const rootCheck = (label: string, root: string) => {
    canonicalRoot ??= root;
    const expected = canonicalRoot;
    check(`${label} merkle root`, root.toLowerCase() === expected.toLowerCase(), `${root} != ${expected}`);
  };
  const indexCheck = (label: string, got: number[]) =>
    check(`${label} positions`, got.join(',') === EXPECTED.join(','), `${got.join('/')} != ${EXPECTED.join('/')}`);

  // ---------------------------------------------------------------- 1. hosted proof fetch
  rule(`1. Hosted proof fetch — POST /api/v1/proof-batch/${ETHEREUM_CHAIN_KEY}`);
  const hosted: number[] = [];
  for (let i = 0; i < N_HOSTED + WARMUP; i++) {
    const source = new HostedByIndexSource(CC3.proverUrl);
    const t0 = Date.now();
    const bundle = await source.fetch(ETHEREUM_CHAIN_KEY, blockNumber, legs);
    const elapsed = Date.now() - t0;
    rootCheck('hosted', bundle.legs[0]!.merkleProof.root);
    indexCheck('hosted', bundle.legs.map((l) => l.txIndex));
    if (i < WARMUP) say(`  warm-up  ${ms(elapsed)} (discarded)`);
    else {
      hosted.push(elapsed);
      say(`  trial ${String(i - WARMUP + 1).padStart(2)}  ${ms(elapsed)}`);
    }
  }

  // ---------------------------------------------------------------- 2. local proof build
  rule('2. Local proof build — RawProofBuilder, cold cache, no proof service');
  say('a fresh CachingBlockProvider per trial, so every trial pays the full mainnet cost');
  const local: number[] = [];
  for (let i = 0; i < N_LOCAL + WARMUP; i++) {
    const source = new LocalRawSource(ETHEREUM_CHAIN_KEY, mainnet, cc3);
    const t0 = Date.now();
    const bundle = await source.fetch(ETHEREUM_CHAIN_KEY, blockNumber, legs);
    const elapsed = Date.now() - t0;
    rootCheck('local', bundle.legs[0]!.merkleProof.root);
    indexCheck('local', bundle.legs.map((l) => l.txIndex));
    if (i < WARMUP) say(`  warm-up  ${ms(elapsed)} (discarded)`);
    else {
      local.push(elapsed);
      say(`  trial ${String(i - WARMUP + 1).padStart(2)}  ${ms(elapsed)}`);
    }
  }

  // ---------------------------------------------------------------- 3. end to end
  rule('3. End-to-end prove → ruling — three tx hashes in, one confirmed CC3 ruling out');
  say('timed: fetch → audit → decode → free dry-run → claim → submit → receipt');
  say('untimed setup per trial: a fresh court is deployed and bonded, because the replay guard');
  say('retires a court once it has ruled. A relay bonds once; claims then settle against it.');

  const prover = new blockProver.PrecompileBlockProver(cc3);
  const info = new chainInfo.PrecompileChainInfoProvider(cc3);
  const decoder = decoderContract(cc3);
  const e2e: number[] = [];
  const receipts: Array<{ tx: string; block: number; gas: bigint; paid: string }> = [];
  let gasSpentOnRulings = 0n;
  const balanceBefore = await cc3.getBalance(wallet.address);

  // The entry point the relay must cover is read out of the PROOF, so it has to be derived once
  // before any court can be bonded. Setup, not measurement.
  const seed = await new HostedByIndexSource(CC3.proverUrl).fetch(ETHEREUM_CHAIN_KEY, blockNumber, legs);
  const seedDecoded: DecodedLeg[] = [];
  for (const l of seed.legs) seedDecoded.push(await decodeLeg(decoder, l.role, l.txIndex, l.txBytes));
  const seedShape = deriveShape(seedDecoded[0]!, seedDecoded[1]!, seedDecoded[2]!);

  for (let i = 0; i < N_E2E + WARMUP; i++) {
    const { contract: court } = await ensureCourt(wallet, cc3, () => {}, { fresh: true, record: false });
    await ensureRelay(court, wallet, wallet.address, seedShape.victimEntrypoint, MIN_BOND, () => {});

    const t0 = Date.now();
    const bundle = await new HostedByIndexSource(CC3.proverUrl).fetch(ETHEREUM_CHAIN_KEY, blockNumber, legs);
    const audit = await auditBundle(bundle, info, (h) => reencodeFromSource(mainnet, h));
    const decoded: DecodedLeg[] = [];
    for (const l of bundle.legs) decoded.push(await decodeLeg(decoder, l.role, l.txIndex, l.txBytes));
    const shape = deriveShape(decoded[0]!, decoded[1]!, decoded[2]!);
    for (const l of bundle.legs) {
      const ok = await prover.verifySingle(
        ETHEREUM_CHAIN_KEY,
        blockNumber,
        l.txBytes,
        l.merkleProof as never,
        bundle.continuityProof,
      );
      const recovered = Number(await prover.computeTransactionIndex(l.merkleProof as never));
      check('dry run', ok && recovered === l.expectedIndex, `${l.role}: ok=${ok} index=${recovered}`);
    }
    const claim = buildClaim(bundle, wallet.address, shape);
    const calldata = court.interface.encodeFunctionData('proveSandwich', [claim]);
    const budget = await budgetGas(cc3, court, calldata, wallet.address, bundle.continuityProof.roots.length);
    const result = await submitClaim(court, wallet, claim, budget.cappedLimit);
    const elapsed = Date.now() - t0;

    check('audit', audit.ok, audit.failures.join('; '));
    rootCheck('e2e', audit.singleRoot);
    indexCheck('e2e', result.verifiedIndices);
    check('receipt status', result.status === 1, `status ${result.status}`);
    check('TransactionVerified logs', result.verifiedIndices.length === 3, `${result.verifiedIndices.length} logs`);
    const provenEvent = result.events.find((e) => e.name === 'SandwichProven');
    check('SandwichProven', provenEvent !== undefined, 'event missing');
    check(
      'paid == computed',
      provenEvent !== undefined && provenEvent.args[5] === provenEvent.args[6],
      `harm ${provenEvent?.args[5]} vs paid ${provenEvent?.args[6]}`,
    );

    if (i < WARMUP) say(`  warm-up  ${ms(elapsed)} (discarded) · ${result.txHash}`);
    else {
      e2e.push(elapsed);
      gasSpentOnRulings += result.gasUsed;
      receipts.push({
        tx: result.txHash,
        block: result.blockNumber,
        gas: result.gasUsed,
        paid: provenEvent?.args[6] ?? '?',
      });
      say(
        `  trial ${String(i - WARMUP + 1).padStart(2)}  ${ms(elapsed)} · ${result.gasUsed} gas · ` +
          `block ${result.blockNumber} · ${result.txHash}`,
      );
    }
  }
  const balanceAfter = await cc3.getBalance(wallet.address);

  // ---------------------------------------------------------------- results
  rule('Results');
  const table = [
    stats(`hosted proof fetch`, hosted),
    stats(`local proof build (no prover)`, local),
    stats(`end-to-end prove → ruling`, e2e),
  ];
  say('| path | n | p50 | p95 | min | max | mean |');
  say('|---|---:|---:|---:|---:|---:|---:|');
  for (const s of table) {
    say(
      `| ${s.path} | ${s.n} | ${ms(s.p50)} | ${ms(s.p95)}${s.p95IsMax ? ' *' : ''} | ${ms(s.min)} | ` +
        `${ms(s.max)} | ${ms(s.mean)} |`,
    );
  }
  if (table.some((s) => s.p95IsMax)) {
    say('');
    say('* nearest-rank p95 at this n IS the slowest observation. Read it as a worst case seen,');
    say('  not as a resolved tail. The n is small on purpose: those trials cost real gas or ~200s');
    say('  of mainnet round-trips each.');
  }

  const hostedS = table[0]!;
  const localS = table[1]!;
  say('');
  say(
    `The hosted prover is ${(localS.p50 / hostedS.p50).toFixed(0)}× faster at the median — and index41 ` +
      `does not need it: the local path returns the same merkle root, ${canonicalRoot}.`,
  );

  rule('Real-run receipt — the rulings this benchmark actually landed');
  say(`signer ${wallet.address}`);
  say(`balance ${formatEther(balanceBefore)} CTC → ${formatEther(balanceAfter)} CTC`);
  say(
    `spent ${formatEther(balanceBefore - balanceAfter)} CTC across ${N_E2E + WARMUP} courts deployed, ` +
      `${N_E2E + WARMUP} bonds posted and ${N_E2E + WARMUP} rulings submitted`,
  );
  say(`gas used by the ${N_E2E} measured rulings: ${gasSpentOnRulings} (${gasSpentOnRulings / BigInt(N_E2E)} each)`);
  say('');
  for (const r of receipts) {
    say(`  ${CC3.explorer}/tx/${r.tx}`);
    say(`      block ${r.block} · ${r.gas} gas · paid ${r.paid} wei to the victim`);
  }

  rule('Correctness');
  if (failures === 0) {
    say(`all trials passed every check: positions ${EXPECTED.join(' / ')}, one merkle root across both`);
    say('proof sources, status-1 receipts with three TransactionVerified logs, paid == computed.');
  } else {
    say(`${failures} CHECK(S) FAILED — the timings above are not valid.`);
  }

  rule();
  say(`finished ${new Date().toISOString()} · ${((Date.now() - started.getTime()) / 1000).toFixed(0)}s total`);
  say(`evidence written to docs/bench-output.txt`);
  writeFileSync(OUTPUT, lines.join('\n') + '\n');

  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  say('');
  rule('BENCHMARK ERROR');
  say(String(err?.stack ?? err));
  writeFileSync(OUTPUT, lines.join('\n') + '\n');
  process.exitCode = 1;
});
