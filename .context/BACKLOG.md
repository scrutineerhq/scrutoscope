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

## M2 — Deep Mode, Diagnostics, and Timeline (current)

- [x] Request timeline — horizontal bar visualization, plugin-colored segments, lifecycle phase markers
- [x] Lifecycle phase markers — hrtime snapshots at 25 WP hooks (early boot through shutdown)
- [x] Lollipop milestone markers — tiered vertical stem + dot + label, overlap prevention
- [x] Deep mode: query detail — individual SQL queries with time and caller via SAVEQUERIES
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
- [ ] Network call lollipops — lower-tier timeline markers for HTTP calls (`wp_remote_*`), DB queries, and filesystem network ops (FTP/SSH/SFTP via `WP_Filesystem` abstraction) showing duration + target

## M2.5 — AI Agent API & Secure Sharing (NEW — designed June 23, 2026)

Full spec at `workspace/your_files/scrutineer-api-spec.md`. Panel review at `workspace/your_files/scrutineer-api-panel-review.md`.

### API Foundation
- [ ] REST API endpoint registration (`/v1/prompt`, `/v1/diagnostics`, `/v1/routes`, `/v1/profile/{id}`, `/v1/compare/{a}/{b}`)
- [ ] Diagnostics data collector (§4.1 always-included + §4.2 opt-in fields)
- [ ] Hard sanitization pass (§4.3 — paths, creds, IPs stripped before any output)
- [ ] Diagnostics sharing checkbox panel + WP option storage
- [ ] `/v1/prompt` content — measurement contract, tone rules, endpoint schemas, boundaries
- [ ] Scoped auto-created Application Passwords (§6 — 24h TTL, restricted to scrutinizer/v1/*)
- [ ] "Send to Agent" button — auto-creates password, copies one-liner to clipboard

### Secure Sharing Relay
- [ ] scrutinizer.dev CF Worker — KV storage, capability URLs
- [ ] Client-side AES-256-GCM encryption (Web Crypto API, key in URL fragment)
- [ ] Relay endpoints: POST /r/, GET /r/{id}, GET /r/{id}/data, DELETE /r/{id}
- [ ] "Send to Support" button — encrypt + upload + display share URL
- [ ] Expiry options (1/7/14/30 days + expire-after-reading)
- [ ] Shared Reports management panel (list active shares, one-click revoke)
- [ ] Optional passphrase protection (PBKDF2 key wrapping, minimum strength)

### Report Viewer (Studio)
- [ ] Standalone SPA at scrutinizer.dev — full dashboard experience, read-only
- [ ] Client-side decryption flow
- [ ] Guidance header ("How to read this report" + security warning)
- [ ] Error states (missing fragment, expired, wrong passphrase, corrupted)
- [ ] Responsive design, dark/light mode, print-friendly
- [ ] Referrer-Policy: no-referrer

### TODO
- [ ] Add PANEL.md to .context/ with standing review panel personas

## M3 — Baselines and Regression Language

- [ ] Named baselines — save current profile set as a named reference
- [ ] Route-matched comparison — match by fingerprint, not URL
- [ ] Regression classification — 5+ matches, 20%+100ms, 3/5 consistent
- [ ] Compare view — side-by-side timeline, delta summary
- [ ] Messaging enforcement — "slower" not "slow," "associated with" not "caused by"

## M4 — Report Sharing (ABSORBED into M2.5)

Sharing architecture redesigned June 23, 2026. Zero-knowledge relay pulled into Phase 1 (was Phase 2). R2 replaced by CF KV. See M2.5 above for full breakdown.

~~- [ ] Capability-link generation~~
~~- [ ] Section include/exclude UI~~
~~- [ ] R2 upload~~
~~- [ ] Hosted viewer~~
~~- [ ] Revocation~~
~~- [ ] Report receipt~~
~~- [ ] Secret protection~~
~~- [ ] Size limits~~

## M5 — External Diagnostics and WP-CLI

- [ ] Yoke integration — on-demand external diagnostics panel
- [ ] Attribution display — `via ns.lol ↗` / `via certs.lol ↗` links
- [ ] WP-CLI: `wp scrutinizer list` — list saved profiles
- [ ] WP-CLI: `wp scrutinizer show <id>` — display profile detail
- [ ] WP-CLI: `wp scrutinizer delete <id>` — delete profile
- [ ] WP-CLI: `wp scrutinizer export <id>` — export profile as JSON
- [ ] WP-CLI: `wp scrutinizer baseline list` — list baselines
- [ ] WP-CLI: `wp scrutinizer baseline save <name>` — save current as baseline
- [ ] WP-CLI: `wp scrutinizer baseline delete <name>` — remove baseline
- [ ] WP-CLI: `wp scrutinizer baseline compare <name>` — compare against baseline
- [ ] WP-CLI: `wp scrutinizer clear` — delete all profiles
- [ ] WP-CLI: `wp scrutinizer status` — profiler state summary

## M6 — Polish and wp.org Submission

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
