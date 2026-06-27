# BROWSER QA — Plugin dashboard

> A deterministic, on-demand browser-QA runbook for the WordPress admin dashboard. **Any agent or human can run it.** This is **not** a CI gate (by decision — the dashboard is manual-only; the *relay* viewer is the one with automated browser CI). Run it before a release, after dashboard JS/UI changes, or when validating a new dashboard feature.
>
> The relay viewer has its own automated Playwright suite in the `scrutinizer-relay` repo — this runbook is only the plugin dashboard.

## What it proves
The dashboard renders and navigates without PHP errors, JS exceptions, or accessibility violations, across every primary view — home, routes, route drill-down, profile detail tabs, History/Cron/API tabs, and settings (including a save).

## Targets (pick one)

| Target | Use for | How |
|---|---|---|
| **wp-env** | reproducible / repeatable runs (preferred) | `wp-env start`, seed fixtures (below), `SCRUTINIZER_BASE_URL=http://localhost:8888` |
| **Live test host** | exploratory against real data/plugins | `SCRUTINIZER_BASE_URL=https://poc.scrutineer.dev` (Wordfence present; login still works) |

## Prerequisites

```sh
cd scrutinizer
npm install                       # installs @playwright/test + @axe-core/playwright (dev-only; .distignore'd)
npx playwright install chromium   # one-time browser download (cached)
```

Credentials come from the environment — **never hard-code them**:

```sh
export SCRUTINIZER_BASE_URL="http://localhost:8888"   # or the live host
export WP_ADMIN_USER="admin"
export WP_ADMIN_PASS="<password>"                     # wp-env default is "password"
```

## Seed deterministic fixtures (wp-env only)

The dashboard needs profiles to show. For a repeatable run, plant a known set so assertions aren't at the mercy of random data:

```sh
# Generate a handful of profiles by sampling real front-end requests at 100%:
wp-env run cli wp option update scrutinizer_background_profiling 1
wp-env run cli wp option update scrutinizer_sample_rate 100
for u in / /?p=1 /sample-page/; do curl -s "http://localhost:8888$u" >/dev/null; done
wp-env run cli wp option update scrutinizer_sample_rate 10
```

(The live host already has hundreds of real profiles; no seeding needed.)

## Run

```sh
npm run test:e2e          # global-setup logs in once, then runs e2e/*.spec.js
```

A failing step drops a screenshot in `test-results/`. The `e2e/dashboard.spec.js` scaffold automates the checklist below; the checklist is also the manual script if you'd rather click through.

## The checklist (selectors are real; expected outcomes are the pass bar)

| # | Step | Selector / action | Expected |
|---|---|---|---|
| 1 | **Login + dashboard loads** | `/wp-admin/tools.php?page=scrutinizer` | HTTP < 400; **no** `Fatal error` / `Warning:` / `Notice:` in the body |
| 2 | **Home cards** | — | three cards: **Capture Profile** (`#scrutinizer-home-capture`), **View Profiles** (`#scrutinizer-home-profiles`), **Settings** (`#scrutinizer-home-settings`) |
| 3 | **Routes view** | click `#scrutinizer-home-profiles` | a routes table renders `tbody tr` rows; top tabs **Routes / History / Cron / API** (`.scrutinizer-top-tab`); filter `#scrutinizer-route-filter` + search `#scrutinizer-route-search` present |
| 4 | **Route drill-down** | click a route row | route detail (`#scrutinizer-route-detail`) shows that route's profile table (`#scrutinizer-profile-table`, sortable cols); `← Back to routes` (`#scrutinizer-back-to-list`) returns |
| 4b | **Regression verdict banner** | (loads on drill-down) | `#scrutinizer-route-regression` becomes visible with a `verdict-*` class (Likely Regression / Difference observed / Within noise / insufficient-data-shows-just-the-message). Routes with < ~20 profiles show insufficient-data — that's expected |
| 5 | **Profile detail tabs** | click the **View** action on a profile row (not the row itself) | detail shows tabs **Timeline / Breakdown / Sources / Queries / Metadata** (D19, Timeline default); each switches without error. Detail opens fast (~50ms — trace/timeline are lazy); the lazy Timeline tab can take ~1–2s on very large legacy profiles. |
| 6 | **History / Cron / API tabs** | click each top tab | each renders, no PHP error |
| 7 | **Settings + save** | click `#scrutinizer-home-settings` | sections present: Profiling, Background Measurement, Query Profiling, Storage, Profile Retention, Network, Client IP Detection. Toggling `#scrutinizer-qp-toggle` / `#scrutinizer-bg-toggle` persists (AJAX success), no error |
| 8 | **Accessibility** | axe-core on routes + detail + settings | **zero** serious/critical WCAG 2 A/AA violations |
| 9 | **No JS errors** | listen for `pageerror` + `console.error` throughout | none across the whole walkthrough |

## Pass criteria
All green: clean load, every view navigable, settings save, **0** axe violations, **0** JS errors, **0** PHP notices.

**Automation coverage:** the `e2e/dashboard.spec.js` scaffold automates steps **1–4** and **6–9**. Step **5** (individual profile detail) is a manual check by the note above. Last full run against the live host: **6/6 automated green, 0 axe violations, 0 JS errors.**

## Notes / gotchas
- **Login:** two-step (GET sets the test cookie, POST authenticates); the scaffold's `global-setup.js` handles it and persists auth state so specs start logged-in.
- **Live host:** Wordfence is active but does not block the scripted admin login. Settings toggles mutate the host — the scaffold reverts them; revert manually if running by hand.
- **Large profiles:** legacy profiles captured before the per-invocation cap can be multi-MB and slow the detail view — not a bug, but bump the per-test timeout when exercising detail.
