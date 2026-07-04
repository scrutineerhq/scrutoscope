# GOTCHAS

> Lessons learned the hard way. Every "don't" is paired with a "do."
> Append new entries when a mistake is discovered. Never remove entries.

---

### Server Request Duration ≠ page load time

**What happened (P3 era):** P3 reported "page load time" which users interpreted as what Chrome DevTools showed. The metric was actually server execution time. Support tickets followed.

**Don't:** Use "page load," "load time," or any term that implies browser rendering.
**Do:** Always say "Server Request Duration." In the dashboard, define it on first display: "Wall-clock time WordPress spent serving this request on the server."

---

### `microtime()` is not monotonic

**What happened:** PHP's `microtime(true)` can jump backward on NTP adjustments, VM live migrations, or container clock skew. Negative timing deltas break exclusive time calculation.

**Don't:** Use `microtime()` for timing instrumentation.
**Do:** Use `hrtime(true)` (available since PHP 7.3). It's monotonic and nanosecond-precision. The minimum PHP version is 7.4, so this is always available.

---

### `all` hook is a performance sinkhole

**What happened (other profilers):** Registering a WordPress `all` hook fires the profiler callback on every `do_action` and `apply_filters` call — hundreds per request. The overhead alone changes what you're measuring.

**Don't:** Use `add_action('all', ...)` or `add_filter('all', ...)` for instrumentation.
**Do:** Wrap individual callbacks at registration time. More code upfront, but the overhead stays proportional to what actually fires, not the total hook surface area.

---

### Nested callback attribution is the hard problem

**What happened (P3 era):** P3 attributed all time to the outermost callback. A theme calling `apply_filters('the_content')` got charged for every content filter — Yoast SEO, shortcodes, oEmbed. Misleading results.

**Don't:** Report only inclusive time. Don't assume the first callback in a hook is responsible for everything that runs inside it.
**Do:** Track the call stack depth. Exclusive time = inclusive time minus time spent in observed nested callbacks. Both metrics are stored and displayed. Inclusive tells you "everything that happened while this was active." Exclusive tells you "what this specific callback did."

---

### WordPress coding standards require specific array syntax

**What happened:** PHP short array syntax (`[]`) is allowed by WordPress-Extra since WPCS 3.0, but older phpcs configs or custom rules may flag it. Mixed styles in one file look sloppy.

**Don't:** Mix `array()` and `[]` syntax within the same file.
**Do:** Use `array()` consistently throughout. The phpcs.xml.dist enforces WordPress-Extra, which is the standard for wp.org plugins. Consistency matters more than personal preference.

---

### Cookie flags matter for profiling security

**What happened:** If the profiling cookie isn't HttpOnly, any XSS on the site lets an attacker start profiling sessions. If it isn't Secure, it leaks over HTTP. If it isn't SameSite=Strict, cross-origin requests can trigger profiling.

**Don't:** Set profiling cookies with default flags.
**Do:** Always set HttpOnly, Secure (skippable on localhost for dev), SameSite=Strict. The profiling cookie is an authorization token — treat it like one.

---

### HMAC activation URLs must expire quickly

**What happened:** Long-lived activation URLs are bookmark-shareable. Someone could accidentally profile a site weeks later by clicking an old link.

**Don't:** Issue activation tokens valid for more than a few minutes.
**Do:** Include a Unix timestamp in the HMAC payload. Reject tokens older than 5 minutes. Include the admin user ID — tokens are non-transferable.

---

### wp.org review catches remote asset loading

**What happened:** Plugins loading JS/CSS from CDNs or external domains get flagged in wp.org review. Even Google Fonts hosted externally can delay approval.

**Don't:** Enqueue scripts or styles from external URLs.
**Do:** Bundle everything locally. `wp_enqueue_script()` and `wp_enqueue_style()` should only reference `plugins_url()` paths. No CDN fallbacks, no remote fonts.

---

### PHP 7.4 means no typed properties

