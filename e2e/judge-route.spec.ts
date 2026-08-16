import { expect, test } from '@playwright/test';

/**
 * `/judge` is the page built for exactly one reader. A judge surface that 404s, redirects to a
 * login, or quietly loses its receipt on submission day is worse than not having one — so it gets
 * its own suite, and every test here runs with no credentials and no session.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test('/judge is 200 with no credentials, no cookies and no redirect', async ({ page }) => {
  const res = await page.goto('/judge');
  expect(res?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/judge');
});

test('/judge carries the one-sentence claim', async ({ page }) => {
  await page.goto('/judge');
  await expect(
    page.getByText(/proves transaction A executed before transaction B inside an Ethereum block/i),
  ).toBeVisible();
});

test('the receipt block shows live-sourced numbers, not placeholders', async ({ page, request }) => {
  const proof = (await (await request.get('/api/proof')).json()) as {
    legs: Array<{ index: number; laterality: string }>;
    claim: { gasUsed: number };
    harmPaid: { amount: string };
  };

  await page.goto('/judge');
  const body = await page.locator('main').innerText();

  for (const leg of proof.legs) {
    expect(body).toContain(leg.laterality);
    expect(body).toContain(String(leg.index));
  }
  expect(body).toContain(proof.claim.gasUsed.toLocaleString('en-US'));
  expect(body).toContain(Number(proof.harmPaid.amount).toLocaleString('en-US'));
});

test('the reproduce block contains no kill-switch flag', async ({ page }) => {
  await page.goto('/judge');
  const body = await page.locator('main').innerText();
  // R10: the command a judge is handed must not be the command that disables the product.
  expect(body).not.toMatch(/OFFLINE=1|MOCK=|MOCK_MODE|USE_MOCK|DEMO_MODE=1|--dry-run/);
  expect(body).toMatch(/npm run dev/);
});

test('/judge states honest limitations rather than only claims', async ({ page }) => {
  await page.goto('/judge');
  await expect(page.getByRole('heading', { name: /what this does not do/i })).toBeVisible();
  await expect(page.getByText(/cannot prove state/i)).toBeVisible();
});

test('every /judge link has a destination', async ({ page }) => {
  await page.goto('/judge');
  const hrefs = await page.locator('main a').evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute('href')),
  );
  expect(hrefs.length).toBeGreaterThan(10);
  for (const href of hrefs) {
    expect(href, 'no empty or placeholder hrefs').toBeTruthy();
    expect(href).not.toMatch(/^#$|example\.com|OWNER\/REPO|your-/);
  }
});
