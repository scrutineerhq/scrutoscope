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

Targets — not yet benchmarked. Do not hardcode specific numbers (e.g. "2-5ms") until measured.

| Mode | Target |
|---|---|
| Session profiling | < 2% |
| Background profiling | Near-zero average |
