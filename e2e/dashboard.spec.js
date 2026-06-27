import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DASH = '/wp-admin/tools.php?page=scrutinizer';

// Every test fails if the page raised a JS exception during it.
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await use(page);
    expect(errors, 'uncaught JS exceptions during the test').toEqual([]);
  },
});

function expectNoPhpErrors(body) {
  expect(body, 'dashboard surfaced a PHP error').not.toMatch(/Fatal error|Parse error|Warning:|Notice:|Deprecated:/);
}

test('home loads cleanly with the three cards', async ({ page }) => {
  const resp = await page.goto(DASH, { waitUntil: 'networkidle' });
  expect(resp.status()).toBeLessThan(400);
  expectNoPhpErrors(await page.locator('body').innerText());
  await expect(page.locator('#scrutinizer-home-capture')).toBeVisible();
  await expect(page.locator('#scrutinizer-home-profiles')).toBeVisible();
  await expect(page.locator('#scrutinizer-home-settings')).toBeVisible();
});

test('routes view renders rows and the top tabs', async ({ page }) => {
  await page.goto(DASH, { waitUntil: 'networkidle' });
  await page.click('#scrutinizer-home-profiles');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#scrutinizer-route-filter')).toBeVisible();
  await expect(page.locator('#scrutinizer-route-search')).toBeVisible();
  for (const t of ['Routes', 'History', 'Cron', 'API']) {
    await expect(page.getByRole('button', { name: t, exact: true }).first()).toBeVisible();
  }
});

test('History, Cron and API tabs render without PHP errors', async ({ page }) => {
  await page.goto(DASH, { waitUntil: 'networkidle' });
  await page.click('#scrutinizer-home-profiles');
  await page.waitForTimeout(2000);
  for (const t of ['History', 'Cron', 'API', 'Routes']) {
    await page.getByRole('button', { name: t, exact: true }).first().click();
    await page.waitForTimeout(1200);
    expectNoPhpErrors(await page.locator('body').innerText());
  }
});

test('route drill-down opens the profile table and Back returns', async ({ page }) => {
  await page.goto(DASH, { waitUntil: 'networkidle' });
  await page.click('#scrutinizer-home-profiles');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  await page.locator('tbody tr').first().click();
  await expect(page.locator('#scrutinizer-back-to-list').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#scrutinizer-back-to-list').first().click();
  await expect(page.locator('#scrutinizer-route-filter')).toBeVisible({ timeout: 15000 });
});

test('profile detail opens and the timeline tab renders without errors', async ({ page }) => {
  test.setTimeout(90000); // large legacy profiles take a moment to render
  await page.goto(DASH, { waitUntil: 'networkidle' });
  await page.click('#scrutinizer-home-profiles');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  await page.locator('tbody tr').first().click();
  // Open a profile via its "View" action (not a row click).
  await page.locator('#scrutinizer-route-detail a:has-text("View"), #scrutinizer-profile-table a:has-text("View")')
    .first().click({ timeout: 15000 });
  await expect(page.locator('.scrutinizer-pin-toolbar, .scrutinizer-tabs').first()).toBeVisible({ timeout: 25000 });
  // Timeline tab is lazy-loaded; it must render (the page-error fixture guards
  // against the asset-src crash class).
  await page.locator('.scrutinizer-tab[data-tab="timeline"]').first().click();
  await page.waitForTimeout(2500);
  await expect(page.locator('.scrutinizer-tab[data-tab="timeline"]').first()).toHaveClass(/active/);
});

test('route detail shows a regression verdict banner', async ({ page }) => {
  await page.goto(DASH, { waitUntil: 'networkidle' });
  await page.click('#scrutinizer-home-profiles');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  await page.locator('tbody tr').first().click();
  // The banner loads via AJAX; any verdict (incl. insufficient_data) is valid.
  const banner = page.locator('#scrutinizer-route-regression');
  await expect(banner).toBeVisible({ timeout: 15000 });
  await expect(banner).toHaveClass(/verdict-(likely_regression|difference_observed|within_noise|insufficient_data)/);
});

test('settings render and a toggle saves', async ({ page }) => {
  await page.goto(DASH, { waitUntil: 'networkidle' });
  await page.click('#scrutinizer-home-settings');
  await expect(page.locator('#scrutinizer-settings-view')).toBeVisible({ timeout: 15000 });

  // The functional controls are present.
  await expect(page.locator('#scrutinizer-bg-toggle')).toBeVisible();
  await expect(page.locator('#scrutinizer-retention-select')).toBeVisible();

  // Toggling background measurement must fire a save (admin-ajax POST → 200).
  // (The query-profiling toggle is intentionally disabled when SAVEQUERIES is
  // externally defined, so it is not a reliable save target.)
  const bg = page.locator('#scrutinizer-bg-toggle');
  const [resp] = await Promise.all([
    page.waitForResponse((r) => /admin-ajax\.php/.test(r.url()) && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null),
    bg.click({ force: true }),
  ]);
  expect(resp, 'toggling a setting should POST a save to admin-ajax').not.toBeNull();
  expect(resp.status()).toBe(200);

  // Revert host state (toggle back).
  await bg.click({ force: true });
  await page.waitForTimeout(800);
});

test('routes view has no serious accessibility violations', async ({ page }) => {
  await page.goto(DASH, { waitUntil: 'networkidle' });
  await page.click('#scrutinizer-home-profiles');
  await page.waitForTimeout(2500);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
});
