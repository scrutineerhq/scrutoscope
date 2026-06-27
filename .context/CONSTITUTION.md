# CONSTITUTION

The rules that never bend. Every PR, every refactor, every "quick fix" must pass these.

## Identity

- **Brand:** The Scrutineer Project (scrutineer.dev)
- **Plugin:** Scrutinizer — WordPress Performance Profiler
- **Org handle:** @scrutineerhq (everywhere)
- **License:** GPL-2.0-or-later. FOSS everything: plugin, relay, CLI, viewer.
- **WP-CLI namespace:** `wp scrutinizer`

## Product philosophy

1. **Profiler only.** Scrutinizer measures. It does not recommend, remediate, or prescribe. Read-only until overwhelming evidence says otherwise.
2. **Local-first.** No automatic network requests from install, activation, update, or usage. The admin drives every action.
3. **No silent collection.** No background telemetry, no opt-out-required data flows. Background profiling is local and admin-configured.
4. **Attribution ≠ causality.** Never say a plugin "caused" a regression. Say the largest observed increase in exclusive callback time was "associated with" it.
5. **Honest measurement.** Never call Server Request Duration "page load." Never hide unattributed time. Never merge browser timing into server duration.
6. **No monetization.** No paid tiers, lead funnels, licensing telemetry, or upsell gates.
7. **Trustworthy defaults, transparency on demand.** Every default should be safe to trust without reading a manual. But when someone is curious — about what a number means, why something is measured this way, what "unknown" contains — the answer should be one click away. Never force the explanation on everyone; never hide it from anyone who asks.

## Hard never-collect

- Passwords, cookies, auth headers, tokens, WordPress salts, private keys, database credentials.
- Raw SQL literals (normalized shapes only).
- Full HTTP URLs, query strings, request/response bodies.
- POST bodies, uploaded files, visitor/customer data.
- File contents or arbitrary option values.

## Hard never-execute

- PHP eval, shell commands, WP-CLI commands, arbitrary SQL, dynamic closures, arbitrary file reads.
- Plugin/theme activation changes, updates, installations.
- Third-party account changes.

## Terminology — use these exact terms

| Term | Meaning |
|---|---|
| Server Request Duration | Wall-clock time serving a PHP/WP request. NOT page load. |
| Exclusive Callback Time | Time in a callback minus observed nested callbacks. Additive. |
| Inclusive Callback Time | Total elapsed while a callback was active, including nested. Cumulative. |
| Unattributed Time | Request time not mapped to any observed callback. |
| Hook Execution Trace | Nested hook/callback trace. NOT a flame graph. |
| Observed Memory Delta | Memory change during a callback. NOT per-plugin ownership. |
| Difference Observed | Measured change, insufficient evidence for regression. |
| Likely Regression | Meaningful, consistent slowdown across matched observations. |

## Overhead budget

Measured, not aspirational — but highly variable (number of active plugins, OPcache on/off, MySQL local vs remote, hardware, load). There is **one profiling depth**, not tiered modes; the only knob that changes what's captured is the query-profiling toggle. We report what we measured, not a guarantee.

| Cost | Measured | Notes |
|---|---|---|
| Always-on check (every request) | ~2ms or less | The "are we profiling?" branch every visitor pays. Typically well under 2% of request time. This is the cost that must stay tiny. |
| Active profiling (per profiled request) | ~250ms | Bringing up the hooks and timing every callback. Paid only on requests actually being profiled (an admin session, or the sampled slice of background traffic). |
| Background sampling | ≈ always-on + (sample rate × active) | Near-zero at low sample rates; at 100% you pay the active cost on every request. |

Deactivating the plugin removes all per-request overhead and keeps captured profiles — only uninstalling drops the data.
