/**
 * A caching `BlockProvider`, written against the SDK's own extension point.
 *
 * `proofProvider.raw.blockProvider.BlockProvider` is an interface, not a class — the SDK ships
 * `SimpleBlockProvider` as one implementation and says, in its own doc comment, that it "has no
 * caching or optimizations". That understates the cost. Building a raw proof for one transaction
 * makes the SDK:
 *
 *   1. fetch the transaction,
 *   2. fetch its whole block with receipts,
 *   3. fetch EVERY transaction in that block again, one `eth_getTransactionByHash` at a time,
 *      to rebuild the merkle tree, and
 *   4. fetch every block in the continuity range, with receipts, to rebuild their digests.
 *
 * For index41 that is three legs of a 240-transaction block plus a 60-block continuity range:
 * roughly 800 mainnet round-trips per claim against public RPCs that rate-limit at a fraction of
 * that. So this decorator implements the same interface, delegates the misses to
 * `SimpleBlockProvider`, and — the part that matters — back-fills the per-transaction cache out of
 * the block it already fetched, because `getBlockWithReceipts` returns exactly the
 * `TransactionWithRaw` objects `getTransaction` would have re-fetched one by one.
 *
 * Same interface, same SDK code path, same proof. ~800 calls become ~130.
 */

import type { JsonRpcApiProvider } from 'ethers';
import { encoding, proofProvider } from '@gluwa/usc-sdk';

import { surfaceConstructed, surfaceWork } from './surfaces.js';

type TransactionWithRaw = encoding.TransactionWithRaw;
type BlockProvider = proofProvider.raw.blockProvider.BlockProvider;
type BlockWithReceipts = proofProvider.raw.blockProvider.BlockWithReceipts;

export interface CacheStats {
  blockHits: number;
  blockMisses: number;
  txHits: number;
  txMisses: number;
  txBackfilled: number;
}

export class CachingBlockProvider implements BlockProvider {
  private readonly blocks = new Map<number, BlockWithReceipts | null>();
  private readonly txs = new Map<string, TransactionWithRaw | null>();
  private head: number | null = null;

  readonly stats: CacheStats = { blockHits: 0, blockMisses: 0, txHits: 0, txMisses: 0, txBackfilled: 0 };

  constructor(private readonly inner: BlockProvider) {}

  /** Convenience: wrap the SDK's own provider, which is what the fallback path actually uses. */
  static wrapping(rpc: JsonRpcApiProvider): CachingBlockProvider {
    surfaceConstructed('proofProvider.raw.blockProvider.SimpleBlockProvider');
    return new CachingBlockProvider(new proofProvider.raw.blockProvider.SimpleBlockProvider(rpc));
  }

  async getBlockNumber(): Promise<number> {
    // Reaching any of these three methods means the SDK is driving this repo's own implementation
    // of its `BlockProvider` interface — surface 18, and only the local prover ever gets here.
    surfaceWork('proofProvider.raw.blockProvider.BlockProvider (implemented)');
    // The continuity builder asks for the head once per proof; the answer cannot go stale in a
    // way that matters, because every height it is compared against is already historical.
    if (this.head === null) {
      surfaceWork('proofProvider.raw.blockProvider.SimpleBlockProvider');
      this.head = await this.inner.getBlockNumber();
    }
    return this.head;
  }

  async getTransaction(transactionHash: string): Promise<TransactionWithRaw | null> {
    surfaceWork('proofProvider.raw.blockProvider.BlockProvider (implemented)');
    const key = transactionHash.toLowerCase();
    if (this.txs.has(key)) {
      this.stats.txHits += 1;
      return this.txs.get(key) ?? null;
    }
    this.stats.txMisses += 1;
    surfaceWork('proofProvider.raw.blockProvider.SimpleBlockProvider');
    const tx = await this.inner.getTransaction(transactionHash);
    this.txs.set(key, tx);
    return tx;
  }

  async getBlockWithReceipts(blockNumber: number): Promise<BlockWithReceipts | null> {
    surfaceWork('proofProvider.raw.blockProvider.BlockProvider (implemented)');
    if (this.blocks.has(blockNumber)) {
      this.stats.blockHits += 1;
      return this.blocks.get(blockNumber) ?? null;
    }
    this.stats.blockMisses += 1;
    surfaceWork('proofProvider.raw.blockProvider.SimpleBlockProvider');
    const block = await this.inner.getBlockWithReceipts(blockNumber);
    this.blocks.set(blockNumber, block);

    // The back-fill. `getBlockWithReceipts` built these with the same `_wrapTransactionResponse`
    // + raw-authorizationList mapping that `getTransactionWithRaw` uses, so they are the same
    // objects the SDK would otherwise re-fetch individually.
    if (block) {
      for (const tx of block.transactions) {
        const hash = tx.formatted.hash?.toLowerCase();
        if (!hash || this.txs.has(hash)) continue;
        this.txs.set(hash, tx);
        this.stats.txBackfilled += 1;
      }
    }
    return block;
  }

  summary(): string {
    const s = this.stats;
    const saved = s.txHits + s.blockHits;
    return (
      `blocks ${s.blockMisses} fetched / ${s.blockHits} cached · ` +
      `transactions ${s.txMisses} fetched / ${s.txHits} cached (${s.txBackfilled} back-filled from blocks) · ` +
      `${saved} mainnet round-trips avoided`
    );
  }
}
