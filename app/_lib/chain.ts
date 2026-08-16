/**
 * Reading a ruling off Creditcoin, with no dependencies and no secrets.
 *
 * This module is the ONLY place the demo learns what happened. It speaks plain JSON-RPC to a
 * public CC3 testnet endpoint and decodes the receipt of one real transaction. There is no
 * fixture path, no `if (demo)` branch, and no literal `14` anywhere in the file: the indices the
 * page prints are the ones the Attestcoin precompile itself put in its own logs.
 *
 * Zero-config on purpose. The RPC URL is a public constant; `NEXT_PUBLIC_CC3_RPC` may override it
 * but nothing requires it, and no key, wallet or `.env` is read at any point.
 */

export const CC3 = {
  name: 'Creditcoin CC3 testnet',
  chainId: 102031,
  rpcUrl: process.env.NEXT_PUBLIC_CC3_RPC ?? 'https://rpc.cc3-testnet.creditcoin.network',
  explorer: 'https://creditcoin-testnet.blockscout.com',
} as const;

/** The claim whose receipt this page reads. One transaction, five logs, a settled sandwich. */
export const CLAIM_TX = '0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810';

/** The Attestcoin verifier's own gas ceiling for a single verification call. */
export const MAX_GAS_CAP = 75_000_000;

/**
 * Event signatures and the topic0 each one hashes to. `scripts/capture-proof.mjs` recomputes
 * keccak256 over every signature below and refuses to write an artifact if one disagrees, so
 * these constants are checked rather than trusted.
 */
export const TOPIC = {
  /** Emitted by the precompile itself, once per `verifyAndEmit`. Carries the recovered position. */
  TransactionVerified: '0x8a8df984523447f746ce8bccdb04c87025c708eb62a2d070bdffb8945c8f391e',
  /** Index41's hero event: the whole sandwich, ordered. */
  SandwichProven: '0xbb41c14a4b2500ad9e0d5a583435d6419982a9877d0efd00d1107d6177d9b9ac',
  /** The bond moving to the victim. */
  HarmPaid: '0xdcdf799a3df7388e9f3178281e4f57547a2e7494e14d7d01762d0891eddef0af',
} as const;

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
}

export interface RawReceipt {
  transactionHash: string;
  from: string;
  to: string;
  blockNumber: string;
  blockHash: string;
  status: string;
  gasUsed: string;
  logs: RawLog[];
}

export interface DecodedRuling {
  claim: {
    txHash: string;
    relay: string;
    index41: string;
    blockNumber: number;
    blockHash: string;
    status: number;
    gasUsed: number;
    gasPercentOfCap: number;
    logCount: number;
  };
  /** One entry per `verifyAndEmit`, in the order the transaction made them. */
  verified: Array<{ logIndex: number; emitter: string; chainKey: number; height: number; txIndex: number }>;
  ruling: {
    logIndex: number;
    emitter: string;
    searcher: string;
    blockHeight: number;
    frontIndex: number;
    victimIndex: number;
    backIndex: number;
    harm: string;
    paid: string;
  };
  harmPaid: { logIndex: number; emitter: string; victim: string; relay: string; amount: string };
}

const toNum = (hex: string) => Number(BigInt(hex));
const toBig = (hex: string) => BigInt(hex).toString();
const word = (data: string, i: number) => '0x' + data.slice(2).slice(i * 64, (i + 1) * 64);
const asAddress = (topic: string) => '0x' + topic.slice(-40);

