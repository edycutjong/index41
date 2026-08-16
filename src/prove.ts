/**
 * prove.ts — three Ethereum mainnet transaction hashes in, one Creditcoin ruling out.
 *
 *   npm run prove                      # the recorded sandwich in data/
 *   npm run prove -- <front> <victim> <back>
 *   npm run prove -- --kill-hosted     # the hosted prover is switched off; nothing else changes
 *   npm run prove -- --source local    # go straight to the local prover
 *
 * The default path, with no flags at all:
 *
 *   1. resolve the block and the three positions from mainnet (ground truth, never trusted)
 *   2. wait until the block is attested — SDK `waitUntilHeightAttested`, plus an adaptive poller
 *      driven by the prover's own `retriable` / `last_attested_block`
 *   3. fetch proofs down a ladder of three interchangeable sources, the last of which needs no
 *      proof service at all
 *   4. audit the bundle: re-encode the leaves from mainnet, re-fold the merkle paths, and chain
 *      the continuity roots to a digest Creditcoin already holds
 *   5. decode each leg through Creditcoin's deployed EvmV1Decoder — the same library the contract
 *      links against — and reproduce every clause of the contract's shape assertion off-chain
 *   6. dry-run all three verifications for free, then submit ONE transaction that calls
 *      `verifyAndEmit` three times and `calculateTxIndex` on each
 *   7. read back SandwichProven and print the Blockscout link
 *
 * Nothing here is mocked, and there is no path that skips the precompile.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { blockProver, chainInfo, utils } from '@gluwa/usc-sdk';

import { REPO_ROOT } from './artifacts.js';
import { auditBundle, reencodeFromSource } from './audit.js';
import {
  budgetGas,
  buildClaim,
  decodeLeg,
  decoderContract,
  deriveShape,
  submitClaim,
  type DecodedLeg,
} from './claim.js';
import { CC3, ETHEREUM_CHAIN_KEY, EVM_V1_DECODER, VERIFIER_PRECOMPILE, loadAccount } from './config.js';
import { ensureCourt, ensureRelay } from './court.js';
import { MAINNET_RPCS, getTx, hexToNum } from './eth.js';
import { Log, PipelineFailure, assert } from './log.js';
import {
  HostedByHashSource,
  HostedByIndexSource,
  LocalRawSource,
  type LegRequest,
  type ProofSource,
  fetchFromLadder,
} from './proof-sources.js';
import { attestedHeight, health, probeRetriableContract, waitForProvable } from './prover-api.js';

/** A bond big enough that the demo's harm is fully covered. Harm here is denominated in pool wei. */
const MIN_BOND = 10n ** 18n; // 1 CTC

/**
 * How far below the attested tip a block has to be before its data counts as settled — roughly an
 * hour of Ethereum. Below this, `waitUntilHeightAttested`'s 15-second data-availability cushion is
 * doing real work and index41 keeps it.
 */
const SETTLED_MARGIN = 256;

// ------------------------------------------------------------------ arguments

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const hashes = argv.filter((a) => /^0x[0-9a-fA-F]{64}$/.test(a));
const killHosted = flag('kill-hosted');
const only = option('source');
/**
 * `proveSandwich` burns three query ids plus a composite claim id, so one sandwich can be ruled on
 * exactly once per contract — that is the product, not an inconvenience. Deploying a second court
 * is therefore the only honest way to demonstrate a second, independent proving run (proving the
 * same sandwich again with the hosted prover switched off, say). It changes nothing about how the
 * proof is obtained or checked.
 */
const freshCourt = flag('fresh-court');

/**
 * `--kill-hosted` does not enable a code path. It points the hosted sources at an address that
 * does not answer, which is the closest honest simulation of the proof service being down. The
 * pipeline then does what it would do in production: build the proof itself.
 */
const PROVER_URL = killHosted ? 'https://prover.invalid.creditcoin.example' : CC3.proverUrl;

