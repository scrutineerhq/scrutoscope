# Scrutoscope

**WordPress Performance Profiler — See where your server request duration is spent.**

Scrutoscope is a read-only profiling plugin for WordPress. It instruments every hook callback during a page request and attributes the time to its source — plugin, theme, core, mu-plugin, or drop-in — so you can see exactly what's slow and why.

> By the author of the [P3 (Plugin Performance Profiler)](https://wordpress.org/plugins/p3-profiler/). Scrutoscope is the spiritual successor: rebuilt from scratch for modern WordPress, with real attribution, SQL analysis, and zero-knowledge sharing.

## What It Measures

| What | How |
|------|-----|
| **Server Request Duration** | Total wall-clock time for the PHP request |
| **Source Attribution** | Every hook callback traced to its plugin/theme/core with exclusive and inclusive timing |
| **Database Queries** | Query text (sanitized), execution time, caller, and source |
| **HTTP Calls** | External requests with URL, duration, and response code |
| **Autoloaded Options** | Option names, sizes, and sources contributing to autoload bloat |
| **Enqueued Assets** | Scripts and stylesheets with sizes and dependency chains |
| **Hook Execution Trace** | Full callback tree by WordPress lifecycle phase |
| **Timeline** | Visual timeline with phase milestone markers |

## Key Features

- **Background capture** with configurable sample rate (0.1%–100%)
- **Route-based grouping** with human-readable labels and status code breakdown
- **Pin & annotate** profiles with notes and tags
- **Automatic retention** — TTL + per-route cap, pinned profiles exempt
- **Cron inventory** — all registered WordPress cron events at a glance
- **REST API** — seven read-only endpoints for AI agent integration
- **Send to Agent** — one-click prompt with short-lived credentials
- **Send to Support** — zero-knowledge encrypted sharing via [scrutoscope.dev](https://scrutoscope.dev)
- **WP-CLI** — `wp scrutoscope status|list|show|delete|export|clear|rebuild-stats|mu-plugin`

## Requirements

- WordPress 6.0+
- PHP 7.4+

## Installation

### From GitHub Release

1. Download the latest `.zip` from [Releases](https://github.com/scrutineerhq/scrutoscope/releases)
2. In WordPress admin → Plugins → Add New → Upload Plugin
3. Upload the zip and activate

### From Source

```bash
git clone https://github.com/scrutineerhq/scrutoscope.git
cd scrutoscope
composer install --no-dev
```

Copy or symlink the `scrutoscope` directory into `wp-content/plugins/`.

## Quick Start

1. Activate the plugin
2. Go to **Tools → Scrutoscope**
3. Profiles start capturing automatically at 10% sample rate
4. Click any route to see the full profile detail
5. Use the **⚙️** gear to adjust capture rate and retention

## REST API

Scrutoscope exposes seven read-only REST endpoints under `wp-json/scrutoscope/`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/prompt` | System prompt — the API contract (text/plain) |
| `GET` | `/v1/diagnostics` | Site fingerprint with opt-in fields |
| `GET` | `/v1/routes` | Profiled routes with summary stats |
| `GET` | `/v1/regression` | Regression detection for a route |
| `GET` | `/v1/profile/{id}` | Full compiled profile |
| `GET` | `/v1/compare/{a}/{b}` | Two profiles with deltas |
| `GET` | `/v1/manifest` | Plugin capabilities manifest |

Authentication: WordPress Application Passwords. The **Send to Agent** button generates a short-lived credential automatically.

## Encrypted Sharing

Share a performance report with your support team or plugin developer:

1. Open a profile from the **History** tab
2. Click **Share** in the toolbar
3. Choose expiry, sections to include, and optional passphrase
4. Click **Encrypt & Share**

The report is encrypted in your browser with AES-256-GCM before upload. The relay server at `scrutoscope.dev` stores only ciphertext it cannot read. The decryption key lives in the URL fragment (`#key`) and never leaves your browser. Links are revocable and auto-expire.

## Design Philosophy

- **Read-only** — Scrutoscope measures. It never modifies your site.
- **Data first** — The dashboard leads with profiling data, not settings.
- **Trustworthy defaults** — Safe to activate and forget.
- **WordPress native** — Standard admin patterns, no custom dark themes.
- **Privacy by design** — No telemetry. SQL sanitized. Sharing is opt-in and encrypted.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).

## Links

- [scrutineer.dev](https://scrutineer.dev) — Project home
- [@scrutineer.dev](https://bsky.app/profile/scrutineer.dev) — Bluesky
- [GitHub](https://github.com/scrutineerhq/scrutoscope) — Source
