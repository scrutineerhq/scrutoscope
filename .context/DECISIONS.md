# DECISIONS

Locked design decisions. Each has a rationale. Reversals require explicit discussion.

## D1: Read-only product — no remediations
Scrutinizer does not fix things. No "disable this plugin" buttons, no "try deactivating X" suggestions, no AI recommendations. If plugin devs want those features, they can build them in their own plugin. Rationale: the profiler's credibility depends on not having opinions about what to do with its data.

## D2: No scan triggering from WP-CLI
`wp scrutinizer` manages data only (list, view, delete, compare, share, revoke). No `wp scrutinizer scan`. Loopback requests miss lazy-loaded components, and requiring a headless browser is too heavy for CLI. Scans happen through the admin UI in a real browser.

## D3: No crowdsourced benchmarks
Removed entirely — not just deferred. Kurt doesn't see ROI vs collection heat. Scrutinizer never uploads performance data for cross-site comparison.

## D4: No background sampling in V1
Background sampling cut from V1 scope. V1 is a deliberate diagnostic tool: user starts profiling, browses, stops, reviews.

## D5: Profiling cookie activation model
Profiling is activated via HMAC-signed short-lived URL → sets HttpOnly/Secure/SameSite cookie → immediate redirect strips token from URL. Only requests carrying the valid cookie are instrumented. One active session at a time.

## D6: Route-matched baselines, not URL-based
Comparison uses coarse fingerprints (route class + frontend/admin + anon/auth + cache state + runtime metadata). Raw URLs are not comparison keys. Checkout is compared to checkout, not homepage.

## D7: Likely Regression thresholds
≥5 matched requests per set, ≥20% + 100ms median increase, consistent direction in ≥3/5 comparisons. Below that: "Difference observed" or "Possible change."

## D8: ~~Share model is capability-link, NOT zero-knowledge~~ SUPERSEDED
~~Standard sharing is unlisted capability URLs with 128-bit random IDs. Not encrypted, not discoverable. Zero-knowledge is Phase 2 (Secure DX) only. Don't conflate them.~~

**Superseded June 23, 2026:** Zero-knowledge sharing pulled into Phase 1. Share model is now capability URLs with client-side AES-256-GCM encryption, key in URL fragment. The relay (scrutinizer.dev) stores only ciphertext and cannot read reports. See scrutineer-api-spec.md §7. R2 replaced by CF KV (ciphertext blobs with TTL). The old D8 distinction between "capability-link Phase 1" and "zero-knowledge Phase 2" is dissolved — Scrutinizer ships with zero-knowledge from day one.

## D9: Expiry defaults
Share links: 1-30 days, default 7. User-chosen at share time. R2 lifecycle removes expired artifacts.

## D10: Section-level include/exclude before sharing
Users see a checklist of all report sections. Defaults all-on. They can disable any section. Preview shows exactly what will be published.

## D11: External diagnostics via Yoke only
Yoke/.lol family provides external signals (DNS, TLS, redirects, CDN detection, HTTP protocol). These are on-demand, user-initiated, clearly separated from WordPress profiling data. External timing never enters Server Request Duration or baseline math.

## D12: Three-phase product, separate data models
- Phase 1: Scrutinizer (profiler + sharing + Yoke integration)
- Phase 2: Triage (Secure DX — encrypted diagnostic handoff)
- Phase 3: Scrutiny (Analytics SDK — feature counters, HITL consent)
Each phase is a separate product under one brand with no shared raw data model or implied collection authority.

## D13: No global `all` hook
Instrumentation wraps callbacks at entry/exit with monotonic HR clock. No `all` hook registration. No statement ticks.

## D14: HITL consent for Analytics SDK (Phase 3)
No public `enable()` method. Consent records are nonce-gated. Triage owns the consent UI. 5-deferral limit then opt-out. Re-prompt on major version bumps only.

## D15: Single keypair per plugin (Secure DX)
One keypair = root + operational. Shared teams share the keypair via their own trusted channel. Rotation via self-signed keyset endpoint (monotonic epoch) without plugin release.

## D16: WordPress.org slug assigned at submission
Plugin slug comes from wp.org at final submission time. Not pre-reserved.

## D17: Remediations removed, not deferred
Removed entirely from spec scope. The word "remediation" in Scrutinizer context means "someone else's job." This was an explicit, considered decision — not a deferral.