**What happened:** Typed class properties (`public int $count = 0;`) are PHP 7.4+ but *class* typed properties are syntactically valid yet behaviorally different from what you'd expect with strict_types. More importantly, readonly properties (8.1), enums (8.1), intersection types (8.1), and fibers (8.1) are out.

**Don't:** Use PHP 8.x features anywhere in the main plugin code. Don't assume CI catching it is enough — devs run code locally on newer PHP and miss the error.
**Do:** Test on PHP 7.4 in CI. Use docblock `@var` annotations for type hints. Class properties use defaults and runtime checks, not language-level type enforcement.

---

### Wrapping by-reference callbacks breaks their contract AND login

**What happened:** POC site with Wordfence installed — login completely broken. `Instrumentor::wrap_callback()` used `func_get_args()` + `call_user_func_array()` to invoke the original callback. This strips PHP pass-by-reference semantics. Wordfence's `authAction(&$username, &$passwd)` on `wp_authenticate` (a `do_action_ref_array` hook) triggered two PHP warnings, which with `display_errors` on produced HTML output before HTTP headers were sent. WordPress couldn't set auth cookies → "Cookies are blocked due to unexpected output" → login impossible.

The warnings were the visible symptom, but the real problem is deeper: even with warnings suppressed, the reference modifications to `$username` and `$passwd` wouldn't propagate back to the caller. The callback's contract is silently broken.

**Don't:** Wrap callbacks that have `&$param` parameters. `func_get_args()` always returns copies — there is no way in PHP to forward variadic arguments while preserving references through a generic closure wrapper.
**Do:** Use `Reflection` at wrap time to detect by-reference parameters. Skip instrumenting those callbacks entirely. The loss of profiling data for a handful of ref-param callbacks is correct — we literally cannot observe them without changing their behavior. `has_reference_params()` in `Instrumentor.php` handles this.

---

### PHPCS array alignment is strict and catches cross-array inconsistencies

**What happened:** CI failed on `Report.php` because adding new keys to an existing array changed the longest key name, which meant ALL other keys' spacing needed to change to stay aligned. PHPCS treats unaligned double arrows as warnings but they still fail CI.

**Don't:** Add keys to a multi-line array and assume only the new line needs spacing.
**Do:** When adding keys to a WPCS-linted array, check if the new key is longer than existing keys. If so, realign ALL double arrows in that array to match the new longest key. The `[x]` flag means PHPCBF can auto-fix, but since we don't have local composer/phpcs, catch this manually before pushing.

---

### `plugins_loaded` fires AFTER plugins are loaded, not during

**What happened:** Phase marker for `plugins_loaded` captures the time when that action fires, not when plugins started loading. The profiler boots at `plugins_loaded` priority 0, so anything that happened before that (mu-plugins loading, earlier plugin bootstraps) is invisible. The `muplugins_loaded` marker won't fire if the profiler isn't active yet.

**Don't:** Claim the timeline shows "everything from PHP startup." It doesn't — it shows from profiler boot forward.
**Do:** Be honest about the timeline's starting point. Unattributed time includes real pre-profiler overhead. The tooltip explains this accurately.

---

### Query sanitization must reduce, not mask

**What happened:** The original `sanitize_query()` replaced literal values with `%s`/`%d` placeholders and collapsed IN/VALUES clauses, but preserved the full query structure — column names, WHERE predicates, ORDER BY, LIMIT, GROUP BY, HAVING, all of it. This leaked table schema details, query patterns, and structural information about the site. The bug was fixed, regressed, was fixed again, and regressed a second time because the approach (mask values) was fundamentally wrong.

**Don't:** Sanitize SQL by substituting values while keeping structure. Regex-based literal replacement is fragile and always misses edge cases. Even "structure-preserving sanitization" leaks information — column names reveal schema, WHERE clauses reveal business logic, JOINs reveal relationships.
**Do:** Reduce queries to verb + table name(s) only. `SELECT option_value FROM wp_options WHERE option_name = 'foo' LIMIT 1` becomes `SELECT wp_options`. Period. The reduction is applied at write time (Profiler::sanitize_query) and again at read time (Sanitizer::sanitize_sql) as defense-in-depth. Both implementations must stay in sync. If a stored query contains any SQL keyword beyond the verb, it's a regression.

