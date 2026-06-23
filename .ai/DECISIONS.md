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

## D8: Share model is capability-link, NOT zero-knowledge
Standard sharing is unlisted capability URLs with 128-bit random IDs. Not encrypted, not discoverable. Zero-knowledge is Phase 2 (Secure DX) only. Don't conflate them.

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
