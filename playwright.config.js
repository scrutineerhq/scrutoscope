import { defineConfig, devices } from '@playwright/test';

/**
 * Manual browser-QA config for the Scrutinizer dashboard. Not a CI gate — run
 * on demand against either a wp-env instance or the live test host. See
 * .context/BROWSER_QA.md for the runbook.
 *
 * Target is chosen by env:
 *   SCRUTINIZER_BASE_URL  (default http://localhost:8888 — wp-env dev)
 *   WP_ADMIN_USER         (default admin)
 *   WP_ADMIN_PASS         (required; never hard-coded)
 */
const baseURL = process.env.SCRUTINIZER_BASE_URL || 'http://localhost:8888';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: 'e2e/.auth/state.json',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
