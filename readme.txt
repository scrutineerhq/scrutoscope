=== Scrutinizer ===
Contributors: scrutineerhq
Tags: performance, profiling, debug, optimization, profiler
Requires at least: 6.0
Tested up to: 7.0
Stable tag: 1.0.3
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

WordPress Performance Profiler — See where your server request duration is spent.

== Description ==

Scrutinizer is a read-only profiling plugin for WordPress. It instruments every hook callback during a page request and attributes the time to its source — plugin, theme, core, mu-plugin, or drop-in — so you can see exactly what's slow and why.

**By the author of [P3 (Plugin Performance Profiler)](https://wordpress.org/plugins/p3-profiler/).** Scrutinizer is the spiritual successor, rebuilt from scratch for modern WordPress.

= What It Measures =

* **Server Request Duration** — Total wall-clock time for the PHP request
* **Source Attribution** — Every hook callback traced to its plugin/theme/core with exclusive and inclusive timing
* **Database Queries** — Query text (sanitized), execution time, caller, and source
* **HTTP Calls** — External requests with URL, duration, and response code
* **Autoloaded Options** — Option names, sizes, and sources contributing to autoload bloat
* **Enqueued Assets** — Scripts and stylesheets with sizes and dependency chains
* **Hook Execution Trace** — Full callback tree by WordPress lifecycle phase
* **Timeline** — Visual timeline with phase milestone markers

= Key Features =

* Background capture with configurable sample rate (0.1%–100%)
* Route-based grouping with human-readable labels and status code breakdown
* Pin & annotate profiles with notes and tags
* Automatic retention — TTL + per-route cap, pinned profiles exempt
* Cron inventory — all registered WordPress cron events at a glance
* REST API — six read-only endpoints for AI agent integration
* Send to Agent — one-click prompt with short-lived credentials
* Send to Support — zero-knowledge encrypted sharing
* WP-CLI — `wp scrutinizer status|list|show|delete|export|clear|mu-plugin`

= Design Philosophy =

* **Read-only** — Scrutinizer measures. It never modifies your site.
* **Data first** — The dashboard leads with profiling data, not settings.
* **Trustworthy defaults** — Safe to activate and forget.
* **WordPress native** — Standard admin patterns, no custom dark themes.
* **Privacy by design** — No telemetry. SQL sanitized. Sharing is opt-in and encrypted.

== Installation ==

1. Download the latest release from [GitHub](https://github.com/scrutineerhq/scrutinizer/releases)
2. Upload the `scrutinizer` directory to `wp-content/plugins/`
3. Activate through the Plugins menu
4. Go to Tools → Scrutinizer

Profiles begin capturing automatically at 10% sample rate.

== Frequently Asked Questions ==

= Does Scrutinizer slow down my site? =

There are two kinds of overhead. An always-on check on every request — about 2ms or less — decides whether the request is being profiled; this is what every visitor pays, and it's negligible. When a request *is* being profiled (an admin session, or the sampled fraction of background traffic), instrumenting the hooks and timing every callback adds roughly 250ms in our benchmarks. Both vary a lot with your environment — number of active plugins, OPcache, whether MySQL is local or remote, your hardware, and current load — so we report what we measured rather than promising a number. At the default 10% background sample rate, most requests only pay the ~2ms check. And you're always one click from zero: deactivating Scrutinizer removes all overhead and keeps your captured profiles (only deleting the plugin removes the data).

= What data leaves my server? =

Nothing, unless you choose to share a report. The "Send to Support" feature encrypts your report in the browser before upload. The relay server never sees your data. No telemetry, no analytics, no phone-home.

= Does it work with WooCommerce? =

Yes. Scrutinizer profiles any WordPress request, including WooCommerce pages, AJAX calls, and REST API endpoints.

= Can I use it on a production site? =

Yes, with a low sample rate (0.1% or 1%). Scrutinizer is designed for background capture at scale. Use higher rates for focused debugging.

== Changelog ==

= 1.0.3 =
* Security: GDPR-compliant IP hashing — API log stores HMAC-SHA256 pseudonyms, not raw IPs
* Security: Activation tokens bound to issuing admin user ID
* Security: Proxy header spoofing fix (REMOTE_ADDR only by default)
* Security: Query strings stripped from profile URLs at write time
* New: Background profiling filters — user scope (all/anonymous/logged-in) and path exclusions
* New: Proxy trust settings with auto-detection
* New: Full-page settings view replaces settings modal
* Improved: Profile data compressed with gzip (smaller database footprint)
* Improved: Overhead claims updated with real benchmark numbers
* Improved: Settings page polish — card hierarchy, callout notes, layout fixes
* Community: 4 merged PRs from George Stephanis

= 1.0.2 =
* Improved: Early boot timer mu-plugin auto-installs on activation — bootstrap timing works without a WP-CLI step
* Improved: Uninstall cleans up the mu-plugin along with all other plugin data

= 1.0.1 =
* Fix: handle_prompt AJAX handler now returns proper JSON response
* Fix: API audit log table creation on activation
* Fix: Cron schedule registration runs only once per lifecycle
* Fix: WCAG contrast ratios for muted text and inactive tabs
* Fix: Timeline milestone labels no longer clip at container edges
* Fix: Query density strip zoom alignment
* Fix: Share payload field mapping for viewer compatibility
* Fix: Duplicate sort click handlers on History/Cron tabs
* Improved: Shared reports ledger with revocable links
* Improved: Profile TTL controls (7/14/30 day or never) with countdown badges
* Improved: Pinned and shared profiles exempt from TTL cleanup
* Improved: Queries pill labels are now context-aware
* Improved: Clean uninstall removes all tables, options, cron hooks, and app passwords

= 1.0.0 =
* Initial release
* Server request duration profiling with source attribution
* SQL query profiling with tokenizer-based sanitization
* HTTP call tracking
* Autoloaded options analysis
* Enqueued assets inventory
* Hook execution trace with phase grouping
* Timeline visualization with milestone markers
* Route-based grouping with human-readable labels
* Background capture with configurable sample rate
* Pin & annotate with notes and tags
* Profile retention with TTL and per-route cap
* Cron inventory
* REST API (6 endpoints)
* Send to Agent with Application Password credentials
* Send to Support with zero-knowledge encrypted sharing
* WP-CLI integration (7 commands)

== Screenshots ==

1. Dashboard — Routes view with source breakdown
2. Profile detail — Timeline visualization
3. Profile detail — Source attribution breakdown
4. Share — Zero-knowledge encrypted report sharing

== Upgrade Notice ==

= 1.0.3 =
Security hardening (IP hashing, token binding, proxy spoofing fix), background profiling filters, full-page settings view.

= 1.0.2 =
Auto-installs the early boot timer. Bootstrap timing now works out of the box.

= 1.0.1 =
Bug fixes and polish. Adds shared reports ledger and profile TTL controls.

= 1.0.0 =
Initial release.
