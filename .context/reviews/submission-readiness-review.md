# Scrutinizer Submission Readiness Review

Scope:

- `scrutinizer` WordPress plugin
- `scrutinizer-relay` Cloudflare Worker relay/viewer
- `.context` project constitution, invariants, backlog, decisions, and review panel personas

Review stance:

This is a pre-submission review with WordPress.org, security, privacy, performance, accessibility, support, and product-readiness lenses. The codebase is in good shape technically, and the recent security fixes appear to be present. I would still make a few trust/submission changes before sending this to WordPress.org or broadly promoting it.

## Overall Recommendation

**Needs work, but close.**

The remaining issues are not primarily failing tests or broken implementation. They are expectation, consent, and production-safety issues:

1. Make the early boot MU plugin explicit opt-in instead of auto-installed on activation.
2. Reconsider default-on `SAVEQUERIES`, or disclose its overhead more clearly.
3. Add a WordPress.org-style external-services disclosure for `https://scrutinizer.dev`.
4. Correct readme claims that conflict with code behavior or the project constitution.
5. Finish the release hygiene items still listed in `.context/BACKLOG.md`: JS i18n sweep and final screenshot preparation.

## Verification Performed

Plugin repo:

- `docker run --rm -v "$PWD":/app -w /app php:8.2-cli vendor/bin/phpunit --no-coverage`
  - Passed: `OK (100 tests, 250 assertions)`
- `docker run --rm -v "$PWD":/app -w /app php:7.4-cli sh -c 'find includes -name "*.php" -print0 | xargs -0 -n1 php -l >/dev/null && echo "7.4 OK"'`
  - Passed: `7.4 OK`
- `docker run --rm -v "$PWD":/app -w /app php:8.2-cli vendor/bin/phpcs`
  - Passed: `20 / 20 (100%)`
- `docker run --rm -v "$PWD":/app -w /app php:8.2-cli vendor/bin/phpcbf`
  - Passed: no violations found
- `git diff --check`
  - Passed

Relay repo:

- `npm test`
  - Passed: 12 tests
- `npm run check`
  - Passed: `node --check worker.js`
- `HOME=/private/tmp npm run build`
  - Passed: Wrangler dry-run build
- `git diff --check`
  - Passed

Both repos were clean after verification.

## High Priority Findings

### 1. MU plugin auto-install conflicts with the read-only/trust posture

Severity: High  
Personas: wp.org Plugin Reviewer, Security Reviewer, Agency CTO, Hosting Support, HN Heckler  
Files:

- `scrutinizer.php:119`
- `scrutinizer.php:142`
- `uninstall.php:68`
- `assets/mu-plugin/scrutinizer-early.php`
- `readme.txt:44`
- `readme.txt:103`

What:

On activation, Scrutinizer copies `assets/mu-plugin/scrutinizer-early.php` into `WPMU_PLUGIN_DIR . '/scrutinizer-early.php'`. That means activating the normal plugin also writes executable code into `wp-content/mu-plugins`, causing Scrutinizer code to run as a must-use plugin until removed.

Why it matters:

- The readme says: “Scrutinizer measures. It never modifies your site.”
- The constitution frames the product as read-only and local-first.
- A must-use plugin write is a meaningful site modification, even if it is plugin-owned and removed on deactivation.
- WordPress.org reviewers and managed-hosting reviewers will notice direct filesystem writes and executable code copied outside the plugin directory.
- Agencies and hosting support teams may treat auto-installed MU code as a production-risk surprise.

Recommendation:

Make early boot capture explicit opt-in.

Suggested behavior:

- Activation creates tables and schedules cleanup only.
- Dashboard shows an “Enable early boot timing” control with a short explanation.
- WP-CLI keeps `wp scrutinizer mu-plugin install|status|remove`.
- If the user enables it, show exactly what file will be written and where.
- If writing fails, surface an admin notice rather than silently degrading.
- If retained, disclose it in readme, FAQ, uninstall behavior, and privacy/trust copy.

Also change `uninstall.php` from raw `unlink()` to `wp_delete_file()` for consistency with deactivation.

### 2. `SAVEQUERIES` defaults on even when profiling is otherwise inactive

Severity: High/Medium  
Personas: Performance Skeptic, Hosting Support, Agency CTO, Plugin Author  
Files:

