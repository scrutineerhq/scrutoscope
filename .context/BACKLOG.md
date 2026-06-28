# BACKLOG

> Known work items, grouped by milestone. Not a task tracker — a durable reference for what's in scope.

## Completed Milestones

- **M1 — Core Instrumentation Engine** ✅ Instrumentor, CallStack, Attribution, Profiler, Storage, Session, dashboard, AJAX, admin bar, route fingerprinting, background profiling, by-reference callback detection.
- **M2 — Deep Mode, Diagnostics, and Timeline** ✅ Timeline visualization, lifecycle phase markers, query profiling, memory observations, enqueued assets, cron inventory, trace explorer, HTTP call lollipops, compare view, pin/annotate/prune.
- **M2.5 — AI Agent API & Secure Sharing** ✅ REST API (6 endpoints), diagnostics collector, hard sanitization, `/v1/prompt`, Application Passwords, "Send to Agent", zero-knowledge relay (AES-256-GCM, R2, capability URLs), "Send to Support", expiry options, passphrase protection, gzip compression, viewer SPA with file upload drop zone.
- **M3 — Compare Workflow + Regression Detection** ✅ _Shipped this cycle._ Comparison picker + inline compare; the statistical classifier (`Report::classify_change()` — a 3-threshold verdict, **detection not enforcement**, see D43), route-fingerprint matching (`route_fingerprint()` / `match_samples()` / `compare_route()`), `GET /v1/regression` + the dashboard AJAX, and the route-detail **verdict banner**. The two-profile compare view stays at "Difference observed" (a single comparison); only the multi-sample classifier asserts the stronger verdict.

## M3.5 — Long-term stats aggregate

Regression detection reads stored profiles, which roll off at the 7-day TTL — so the raw path can only compare **inside** that window. The aggregate decouples the signal from the samples (tiny mergeable histograms survive after the raw profiles expire).

- [x] **Capture** — `RouteStats` mergeable duration histogram + a `scrutinizer_route_stats` (fingerprint, day) table; recorded on save (best-effort); `wp scrutinizer rebuild-stats` backfill. Pure aggregate (output-boundary clean), persists past the profile TTL.
- [x] **Classifier reads windows** — `classify_histograms()` + `Regression::for_route()` read merged aggregate windows (recent vs an older baseline), falling back to raw when history is thin, so the verdict works **across deploys**, not just within 7 days. Quantiles come from the merged histogram; thresholds/direction unchanged.
- [ ] **Aggregate retention** — keep daily buckets for months (a few MB/year); prune very old.
- [ ] **Trends** — long-term sparklines from the aggregate after profiles expire (folds in the M5.6 trend items).
- **M4 — Report Sharing** ✅ Absorbed into M2.5. Share data enrichment, viewer tabs (HTTP Calls, Autoloaded Options, Enqueued Assets), timeline segment tooltips, viewer branding.
- **M5 — WP-CLI** ✅ 7 subcommands: list, show, delete, export, clear, status, mu-plugin.
- **M5.5 — Data Lifecycle & Share Management** ✅ Shared reports ledger (save/get/delete/revoke), profile TTL (7d default, configurable), pinned + shared exempt from cleanup, TTL badges in History tab.
- **UX Panel** ✅ 18/18 findings implemented.

## M5.6 — Cron Profiling Integration ✅ Shipped in 1.2.0 (opt-in)

Connect the cron inventory to actual profiler data, surfaced in the cron view.

- [x] **Opt-in capture** — Settings → "Profile Cron Jobs" lifts the WP-Cron sampling exclusion (cron is normally skipped). Cron hook names are snapshotted at request start, since single events vanish from the cron array once they fire.
- [x] **Per-hook cost column** — exclusive time per hook from profiled cron runs, with the worst (peak) run flagged. Stored in a bounded `scrutinizer_cron_hook_costs` option (last/max/runs per hook, capped at 50).
- [ ] Click-through to per-hook profile history (deferred)
- [ ] Trend line per hook + statistical spike detection (deferred)

## M6 — Polish and wp.org Submission

### Done
- [x] `uninstall.php` — clean up DB tables (profiles, api_log), options, cron events, app passwords, transients
- [x] Delete empty `includes/Share/` directory
- [x] Delete duplicate `includes/CLI/` (correct path is `includes/Cli/`)
- [x] `handle_prompt` — replace raw `echo`/`exit` with proper WP REST response
- [x] API access log — move from `wp_options` to new `wp_scrutinizer_api_log` table
- [x] Cron registration — avoid re-registering on every `plugins_loaded`
- [x] Timeline milestone label clipping at edges
- [x] Queries tab "—" source pill → meaningful label ("Core" or "Unattributed")
- [x] Contrast fixes on secondary text elements

