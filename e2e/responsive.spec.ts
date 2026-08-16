import { expect, test } from '@playwright/test';

/**
 * The evidence on this page is dense — long hashes, an 8-column laterality table, a merkle sibling
 * list. Dense evidence is exactly what breaks a narrow viewport, and a judge on a phone who gets a
 * horizontally-scrolling page reads it as a project that was never opened on a phone.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  for (const path of ['/', '/judge']) {
    test(`${path} does not scroll horizontally at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // Wide tables are allowed to scroll INSIDE their own container; the document must not.
      expect(overflow, 'the page body must never scroll sideways').toBeLessThanOrEqual(1);
    });
  }
}

test('interactive controls stay tappable at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');

  const buttons = page.locator('button:visible');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox();
    if (!box) continue;
    expect(box.height, `button ${i} is too short to tap`).toBeGreaterThanOrEqual(28);
  }
});

test('the header fits the viewport at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const header = page.locator('header').first();
  const box = await header.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(375);
});
