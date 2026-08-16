/**
 * GET /api/proof — re-read the ruling off Creditcoin, on demand.
 *
 * This is what the "re-read the chain" button calls. It performs a real
 * `eth_getTransactionReceipt` against a public CC3 testnet node every time; nothing is memoised.
 * If the node cannot be reached it answers with the captured artifact and says so in
 * `provenance.mode`, so the page can never silently present a recording as a live read.
 */

import { NextResponse } from 'next/server';

import { getProofView } from '@/app/_lib/proof';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const view = await getProofView();
  return NextResponse.json(view, {
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}
