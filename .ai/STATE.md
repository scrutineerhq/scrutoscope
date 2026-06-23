# STATE

> Volatile snapshot of the project. Updated after significant sessions.

**Last updated:** 2026-06-23

## Version

- Plugin: `0.1.0-dev`
- Phase: 1 (Scrutinizer — profiler only)
- Milestone: M1 (Core Instrumentation Engine) — in progress

## Codebase

| Component | Status |
|-----------|--------|
| Plugin bootstrap (`scrutinizer.php`) | ✅ Functional — autoloader, activation/deactivation hooks, admin bar indicator |
| Profiler engine (`includes/Profiler/`) | ✅ Scaffolded — Profiler, Session, CallStack, Attribution, Instrumentor, Report, Storage |
| Admin UI (`includes/Admin/`) | ✅ Scaffolded — Dashboard page, AJAX handlers |
| CSS/JS (`assets/`) | ✅ Scaffolded — dashboard.css, dashboard.js |
| WP-CLI (`includes/CLI/`) | ⬜ Empty — M5 scope |
| Report sharing (`includes/Share/`) | ⬜ Empty — M4 scope |
| Tests (`tests/`) | ⬜ Empty |
| Languages (`languages/`) | ⬜ Empty — i18n scaffolded but no .pot yet |

## Requirements

- PHP: 7.4+
- WordPress: 6.0+
- No external dependencies (Composer is for dev tools only: phpcs, phpunit)

## Infrastructure

| Resource | Details |
|----------|---------|
| Domain | scrutineer.dev (registered) |
| GitHub | scrutineerhq/scrutinizer (public, GPL) |
| Dev server | Linode VPS — SSH port 80 via CONNECT proxy |
| CI | GitHub Actions (phpcs + phpunit across PHP 7.4–8.3) |
| Hosted relay | Not yet deployed — M4/M6 scope |

## Accounts

| Surface | Handle | Status |
|---------|--------|--------|
| GitHub org | scrutineerhq | ✅ Reserved |
| Bluesky | @scrutineer.dev | ✅ Reserved |
| Mastodon | @scrutineer@mastodon.social | ✅ Reserved |
| Reddit | u/scrutineer-project | ✅ Reserved |
| npm | @scrutineer | ✅ Reserved |
| X/Twitter | — | Skipped (all variants taken) |
| wp.org slug | — | Assigned at submission (M6) |

## Milestones

| Milestone | Scope | Status |
|-----------|-------|--------|
| M0 — Foundation | Scaffold, CI, accounts, dev env | ✅ Complete |
| M1 — Core Instrumentation | Profiler engine, Standard mode, basic dashboard | 🔨 In progress |
| M2 — Deep Mode & Timeline | Deep mode, request timeline visualization, full diagnostics | ⬜ Not started |
| M3 — Baselines & Regression | Named baselines, route-matched comparison, regression language | ⬜ Not started |
| M4 — Report Sharing | Capability links, R2 upload, hosted viewer, revocation | ⬜ Not started |
| M5 — External Diagnostics & CLI | Yoke integration, 11 WP-CLI commands | ⬜ Not started |
| M6 — Polish & wp.org | Submission readiness, hosted infra live | ⬜ Not started |

## Phase Roadmap

| Phase | Name | Scope |
|-------|------|-------|
| 1 | Scrutinizer | Profiler + sharing + Yoke integration (M1–M6) |
| 2 | Triage (Secure DX) | E2E encrypted diagnostic handoff, key model, Studio |
| 3 | Scrutiny (Analytics) | SDK for plugin devs, HITL consent, feature counters |

## Open Issues

_None tracked yet._
