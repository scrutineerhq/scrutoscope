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
- [x] Lifecycle phase markers — hrtime snapshots at 8 key WP hooks
- [x] Deep mode: query detail — individual SQL queries with time and caller via SAVEQUERIES
- [x] Query count metric card — always via $wpdb->num_queries
- [x] User role capture — wp_get_current_user() per request, role pill badges
- [x] Metric cards — Server Request Duration, memory, queries, callbacks
- [x] Tabbed detail view — Timeline, Breakdown, Sources, Queries, Metadata
- [x] Weight glyphs — thin inline progress bars on source table rows
- [x] Unattributed time tooltip — ⓘ explanation of bootstrap overhead
- [ ] Memory observations — `memory_get_usage()` deltas per callback (already captured per timing, not yet visualized)
- [ ] Enqueued assets inventory — script/style handles, sizes, dependencies
- [ ] Cron inventory — scheduled events, overdue/duplicate indicators
- [ ] Hook Execution Trace — nested callback visualization (trace data exists, UI needed)

## M3 — Baselines and Regression Language

- [ ] Named baselines — save current profile set as a named reference
- [ ] Route-matched comparison — match by fingerprint, not URL
- [ ] Regression classification — 5+ matches, 20%+100ms, 3/5 consistent
- [ ] Compare view — side-by-side timeline, delta summary
- [ ] Messaging enforcement — "slower" not "slow," "associated with" not "caused by"

## M4 — Report Sharing

- [ ] Capability-link generation — 128-bit random, URL-safe
- [ ] Section include/exclude UI — checklist with preview
- [ ] R2 upload — retention encoded in key path, lifecycle auto-delete
- [ ] Hosted viewer — scrutineer.dev/d/{id}, structured rendering, no innerHTML
- [ ] Revocation — dashboard + standalone link, immediate retrieval block
- [ ] Report receipt — sections included, access log, revocation status
- [ ] Secret protection — enforce hard-never-collect on shared artifacts
- [ ] Size limits — transparent truncation with in-report notice

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