- `scrutinizer.php:30`
- `scrutinizer.php:46`
- `includes/Admin/Dashboard.php:111`
- `includes/Profiler/Profiler.php:193`
- `includes/Profiler/Profiler.php:1209`
- `readme.txt:63`

What:

If `SAVEQUERIES` is not already defined, Scrutinizer defines it as true by default via:

```php
get_option( 'scrutinizer_query_profiling', true )
```

Background profiling itself defaults off:

```php
get_option( 'scrutinizer_background_profiling', false )
```

So a fresh activation can enable WordPress query logging for every request even when full background profiling is disabled.

Why it matters:

- `SAVEQUERIES` causes WordPress to retain query text, timing, and caller data in memory.
- That overhead is paid outside full profiling sessions.
- It weakens the readme claim that non-profiled requests only pay a small always-on check.
- It creates an easy HN/performance-review criticism: the profiler changes the site’s baseline before the user asks to profile anything.

Recommendation:

Default query profiling off, or make enabling it a deliberate first-run choice.

Potential design:

- Keep basic query count always available through `$wpdb->num_queries`.
- Enable full SQL timing/details only when the admin turns on Query Profiling.
- If the constant cannot be toggled per request because of WordPress boot timing, explain that plainly in the UI.
- Update readme overhead language to distinguish:
  - inactive plugin overhead
  - active profiling overhead
  - query-log overhead when `SAVEQUERIES` is enabled

### 3. External service disclosure is not complete enough for WordPress.org

Severity: High/Medium  
Personas: wp.org Plugin Reviewer, Security Reviewer, Hosting Support, Agency CTO  
Files:

- `assets/js/dashboard.js:5122`
- `assets/js/dashboard.js:5548`
- `assets/js/dashboard.js:5610`
- `readme.txt:65`

What:

The dashboard sends encrypted report payloads and revocation requests to:

```js
https://scrutinizer.dev
```

The UI mentions a zero-knowledge relay, and the FAQ says sharing is optional and encrypted, but the readme does not provide a formal external-services disclosure.

Why it matters:

WordPress.org expects plugins to clearly disclose external services. For this plugin, the disclosure should be especially explicit because the plugin’s primary trust promise is “local-first, no telemetry, no phone-home.”

Recommendation:

Add an `External Services` section to `readme.txt` covering:

- Service name and URL: `Scrutinizer relay`, `https://scrutinizer.dev`
- Operator: The Scrutineer Project
- When it is contacted:
  - only when an admin clicks Encrypt & Share
  - when revoking a previously shared report
  - when opening a relay-hosted shared report
- What is sent:
  - encrypted report ciphertext
  - IV
  - TTL
  - burn-after-reading flag
  - passphrase KDF metadata if used
  - revoke token for deletes
  - normal HTTP metadata visible to any web service
- What is not sent:
  - decryption key, which stays in URL fragment
  - passphrase
  - plaintext profile data
- Retention:
  - expires after selected TTL
  - optional burn-after-reading
  - manual revocation
- Links to terms/privacy policy if available.

### 4. Readme claims conflict with actual defaults and privacy hardening

Severity: Medium  
Personas: wp.org Plugin Reviewer, Beginner, Freelancer, HN Heckler, Security Reviewer  
Files:

- `readme.txt:24`
- `readme.txt:44`
- `readme.txt:57`
- `readme.txt:63`
- `includes/Admin/Dashboard.php:111`
- `includes/Profiler/Storage.php:117`
- `includes/Api/Sanitizer.php:121`

What:

Several readme statements are too broad or stale:

- “It never modifies your site” conflicts with custom tables, options, cron events, app passwords, and the MU plugin copy.
- “Profiles begin capturing automatically at 10% sample rate” conflicts with `scrutinizer_background_profiling` defaulting false.
- “HTTP Calls — External requests with URL” should say host/destination, not full URL, because HTTP paths are now intentionally stripped.
- The overhead section mentions default 10% background profiling, but the code defaults background profiling off.

Recommendation:

Rewrite the trust/default language with narrower, defensible claims:

- “Scrutinizer does not change content, themes, plugins, or site behavior; it stores its own profiling data and settings.”
- “Background measurement is optional and defaults off.”
- “Outbound HTTP calls are reduced to scheme and host before storage/output.”
- “Query details require query profiling, which can add overhead because it uses WordPress `SAVEQUERIES`.”

