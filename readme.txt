=== Scrutinizer ===
Contributors: scrutineerhq
Tags: performance, profiler, p3, p3-profiler, profiling
Requires at least: 6.0
Tested up to: 7.0
Stable tag: 1.1.0
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
* **HTTP Calls** — External request destination host (paths and query strings are stripped), duration, response code, and whether PHP waited for the response (blocking vs. async)
* **Autoloaded Options** — Option names, sizes, and sources contributing to autoload bloat
* **Enqueued Assets** — Scripts and stylesheets with sizes and dependency chains
* **Hook Execution Trace** — Full callback tree by WordPress lifecycle phase
* **Timeline** — Redesigned request timeline: a cost-sorted ownership bar names the culprit, over a chronological view with phase markers, HTTP and query-density lanes, and a memory curve

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

* **Read-only by design** — Scrutinizer does not change your content, themes, plugins, or site behavior. It stores its own profiling tables, settings, and scheduled cleanup events (plus a record per report you choose to share). Optional early-boot timing adds a small must-use plugin only when you enable it.
* **Data first** — The dashboard leads with profiling data, not settings.
* **Off until asked** — Background measurement, query profiling, and early-boot timing are all opt-in. A fresh install just adds its tables and a cleanup task.
* **WordPress native** — Standard admin patterns.
* **Privacy by design** — No telemetry. SQL is reduced to verb + table; outbound HTTP URLs are reduced to scheme + host. Sharing is opt-in and end-to-end encrypted.

== Installation ==