/** Decode a claim receipt into a ruling. Throws rather than guessing — a partial ruling is a lie. */
export function decodeRuling(receipt: RawReceipt): DecodedRuling {
  const verified = receipt.logs
    .filter((l) => l.topics[0] === TOPIC.TransactionVerified)
    .map((l) => ({
      logIndex: toNum(l.logIndex),
      emitter: l.address,
      chainKey: toNum(l.topics[1] ?? '0x0'),
      height: toNum(l.topics[2] ?? '0x0'),
      txIndex: toNum(word(l.data, 0)),
    }));
  if (verified.length !== 3) {
    throw new Error(`expected three TransactionVerified logs, receipt has ${verified.length}`);
  }

  const provenLog = receipt.logs.find((l) => l.topics[0] === TOPIC.SandwichProven);
  if (!provenLog) throw new Error('receipt carries no SandwichProven log');
  const paidLog = receipt.logs.find((l) => l.topics[0] === TOPIC.HarmPaid);
  if (!paidLog) throw new Error('receipt carries no HarmPaid log');

  const gasUsed = toNum(receipt.gasUsed);

  return {
    claim: {
      txHash: receipt.transactionHash,
      relay: receipt.from,
      index41: receipt.to,
      blockNumber: toNum(receipt.blockNumber),
      blockHash: receipt.blockHash,
      status: toNum(receipt.status),
      gasUsed,
      gasPercentOfCap: Number(((gasUsed / MAX_GAS_CAP) * 100).toFixed(3)),
      logCount: receipt.logs.length,
    },
    verified,
    ruling: {
      logIndex: toNum(provenLog.logIndex),
      emitter: provenLog.address,
      searcher: asAddress(provenLog.topics[1] ?? ''),
      blockHeight: toNum(provenLog.topics[2] ?? '0x0'),
      frontIndex: toNum(word(provenLog.data, 0)),
      victimIndex: toNum(word(provenLog.data, 1)),
      backIndex: toNum(word(provenLog.data, 2)),
      harm: toBig(word(provenLog.data, 3)),
      paid: toBig(word(provenLog.data, 4)),
    },
    harmPaid: {
      logIndex: toNum(paidLog.logIndex),
      emitter: paidLog.address,
      victim: asAddress(paidLog.topics[1] ?? ''),
      relay: asAddress(paidLog.topics[2] ?? ''),
      amount: toBig(word(paidLog.data, 0)),
    },
  };
}

/** One JSON-RPC round trip, bounded. No retries: a slow chain must degrade, not hang. */
export async function rpcCall<T>(method: string, params: unknown[], timeoutMs = 7000): Promise<T> {
  const res = await fetch(CC3.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method} → ${json.error.message}`);
  if (json.result == null) throw new Error(`${method} → the node returned no result`);
  return json.result;
}

/** Read the claim receipt straight off the chain. */
export async function readClaimReceipt(timeoutMs = 7000): Promise<DecodedRuling> {
  const receipt = await rpcCall<RawReceipt | null>('eth_getTransactionReceipt', [CLAIM_TX], timeoutMs);
  if (!receipt) throw new Error('the node has no receipt for the claim transaction');
  return decodeRuling(receipt);
}

// ------------------------------------------------------------------------------------------
// The conceptual leap, in eight lines.
// ------------------------------------------------------------------------------------------

/**
 * A merkle authentication path is usually treated as an opaque list of sibling hashes. It is not.
 * Walking leaf -> root, each step tells you whether your node was the LEFT or the RIGHT child —
 * and that single bit, at that depth, is one bit of your position in the tree. Collect them
 * least-significant-first and you have not verified the position, you have RECOVERED it.
 *
 * `L` means the sibling sat on the left, so this node was the right child, so the bit is 1.
 * `RLLLRRRR` -> 0,1,1,1,0,0,0,0 -> 2 + 4 + 8 = 14.
 */
export function indexFromLaterality(laterality: string): number {
  let index = 0;
  for (let bit = 0; bit < laterality.length; bit += 1) {
    if (laterality[bit] === 'L') index |= 1 << bit;
  }
  return index;
}

/** The running decode, one step per sibling — what the ledger animates. */
export function lateralitySteps(laterality: string): Array<{
  depth: number;
  side: 'L' | 'R';
  bit: 0 | 1;
  weight: number;
  runningTotal: number;
}> {
  let running = 0;
  return Array.from(laterality).map((side, depth) => {
    const bit = side === 'L' ? 1 : 0;
    const weight = bit << depth;
    running += weight;
    return { depth, side: side as 'L' | 'R', bit: bit as 0 | 1, weight, runningTotal: running };
  });
}

export const explorerTx = (hash: string) => `${CC3.explorer}/tx/${hash}`;
export const explorerAddress = (address: string) => `${CC3.explorer}/address/${address}`;
/**
 * Source-chain links go to Blockscout's Ethereum mainnet instance rather than Etherscan: same
 * explorer family as the Creditcoin links, and it serves a machine-readable API on the same URL,
 * so a sceptic can check a position with curl instead of a browser —
 *   GET https://eth.blockscout.com/api/v2/transactions/<hash>  ->  { "position": 14, ... }
 */
export const ETH_EXPLORER = 'https://eth.blockscout.com';
export const sourceTxUrl = (hash: string) => `${ETH_EXPLORER}/tx/${hash}`;
export const sourceBlockUrl = (n: number) => `${ETH_EXPLORER}/block/${n}`;
