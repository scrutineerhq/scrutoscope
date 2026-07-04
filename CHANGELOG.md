# Changelog

All notable changes to Scrutinizer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.7] - 2026-07-04

wp.org review compliance fixes.

### Fixed
- Moved inline `<script>` to `wp_register_script()` / `wp_add_inline_script()` for wp.org compliance
- Removed unnecessary `require_once` for `plugin.php`
- Switched `file_put_contents` to WordPress uploads directory via `wp_upload_dir()`
- Replaced `copy()` with `WP_Filesystem` API for mu-plugin installation

## [1.2.6] - 2026-07-04

Dashboard enhancements and tab-switch fix.

### Added
- Inline trend sparklines in the routes overview table (last 20 data points, regression coloring)
- Sortable memory delta column ("Mem") in the hook execution trace table

### Fixed
- Routes tab hangs on "Loading…" on first visit when user switches tabs before AJAX completes (race condition: cached data now renders immediately on tab switch)
- Revoke button icon vertical alignment in API settings
- Client IP detection settings description reworded for clarity

## [1.2.5] - 2026-07-03

Plugin Check compatibility fixes for wp.org submission.

### Fixed
- Replace heredoc syntax in Prompt.php for Plugin Check compatibility
- Remove deprecated `load_plugin_textdomain` call (handled by wp.org since WP 4.6)
- Sanitize `$_SERVER['REQUEST_URI']` with `wp_unslash`
- Trim upgrade notice for 1.1.0 to under 300 characters
- Update contributor slug to `kurtpayne`

## [1.2.4] - 2026-07-02

Shared report privacy and breakdown bar fix.

### Fixed
- Breakdown bar now fills to 100% with a labeled "Unattributed" segment for remainder time
- Database table prefix stripped from SQL in shared and exported profiles (replaced with `{prefix}_`)

## [1.2.3] - 2026-06-29

Internal refactor, code quality, and wp.org submission polish.

### Changed
- Refactored Storage class (1,619 lines) into four focused classes: Storage (CRUD), Schema (DDL), StorageRouteAggregates (route stats), Cleanup (retention)
- Serve minified assets by default (375KB → 228KB); unminified served when SCRIPT_DEBUG is on
- Streamlined screenshots from 21 to 15 (removed redundant and niche screenshots)
- Scoped uninstall user query to only users with Application Passwords

### Added
- ABSPATH exit guards on all 20 PHP files in includes/
- RouteKey normalization tests (10 cases)
- Version links for v1.2.1 and v1.2.2 in changelog

### Fixed
- REST endpoint count in documentation (was 5/6, actual 7)
- CLI subcommand list in README.md (was wrong names and count)
- .distignore: AGENTS.md, test-plugins/, .wordpress-org/, *.gitkeep now excluded from release zip

## [1.2.2] - 2026-06-28

Cron visibility, sharing fixes, and wp.org polish.

### Added

- **Cron tab reorganized** into collapsible source sections with a recent cron profile history panel.
- **Routes pagination** — client-side pagination for sites with many measured routes.
- **Lightweight profile indicator** — profiles captured in lightweight mode are labeled in the dashboard.

### Changed

- **Send to Agent** prompt simplified — bootstraps from `/v1/prompt` instead of embedding the full prompt inline.
- Removed JIT textdomain section from the Metadata tab (no longer relevant on WP 6.7+).
- Share payload passes fields through directly — no more field renaming between plugin and relay.

### Fixed

- Shared report timeline now shows correct plugin names and colors.
- Shared report trace rendering restored.
- False-positive duplicate cron warnings eliminated.
- `DESCRIBE`/`DESC`/`EXPLAIN` queries no longer lose their table name in query grouping.

### wp.org

- Added 21 screenshots with descriptions and HiDPI banners.
- Corrected screenshot slot ordering.

## [1.2.1] - 2026-06-28

Capture experience polish.

### Added

- **Capture feedback banner** - floating bottom bar on every profiled page shows "Profiling active - keep browsing to capture more pages." Works across admin, front-end logged in, and front-end logged out. Dismiss persists for the browser session. Skips the Scrutinizer dashboard (which already has session UI).

### Changed

- Admin bar tooltip wording: replaced emdash with regular dash for consistency.

## [1.2.0] - 2026-06-28

Production-safe capture and cron visibility.

### Added

- **Lightweight capture mode** (Settings → Lightweight Mode) — records source/attribution totals only, skipping the timeline and the per-callback trace (together ~95% of stored profile size). Profiles drop from several MB to ~200 KB, so always-on background sampling is safe on busy production sites. The full source / queries / HTTP / subsystem breakdown is kept; the Timeline and Trace tabs (and the shared-report viewer) note when a capture was lightweight.
- **Cron profiling** (Settings → Profile Cron Jobs) — opt in to sample WP-Cron runs (normally excluded), so the Cron tab shows measured per-hook exclusive cost from real runs, with the worst run flagged. Cron hooks are snapshotted at request start so single events are attributed correctly.