1. Download the latest release from [GitHub](https://github.com/scrutineerhq/scrutinizer/releases)
2. Upload the `scrutinizer` directory to `wp-content/plugins/`
3. Activate through the Plugins menu
4. Go to Tools → Scrutinizer

Background measurement is optional and **off by default**. To capture a profile, open Tools → Scrutinizer and start a profiling session, or enable background measurement with a sample rate you choose.

== Frequently Asked Questions ==

= Does Scrutinizer slow down my site? =

There are two kinds of overhead. An always-on check on every request — about 2ms or less — decides whether the request is being profiled; this is what every visitor pays, and it's negligible. When a request *is* being profiled (an admin session, or the sampled fraction of background traffic), instrumenting the hooks and timing every callback adds roughly 250ms in our benchmarks. Both vary a lot with your environment — number of active plugins, OPcache, whether MySQL is local or remote, your hardware, and current load — so we report what we measured rather than promising a number. Background measurement is off by default; when you turn it on you choose the sample rate, and at a low rate most requests only pay the ~2ms check. Query detail is a separate opt-in: enabling Query Profiling turns on WordPress `SAVEQUERIES`, which makes WordPress keep query text, timing, and caller in memory for the request — extra overhead you only pay when you ask for query detail, so leave it off when you just need request and source timing. And you're always one click from zero: deactivating Scrutinizer removes all overhead and keeps your captured profiles (only deleting the plugin removes the data).

= What data leaves my server? =

Nothing, unless you choose to share a report. The "Send to Support" feature encrypts your report in the browser before upload. The relay server never sees your data. No telemetry, no analytics, no phone-home.

= Does it work with WooCommerce? =

Yes. Scrutinizer profiles any WordPress request, including WooCommerce pages, AJAX calls, and REST API endpoints.

= Can I use it on a production site? =

Yes, with a low sample rate (0.1% or 1%). Scrutinizer is designed for background capture at scale. Use higher rates for focused debugging.

== External Services ==

Scrutinizer is local-first and does not phone home. It contacts exactly one external service, and only when you explicitly choose to share a report.

**Service:** Scrutinizer relay — zero-knowledge report sharing.
**Provided by:** The Scrutineer Project (https://scrutinizer.dev). Relay source: https://github.com/scrutineerhq/scrutinizer-relay

**When it is contacted (admin-initiated only):**

* When you click **Send to Support** / **Encrypt & Share** to create a shared report.
* When you **revoke** a report you previously shared.
* When you open a relay-hosted shared report link in your browser.

It is never contacted during normal profiling, page loads, or background capture.

**What is sent:**

* The **encrypted** report ciphertext and its initialization vector (IV).
* The time-to-live (TTL) you choose and an optional burn-after-reading flag.
* Key-derivation metadata if you set a passphrase — never the passphrase itself.
* A revoke token, so you can delete the report later.
* Normal HTTP request metadata (IP address, user agent) visible to any web service.

**What is never sent:**

* The decryption key — it stays in the URL fragment (after `#`), which browsers never transmit to the server.
* Your passphrase.
* Any plaintext profile data.

**Data retention:** a shared report expires after the TTL you choose, can be set to burn after its first read, and can be revoked manually at any time. The relay only ever stores ciphertext.

== Changelog ==

= 1.1.0 =
This release focuses on trust — opt-in defaults and honest disclosure — alongside a redesigned timeline and deeper attribution.

* New: Redesigned Request Timeline — a cost-sorted "who owns the time" bar names the culprit at a glance, over a chronological timeline with WordPress lifecycle phase markers. Unattributed time is always shown (never hidden); HTTP waits and database-query density get their own lanes; memory is drawn as a growth curve. Colour-blind-safe (Okabe–Ito) palette, with zoom and pan.
* New: One shared timeline renderer — a profile looks identical in the dashboard and in a shared report, which now also has a dark mode.
* New: Core-developer attribution — the single "core" bucket splits into WordPress subsystems (Query, Options, Blocks, REST, i18n…); deprecations and _doing_it_wrong() notices are captured with the source that triggered them; just-in-time translation loads are surfaced with the hook that caused them; and the pre-plugin bootstrap is split into must-use vs. active-plugin loading.
* New: Accurate outbound-HTTP timing — each call records whether PHP actually waited (blocking) or fired-and-forgot (async), shown distinctly on the timeline, instead of inferring it from duration.
* New: Memory over time — memory is sampled at each lifecycle phase, so the timeline shows an honest growth curve with the peak labelled.
* New: Regression detection — a verdict (Likely regression / Difference observed / Within noise / Insufficient data) from comparing a route against its own history, with a long-term aggregate that survives deploys and the 7-day profile retention. Detection only — it never blocks or changes anything.
* Changed: Early-boot timing is now opt-in — activation no longer writes a must-use plugin; enable it from Settings (or WP-CLI) when you want pre-plugin bootstrap timing.
* Changed: Query profiling (SAVEQUERIES) now defaults off — enable it from Settings when you need per-query detail; the basic query count is always available.
* Changed: Outbound HTTP URLs are reduced to scheme + host (paths and query strings stripped) on write, read, and output, because paths can carry secret tokens.
* Security: Fixed a bypass where a Scrutineer Application Password (scoped to REST with a short expiry) could be used over XML-RPC, skipping both scope and expiry.
* Security: Legacy stored profiles are re-sanitized on read and output, so older rows can't leak a full outbound URL through a share or export. Also hardened the WP-CLI export, report-sharing, deactivation/uninstall cleanup, and the autoloader.
* Fixed: Shared-report viewer — trace callbacks show their names grouped by hook, the breakdown bar renders correctly, the timeline follows dark mode, and duplicate tabs are removed.
* Accessibility: Full ARIA tab pattern with arrow-key navigation, focus management on view changes, and screen-reader announcements for dynamic content.
* i18n: All dashboard strings are translatable; a fresh translation template (.pot) ships with the plugin.
* Docs: Added an External Services disclosure for the optional report-sharing relay, and corrected readme/agent wording to match the privacy behavior (host-only HTTP, opt-in defaults).

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
2. Profile detail — the redesigned Request Timeline: cost-sorted ownership bar, phase rail, HTTP and query-density lanes, and a memory curve
3. Profile detail — Source attribution breakdown
4. Shared report — viewed in the zero-knowledge relay (decrypted entirely in the browser); the same timeline renders here as in the dashboard

== Upgrade Notice ==

= 1.1.0 =
Heads-up on two default changes: early-boot timing is now opt-in (no must-use plugin is written on activation), and query profiling (SAVEQUERIES) now defaults off — enable either from Settings. Also: a redesigned Request Timeline, core-developer attribution, accurate blocking-vs-async HTTP timing, and security hardening.

= 1.0.3 =
Security hardening (IP hashing, token binding, proxy spoofing fix), background profiling filters, full-page settings view.

= 1.0.2 =
Auto-installs the early boot timer. Bootstrap timing now works out of the box.

= 1.0.1 =
Bug fixes and polish. Adds shared reports ledger and profile TTL controls.

= 1.0.0 =
Initial release.