## Medium Priority Findings

### 5. i18n is improved, but release hygiene is not finished

Severity: Medium  
Personas: wp.org Plugin Reviewer, Accessibility Auditor  
Files:

- `.context/BACKLOG.md:47`
- `.context/BACKLOG.md:70`
- `includes/Admin/Dashboard.php:87`
- `languages/scrutinizer.pot`
- `languages/.gitkeep`

What:

The dashboard script depends on `wp-i18n`, and `wp_set_script_translations()` is configured. The `.pot` file exists. However, `.context/BACKLOG.md` still lists the JS string sweep as a remaining wp.org blocker, and there are no generated JS translation JSON files in `languages/`.

Notes:

WordPress.org language packs can generate JS translation files after release, so missing local JSON files may not be a hard blocker for dotorg. But the backlog still identifies the sweep as unfinished, and final release packaging should verify the POT is fresh.

Recommendation:

- Run a final string audit.
- Regenerate the POT.
- Decide whether to ship generated JS translation JSON files or rely on WordPress.org language packs.
- Remove or update stale backlog items once complete.

### 6. Screenshots exist, but final screenshot preparation is still marked incomplete

Severity: Medium/Low  
Personas: wp.org Plugin Reviewer, Beginner, Freelancer, Hosting Support  
Files:

- `.context/BACKLOG.md:67`
- `.wordpress-org/screenshot-1.png`
- `.wordpress-org/screenshot-2.png`
- `.wordpress-org/screenshot-3.png`
- `.wordpress-org/screenshot-4.png`
- `readme.txt:140`

What:

Screenshots are present under `.wordpress-org/`, and `readme.txt` has screenshot captions. The backlog still marks screenshot preparation as incomplete.

Recommendation:

- Verify screenshots match the final UI and captions.
- Ensure they show the strongest first-use path:
  - routes/source breakdown
  - profile detail timeline
  - source attribution
  - shared encrypted report
- Make sure screenshot 1 communicates value to a non-expert in a few seconds.

### 7. Prompt copy still says HTTP calls include URL

Severity: Low/Medium  
Personas: AI-Native Developer, Security Reviewer  
Files:

- `includes/Api/Prompt.php:99`

What:

The agent prompt says HTTP calls are captured with URL. Current privacy hardening reduces outbound HTTP URLs to scheme and host, which is the right behavior.

Recommendation:

Update prompt language to say “destination host” or “scheme and host” instead of “URL.” This keeps the AI contract aligned with the privacy invariant and reduces agent confusion.

### 8. Public manifest endpoint appears intentional, but document the versioning story

Severity: Low  
Personas: AI-Native Developer, Security Reviewer, wp.org Plugin Reviewer  
Files:

- `includes/Api/RestApi.php:130`

What:

`/scrutinizer/v1/manifest` is public by design. That is reasonable if it only exposes non-sensitive API metadata. It should remain intentionally sparse and avoid precise patch/build details.

Recommendation:

Document that the manifest is public, what it exposes, and why. Consider adding schema/version fields that help agents adapt without exposing site-sensitive details.

## Security Review Notes

### Positive Findings

REST authorization:

- Protected REST routes use `permission_callback`.
- `check_permission()` requires `manage_options`.
- The manifest endpoint is the only public REST route and appears intentional.

AJAX authorization:

- AJAX handlers are centrally registered through a guard.
- The guard checks both nonce and `manage_options`.

Application Password hardening:

- Scrutineer-owned Application Passwords are captured and checked.
- Non-REST use is rejected through both `authenticate` and `determine_current_user`.
- REST route scope is restricted to `/scrutinizer/v1/*`.
- TTL is enforced and expired credentials are revoked.

Data minimization:

- HTTP call URLs are reduced to scheme and host on write/read/output.
- SQL is reduced defensively on output paths.
- Stored profiles are sanitized again when read, which protects legacy rows from older sanitizer behavior.

No obvious remote asset loading:

- Admin scripts/styles are enqueued from local plugin assets.
- Relay calls are user-triggered through sharing/revocation.

### Remaining Hardening

