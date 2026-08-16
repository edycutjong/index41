/**
 * find-sandwich — locate a REAL sandwich attack in a REAL Ethereum mainnet block.
 *
 * Shape we look for, inside ONE block, around ONE contract (an AMM pool):
 *
 *     index i   searcher   swap   (front-run)
 *     index j   victim     swap   (the filling)     i < j < k
 *     index k   searcher   swap   (back-run)
 *
 * Detection is AMM-agnostic and receipt-driven: all three transactions must
 * touch the same pool contract (it appears as a log emitter in all three), the
 * outer two must share a sender, the middle one must not, and the pool must
 * emit a recognised Swap event in the outer two.
 *
 * This script only *finds* candidates. It proves nothing. The ordering claim is
 * only real once `INativeQueryVerifier.calculateTxIndex` recovers those indices
 * on Creditcoin from the merkle authentication path — that is `spike.ts`.
 *
 *   npm run find-sandwich -- [--from <block>] [--blocks <n>]
 */

import {
  SWAP_TOPICS,
  getBlock,
  getBlockReceipts,
  hexToNum,
  type RawBlock,
  type RawReceipt,
  type RawTx,
} from './lib/eth.js';

const PROVER_URL = 'https://prover.cc3-testnet.creditcoin.network';
const ETHEREUM_CHAIN_KEY = 3;

export interface SandwichLeg {
  index: number;
  hash: string;
  from: string;
  to: string | null;
  effectiveGasPriceGwei: number;
}

export interface SandwichCandidate {
  blockNumber: number;
  blockHash: string;
  pool: string;
  poolProtocol: string;
  searcher: string;
  frontRun: SandwichLeg;
  victim: SandwichLeg;
  backRun: SandwichLeg;
}

const leg = (tx: RawTx, rx: RawReceipt): SandwichLeg => ({
  index: hexToNum(tx.transactionIndex),
  hash: tx.hash,
  from: tx.from.toLowerCase(),
  to: tx.to ? tx.to.toLowerCase() : null,
  effectiveGasPriceGwei: Number(BigInt(rx.effectiveGasPrice)) / 1e9,
});

export function detectSandwiches(block: RawBlock, receipts: RawReceipt[]): SandwichCandidate[] {
  const txByIndex = new Map<number, RawTx>();
  for (const tx of block.transactions) txByIndex.set(hexToNum(tx.transactionIndex), tx);

  const rxByIndex = new Map<number, RawReceipt>();
  for (const rx of receipts) rxByIndex.set(hexToNum(rx.transactionIndex), rx);

  /** txIndex -> pool address -> the swap protocol it emitted (or '' for "touched, no swap") */
  const touched = new Map<number, Map<string, string>>();
  for (const rx of receipts) {
    if (BigInt(rx.status) !== 1n) continue; // a reverted leg proves nothing
    const idx = hexToNum(rx.transactionIndex);
    const pools = touched.get(idx) ?? new Map<string, string>();
    for (const log of rx.logs) {
      const addr = log.address.toLowerCase();
      const protocol = log.topics[0] ? (SWAP_TOPICS[log.topics[0].toLowerCase()] ?? '') : '';
      if (protocol || !pools.has(addr)) pools.set(addr, protocol || (pools.get(addr) ?? ''));
    }
    touched.set(idx, pools);
  }

  const indices = [...touched.keys()].sort((a, b) => a - b);
  const found: SandwichCandidate[] = [];

  for (let a = 0; a < indices.length; a++) {
    for (let c = a + 2; c < indices.length; c++) {
      const i = indices[a]!;
      const k = indices[c]!;
      const front = txByIndex.get(i);
      const back = txByIndex.get(k);
      if (!front || !back) continue;
      if (front.from.toLowerCase() !== back.from.toLowerCase()) continue;

      const frontPools = touched.get(i)!;
      const backPools = touched.get(k)!;

      for (let b = a + 1; b < c; b++) {
        const j = indices[b]!;
        const victim = txByIndex.get(j);
        if (!victim) continue;
        if (victim.from.toLowerCase() === front.from.toLowerCase()) continue;
        const victimPools = touched.get(j)!;

        for (const [pool, frontProtocol] of frontPools) {
          const backProtocol = backPools.get(pool);
          if (backProtocol === undefined) continue;
          if (!victimPools.has(pool)) continue;
          // the searcher's own two legs must be actual swaps on that pool
          if (!frontProtocol || !backProtocol) continue;

          found.push({
            blockNumber: hexToNum(block.number),
            blockHash: block.hash,
            pool,
            poolProtocol: frontProtocol,
            searcher: front.from.toLowerCase(),
            frontRun: leg(front, rxByIndex.get(i)!),
            victim: leg(victim, rxByIndex.get(j)!),
            backRun: leg(back, rxByIndex.get(k)!),
          });
          break;
        }
      }
    }
  }
  return found;
}

async function attestedHeight(chainKey: number): Promise<number> {
  const res = await fetch(`${PROVER_URL}/api/v1/attested-height/${chainKey}`);
  if (!res.ok) throw new Error(`attested-height -> HTTP ${res.status}`);
  const body = (await res.json()) as { attestedHeight: number | null };
  if (body.attestedHeight == null) throw new Error(`chain key ${chainKey} has no attested height`);
  return body.attestedHeight;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

export async function scan(start: number, count: number, verbose = true): Promise<SandwichCandidate[]> {
  const all: SandwichCandidate[] = [];
  for (let n = start; n > start - count; n--) {
    let block: RawBlock;
    let receipts: RawReceipt[];
    try {
      block = await getBlock(n);
      receipts = await getBlockReceipts(n);
    } catch (err) {
      if (verbose) console.log(`block ${n}: SKIPPED — ${(err as Error).message.split('\n')[0]}`);
      continue;
    }
    const hits = detectSandwiches(block, receipts);
    if (verbose) {
      console.log(`block ${n}: ${block.transactions.length} txs, ${hits.length} sandwich candidate(s)`);
    }
    all.push(...hits);
  }
  return all;
}

/** Tightest sandwich first — the smallest front..back span is the cleanest demo. */
export function rank(all: SandwichCandidate[]): SandwichCandidate[] {
  return [...all].sort((x, y) => x.backRun.index - x.frontRun.index - (y.backRun.index - y.frontRun.index));
}

async function main() {
  const attested = await attestedHeight(ETHEREUM_CHAIN_KEY);
  // stay a margin below the attestation tip so the prover has certainly ingested the block
  const start = Number(arg('from') ?? attested - 50);
  const count = Number(arg('blocks') ?? 30);

  console.log(`Attestcoin attested height, chain key ${ETHEREUM_CHAIN_KEY} (Ethereum mainnet): ${attested}`);
  console.log(`scanning mainnet blocks ${start} down to ${start - count + 1} for sandwiches\n`);

  const all = rank(await scan(start, count));
  if (!all.length) {
    console.log('\nno sandwich found in range');
    process.exit(1);
  }

  const outFile = arg('out');
  if (outFile) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outFile, JSON.stringify(all, null, 2));
    console.log(`\nwrote ${all.length} candidate(s) to ${outFile}`);
  }

  const best = all[0]!;
  console.log(`\n${all.length} candidate(s) total. Best:\n`);
  console.log(JSON.stringify(process.argv.includes('--all') ? all : best, null, 2));
  console.log(`\nindex ${best.frontRun.index}   searcher buy     ${best.frontRun.hash}`);
  console.log(`index ${best.victim.index}   the victim       ${best.victim.hash}`);
  console.log(`index ${best.backRun.index}   searcher sell    ${best.backRun.hash}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
