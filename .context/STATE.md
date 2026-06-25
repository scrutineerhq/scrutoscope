# STATE

> Volatile snapshot of the project. Updated after significant sessions.

**Last updated:** 2026-06-24 (evening session — UX panel implementation)

## Version

- Plugin: `0.1.0-dev`
- Phase: 1 (Scrutinizer — profiler only)
- Milestone: UX Panel findings implemented — pre-M3

## Codebase

| Component | Status |
|-----------|--------|
| Plugin bootstrap (`scrutinizer.php`) | ✅ Functional — autoloader, activation/deactivation hooks, admin bar indicator, cron registration |
| Profiler engine (`includes/Profiler/`) | ✅ Complete — Profiler, Session, CallStack, Attribution, Instrumentor, Report, Storage, QueryReducer |
| API (`includes/Api/`) | ✅ Complete — RestApi (5 endpoints), Sanitizer, Diagnostics (opt-in fields), Prompt, ApplicationPassword (TTL/scope/GC) |
| Admin UI (`includes/Admin/`) | ✅ Functional — Dashboard page, AJAX handlers (18 total), tabbed detail view, API tab |
| CSS/JS (`assets/`) | ✅ UX panel implemented — WP admin cards, collapsed trace, snap rate buttons, filter bar, route labels, contextual help |
| WP-CLI (`includes/CLI/`) | ✅ Complete — 6 commands (list, show, delete, export, clear, status) |
| Report sharing (`includes/Share/`) | ⬜ Empty — M4 scope |
| Tests (`tests/`) | ⬜ Empty |
| Languages (`languages/`) | ⬜ Empty — i18n scaffolded but no .pot yet |

## What Changed This Session (June 24 evening)

### UX Panel Review → Implementation (D30–D36)

Design panel (Lena/Derek/Sophie/Raj/Nina) reviewed all 18 findings. Solutions locked as D30–D36, CONSTITUTION #7 added.

**Implemented and deployed:**

| Finding | Change | Status |
|---------|--------|--------|
| F1 (top section) | Data-first layout, controls behind ⚙️ gear panel | ✅ |
| F2 (scanner noise) | Route filter: "Pages that loaded" default, response_status per profile | ✅ |
| F3 (dark styling) | WP admin cards, --wp-admin-theme-color for 8 color schemes | ✅ |
| F4 (sortable) | Clickable column headers, default Avg Duration ▼ | ✅ |
| F5 (unknown source) | Expandable `<details>` on Unknown row | ✅ |
| F7 (trace crash) | Collapsed tree by lifecycle phase, search filter | ✅ |
| F8 (subtitles) | Breakdown + Sources tab subtitles | ✅ |
| F9 (route labels) | Two-line cells, label captured at profile time | ✅ |
| F14 (query badges) | Source attribution per query row | ✅ |
| F16 (privacy) | Advisory below Copy Prompt | ✅ |
| D30 (sample rate) | Snap buttons + custom numeric, float precision | ✅ |
| D31 (retention) | TTL 30d + max 100/route, pinned exempt, cron cleanup | ✅ |

**Copy decisions:** labels are light/moderate/detailed/every request. Overhead TBD pending shared hosting benchmarks.

### POC State
- All profiles purged, background capture at 100%, fresh profiles accumulating with response_status + route labels

## Current Features

### Profiling Engine
- Hook callback instrumentation with exclusive/inclusive time tracking
- Background sampling with configurable float rate (0.0–100.0%)
- Lifecycle phase markers at 25 WP hooks
- Deep mode query logging with QueryReducer
- Response status capture, route label generation
- Profile retention — TTL + max per route + pinned exemption + scheduled cleanup

### Dashboard UI
- **Data-first layout** — routes above-fold, controls behind ⚙️ gear
- **Route filter** — "Pages that loaded" (2xx default), "Not found", "All"
- **Sortable columns**, two-line route cells, snap button capture rate
- **Collapsed trace tree** — phase-grouped, search filter, no mass DOM
- **WP admin card styling** — no dark backgrounds, all 8 color schemes
- **Tab subtitles**, expandable Unknown, query source badges, privacy advisory
- Timeline, breakdown bar, metric cards, role pills, weight glyphs
- Pin/Annotate/Prune, History, Compare view

### REST API (M2.5)
- 5 endpoints with response_status counts and route_label per group
- Application Password lifecycle, scope enforcement, hard sanitization

### WP-CLI (M5)
- 6 commands: list, show, delete, export, clear, status

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
| POC site | poc.scrutineer.dev — WP 7.0, PHP 8.3, 9 plugins (WooCommerce, Wordfence, Yoast, CF7, WP Super Cache, ACF, Jetpack, Akismet, Scrutinizer) |
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
| M1 — Core Instrumentation | Profiler engine, Standard mode, basic dashboard | ✅ Complete |
| M2 — Deep Mode & Timeline | Deep mode, request timeline visualization, full diagnostics | ✅ Complete |
| M2.5 — AI Agent API | REST API, prompt endpoint, diagnostics panel | ✅ Complete |
| UX Panel | Design review findings (F1–F18) | ✅ 14 of 18 findings implemented |
| M5 — WP-CLI | 6 subcommands | ✅ Complete |
| M3 — Compare Workflow | Route-matched comparison, regression language | ⬜ Not started |
| M4 — Report Sharing | Zero-knowledge relay, capability URLs | ⬜ Not started |
| M6 — Polish & wp.org | Submission readiness, hosted infra | ⬜ Not started |

## Next Up

- **Shared hosting benchmarking** — GoDaddy shared/managed WP (Felix hookup) or Site5 fallback. Qualify overhead number for capture rate descriptions.
- **M3 Compare Workflow** — pin profiles, pick comparison target from saved, compare inline with regression language
- **Remaining UX findings** — F10 (trend sparkline), F13 (jargon audit), F15 (MCP manifest), F17 (API audit log), F18 (measured overhead display)
- **Contextual help terms** — wire `<details><summary>` content to all terminology (CSS ready, content not yet applied)

## Open Issues

- `scrutinizer_debug.php` mu-plugin has permission errors writing to `/tmp/scrutinizer_debug.log` — noisy but non-blocking
- `is_baseline` / `baseline_name` columns are schema cruft — scheduled for cleanup
