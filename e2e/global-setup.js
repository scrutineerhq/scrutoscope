import { chromium } from '@playwright/test';
import fs from 'fs';

/**
 * Log into wp-admin once and persist the auth state so specs start
 * authenticated. Fails loudly if login is blocked (bad creds, Wordfence, etc.).
 */
export default async function globalSetup() {
  const baseURL = process.env.SCRUTINIZER_BASE_URL || 'http://localhost:8888';
  const user = process.env.WP_ADMIN_USER || 'admin';
  const pass = process.env.WP_ADMIN_PASS;
  if (!pass) {
    throw new Error('Set WP_ADMIN_PASS (and SCRUTINIZER_BASE_URL) — see .context/BROWSER_QA.md');
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ ignoreHTTPSErrors: true });

  // Two-step: GET sets the test cookie, POST authenticates.
  await page.goto(baseURL + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  await page.fill('#user_login', user);
  await page.fill('#user_pass', pass);
  await page.click('#wp-submit');
  await page.waitForLoadState('networkidle');

  const failed = await page.locator('#login_error').count();
  if (failed || !/\/wp-admin\/?/.test(page.url())) {
    const err = await page.locator('#login_error').innerText().catch(() => '(none)');
    await browser.close();
    throw new Error(`wp-admin login failed at ${page.url()} — ${err}`);
  }

  fs.mkdirSync('e2e/.auth', { recursive: true });
  await page.context().storageState({ path: 'e2e/.auth/state.json' });
  await browser.close();
}
