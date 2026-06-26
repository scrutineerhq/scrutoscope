# BACKLOG

> Known work items, grouped by milestone. Not a task tracker — a durable reference for what's in scope.

## M1 — Core Instrumentation Engine ✅ Complete

- [x] `Instrumentor::wrap_hooks()` — iterate `$wp_filter`, wrap each callback with timing bookends
- [x] `CallStack` — push/pop with `hrtime(true)`, exclusive time accumulation on parent frames
- [x] `Attribution::resolve()` — callback → file path → plugin/theme/core classification, memoized
- [x] `Profiler::finalize()` — compute Server Request Duration, unattributed time, build profile
- [x] `Storage::save_profile()` — JSON profile insert with route fingerprint
- [x] `Session` — activation URL generation, HMAC verification, cookie lifecycle
- [x] Dashboard — start/stop controls, Server Request Duration display, plugin summary table
- [x] AJAX — start, stop, delete handlers with nonce + capability checks
- [x] Admin bar indicator — green dot during active profiling
- [x] Route fingerprinting — coarse match key (route class + frontend/admin + anon/auth + cache state)
- [x] Decision tree entry point — "Slow admin? Logged-in? Visitors?" flow
- [x] Background profiling — probabilistic sampling with configurable rate
- [x] Page grouping — route_key normalization for grouped route view
- [x] By-reference callback detection — skip callbacks with `&$param` via Reflection

## M2 — Deep Mode, Diagnostics, and Timeline ✅ Complete

- [x] Request timeline — horizontal bar visualization, plugin-colored segments, lifecycle phase markers
- [x] Lifecycle phase markers — hrtime snapshots at 25 WP hooks (early boot through shutdown)
- [x] Lollipop milestone markers — tiered vertical stem + dot + label, overlap prevention
- [x] Deep mode: query detail — individual SQL queries with time and caller via SAVEQUERIES
- [x] Query profiling toggle — auto-enable SAVEQUERIES, three-state UI (controllable/forced on/forced off)
- [x] Query sanitization — structure-preserving, replaces literals with placeholders, collapses IN/VALUES
- [x] Query count metric card — always via $wpdb->num_queries
- [x] User role capture — wp_get_current_user() per request, role pill badges
- [x] Metric cards — Server Request Duration, memory, queries, callbacks
- [x] Tabbed detail view — Timeline, Breakdown, Sources, Queries, Metadata, History
- [x] Weight glyphs — thin inline progress bars on source table rows
- [x] Unattributed time tooltip — tap-toggle button+bubble (mobile-friendly)
- [x] Breakdown bar color fix — inline colors from sourceColors map, consistent bar+legend
- [x] Pin/Annotate/Prune — toolbar per profile
- [x] History tab — filter by route, tag, date range, pinned-only
- [x] Compare view — side-by-side profile deltas
- [x] Cache-busting version via filemtime()
- [x] Memory observations — `memory_get_usage()` deltas per callback, peak + allocated in summary, dashboard cards + per-source columns
- [x] Enqueued assets inventory — script/style handles, sizes, dependencies, inline detection, handle-based attribution
- [x] Cron inventory — scheduled events, overdue/duplicate indicators
- [x] Hook Execution Trace — nested callback visualization with collapsible tree, filter, timing bars
- [x] Network call timeline — HTTP call lollipops (individual markers), query density heatmap strip (60-bucket clustering), I/O summary counts

## M2.5 — AI Agent API & Secure Sharing

Full spec at `workspace/your_files/scrutineer-api-spec.md`. Panel review at `workspace/your_files/scrutineer-api-panel-review.md`.

