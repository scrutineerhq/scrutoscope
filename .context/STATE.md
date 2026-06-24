# STATE

> Volatile snapshot of the project. Updated after significant sessions.

**Last updated:** 2026-06-24 (morning session)

## Version

- Plugin: `0.1.0-dev`
- Phase: 1 (Scrutinizer — profiler only)
- Milestone: M2.5 (AI Agent API) — **COMPLETE**

## Codebase

| Component | Status |
|-----------|--------|
| Plugin bootstrap (`scrutinizer.php`) | ✅ Functional — autoloader, activation/deactivation hooks, admin bar indicator |
| Profiler engine (`includes/Profiler/`) | ✅ Complete — Profiler, Session, CallStack, Attribution, Instrumentor, Report, Storage |
| API (`includes/Api/`) | ✅ Complete — RestApi (5 endpoints), Sanitizer, Diagnostics (opt-in fields), Prompt, ApplicationPassword (TTL/scope/GC) |
| Admin UI (`includes/Admin/`) | ✅ Functional — Dashboard page, AJAX handlers (17 total), tabbed detail view, API tab |
| CSS/JS (`assets/`) | ✅ Functional — dashboard.css, dashboard.js with timeline, metric cards, query table |
| WP-CLI (`includes/CLI/`) | ⬜ Empty — M5 scope |
| Report sharing (`includes/Share/`) | ⬜ Empty — M4 scope |
| Tests (`tests/`) | ⬜ Empty |
| Languages (`languages/`) | ⬜ Empty — i18n scaffolded but no .pot yet |

## Current Features

### Profiling Engine
- Hook callback instrumentation via `Instrumentor` with exclusive/inclusive time tracking
- `CallStack` for nested callback depth and exclusive time calculation
- `Attribution` for callback → plugin/theme/core/mu-plugin classification
- Background sampling with configurable rate (1-100%)
- By-reference parameter detection to skip unsafe callback wrapping
- **Lifecycle phase markers** — `hrtime(true)` snapshots at 25 WP hooks across early boot, core init, front-end template lifecycle, admin, and terminal (shutdown)
- **Deep mode query logging** — captures `$wpdb->queries` when `SAVEQUERIES` is enabled (sql, time_ms, caller)
- **Query count** — always captured via `$wpdb->num_queries`
- **User role capture** — `wp_get_current_user()->roles` per request (administrator/editor/subscriber/anonymous)
- **Timeline data** — per-callback position/width computed in `Report::build_timeline()`

### Dashboard UI
- Three-level drill-down: grouped routes → route profiles → single profile detail
- **Four top-level tabs**: Routes, History, Cron, **API**
- **Tabbed detail view**: Timeline, Breakdown, Sources, Queries, Metadata, History
- **Timeline visualization** — horizontal bar with callback segments, lollipop milestone markers (vertical stem + dot + label, tiered to prevent overlap), time axis, source legend
- **Breakdown bar** — inline colors from `sourceColors` map (not CSS classes), consistent between bar segments and legend. Unknown/unattributed shown in amber.
- **Metric cards** — Server Request Duration, Peak Memory, DB Queries, Callbacks
- **Role pills** — color-coded badges (🔒 admin red, editor blue, subscriber gray, 👤 anonymous outline)
- **Weight glyphs** — thin inline progress bars on source table rows, proportional to % of total execution time
- **Unattributed time tooltip** — tap-toggle `<button>` + `<span>` bubble (mobile-friendly, replaces old `title` attribute)
- **Query table** — sortable by time, slow query highlighting (>10ms), caller trace, structure-preserving sanitized SQL
- **Pin/Annotate/Prune** — toolbar per profile: pin important profiles, add text annotations, delete unneeded profiles
- **History tab** — filter profiles by route, tag, date range, pinned-only
- **Compare view** — side-by-side profile comparison with delta summary
- Background profiling toggle with sample rate slider
- Sortable column headers, route grouping, profile deletion
- Cache-busting version string via `filemtime()` on dashboard.js

### REST API (M2.5)
- 5 authenticated endpoints: `/v1/prompt`, `/v1/diagnostics`, `/v1/routes`, `/v1/profile/{id}`, `/v1/compare/{a}/{b}`
- **Application Password lifecycle** — auto-create, auto-rotate (one credential max), plugin-enforced TTL (1hr default, 24hr max), hourly GC, full cleanup on deactivation
- **Scope enforcement** — Scrutineer passwords (matched by `app_id`) restricted to `scrutinizer/v1/*` routes only; non-scrutineer endpoints return 403
- **Diagnostics opt-in** — 12 environment fields selectable via admin UI checkboxes, saved to `wp_options`
- **Send to Agent** — one-click button creates scoped Application Password, formats one-liner prompt with credentials, copies to clipboard
- **Prompt endpoint** — self-bootstrapping `text/plain` system prompt for AI agents
- **Hard sanitization** — paths, credentials, IPs scrubbed from all API output via `Sanitizer`

### Storage
- Custom DB table with auto-upgrade (`maybe_upgrade_table`)
- Columns: session_id, profile_type, request_url, request_method, route_class, route_key, duration_ns, user_role, profile_data (JSON), captured_at, is_baseline, baseline_name

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
| M2 — Deep Mode & Timeline | Deep mode, request timeline visualization, full diagnostics | 🔨 Near complete (4 items remaining) |
| M2.5 — AI Agent API & Sharing | REST API, prompt endpoint, diagnostics panel, zero-knowledge relay, Studio viewer | ✅ Core API complete (5 endpoints, scope enforcement, UI) |
| M3 — Baselines & Regression | Named baselines, route-matched comparison, regression language | ⬜ Not started |
| M4 — Report Sharing | ~~Absorbed into M2.5~~ | ✅ Redesigned |
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
