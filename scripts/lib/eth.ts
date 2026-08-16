/**
 * Minimal JSON-RPC helpers for reading Ethereum mainnet.
 *
 * index41 never *trusts* these reads — they exist only to locate a candidate
 * sandwich and to state, out of band, what the real block positions are.
 * The positions index41 acts on come from the Attestcoin precompile
 * (`INativeQueryVerifier.calculateTxIndex`), not from here.
 */

export const MAINNET_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://eth.merkle.io',
  'https://rpc.flashbots.net',
];

export type RpcError = { code: number; message: string };

export async function rpc<T>(url: string, method: string, params: unknown[], timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { result?: T; error?: RpcError };
  if (body.error) throw new Error(`${method} -> RPC error ${body.error.code}: ${body.error.message}`);
  if (body.result === null || body.result === undefined) throw new Error(`${method} -> null result`);
  return body.result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cursor = 0;

/**
 * Calls `method` against the mainnet RPC pool, round-robin, with backoff.
 * Public endpoints rate-limit aggressively; every failure is reported verbatim
 * rather than swallowed.
 */
export async function mainnetRpc<T>(method: string, params: unknown[], rounds = 4): Promise<T> {
  const failures: string[] = [];
  for (let round = 0; round < rounds; round++) {
    const base = cursor++;
    for (let i = 0; i < MAINNET_RPCS.length; i++) {
      const url = MAINNET_RPCS[(base + i) % MAINNET_RPCS.length]!;
      try {
        return await rpc<T>(url, method, params);
      } catch (err) {
        failures.push(`  [round ${round}] ${url}: ${(err as Error).message}`);
      }
    }
    await sleep(800 * (round + 1));
  }
  throw new Error(`all mainnet RPCs failed for ${method}:\n${failures.join('\n')}`);
}

export const hexToNum = (h: string): number => Number(BigInt(h));
export const numToHex = (n: number): string => '0x' + n.toString(16);

export interface RawTx {
  hash: string;
  from: string;
  to: string | null;
  input: string;
  value: string;
  gasPrice?: string;
  maxPriorityFeePerGas?: string;
  transactionIndex: string;
  type: string;
}

export interface RawBlock {
  number: string;
  hash: string;
  baseFeePerGas?: string;
  timestamp: string;
  transactions: RawTx[];
}

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  transactionIndex: string;
  transactionHash: string;
  logIndex: string;
}

export interface RawReceipt {
  transactionHash: string;
  transactionIndex: string;
  from: string;
  to: string | null;
  status: string;
  gasUsed: string;
  effectiveGasPrice: string;
  logs: RawLog[];
}

/** Swap-event topic0 values across the AMMs that carry mainnet flow. */
export const SWAP_TOPICS: Record<string, string> = {
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': 'UniswapV2.Swap',
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67': 'UniswapV3.Swap',
  '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f': 'UniswapV4.Swap',
  '0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b': 'Balancer.Swap',
  '0x8b3e96f2b889fa771c53c981b40daf005f63f637f1869f707052d15a3dd97140': 'Curve.TokenExchange',
  '0xb2e76ae99761dc136e598d4a629bb347eccb9532a5f8bbd72e18467c3c34cc98': 'Curve.TokenExchangeUnderlying',
  '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83': 'Uniswap.SwapV4Router',
};

export const getBlock = (n: number) => mainnetRpc<RawBlock>('eth_getBlockByNumber', [numToHex(n), true]);

export const getBlockReceipts = (n: number) => mainnetRpc<RawReceipt[]>('eth_getBlockReceipts', [numToHex(n)]);

export const getTx = (hash: string) => mainnetRpc<RawTx & { blockNumber: string }>('eth_getTransactionByHash', [hash]);