- Replace `unlink()` in uninstall with `wp_delete_file()`.
- Make the MU plugin opt-in.
- Strengthen external-service disclosure.
- Keep readme and prompt text aligned with the hard “never collect full URLs” invariant.
- Consider adding regression tests for readme/prompt wording around full URLs if this has regressed before.

## Panel Findings

### wp.org Plugin Reviewer

Readiness: Needs work  
Estimated first-submission outcome: likely returned for revisions unless disclosure/default behavior is fixed.

Top concerns:

- Auto-installing a MU plugin on activation.
- Missing external-services disclosure for `scrutinizer.dev`.
- Overbroad readme claims.
- Incomplete i18n/screenshot checklist.

Strengths:

- Good plugin header/readme structure.
- GPL-compatible license.
- Custom tables and cleanup are present.
- Security posture is much improved.
- Tests and PHPCS pass.

### Security Reviewer

Posture: Strong, with trust/disclosure issues remaining.

No current showstopper was found in nonce/capability checks, REST permission callbacks, app-password scoping, or output sanitization based on this pass.

The remaining security-adjacent issue is the gap between behavior and promises: MU plugin installation, external relay use, and query logging should all be explicit enough that an enterprise reviewer is not surprised.

### Performance Skeptic

Trust level: Good for profiled requests, but default overhead story needs tightening.

Main criticism:

The plugin should not change global query logging by default while claiming low inactive overhead. If `SAVEQUERIES` is on, document and measure that overhead separately.

Suggested doc language:

“Like all profilers, Scrutinizer changes the request it observes. Use it for attribution and relative comparisons, not as a zero-overhead benchmark. Query detail requires WordPress `SAVEQUERIES`, which adds memory and timing overhead.”

### Hosting Support

Triage utility: High, once first-run safety is clearer.

Support value:

- Source attribution, HTTP calls, cron inventory, and shared reports are highly useful.
- Secure report sharing is a real improvement over asking customers for wp-admin access.

Concern:

Support teams will be cautious about recommending a plugin that auto-installs MU code and enables query logging by default.

### Agency CTO

Team adoption readiness: Medium-high after default behavior changes.

Strengths:

- WP-CLI commands.
- REST API.
- Share/export flow.
- Regression comparison.
- Retention controls.

Blockers for fleet use:

- Need predictable production defaults.
- Need clear managed-hosting behavior when filesystem writes fail.
- Need explicit docs on database growth and cleanup.

### Plugin Author

Attribution trust: Promising.

Strengths:

- Inclusive vs exclusive timing matters to plugin authors.
- Source attribution and trace views help defend or confirm “your plugin is slow” claims.
- Shared reports can make support tickets more concrete.

Missing:

- A concise methodology doc explaining attribution edge cases:
  - closures
  - nested hooks
  - callbacks that call other callbacks
  - overhead not subtracted from callback time
  - shutdown/deferred work

### WordPress Core Contributor

Measurement integrity: Good, assuming by-reference callback handling and wrapper cleanup remain covered by tests.

Strengths:

- PHP 7.4 lint passes.
- PHPCS passes.
- Uses `hrtime()`-style nanosecond timing internally.
- Handles short-circuited HTTP requests and `blocking => false` more accurately after recent fixes.

Hardest edge case:

The profiler necessarily changes callback execution by wrapping callbacks. The docs should acknowledge that this is a WordPress-layer profiler, not a C-extension profiler like Blackfire.

### AI-Native Developer

Agent readiness: High.

Strengths:

- `/v1/prompt`
- `/v1/manifest`
- Scoped, short-lived Application Passwords
- Structured profile/compare/regression endpoints
- Diagnostics opt-in

Missing feature:

Add an OpenAPI or JSON Schema endpoint. A prompt is useful, but schemas make agent integrations more deterministic and easier to validate.

### Accessibility Auditor

Status: Improved, but requires a final manual pass.

Context indicates:

- ARIA tab pattern work has been done.
- Keyboard navigation work has been done.
- Focus management and live announcements have been added.

Remaining recommendation:

Before submission, do a final keyboard-only and screen-reader pass on:

- route list
- profile detail tabs
- trace explorer
- share panel
- settings view
- shared report viewer

Also verify contrast in final screenshots and ensure icon-only controls have accessible labels.

### Solo Freelancer

Time-to-value: Potentially strong.

