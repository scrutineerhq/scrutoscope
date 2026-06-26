# BACKLOG

> Known work items, grouped by milestone. Not a task tracker — a durable reference for what's in scope.

## Completed Milestones

- **M1 — Core Instrumentation Engine** ✅ Instrumentor, CallStack, Attribution, Profiler, Storage, Session, dashboard, AJAX, admin bar, route fingerprinting, background profiling, by-reference callback detection.
- **M2 — Deep Mode, Diagnostics, and Timeline** ✅ Timeline visualization, lifecycle phase markers, query profiling, memory observations, enqueued assets, cron inventory, trace explorer, HTTP call lollipops, compare view, pin/annotate/prune.
- **M2.5 — AI Agent API & Secure Sharing** ✅ REST API (6 endpoints), diagnostics collector, hard sanitization, `/v1/prompt`, Application Passwords, "Send to Agent", zero-knowledge relay (AES-256-GCM, R2, capability URLs), "Send to Support", expiry options, passphrase protection, gzip compression, viewer SPA with file upload drop zone.
- **M3 — Compare Workflow** ✅ Comparison target picker, route-matched suggestions, inline comparison, regression language enforcement, delta thresholds, schema cleanup.
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
