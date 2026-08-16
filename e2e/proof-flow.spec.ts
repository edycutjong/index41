import { expect, test } from '@playwright/test';

/**
 * The core user journey, and the only one that matters: does the product actually prove ordering?
 *
 * These assertions are deliberately written against INVARIANTS rather than against 14/15/16. If a
 * test hard-coded the indices it would still pass against a page that had hard-coded them too —
 * which is exactly the failure mode this repository exists to avoid. Instead the suite asserts
 * that whatever the chain returned is internally consistent: the off-chain laterality decode
 * agrees with the on-chain emission, and the three positions are strictly increasing.
 */

interface Leg {
  index: number;
  indexFromPath: number;
  agrees: boolean;
  laterality: string;
}
interface Proof {
  provenance: { mode: string; rpc: string; at: string };
  legs: Leg[];
  ruling: { frontIndex: number; victimIndex: number; backIndex: number; harm: string; paid: string };
  harmPaid: { amount: string };
  claim: { status: number; gasUsed: number; gasPercentOfCap: number; logCount: number };
  ordered: boolean;
}

test('GET /api/proof returns a ruling whose two independent decodes agree', async ({ request }) => {
  const res = await request.get('/api/proof');
  expect(res.status()).toBe(200);
  const proof = (await res.json()) as Proof;

  expect(['live-chain-read', 'cached-proof-artifact']).toContain(proof.provenance.mode);
  expect(proof.legs).toHaveLength(3);

  for (const leg of proof.legs) {
    // The whole conceptual claim, checked: position recovered from the SHAPE of the merkle path
    // equals the position the Attestcoin precompile emitted on chain.
    expect(leg.indexFromPath, `laterality ${leg.laterality} must decode to the emitted index`).toBe(leg.index);
    expect(leg.agrees).toBe(true);
  }
});

test('the ruling asserts front < victim < back, and the transaction succeeded', async ({ request }) => {
  const proof = (await (await request.get('/api/proof')).json()) as Proof;

  expect(proof.ruling.frontIndex).toBeLessThan(proof.ruling.victimIndex);
  expect(proof.ruling.victimIndex).toBeLessThan(proof.ruling.backIndex);
  expect(proof.ordered).toBe(true);

  expect(proof.claim.status).toBe(1);
  expect(proof.claim.logCount).toBe(5);
  // Three verifyAndEmit calls in one transaction have to fit under the verifier's own ceiling.
  expect(proof.claim.gasPercentOfCap).toBeLessThan(100);
});

test('harm paid equals harm computed — the bond pays exactly what was proven', async ({ request }) => {
  const proof = (await (await request.get('/api/proof')).json()) as Proof;
  expect(proof.ruling.paid).toBe(proof.ruling.harm);
  expect(proof.harmPaid.amount).toBe(proof.ruling.paid);
  expect(BigInt(proof.harmPaid.amount)).toBeGreaterThan(0n);
});

test('the ledger renders the same three positions the API reports', async ({ page, request }) => {
  const proof = (await (await request.get('/api/proof')).json()) as Proof;
  await page.goto('/');

  const ledger = page.locator('#proof');
  await expect(ledger).toBeVisible();

  const text = await ledger.innerText();
  for (const leg of proof.legs) {
    expect(text, `position ${leg.index} must appear in the ledger`).toContain(String(leg.index));
    // Each row carries its own merkle path as an aria-label; the running bit-by-bit decode panel
    // below the ledger only ever shows the ACTIVE leg, so the labels are where all three live.
    await expect(
      ledger.locator(`[aria-label="merkle path ${leg.laterality}"]`),
      `laterality ${leg.laterality} must be on its own row`,
    ).toHaveCount(1);
  }
});

test('the ledger invents no laterality of its own', async ({ page, request }) => {
  const proof = (await (await request.get('/api/proof')).json()) as Proof;
  await page.goto('/');

  const labels = await page
    .locator('#proof [aria-label^="merkle path "]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace('merkle path ', '')));

  expect(labels).toHaveLength(proof.legs.length);
  expect(new Set(labels)).toEqual(new Set(proof.legs.map((l) => l.laterality)));
});

test('/api/proof is never cached — a re-read is a real read', async ({ request }) => {
  const res = await request.get('/api/proof');
  expect(res.headers()['cache-control']).toContain('no-store');
});
