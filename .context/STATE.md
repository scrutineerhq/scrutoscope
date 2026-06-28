# STATE

> Volatile snapshot of the project. Updated after significant sessions.

**Last updated:** 2026-06-28

## Version

- Plugin: `1.2.0` (beta — `v1.2.0-beta.1` pre-release cut; not yet submitted to wp.org)
- Last stable tag: `v1.0.3`
- PHP: 7.4+
- WordPress: 6.0+

## Codebase

| Component | Status |
|-----------|--------|
| Plugin bootstrap (`scrutinizer.php`) | ✅ Functional |
| Profiler engine (`includes/Profiler/`) | ✅ Complete (+ lightweight capture mode) |
| API (`includes/Api/`) | ✅ Complete — 6 REST endpoints + public manifest |
| Admin UI (`includes/Admin/`) | ✅ Functional — AJAX-gated handlers, EarlyBoot helper |
| CSS/JS (`assets/`) | ✅ Complete — shared timeline renderer, dark-mode-aware |
| WP-CLI (`includes/Cli/`) | ✅ Complete — 7 subcommands |
| Share relay (`scrutinizer.dev`) | ✅ Deployed — CF Worker + R2 + KV; dark mode; core-dev diagnostics parity |
| Viewer (`scrutinizer.dev/view`) | ✅ File upload + relay decryption; handles lightweight reports |
| Tests (`tests/`) | ✅ PHPUnit suite (Sanitizer, QueryReducer, Prompt, Storage sanitize…); relay vitest + Playwright e2e; shared-renderer checksum guard in both repos |

## Milestones

| Milestone | Status |
|-----------|--------|
| M1 — Core Instrumentation | ✅ Complete |
| M2 — Deep Mode & Timeline | ✅ Complete |
| M2.5 — AI Agent API & Sharing | ✅ Complete |
| M3 — Compare Workflow + Regression Detection | ✅ Complete (detection, not a gate — D43) |
| M3.5 — Long-term stats aggregate | ✅ Capture + cross-deploy windows shipped; aggregate-retention pruning + trend sparklines deferred |
| M4 — Report Sharing | ✅ Complete (absorbed into M2.5) |
| M5 — WP-CLI | ✅ Complete |
| M5.5 — Data Lifecycle & Share Mgmt | ✅ Complete |
| M5.6 — Cron Profiling | ✅ Shipped in 1.2.0 (opt-in capture + per-hook cost column; trend/spike deferred) |
| M5.7 — Core-developer attribution | ✅ Shipped in 1.1.0 (subsystem breakdown, dev signals, i18n JIT, boot breakdown; cross-build comparison skipped) |
| M6 — wp.org Submission readiness | ✅ Done except final screenshots + a manual keyboard/SR QA pass |

## Releases

- `v1.2.0-beta.1` — pre-release (current QA artifact). Adds lightweight capture mode + cron profiling.
- `v1.1.0-beta.1` — pre-release. Trust/readiness: opt-in early boot, default-off `SAVEQUERIES`, External Services disclosure, accurate blocking/async HTTP, security hardening, core-dev attribution, relay dark mode, i18n.
- `v1.0.3` — last tagged stable.

## Before wp.org submission

- Refreshed wp.org screenshots (delegated — captured against fresh traffic on the 1.2.0 UI).
- A manual keyboard + screen-reader QA pass (axe-core is clean across all views; best-effort).
- Flip the beta → final `v1.2.0` tag (bump the CHANGELOG date) once QA passes.

## Deferred (1.2.x / later)

- Cron trend sparklines + statistical spike detection (M5.6 follow-ups).
- Long-term aggregate retention pruning + trend sparklines (M3.5).
- Cross-build / cross-PHP-version comparison (core-dev direction).
- Roadmap: OpenAPI/JSON-schema endpoint, first-run "capture one profile" flow, methodology doc, DB-growth + managed-hosting docs.
