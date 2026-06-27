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

## M5.6 — Cron Profiling Integration

Connect the cron inventory to actual profiler data. The profiler already captures cron-triggered requests via background profiling — surface that data in the cron view.

- [ ] Per-hook cost column — cross-reference cron hooks with trace data from profiled cron requests, show exclusive time per hook
- [ ] Click-through to performance history — cron hook row links to filtered profile list for that hook
- [ ] Trend line per hook — sparkline showing cost over recent executions
- [ ] Worst execution highlight — flag hooks whose cost has spiked

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
- [ ] Wrap all JS dashboard strings in `wp.i18n.__()`
- [ ] Wrap remaining PHP strings in `__()` / `esc_html__()`
- [ ] Generate `.pot` file
- [ ] Set up `wp_set_script_translations()` loading
- [ ] Create `languages/` directory with `.pot`

### a11y
- [ ] Escape key closes settings modal
- [ ] Keyboard reachability audit — nothing trapped or unreachable
- [ ] Full ARIA tab panel pattern with arrow key navigation
- [ ] Focus trap in settings modal
- [ ] Screen reader announcements for dynamic content

### Visual polish
- [ ] Tab active-state consistency (blue underline vs dark border)

### Code / infra
- [ ] Relay viewer — add Content-Security-Policy header
- [ ] wp.org plugin readme (readme.txt with screenshots, FAQ, changelog)
- [ ] Screenshot preparation
- [ ] Security audit — activation flow, cookie handling, CSRF, nonce validation
- [ ] wp.org submission

## Direction (not scheduled) — Core-developer troubleshooting

Exploratory direction, not committed scope. The pitch: serve people troubleshooting **WordPress core itself** (not plugins) by breaking open the single "core" attribution bucket. **Hard constraint:** every item below must obey the Constitution's output boundary — *aggregates only, never contents.* Object-cache inspection is explicitly out (D42). If any of this ships, attribution comes first; it's the foundation the rest renders on.

- **Subsystem attribution (foundation).** Map a core callback's file to a subsystem (`class-wp-query.php` → Query, `option.php` → Options/autoload, `l10n.php` → i18n, `block-*.php` → Blocks, `rest-api/*` → REST) so "core 180ms" becomes "Query 40ms, i18n 22ms, Blocks 18ms." Mostly a path→subsystem lookup over data already captured.
- **Cross-build comparison.** Compare the same route across WP builds / PHP versions (the route fingerprint already records both). **Design note:** build/version is a *comparison axis*, NOT a fingerprint dimension — folding it into the match key would stop trunk and 6.7 profiles from matching. It's a second baseline strategy alongside the shipped recent-vs-older window. Stretch: stamp the core git SHA when WP runs from a checkout → bisect a regression to a commit.
- **Boot-sequence breakdown.** Split pre-plugin `bootstrap_ns` into phases (textdomain load, must-use, drop-ins) — the part a core dev actually cares about.
- **Dev-signal surfacing.** Hook `deprecated_function_run` / `deprecated_hook_run` / `doing_it_wrong` and attach the call site (aggregate count + location, not values).
- **i18n JIT visibility.** Surface `_load_textdomain_just_in_time` triggers (which textdomain, which hook) — a real core perf topic, tappable via textdomain-load hooks without wrapping every `__()`.

Deliberately **excluded**: object-cache instrumentation (D42), any query-value/content inspection (D41).