## [1.1.0] - 2026-06-27

This release focuses on trust — opt-in defaults and honest disclosure — alongside a redesigned timeline and deeper attribution.

### Added

- **Redesigned Request Timeline** — a cost-sorted "who owns the time" bar names the culprit at a glance, over a chronological timeline with WordPress lifecycle phase markers. Unattributed time is always shown; HTTP waits and database-query density get their own lanes; memory is drawn as a growth curve. Colour-blind-safe (Okabe–Ito) palette, with zoom and pan.
- **One shared timeline renderer** (`scrutinizer-timeline.js`) drives both the dashboard and the relay viewer — byte-identical, checksum-guarded in CI. The shared-report viewer also gained a dark mode.
- **Core-developer attribution** — the single "core" bucket splits into WordPress subsystems (Query, Options, Blocks, REST, i18n…); `deprecated_*` / `_doing_it_wrong()` notices are captured with the source that triggered them; just-in-time textdomain loads are surfaced with the hook that caused them; and the pre-plugin bootstrap is split into must-use vs. active-plugin loading. All aggregate-only.
- **Accurate outbound-HTTP timing** — the real `blocking` request arg is captured (via `http_api_debug`, so fire-and-forget calls are recorded too), and the timeline shows blocking vs. async distinctly instead of inferring it from duration.
- **Memory-over-time sampling** — `memory_get_usage()` is sampled at each lifecycle phase marker, emitting an honest `memory_samples[]` curve (peak reported separately).
- **Regression detection** — a verdict (`likely_regression` / `difference_observed` / `within_noise` / `insufficient_data`) from a three-threshold classifier, plus a long-term route-stats aggregate that compares across windows outliving the 7-day profile TTL (cross-deploy). Detection only — never a gate.
- **Internationalization** — all dashboard strings wrapped via `wp.i18n`; a fresh `.pot` ships with the plugin.

### Changed

- **Early-boot timing is opt-in.** Activation no longer writes `scrutinizer-early.php` into `wp-content/mu-plugins`; enable it from Settings (with a one-time dismissable nudge) or WP-CLI, and it's restored on reactivation.
- **Query profiling (`SAVEQUERIES`) defaults off.** Enable it from Settings for per-query detail; the basic query count stays available via `$wpdb->num_queries`.
- **Outbound HTTP URLs are reduced to scheme + host** (paths and query strings stripped) on write, read, and output — paths can carry secret tokens.

### Security

- Fixed a bypass where a Scrutineer Application Password (scoped to REST + a short TTL) could be used over **XML-RPC**, skipping both scope and expiry — now rejected at the authentication layer for any non-REST use.
- **Legacy stored profiles are re-sanitized on read and on output**, so older rows can't leak a full outbound URL (webhook/bot tokens live in the path) through a share or export. The `blocking` flag is carried through shares and the REST API.
- Hardened the WP-CLI `export`, the report-sharing path, deactivation/uninstall cleanup (`wp_delete_file`), and the autoloader (path-traversal); made the SQL reducer idempotent so a defensive re-reduction keeps the table name.

### Fixed

- Shared-report viewer: trace callbacks now show their names grouped by hook (parsed from the composite id), the breakdown bar renders from nanosecond data, the timeline follows dark mode, and duplicate tabs were removed. The routes "Last Captured" column now sorts chronologically.

### Accessibility

- Full ARIA tab pattern with arrow-key navigation, focus management on view changes, and `aria-live` announcements for dynamic content.

### Docs

- Added an **External Services** disclosure for the optional report-sharing relay; corrected readme and agent-prompt wording to match the privacy behavior (host-only HTTP, opt-in defaults); documented the public `/v1/manifest` endpoint.

## [1.0.3] - 2026-06-26

### Security

- GDPR-compliant IP hashing — API log stores HMAC-SHA256 pseudonyms, not raw IPs.
- Activation tokens bound to the issuing admin user ID.
- Proxy header spoofing fix (REMOTE_ADDR only by default).
- Query strings stripped from profile URLs at write time.

### Added

- Background profiling filters — user scope (all/anonymous/logged-in) and path exclusions.
- Proxy trust settings with auto-detection.
- Full-page settings view replaces the settings modal.

### Improved

- Profile data compressed with gzip (smaller database footprint).
- Overhead claims updated with real benchmark numbers.
- Settings page polish — card hierarchy, callout notes, layout fixes.

## [1.0.2] - 2026-06-26

### Improved

- Early boot timer mu-plugin auto-installs on plugin activation — bootstrap timing works out of the box without a WP-CLI step.
- Uninstall cleans up the mu-plugin along with all other plugin data.