## D18: Background profiling restored to V1
Kurt reversed D4 (no background sampling in V1). Background profiling is back in scope with a configurable sample rate (1-100%). This replaces the deliberate-only model — users can now get passive profiling data without explicit sessions. D4 is superseded.

## D19: Tabbed detail view over single-page scroll
Profile detail uses horizontal tabs (Timeline, Breakdown, Sources, Queries, Metadata) instead of a single scrolling page. This keeps each section focused and avoids overwhelming the user with all data at once. The Timeline tab is the default/first tab shown.

## D20: Lifecycle phase markers at priority 0
Phase markers hook at priority 0 (not PHP_INT_MIN) to avoid conflicts with WordPress internals. We accept missing a few microseconds at each phase boundary. The profiler itself starts at `plugins_loaded` priority 0, so hooks that fired before that (e.g., `muplugins_loaded`) may not be captured — the timeline starts from profiler boot, not SAPI boot.

## D21: Deep mode queries always sorted by time descending
Individual query log is always sorted slowest-first in the dashboard. The raw data could be stored in execution order, but the UI presentation is opinionated: you care about slow queries first. Queries over 10ms are highlighted with a red background.
## D22: API prompt IS the API contract
`/v1/prompt` returns a self-bootstrapping prompt tied to the API version. New API version = new prompt. No separate API docs to drift. The prompt teaches the consuming agent measurement terminology, available endpoints, tone guidance, and interpretation context.

## D23: Two share paths, one data pipeline
"Send to Agent" (clipboard copy of one-liner prompt + scoped 24h Application Password) and "Send to Support" (encrypted report via scrutinizer.dev relay) use the same user-controlled diagnostics checkbox panel. Same data selection, different destinations.