---

### Duplicate delegated click handlers fire on same CSS class

**What happened:** Two separate `$( document ).on( 'click', '.scrutoscope-sortable', ... )` handlers were registered at lines 183 and 289. One handled detail-view table sorts (queries, http calls, assets via `data-sort-table`), the other handled list-view sorts (grouped, route, history, cron via `data-sort`). Every sort click fired both handlers — one did useful work, the other did a wasted no-op lookup.

**Don't:** Bind multiple delegated handlers to the same CSS class selector when they handle different concerns.
**Do:** Use attribute selectors to namespace: `[data-sort-table]` for detail-view tables, `[data-sort]` for list-view tables. The CSS class stays shared for styling, but event delegation targets only the relevant elements.

---

### Triggering WP-Cron manually needs the right lock — or no lock

**What happened:** Testing cron profiling, I curled `wp-cron.php?doing_wp_cron=<random>` to fire due events. Nothing ran. `wp-cron.php` compares the `doing_wp_cron` GET param against the `doing_cron` transient lock; a mismatched value makes it exit early without running anything. And `wp cron event run` (WP-CLI) defines `WP_CLI`, which the profiler excludes from sampling — so that path is never profiled either.

**Don't:** Pass an arbitrary `doing_wp_cron` value, and don't expect `wp cron event run` to produce a profiled cron request.
**Do:** Clear any held lock (`wp transient delete doing_cron`), then hit `wp-cron.php` with **no** `doing_wp_cron` param — it sets the lock itself and runs due events. That's a real `DOING_CRON` web request the profiler can sample.

---

### Single cron events vanish from `_get_cron_array()` once they fire

**What happened:** Cron profiling aggregates per-hook cost and filters to scheduled cron hooks via `_get_cron_array()`. Reading the array at the **end** of the request missed single events entirely — `wp_schedule_single_event()` entries are removed from the cron array the moment they run, so by `stop()` they're gone. Recurring hooks survived (they get rescheduled), so the bug only showed for one-shot events.

**Don't:** Read `_get_cron_array()` at request end to decide which hooks were cron events.
**Do:** Snapshot the scheduled hook names at profiler **start** (before they fire) and use that snapshot at the end. `Profiler::$cron_hooks` captures it in `start()` when `DOING_CRON`.

---

### Regex backslashes inside the relay's `VIEWER_HTML` template literal need doubling

**What happened:** The relay's entire client SPA lives inside one big template-literal string (`VIEWER_HTML = ` + backticks). A trace-cleanup `replace(/#\d+/g, '')` silently did nothing — the template literal evaluates `\d` to `d` (an unrecognized escape drops the backslash), so the **served** regex became `/#d+/g` and never matched. Standalone the regex was fine; only inside the template literal did it break.

**Don't:** Write `\d`, `\s`, `\b`, `\w` (etc.) in a regex literal that sits inside the `VIEWER_HTML` template string.
**Do:** Double-escape so the served code is right: `/#\\d+/g` in source → `/#\d+/g` at runtime. Existing viewer regexes (e.g. `/\\b\\w/g`) already do this — match the convention.

---

### Synthetic test fixtures can hide real data-shape mismatches

**What happened:** The relay's Trace tab showed everything under "other" with no names. The fix read `item._hook` / `item._callback` — and an e2e test with a fixture that *had* those fields passed green. But the real trace item has no such fields: it carries one composite id, `"callback@hook:priority"` (e.g. `wp_initialize_theme_preview_hooks@plugins_loaded:1`). The made-up fixture matched the *wrong* code instead of reality, so the test "passed" while production was broken.

**Don't:** Hand-author fixtures from what the code expects. A green test against an invented shape proves nothing.
**Do:** Capture a real profile (`wp eval` a stored one on the host) to learn the actual field shape, then build fixtures from that. The relay parses the composite `id` (split on the last `@`, then the last `:`) — there are no separate hook/callback fields.
