# BACKLOG

> Known work items, grouped by milestone. Not a task tracker — a durable reference for what's in scope.

## Completed Milestones

- **M1 — Core Instrumentation Engine** ✅ Instrumentor, CallStack, Attribution, Profiler, Storage, Session, dashboard, AJAX, admin bar, route fingerprinting, background profiling, by-reference callback detection.
- **M2 — Deep Mode, Diagnostics, and Timeline** ✅ Timeline visualization, lifecycle phase markers, query profiling, memory observations, enqueued assets, cron inventory, trace explorer, HTTP call lollipops, compare view, pin/annotate/prune.
- **M2.5 — AI Agent API & Secure Sharing** ✅ REST API (6 endpoints), diagnostics collector, hard sanitization, `/v1/prompt`, Application Passwords, "Send to Agent", zero-knowledge relay (AES-256-GCM, R2, capability URLs), "Send to Support", expiry options, passphrase protection, gzip compression, viewer SPA with file upload drop zone.
- **M3 — Compare Workflow** 🚧 _Partial._ Comparison target picker, inline comparison, and per-delta "Difference observed" language are shipped. **Not yet built:** the statistical "Likely Regression" gate (`Report::classify_change()` — ≥5 matched requests, ≥20%+100ms median, ≥3/5 direction) and route-fingerprint baseline matching (`Profiler::route_fingerprint()` / `Report::match_baseline()`); comparison currently keys on the flat `route_key` string. The UI is held to "Difference observed" until the gate exists.
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