### API Foundation ✅ Complete
- [x] REST API endpoint registration (`/v1/prompt`, `/v1/diagnostics`, `/v1/routes`, `/v1/profile/{id}`, `/v1/compare/{a}/{b}`)
- [x] Diagnostics data collector (§4.1 always-included + §4.2 opt-in fields)
- [x] Hard sanitization pass (§4.3 — paths, creds, IPs stripped before any output)
- [x] Diagnostics sharing checkbox panel + WP option storage
- [x] `/v1/prompt` content — measurement contract, tone rules, endpoint schemas, boundaries
- [x] Scoped auto-created Application Passwords (§6 — 24h TTL, restricted to scrutinizer/v1/*)
- [x] "Send to Agent" button — auto-creates password, copies one-liner to clipboard

### Secure Sharing Relay ✅ Complete
- [x] scrutinizer.dev CF Worker — R2 storage, capability URLs
- [x] Client-side AES-256-GCM encryption (Web Crypto API, key in URL fragment)
- [x] Relay endpoints: POST /r/, GET /r/{id}, GET /r/{id}/data, DELETE /r/{id}
- [x] "Send to Support" button — encrypt + upload + display share URL
- [x] Expiry options (1/7/14/30 days + expire-after-reading)
- [x] Optional passphrase protection (PBKDF2 key wrapping)
- [x] Gzip before encryption (CompressionStream/DecompressionStream)

### Report Viewer (Studio) ✅ Complete
- [x] Standalone SPA at scrutinizer.dev — full dashboard experience, read-only
- [x] Client-side decryption + decompression flow
- [x] Guidance header ("How to read this report" + security warning)
- [x] Error states (missing fragment, expired, wrong passphrase, corrupted)
- [x] Responsive design, dark/light mode
- [x] File upload drop zone at scrutinizer.dev/view (D39)
- [x] Referrer-Policy: no-referrer

## M3 — Compare Workflow & Regression Language

Comparison infrastructure exists (M2 compare view). This milestone improves the workflow — making it easy to pick comparison targets and adding guardrails to the language used.

- [x] Comparison target picker — select any pinned profile as the "compare against" reference from the detail view
- [x] Route-matched suggestions — when viewing a profile, suggest pinned profiles on the same route as comparison candidates
- [x] Inline comparison — expand delta view within the profile detail, not just side-by-side
- [x] Regression language enforcement — "slower" not "slow," "associated with" not "caused by," "correlated" not "caused"
- [x] Delta thresholds — highlight meaningful changes (>20% and >100ms), downplay noise (<5% or <10ms)
- [x] Schema cleanup — drop `is_baseline` and `baseline_name` columns (cruft from an earlier design that was never implemented)

## M4 — Report Sharing (ABSORBED into M2.5)

Sharing architecture redesigned June 23, 2026. Zero-knowledge relay pulled into Phase 1 (was Phase 2). Phase C improvements shipped June 25, 2026:
- [x] Gzip before encryption (CompressionStream/DecompressionStream)
- [x] KV → R2 migration for report storage (10MB limit)
- [x] File upload drop zone at scrutinizer.dev/view (D39)
- [x] Viewer branding: "Scrutinizer Report" + mono wordmark + Scrutineer teal
- [x] HTTP Calls, Autoloaded Options, and Enqueued Assets tabs in viewer
- [x] Timeline segment tooltips with callback name and duration
- [x] Share data enrichment: timeline ms conversion, trace parsing, HTTP calls flattening

## M5 — WP-CLI ✅ Complete

- [x] WP-CLI: `wp scrutinizer list` — list saved profiles with filters
- [x] WP-CLI: `wp scrutinizer show <id>` — display profile detail
- [x] WP-CLI: `wp scrutinizer delete <id>` — delete profile
- [x] WP-CLI: `wp scrutinizer export <id>` — export profile as JSON
- [x] WP-CLI: `wp scrutinizer clear` — delete all profiles
- [x] WP-CLI: `wp scrutinizer status` — profiler state summary
- [x] WP-CLI: `wp scrutinizer mu-plugin` — install/remove/status early boot mu-plugin

## M5.5 — Data Lifecycle & Share Management

### Shared Reports Manager
- [x] Shared reports ledger — track all shared reports (relay URL, expiry, creation date, source profile ID)
- [x] "My Shared Reports" view in the API tab — list active shares with status, expiry countdown, and link
- [x] Revoke/expire shared reports from the ledger (DELETE to relay)
- [x] Re-copy share link from the ledger (link persists after initial share)
- [x] Share button should not hide the link — ledger is the durable record

### Profile TTL & Expiry
- [x] Default 7-day TTL on profiles — auto-prune expired profiles via WP-Cron
- [x] Pinned profiles exempt from TTL (pin = keep forever)
- [x] Shared profiles exempt from TTL (or extend to match share expiry)
- [x] TTL indicator in History tab — show time remaining, highlight expiring-soon (e.g. <24h)
- [x] Settings: configurable default TTL (7d/14d/30d/never)
- [x] Clear visual language: pin to keep, share to export, everything else expires

## M5.6 — Cron Profiling Integration

Connect the cron inventory to actual profiler data. The profiler already captures cron-triggered requests via background profiling — surface that data in the cron view.

- [ ] Per-hook cost column — cross-reference cron hooks with trace data from profiled cron requests, show exclusive time per hook
- [ ] Click-through to performance history — cron hook row links to filtered profile list for that hook
- [ ] Trend line per hook — sparkline showing cost over recent executions
- [ ] Worst execution highlight — flag hooks whose cost has spiked

## M6 — Polish and wp.org Submission

### Panel Review Findings (June 25, 2026)
Code review: `workspace/your_files/scrutineer-panel-review-june25.md`
Visual review: `workspace/your_files/scrutineer-visual-review-june25.md`

#### Critical (blocks launch)
- [x] `uninstall.php` — clean up DB tables (profiles, api_log), options, cron events, app passwords, transients
- [x] Delete empty `includes/Share/` directory
- [x] Delete duplicate `includes/CLI/` (correct path is `includes/Cli/`)

#### High — i18n (1.0 requirement, decided June 25)
- [ ] Wrap all JS dashboard strings in `wp.i18n.__()`
- [ ] Wrap remaining PHP strings in `__()` / `esc_html__()`
- [ ] Generate `.pot` file
- [ ] Set up `wp_set_script_translations()` loading
- [ ] Create `languages/` directory with `.pot`

#### High — a11y (functional bar for 1.0, full WCAG AA in 1.1)
- [ ] Fix contrast on hint text, card subtitles, "Clear filters" link
- [ ] Escape key closes settings modal
- [ ] Keyboard reachability audit — nothing trapped or unreachable
- [ ] (1.1) Full ARIA tab panel pattern with arrow key navigation
- [ ] (1.1) Focus trap in settings modal
- [ ] (1.1) Screen reader announcements for dynamic content

#### High — code fixes
- [x] `handle_prompt` — replace raw `echo`/`exit` with proper WP REST response
- [x] API access log — move from `wp_options` to new `wp_scrutinizer_api_log` table
- [ ] Relay viewer — add Content-Security-Policy header
- [x] Cron registration — avoid re-registering on every `plugins_loaded`

#### Visual polish
- [x] Timeline milestone label clipping at edges
- [ ] Tab active-state consistency (blue underline vs dark border)
- [x] Queries tab "—" source pill → meaningful label ("Core" or "Unattributed")
- [x] Borderline contrast fixes on secondary text elements

#### Existing items
- [ ] i18n .pot generation
- [ ] wp.org plugin readme (readme.txt with screenshots, FAQ, changelog)
- [ ] Screenshot preparation
- [ ] Security audit — activation flow, cookie handling, CSRF, nonce validation
- [ ] Hosted infrastructure — Workers, R2, D1, DO, KV, WAF at scrutineer.dev
- [ ] wp.org submission

## Phase 2 — Triage (Secure DX)

Not scoped for Phase 1. Separate plugin (`Triage Secure DX`), separate wp.org listing.

- E2E encrypted diagnostic handoff
- Ed25519 keypair model (single shared key default)
- Signed request envelopes at scrutineer.dev/req/{id}
- Scope catalog with per-subscope toggle
- Scrub + encrypt locally before upload
- Go CLI + local Studio SPA
- Embedded launcher pattern for plugin devs

## Phase 3 — Scrutiny (Analytics)

Not scoped for Phase 1. Separate SDK.

- `Scrutiny::bumpCounter()`, `Scrutiny::setState()`, `Scrutiny::sample()`
- HITL consent — nonce-gated, 5-deferral limit, per-plugin
- Local aggregation + daily flush
- Schema-first metric declarations
- Cardinality enforcement