## D24: Zero-knowledge relay for report sharing
scrutinizer.dev stores only ciphertext. Encryption/decryption is client-side (AES-256-GCM via Web Crypto API). Decryption key lives in URL fragment (#key) — never sent to server. Scrutineer (the org) cannot view shared reports. Supersedes D8.

## D25: Application Passwords — unscoped by core, gated by permission_callback
WordPress Application Passwords have NO endpoint scoping in core (scoping is "future development" per the Integration Guide). An app password inherits the full capabilities of the user it belongs to. Our real access control is `permission_callback` on each `register_rest_route` call — that's the gate, not the password's capabilities. We document that a dedicated least-privilege user is recommended but don't enforce it.

### D25a: Regenerate-on-export, always auto-rotate
"Send to Agent" always revokes any existing Scrutineer Application Password (matched by `app_id`) and creates a fresh one. No option to keep old passwords alive — only one credential is ever valid at a time. Plaintext is returned once from core and copied to clipboard; we never store it.

### D25b: app_id for lifecycle management
All Scrutineer-created Application Passwords use a fixed `app_id` UUID. This lets us: (1) find/revoke our passwords without touching others, (2) clean up on plugin deactivation, (3) detect if a valid password already exists. The `app_id` is the handle for all password lifecycle operations.

### D25c: TTL is plugin-enforced, not core
Core Application Passwords have no expiry. We store `created` timestamp and enforce TTL ourselves. Default 1 hour, user-configurable up to 24 hours max. On each authenticated request to our routes, we check age and reject expired passwords. A scheduled event also garbage-collects stale passwords matching our `app_id`.

## D26: Hard sanitization before any output
All output paths (API responses AND shared reports) run a hard sanitization pass that strips filesystem paths, DB credentials, IPs, auth keys/salts, wp-config constants, and user PII — regardless of checkbox settings. Reports are safe by construction, protecting against social engineering attacks that trick users into sharing.

## D27: Expire after reading
Reports can be set to auto-delete after first successful decryption. Viewer POSTs read confirmation, relay deletes ciphertext. Combinable with time-based expiry (whichever first). Recommended default ON for passphrase-protected reports.

## D28: Security model is key strength, not rate limiting
Client-side decryption means brute-force happens offline — server rate limiting is irrelevant. 256-bit fragment keys are uncrackable. Passphrase layer (if offered) needs high PBKDF2 iterations + minimum strength. The real attack vector is URL leakage, mitigated by Referrer-Policy, short TTL, expire-after-reading, and revocation.

## D29: Report viewer is human-only — no AI analysis
The Studio viewer at scrutinizer.dev is for humans (support, consultants, site owners' helpers). No AI analysis in the viewer. "Send to Agent" IS the AI analysis path. Don't duplicate it.

## D30: Sample rate snap points with custom override
Background measurement uses labeled snap points: 0.1% (very busy site), 1% (busy site), 10% (lower traffic), 100% (debug mode, not recommended). Users can set any value between 0.0 and 100.0 — the control isn't a simple slider, it's a hybrid input (buttons for common values + numeric input for custom). Default: 10%.

## D31: Profile retention — TTL + cap + keep pinned
Profiles have a configurable TTL (default 30 days) and a max count per route (default 100 most recent). Pinned profiles are exempt from both limits. A scheduled cleanup event enforces these. If a site accumulates 500+ routes, something is misconfigured — the UI should surface this as a warning but not hard-cap.

## D32: Contextual help via native HTML `<details><summary>`
All technical terminology uses `<details><summary>` for inline progressive disclosure. The summary shows the term with a dotted underline; expanding it reveals one sentence in muted text. No modals, no popovers, no tooltips, no external docs links. Native HTML, keyboard-accessible, zero JS. This is the project-wide pattern for CONSTITUTION #7 (trustworthy defaults, transparency on demand).

## D33: Layout — data first, controls behind gear panel
The main dashboard shows the data table above-fold. Session controls, background measurement settings, and query profiling settings live behind a ⚙️ gear panel (inline flyout or settings sub-section). Empty state (no profiles) shows onboarding cards. Return visits go straight to data.

## D34: Default route filter — successful requests only
Routes view defaults to showing routes with ≥1 2xx response ("Pages that loaded"). 404/403 scanner probes are hidden by default. Filter dropdown offers: "Pages that loaded" (default), "Not found responses", "All requests". Requires `response_status` stored per profile.

## D35: Dark styling → WP admin card pattern
Replace all dark-background sections (#1e1e1e) with standard WP admin cards (white background, 1px #c3c4c7 border, subtle box-shadow). Security-sensitive sections (Send to Agent) get a blue left border using `var(--wp-admin-theme-color)`. All styling must adapt to WP's 8 built-in admin color schemes.

## D36: Trace rendering — collapsed tree with search
Trace tab renders top-level phase nodes collapsed by default. Each node shows callback count + total time. Expand on click to reveal hooks, then callbacks. Search/filter input at top for finding specific hooks. Never render 18K+ DOM nodes simultaneously.

## D37: Lazy-loaded trace data
The detail AJAX endpoint (`get_profile_detail`) accepts `lightweight=1` to strip trace data from the response and return only a `trace_count`. Trace loads on demand when the user clicks the Trace tab via a separate `get_profile_trace` endpoint. The share flow omits `lightweight=1` and gets the full profile. This solves silent View failures on large profiles (4-30MB trace data over AJAX).

## D38: Trace explorer — Splunk-style log view
The Trace tab replaces the collapsed-tree phase view with a flat, filterable, sortable table. Features: text search (callbacks, hooks, sources), built-in filter pills (Top 10 Slowest, DB Heavy, HTTP Calls, AJAX, plus context-aware Checkout/Login/Auth), source-type filter dropdown, duration and query-count thresholds, sortable columns, client-side pagination (200 per page), and saved searches in localStorage. Entries are enriched client-side by cross-referencing with sources (for source_type), queries (for query counts), and HTTP calls (for HTTP counts) — all already present in the lightweight profile response.

## D39: Viewer accepts local file uploads
The scrutinizer.dev/view SPA has two entry points: (1) `/r/{id}#key` for relay-hosted encrypted reports, and (2) a drop zone for local JSON exports. Both feed the same rendering engine. No WordPress, no auth, no network — just drag, drop, explore. The JSON export includes `_scrutinizer.viewer` pointing to the viewer URL so recipients know where to go.

## D40: Gzip before encryption, R2 for storage
Report payloads are gzip-compressed before AES-256-GCM encryption. Combined with migrating the relay from KV to R2 (no practical size limit), this handles profiles that were previously too large to share. The viewer decompresses after decryption. Client-side DOM pagination handles rendering.
