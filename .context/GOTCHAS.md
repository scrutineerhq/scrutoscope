# GOTCHAS

> Lessons learned the hard way. Every "don't" is paired with a "do."
> Append new entries when a mistake is discovered. Never remove entries.

---

### WordPress.org slug is not pre-reservable

**What happened:** Early planning assumed the slug `scrutinizer` could be claimed before submission. WordPress.org assigns plugin slugs at final submission time — there's no reservation system.

**Don't:** Reference a specific wp.org slug in documentation, URLs, or code as though it's guaranteed.
**Do:** Use the plugin's own domain (`scrutineer.dev/scrutinizer`) as the canonical Plugin URI. Accept that the wp.org slug may differ from the package name.

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

### Shared hosting doesn't have `hrtime()`... wait, it does

**What happened:** Initial concern that cheap shared hosts would run PHP < 7.3 without `hrtime()`. Reality: the minimum WP requirement is moving up, and the plugin requires PHP 7.4+ already, which guarantees `hrtime()`.

**Don't:** Add a `microtime()` fallback "just in case."
**Do:** Require PHP 7.4+ (which the plugin already does). `hrtime(true)` is guaranteed available. One code path, no fallbacks.

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