### i18n
- [x] Generate `.pot` file + `languages/` directory
- [x] Set up `wp_set_script_translations()` loading; dashboard reads `scrutinizerAdmin.i18n.*`
- [x] **JS dashboard strings wrapped for translation** — all user-facing JS strings now go through `wp.i18n` `__()`/`sprintf()` (swept incrementally during the timeline/dashboard work; the last block, the Query Profiling details panel, wrapped in the 1.1.0 release prep). Verified: 0 unwrapped inline UI strings remain.
- [x] PHP strings wrapped in `__()` / `esc_html__()`.
- [x] `.pot` regenerated (510 msgids, no warnings). JS translation JSON is left to WordPress.org language packs post-release (the standard path) rather than shipping generated `-js.json` files.

### a11y
- [x] Escape key closes settings (verified — already works)
- [x] Keyboard reachability audit
- [x] Full ARIA tab pattern with arrow-key navigation (top + detail tabs)
- [x] Focus management on view changes + screen-reader announcements (`aria-live`)
- [~] "Focus trap in settings modal" — settings is a view, not a modal; focus is moved into it on open. Trap N/A.

### Visual polish
- [ ] Tab active-state consistency (blue underline vs dark border)

### Code / infra
- [x] Relay viewer Content-Security-Policy header (nonce-based CSP via `withSecurityHeaders`)
- [x] wp.org plugin readme (`readme.txt` present — header/description/FAQ/changelog/screenshots)
- [x] Security audit — authz/CSRF, injection, data-exposure, instrumentation (5 fixes, incl. the XML-RPC app-password bypass)
- [x] **Submission-readiness review addressed** (`.context/reviews/submission-readiness-review.md`) — early-boot MU plugin made opt-in (Settings toggle + dismissable banner + CLI); `SAVEQUERIES`/query profiling defaulted off; External Services disclosure + readme accuracy; agent prompt + manifest docs aligned with host-only HTTP; `unlink()` → `wp_delete_file()`. Shipped as 1.1.0.
- [ ] Screenshot preparation (delegated — capture against fresh traffic on the 1.2.0 UI)
- [ ] Manual keyboard / screen-reader QA pass (axe-core clean across all views; best-effort)
- [ ] wp.org submission (after the above + beta QA; flip beta → final `v1.2.0` tag)

> **Remaining before submission:** refreshed screenshots + a manual keyboard/SR pass, then beta QA. Released as betas `v1.1.0-beta.1` (trust/readiness) and `v1.2.0-beta.1` (lightweight capture mode + cron profiling).

## Core-developer troubleshooting — mostly shipped in 1.1.0

Serve people troubleshooting **WordPress core itself** (not plugins) by breaking open the single "core" attribution bucket. **Hard constraint:** every item obeys the Constitution's output boundary — *aggregates only, never contents.* Object-cache inspection is explicitly out (D42).

- [x] **Subsystem attribution (foundation).** ✅ 1.1.0. Maps a core callback's file to a subsystem (`class-wp-query.php` → Query, `option.php` → Options, `l10n.php` → i18n, `block-*.php` → Blocks, `rest-api/*` → REST), so "core 180ms" becomes a per-subsystem breakdown (Sources tab + relay).
- [x] **Boot-sequence breakdown.** ✅ 1.1.0. Splits pre-plugin `bootstrap_ns` into must-use vs. active-plugin loading (the early mu-plugin captures `muplugins_loaded`). Honest about what's hookable.
- [x] **Dev-signal surfacing.** ✅ 1.1.0. Hooks `deprecated_*` / `_doing_it_wrong()` and attaches the triggering source (aggregate count + source, never values).
- [x] **i18n JIT visibility.** ✅ 1.1.0. Surfaces `_load_textdomain_just_in_time` loads with the lifecycle hook that triggered each.
- [ ] **Cross-build comparison.** *Skipped (per product call).* Compare the same route across WP builds / PHP versions. **Design note for later:** build/version is a *comparison axis*, NOT a fingerprint dimension — folding it into the match key would stop trunk and 6.7 profiles from matching.

Deliberately **excluded**: object-cache instrumentation (D42), any query-value/content inspection (D41).

Deliberately **excluded**: object-cache instrumentation (D42), any query-value/content inspection (D41).
