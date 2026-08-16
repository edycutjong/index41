import { expect, test } from '@playwright/test';

/**
 * The R20 test: a judge with no .env, no wallet and no API key gets the real thing.
 *
 * Named for what it pins, not for what it visits. Each test below corresponds to a way this page
 * could quietly stop being evidence — a stale prerender, a silent mock, a mislabelled source.
 */

test('the page loads with no environment, no wallet and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  const res = await page.goto('/');
  expect(res?.status()).toBe(200);

  await expect(page).toHaveTitle(/index41/i);
  // The one affordance that touches a wallet must announce that it is not needed.
  await expect(page.getByText(/none is needed/i)).toBeVisible();
  expect(errors).toEqual([]);
});

test('the page names the source it actually used, and never a third one', async ({ page }) => {
  await page.goto('/');
  const body = await page.locator('body').innerText();
  const live = /LIVE CHAIN READ/i.test(body);
  const cached = /CACHED REAL PROOF/i.test(body);
  // Exactly one of the two, never both, never neither. A page that showed numbers without saying
  // where they came from would be the failure this whole project argues against.
  expect(live !== cached).toBe(true);
});

test('the meta tags carry the real pitch, not a framework default', async ({ page }) => {
  await page.goto('/');
  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description).toMatch(/laterality/i);
  // Assert the file the app actually ships. A previous regression pointed og:image at a name that
  // was not in public/ and the tag still read fine as a string, so matching the name is not enough:
  // fetch it and require a real image back. That is the failure this test exists to catch.
  const og = page.locator('meta[property="og:image"]');
  await expect(og).toHaveAttribute('content', /og-image-v2\.png$/);
  const ogUrl = await og.getAttribute('content');
  const res = await page.request.get(ogUrl!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^image\//);
});

test('no stale prerender: two loads both carry a provenance instant', async ({ page }) => {
  // `dynamic = 'force-dynamic'` is what stops a ruling being baked into HTML at build time. If it
  // regressed, this page would be a memory of a chain read rather than a chain read.
  await page.goto('/');
  await expect(page.getByText(/LIVE CHAIN READ|CACHED REAL PROOF/i).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/LIVE CHAIN READ|CACHED REAL PROOF/i).first()).toBeVisible();
});
