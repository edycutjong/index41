import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the REAL app. There is no demo mode to run in — the page reads a live CC3 receipt
 * and falls back to the captured artifact, and both are real, so the suite asserts on invariants
 * that hold either way (the decoded indices must be strictly increasing; the banner must name the
 * source it actually used) rather than on frozen literals.
 *
 * Zero config: no .env, no key, no wallet. `npm run build && npm run e2e` is the whole story.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  // The landing page performs a live JSON-RPC round trip before its first paint.
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run start -- --port 3000 --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000/judge',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