## [1.0.1] - 2026-06-26

### Fixed

- `handle_prompt` AJAX handler now returns proper JSON response instead of raw text.
- API audit log table created on activation (was missing for fresh installs).
- Cron schedule registration runs only once per lifecycle instead of on every admin page load.
- WCAG contrast ratios for muted text and inactive tab labels.
- Timeline milestone labels no longer clip at container edges.
- Query density strip alignment when zoomed.
- Share payload field mapping for relay viewer compatibility.
- Duplicate sort click handlers on History and Cron tabs.

### Improved

- Shared reports ledger with revocable links and expiry tracking.
- Profile TTL controls: configurable 7, 14, or 30 day retention (or never). Countdown badges on profile cards.
- Pinned and shared profiles are exempt from TTL cleanup.
- Queries pill labels are context-aware (show count when expanded, "Queries" when collapsed).
- Clean uninstall removes all database tables, options, cron hooks, and application passwords.

## [1.0.0] - 2026-06-25

### Added

- **Server Request Duration Profiling** — See exactly where time goes during a WordPress page request, attributed to plugins, theme, core, mu-plugins, and drop-ins.
- **Source Attribution** — Every callback traced to its originating plugin/theme/core component with exclusive and inclusive timing.
- **SQL Query Profiling** — Database queries captured with timing, caller stack, and source attribution. Tokenizer-based SQL reduction strips literals for safe sharing.
- **HTTP Call Tracking** — External HTTP requests logged with URL, duration, and response status.
- **Autoloaded Options Analysis** — Detect bloated autoloaded options with size and source attribution.
- **Enqueued Assets Inventory** — Scripts and stylesheets listed with sizes and dependencies.
- **Hook Execution Trace** — Full callback trace organized by WordPress lifecycle phase, collapsible with search.
- **Timeline Visualization** — Visual timeline showing when each callback executes during the request lifecycle, with phase milestone markers.
- **Breakdown Bar** — Color-coded proportional bar showing source contribution to total duration.
- **Route-Based Grouping** — Profiles grouped by route with human-readable labels, sortable columns, and status code distribution (2xx/4xx/5xx).
- **Background Capture** — Configurable sample rate (0.1% to 100%) with snap-point presets and custom float input.
- **Pin & Annotate** — Pin important profiles to protect from cleanup. Add notes and tags for organization.
- **Profile Retention** — Automatic cleanup with configurable TTL (default 30 days) and per-route cap (default 100). Pinned profiles exempt.
- **Cron Inventory** — Dashboard tab listing all registered WordPress cron events with schedules, next run, and hook details.
- **REST API** — Six read-only endpoints for AI agent integration:
  - `GET /v1/prompt` — Self-documenting system prompt (the API contract)
  - `GET /v1/diagnostics` — Site fingerprint with opt-in field selection
  - `GET /v1/routes` — Route summary with stats
  - `GET /v1/profile/{id}` — Full compiled profile
  - `GET /v1/compare/{a}/{b}` — Two profiles with computed deltas
  - `GET /v1/manifest` — Public API manifest for agent discovery
- **Send to Agent** — One-click prompt generation with short-lived Application Password credentials. Auto-revokes previous access on each generation.
- **Send to Support** — Zero-knowledge encrypted report sharing via `scrutinizer.dev` relay. Client-side AES-256-GCM encryption, configurable expiry (1–30 days), optional passphrase protection, expire-after-reading, and instant revocation.
- **WP-CLI Integration** — Eight commands: `wp scrutinizer status`, `list`, `show`, `delete`, `export`, `clear`, `rebuild-stats`, `mu-plugin`.
- **Diagnostics Sharing Controls** — Per-field opt-in checkboxes for environment details shared via the API.
- **Settings Panel** — Gear icon reveals capture rate, retention, and query profiling controls without cluttering the data-first layout.

### Design Principles

- **Read-only** — Scrutinizer measures. It never modifies your site, changes configuration, or makes recommendations.
- **Data first** — The dashboard leads with profiling data. Controls are one click away behind the gear panel.
- **Trustworthy defaults** — 10% sample rate, 30-day retention, 100 profiles per route. Safe to activate and forget.
- **WordPress native** — Standard admin card patterns, semantic borders, WP color palette. No dark custom themes.
- **Privacy by design** — SQL queries sanitized with literal stripping. No telemetry. No external calls except opt-in encrypted sharing.

[1.2.7]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.2.7
[1.2.6]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.2.6
[1.2.5]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.2.5
[1.2.4]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.2.4
[1.2.3]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.2.3
[1.2.2]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.2.2
[1.2.1]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.2.1
[1.2.0]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.2.0
[1.1.0]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.1.0
[1.0.3]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.0.3
[1.0.2]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.0.2
[1.0.1]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.0.1
[1.0.0]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.0.0