const OUTPUT =
  option('evidence') ??
  join(REPO_ROOT, 'docs', killHosted ? 'pipeline-output-local-prover.txt' : 'pipeline-output.txt');
const log = new Log(OUTPUT);

function fixtureHashes(): { hashes: string[]; note: string } {
  const file = join(REPO_ROOT, 'data', 'sandwich-25764741.json');
  const s = JSON.parse(readFileSync(file, 'utf8')) as {
    frontRun: { hash: string };
    victim: { hash: string };
    backRun: { hash: string };
    note: string;
  };
  return { hashes: [s.frontRun.hash, s.victim.hash, s.backRun.hash], note: s.note };
}

// ------------------------------------------------------------------ main

async function main() {
  log.line('index41 — THE PROVING PIPELINE');
  log.line('three Ethereum mainnet transaction hashes in, one Creditcoin ruling out');
  log.line(`run at ${new Date().toISOString()}`);

  // ---------------------------------------------------------------- 0. inputs
  log.rule('0. Input');

  const roles = ['front-run', 'victim', 'back-run'] as const;
  let inputs: string[];
  if (hashes.length === 3) {
    inputs = hashes;
    log.line('three transaction hashes supplied on the command line');
  } else {
    assert(hashes.length === 0, `expected 3 transaction hashes, got ${hashes.length}`);
    const fixture = fixtureHashes();
    inputs = fixture.hashes;
    log.line('no hashes given — using the recorded sandwich in data/sandwich-25764741.json');
    log.line(`  ${fixture.note}`);
  }
  log.line('');
  inputs.forEach((h, i) => log.line(`  ${roles[i]!.padEnd(10)} ${h}`));

  // ---------------------------------------------------------------- 1. networks
  log.rule('1. Networks');

  const { privateKey } = loadAccount('deployer');
  const cc3 = new JsonRpcProvider(CC3.rpcUrl, CC3.chainId, { staticNetwork: true });
  const wallet = new Wallet(privateKey, cc3);
  const net = await cc3.getNetwork();
  assert(Number(net.chainId) === CC3.chainId, `RPC reported chainId ${net.chainId}, expected ${CC3.chainId}`);

  // A plain ethers provider on mainnet, used by the local prover and by the leaf re-encode.
  const mainnet = new JsonRpcProvider(MAINNET_RPCS[0]!, 1, { staticNetwork: true });

  log.kv('creditcoin', `${CC3.rpcUrl} · chainId ${net.chainId} · head ${await cc3.getBlockNumber()}`);
  log.kv('ethereum', `${MAINNET_RPCS[0]} · head ${await mainnet.getBlockNumber()}`);
  log.kv('signer', `${wallet.address} · ${formatEther(await cc3.getBalance(wallet.address))} CTC`);
  log.kv('verifier', `${VERIFIER_PRECOMPILE} (from the SDK's own constant)`);
  log.kv('decoder', `${EVM_V1_DECODER} (Creditcoin's deployed EvmV1Decoder)`);
  log.kv('prover', killHosted ? `${PROVER_URL}  ← --kill-hosted: the hosted service is gone` : PROVER_URL);

  const info = new chainInfo.PrecompileChainInfoProvider(cc3);
  const prover = new blockProver.PrecompileBlockProver(cc3);

  const chain = await info.getSupportedChainByKey(ETHEREUM_CHAIN_KEY);
  assert(chain !== null, `chain key ${ETHEREUM_CHAIN_KEY} is not supported on this network`);
  assert(chain.chainId === 1, `chain key ${ETHEREUM_CHAIN_KEY} maps to chainId ${chain.chainId}, not mainnet`);
  log.kv('source chain', `key ${ETHEREUM_CHAIN_KEY} → chainId ${chain.chainId} (attestation genesis ${await info.getAttestationGenesisHeight(ETHEREUM_CHAIN_KEY)})`);

  // ---------------------------------------------------------------- 2. positions
  log.rule('2. Resolve the block and the three positions');

  const legs: LegRequest[] = [];
  let blockNumber = -1;
  for (let i = 0; i < 3; i++) {
    const tx = await getTx(inputs[i]!);
    const height = hexToNum(tx.blockNumber);
    const index = hexToNum(tx.transactionIndex);
    if (blockNumber < 0) blockNumber = height;
    assert(height === blockNumber, `${inputs[i]} is in block ${height}, not ${blockNumber} — not one block`);
    legs.push({ role: roles[i]!, hash: inputs[i]!, expectedIndex: index });
    log.line(`  ${roles[i]!.padEnd(10)} block ${height}  position ${String(index).padStart(3)}  from ${tx.from}`);
  }
  log.line('');
  log.line('Those positions come from an Ethereum RPC and index41 does not act on them.');
  log.line('They are the ground truth the Creditcoin precompile has to reproduce, unaided.');

  // ---------------------------------------------------------------- 3. attestation
  log.rule('3. Attestation — adaptive, not a flat sleep loop');

  if (!killHosted) {
    const h = await health(PROVER_URL);
    log.kv('prover health', `${h.status} · cc3=${h.cc3_rpc_connected} eth=${h.eth_rpc_connected} · up ${h.uptime_seconds}s`);

    // Before relying on `retriable` + `last_attested_block`, check the prover actually reports
    // them. If it does not, the poller degrades to the examples' flat schedule instead of
    // sleeping on a field that is not there.
    const contract = await probeRetriableContract(ETHEREUM_CHAIN_KEY, PROVER_URL);
    log.line('');
    log.line('asking the prover for a height it cannot possibly serve, to see how it says no:');
    log.line(`  ${contract.raw}`);
    log.line(
      `  retriable=${contract.retriable} block_number=${contract.blockNumber} ` +
        `last_attested_block=${contract.lastAttestedBlock}`,
    );
    if (contract.honoured && contract.blockNumber != null && contract.lastAttestedBlock != null) {
      log.line(
        `  → ${contract.blockNumber - contract.lastAttestedBlock} blocks behind, so the adaptive poller ` +
          `would sleep ${(contract.backoffMs / 1000).toFixed(0)}s, not a flat 15s`,
      );
    } else {
      log.line('  → the prover does not report the lag; the poller falls back to a flat 15s schedule');
    }
  } else {
    log.line('hosted prover disabled — attestation is read straight off the chain-info precompile');
  }

  const tip = await info.getLatestAttestedHeightAndHash(ETHEREUM_CHAIN_KEY);
  log.line('');
  log.kv('attested tip', `${tip.height} ${tip.hash} (isAttestation=${tip.isAttestation})`);
  assert(tip.exists, `chain key ${ETHEREUM_CHAIN_KEY} has no attestations`);

  // The SDK's own wait — the surface every official example uses, kept here so a claim about a
  // block minted seconds ago would also work.
  //
  // Its FIFTH parameter is `extraDelayMs`, and it defaults to 15,000: after seeing the height
  // attested, `waitUntilHeightAttested` sleeps a flat fifteen seconds "to ensure data
  // availability", whether the block was attested one second ago or three hours ago. No official
  // example passes that parameter. index41 does, because the answer is knowable: a block far below
  // the tip has had its data available since long before this process started.
  const behind = tip.height - blockNumber;
  const extraDelayMs = behind >= SETTLED_MARGIN ? 0 : 15_000;
  const t0 = Date.now();
  await info.waitUntilHeightAttested(ETHEREUM_CHAIN_KEY, blockNumber, 5_000, 60_000, extraDelayMs);
  log.kv(
    'waitUntilHeight',
    `returned after ${Date.now() - t0}ms · block is ${behind} below the tip, so extraDelayMs=${extraDelayMs} ` +
      `(the SDK default of 15000 would have added ${15_000 - extraDelayMs}ms of nothing)`,
  );

  if (!killHosted) {
    const wait = await waitForProvable(ETHEREUM_CHAIN_KEY, blockNumber, { baseUrl: PROVER_URL });
    log.kv(
      'prover ready',
      `after ${wait.attempts} attempt(s), ${wait.sleptMs}ms slept, schedule [${wait.schedule.join(', ')}] ` +
        `· attested-height ${await attestedHeight(ETHEREUM_CHAIN_KEY, PROVER_URL)}`,
    );
  }

  const bounds = await info.getContinuityBounds(ETHEREUM_CHAIN_KEY, blockNumber);
  log.kv(
    'continuity',
    `parent ${bounds.parentHeight} (attestation=${bounds.parentIsAttestation}) → ` +
      `child ${bounds.childHeight} (attestation=${bounds.childIsAttestation})`,
  );
  assert(bounds.isAttested, `block ${blockNumber} reports isAttested=false`);

  // ---------------------------------------------------------------- 4. proofs
  log.rule('4. Proofs — three interchangeable sources, hosted last-resort-free');

  const ladder: ProofSource[] = [
    new HostedByIndexSource(PROVER_URL),
    new HostedByHashSource(ETHEREUM_CHAIN_KEY, PROVER_URL),
    new LocalRawSource(ETHEREUM_CHAIN_KEY, mainnet, cc3),
  ];
  const selected =
    only === 'local'
      ? [ladder[2]!]
      : only === 'hosted'
        ? [ladder[0]!, ladder[1]!]
        : ladder;

  for (const s of selected) log.line(`  ${s.name}\n      trusts: ${s.trusts}`);
  log.line('');

  const { bundle, attempts } = await fetchFromLadder(
    selected,
    ETHEREUM_CHAIN_KEY,
    blockNumber,
    legs,
    (a) =>
      log.line(
        a.ok
          ? `  ✓ ${a.source} — ${a.elapsedMs}ms`
          : `  ✗ ${a.source} — ${a.elapsedMs}ms — ${a.error}`,
      ),
  );
  log.line('');
  log.kv('source used', bundle.source);
  for (const note of bundle.notes) log.line(`                ${note}`);
  if (attempts.length > 1) {
    log.line('');
    log.line(`${attempts.length - 1} source(s) failed before this one, and the pipeline did not care.`);
  }

  // ---------------------------------------------------------------- 5. audit
  log.rule('5. Audit — the source gets no benefit of the doubt');

  const audit = await auditBundle(bundle, info, (h) => reencodeFromSource(mainnet, h));
  log.line('leaf → root, one bit of laterality per sibling (L = sibling on the left):');
  log.line('');
  for (const a of audit.legs) {
    log.line(
      `  ${a.role.padEnd(10)} ${a.laterality}  →  ${String(a.indexFromLaterality).padStart(3)}   ` +
        `merkle ${a.merkleOk ? 'ok' : 'MISMATCH'} · leaf ${
          a.leafMatchesMainnet === null ? 'unchecked' : a.leafMatchesMainnet ? 'matches mainnet' : 'DIFFERS'
        } · ${a.txBytesLength} bytes`,
    );
  }
  log.line('');
  log.kv('merkle root', audit.singleRoot);
  log.kv(
    'continuity',
    `${audit.continuity.roots} roots covering ${audit.continuity.fromHeight}..${audit.continuity.toHeight}`,
  );
  log.kv('  chains to', audit.continuity.topDigest);
  log.kv(
    '  recognised',
    audit.continuity.boundTo === 'NOTHING'
      ? 'NOT FOUND ON CHAIN'
      : `as a ${audit.continuity.boundTo} at height ${audit.continuity.boundAtHeight}`,
  );
  for (const f of audit.failures) log.line(`  FAIL: ${f}`);
  assert(audit.ok, `proof audit failed:\n  ${audit.failures.join('\n  ')}`);
  log.line('');
  log.line('Every byte was re-derived from Ethereum and bound to Creditcoin state before a claim existed.');

  // ---------------------------------------------------------------- 6. decode
  log.rule("6. Decode — through Creditcoin's own EvmV1Decoder, the copy the contract links to");

  const decoder = decoderContract(cc3);
  const decoded: DecodedLeg[] = [];
  for (const l of bundle.legs) {
    const d = await decodeLeg(decoder, l.role, l.txIndex, l.txBytes, true);
    decoded.push(d);
    log.line(
      `  ${d.role.padEnd(10)} type ${d.txType} · from ${d.from} · to ${d.to}\n` +
        `             status ${d.receiptStatus} · gasUsed ${d.gasUsed} · ${d.logCount} logs · ` +
        `maxPriorityFeePerGas ${d.maxPriorityFeePerGas}` +
        (d.decodeGas !== undefined ? ` · decode cost ${d.decodeGas} gas` : ''),
    );
  }

  const [front, victim, back] = decoded as [DecodedLeg, DecodedLeg, DecodedLeg];
  const shape = deriveShape(front, victim, back);
  log.line('');
  log.kv('pool', `${shape.pool}  (the Swap emitter common to all three legs — not their \`to\`)`);
  log.kv('numeraire', shape.numeraireIsToken0 ? 'token0' : 'token1');
  log.kv('searcher', shape.searcher);
  log.kv('victim', `${shape.victim} · entry point ${shape.victimEntrypoint}`);
  log.line('');
  log.line(`  front-run paid in   ${shape.frontNumeraireIn}`);
  log.line(`  victim  paid in     ${shape.victimNumeraireIn}`);
  log.line(`  back-run took out   ${shape.backNumeraireOut}`);
  log.line(`  realized profit     ${shape.harm}   ← this is the harm, and it is inside the proof`);

  // ---------------------------------------------------------------- 7. dry run
  log.rule('7. Dry run — every verification, for free, before any gas is spent');

  for (const l of bundle.legs) {
    const ok = await prover.verifySingle(
      ETHEREUM_CHAIN_KEY,
      blockNumber,
      l.txBytes,
      l.merkleProof as never,
      bundle.continuityProof,
    );
    const recovered = Number(await prover.computeTransactionIndex(l.merkleProof as never));
    log.line(
      `  ${l.role.padEnd(10)} verifySingle=${ok} · calculateTxIndex=${recovered} (mainnet says ${l.expectedIndex})`,
    );
    assert(ok, `${l.role}: the precompile refused the proof`);
    assert(recovered === l.expectedIndex, `${l.role}: precompile says ${recovered}, mainnet says ${l.expectedIndex}`);
  }
  const [f, v, b] = bundle.legs.map((l) => l.expectedIndex) as [number, number, number];
  assert(f < v && v < b, `positions are not ascending: ${f}, ${v}, ${b}`);
  log.line('');
  log.line(`  ${f} < ${v} < ${b}   — front-run BEFORE victim BEFORE back-run. Cost so far: zero gas.`);

  // ---------------------------------------------------------------- 8. the court
  log.rule('8. The court');

  const { deployment, contract: court } = await ensureCourt(wallet, cc3, (l) => log.line(l), {
    fresh: freshCourt,
  });
  const relay = await ensureRelay(court, wallet, wallet.address, shape.victimEntrypoint, MIN_BOND, (l) =>
    log.line(l),
  );
  log.kv('Index41', deployment.index41);
  log.kv('relay', `${relay.relay} · bond ${formatEther(relay.bond)} CTC · covers ${shape.victimEntrypoint}=${relay.covers}`);
  assert(relay.covers, `relay does not cover ${shape.victimEntrypoint}`);

  // One sandwich, one payout. The identity of a sandwich is its block, its tree, and the three
  // positions inside it — all four already recovered above.
  const claimId = (await court.claimIdFor!(
    ETHEREUM_CHAIN_KEY,
    blockNumber,
    audit.singleRoot,
    bundle.legs[0]!.expectedIndex,
    bundle.legs[1]!.expectedIndex,
    bundle.legs[2]!.expectedIndex,
  )) as string;
  const prior = (await court.verdicts!(claimId)) as { ruledAt: bigint; harm: bigint; paid: bigint };
  log.kv('claim id', claimId);
  if (prior.ruledAt !== 0n) {
    log.rule('ALREADY RULED');
    log.line(`This court ruled on this exact sandwich at unix ${prior.ruledAt}: harm ${prior.harm}, paid ${prior.paid}.`);
    log.line('The replay guard is doing its job — three per-leg query ids and the composite claim id');
    log.line('were all burned by that ruling, so nothing can claim it a second time here.');
    log.line('Run again with --fresh-court to have a new court rule on it independently.');
    return;
  }

  // ---------------------------------------------------------------- 9. submit
  log.rule('9. Submit — 3× verifyAndEmit in ONE Creditcoin transaction');

  const claim = buildClaim(bundle, relay.relay, shape);
  const calldata = court.interface.encodeFunctionData('proveSandwich', [claim]);
  const budget = await budgetGas(cc3, court, calldata, wallet.address, bundle.continuityProof.roots.length);
  log.kv('calldata', `${budget.calldataBytes} bytes (utils.hex.bytesInHexString)`);
  log.kv('gas limit', `${budget.computedLimit} from utils.gas.computeGasLimit`);
  log.kv('MAX_GAS_CAP', `${utils.gas.MAX_GAS_CAP} — the budget is ${budget.percentOfCapBefore.toFixed(3)}% of it`);
  log.kv('sending with', `${budget.cappedLimit}`);

  const result = await submitClaim(court, wallet, claim, budget.cappedLimit);
  log.line('');
  log.kv('CC3 tx', result.txHash);
  log.kv('block', `${result.blockNumber} · status ${result.status}`);
  log.kv('GAS USED', `${result.gasUsed}  (${result.percentOfCap.toFixed(3)}% of MAX_GAS_CAP)`);
  assert(result.status === 1, 'proveSandwich reverted');
  assert(result.gasUsed <= utils.gas.MAX_GAS_CAP, `used ${result.gasUsed}, over MAX_GAS_CAP`);

  // ---------------------------------------------------------------- 10. ruling
  log.rule('10. The ruling');

  log.line('the precompile\'s OWN event, once per verifyAndEmit — not our contract, not this script:');
  for (const i of result.verifiedIndices) log.line(`  TransactionVerified(chainKey=${ETHEREUM_CHAIN_KEY}, height=${blockNumber}, txIndex=${i})`);
  assert(result.verifiedIndices.length === 3, `expected 3 TransactionVerified logs, got ${result.verifiedIndices.length}`);
  log.line('');
  for (const e of result.events) log.line(`  ${e.name}(${e.args.join(', ')})`);

  const proven = result.events.find((e) => e.name === 'SandwichProven');
  assert(proven !== undefined, 'no SandwichProven event in the receipt');
  log.line('');
  log.line(`  index ${f}   searcher buy     ${bundle.legs[0]!.hash}`);
  log.line(`  index ${v}   the victim       ${bundle.legs[1]!.hash}`);
  log.line(`  index ${b}   searcher sell    ${bundle.legs[2]!.hash}`);
  log.line('');
  log.kv('explorer', `${CC3.explorer}/tx/${result.txHash}`);
  log.kv('contract', `${CC3.explorer}/address/${deployment.index41}`);
  log.line('');
  log.line('  Creditcoin read the position of a transaction inside an Ethereum block, and the bond paid.');
  log.rule();
  log.line(`finished ${new Date().toISOString()}`);
  log.line(`evidence written to ${OUTPUT}`);
}

main().catch((err) => {
  log.line('');
  log.rule(err instanceof PipelineFailure ? 'PIPELINE ASSERTION FAILED' : 'PIPELINE ERROR');
  log.line(String(err?.stack ?? err));
  process.exitCode = 1;
});