Strength:

The product can answer “which plugin/source owns the time?” much faster than manual plugin deactivation.

Concern:

The first-run experience should avoid surprises. A freelancer will trust it more if background profiling, query profiling, and early boot timing are clearly controlled and reversible.

Suggested improvement:

Add a “Quick profile this page” first-run flow that produces one useful result without requiring the user to understand background sampling or query profiling first.

### WordPress Beginner

Beginner friendliness: Moderate.

Strength:

The dashboard can show the slowest source clearly.

Risk:

Terms like route, hook, callback, exclusive time, inclusive time, autoloaded options, and cron are advanced.

Suggested improvement:

Add plain-language labels beside the technical terms, without turning the dashboard into a tutorial. For example:

- “Exclusive time” -> “time spent inside this source”
- “HTTP calls” -> “outbound requests your site waited on”
- “Cron” -> “scheduled background tasks”

### HN Heckler

Show HN readiness: Good after trust-copy fixes.

Likely upvoted criticisms:

- “It says read-only, but activation writes a MU plugin.”
- “It claims low overhead, but enables `SAVEQUERIES` by default.”
- “It says no data leaves the server, but there is a relay domain in the JS.”
- “A PHP-level hook profiler is useful, but do not oversell it as precise application profiling.”

Positioning recommendation:

Pitch it honestly as:

“A local-first WordPress hook/source attribution profiler for finding which plugin, theme, cron job, query, or HTTP dependency owns server-side request time. It complements Query Monitor and Blackfire rather than replacing them.”

## Feature Suggestions

### Before WordPress.org submission

1. MU plugin opt-in flow.
2. Default-off query profiling or explicit first-run consent.
3. External-services readme section.
4. Readme wording cleanup.
5. Final i18n sweep and POT refresh.
6. Final screenshots.
7. One manual accessibility pass.
8. Prompt wording cleanup around HTTP host-only capture.

### Soon after submission

1. OpenAPI or JSON Schema endpoint for agent integrations.
2. First-run “capture one profile now” path.
3. Methodology page:
   - what is measured
   - what is not measured
   - observer overhead
   - exclusive vs inclusive time
   - source attribution caveats
4. Database growth/retention documentation with example storage sizes.
5. Managed-hosting compatibility notes:
   - filesystem write restrictions
   - custom table creation
   - object cache compatibility
   - page cache caveats

### Larger roadmap suggestions

1. Cron profiling integration:
   - per-hook cost column
   - profile history filtered by cron hook
   - spike detection
   - worst execution highlight
2. Long-term trend sparklines from aggregate route stats.
3. Client/support report mode:
   - a simplified “what changed / who owns time” export
   - suitable for ticket replies or client deliverables
4. Core subsystem attribution:
   - split the “core” bucket into Query, Options, Blocks, REST, i18n, etc.
5. “Lightweight mode”:
   - source totals without full trace
   - lower memory overhead for busy production sites

## Suggested Readme Copy Changes

Replace:

> Scrutinizer measures. It never modifies your site.

With:

> Scrutinizer does not change content, themes, plugins, or site behavior. It stores its own profiling tables, settings, scheduled cleanup events, and optional sharing records. Early boot timing is optional and uses a small must-use plugin when enabled.

Replace:

> Profiles begin capturing automatically at 10% sample rate.

With:

> Background measurement is optional and defaults off. To capture a profile, open Tools -> Scrutinizer and start a profiling session or enable background measurement with a sample rate you choose.

Replace:

> HTTP Calls — External requests with URL, duration, and response code

With:

> HTTP Calls — External request destination host, duration, response code, and whether PHP waited for the response. Paths and query strings are stripped before storage/output.

Add:

> Query details require WordPress `SAVEQUERIES`. When enabled, WordPress stores query timing and caller information in memory for the request, which adds overhead. Leave query profiling off when you only need high-level request/source timing.

## Bottom Line

The recent security fixes appear solid. I did not find a remaining obvious authz/CSRF/data-leak bug in this pass. The main pre-submission issue is trust alignment: make surprising behavior explicit, opt-in, and documented.

If the author fixes MU plugin opt-in, `SAVEQUERIES` default/disclosure, external-service disclosure, and readme accuracy, I would consider this ready for a WordPress.org submission pass.
