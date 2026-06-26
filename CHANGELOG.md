# Changelog

All notable changes to Scrutinizer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **WP-CLI Integration** — Seven commands: `wp scrutinizer status`, `list`, `show`, `delete`, `export`, `clear`, `mu-plugin`.
- **Diagnostics Sharing Controls** — Per-field opt-in checkboxes for environment details shared via the API.
- **Settings Panel** — Gear icon reveals capture rate, retention, and query profiling controls without cluttering the data-first layout.

### Design Principles

- **Read-only** — Scrutinizer measures. It never modifies your site, changes configuration, or makes recommendations.
- **Data first** — The dashboard leads with profiling data. Controls are one click away behind the gear panel.
- **Trustworthy defaults** — 10% sample rate, 30-day retention, 100 profiles per route. Safe to activate and forget.
- **WordPress native** — Standard admin card patterns, semantic borders, WP color palette. No dark custom themes.
- **Privacy by design** — SQL queries sanitized with literal stripping. No telemetry. No external calls except opt-in encrypted sharing.

[1.0.1]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.0.1
[1.0.0]: https://github.com/scrutineerhq/scrutinizer/releases/tag/v1.0.0
