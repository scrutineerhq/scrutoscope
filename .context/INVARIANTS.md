# INVARIANTS

> Things that must ALWAYS be true. Adding or removing an invariant requires explicit discussion.
> Each invariant includes a verification method.

## Measurement Contract

- [ ] **Server Request Duration is wall-clock PHP/WP execution.** It is never called "page load." It never includes browser time.
  - _Verify:_ `grep -ri "page.load\|page load" --include="*.php" includes/` — zero user-facing results.

- [ ] **Exclusive + nested = inclusive.** Exclusive Callback Time = inclusive minus observed nested. These are distinct fields in every stored profile.
  - _Verify:_ `Report::compile()` produces separate `exclusive_ns` and `inclusive_ns` fields per callback.

- [ ] **Unattributed time is always shown.** Every profile view displays the gap between Server Request Duration and sum of exclusive callback times. Never hidden, never merged.
  - _Verify:_ Dashboard template includes unattributed time metric card.

- [ ] **No causal language.** UI and CLI never say "caused" or "slow" for a plugin. Allowed: "associated with," "observed increase," "largest exclusive time."
  - _Verify:_ `grep -ri '"caused\|"slow"\|causes\|is slow' --include="*.php" includes/ assets/` — zero results.

## Data Boundaries

- [ ] **No network requests without explicit admin action.** Installing, activating, updating, or using the profiler locally produces zero outbound HTTP. Sharing requires deliberate button press.
  - _Verify:_ Deactivate sharing in test. `tcpdump` during a full profiling cycle — no outbound connections.

- [ ] **Hard never-collect fields are enforced.** Passwords, cookies, auth headers, tokens, salts, private keys, DB creds, raw SQL literals, POST bodies, file contents, visitor data — all excluded from profiles, reports, and shared artifacts.
  - _Verify:_ `Storage::sanitize_profile()` strips these. Test suite covers each category.

- [ ] **Output boundary: inspect transiently, persist only aggregates.** Measurement may read a backtrace or callback context to *attribute* time, but only aggregates (durations, counts, attribution labels) are ever stored or shared — never the inspected values. The transient look must not become persistent data. (See Constitution → Posture.)
  - _Verify:_ No raw backtrace, SQL literal, option value, or request body appears in any stored profile or shared report; attribution persists only `{type, slug, name}` + timings.

- [ ] **SQL queries are reduced to verb + table(s) only.** Stored and displayed queries contain ONLY the SQL verb (SELECT, INSERT, UPDATE, DELETE, SHOW) and the table name(s). No column names, no field lists, no WHERE clauses, no predicates (LIMIT, HAVING, GROUP BY, ORDER BY), no literal values, no query structure beyond verb + table. JOINs include all participating tables. CTE aliases are excluded. Subquery internals are excluded (depth-aware). Enforced by `QueryReducer::reduce()` at both write time (Profiler) AND read time (Sanitizer) as defense-in-depth. This has regressed twice — treat any query output containing SQL keywords beyond the verb as a bug.
  - _Verify:_ `wp eval` to fetch a stored profile's queries array — every `sql` value matches pattern `/^(SELECT|INSERT|UPDATE|DELETE|REPLACE|SHOW|CREATE|ALTER|DROP|TRUNCATE|OPTIMIZE|ANALYZE|CHECK|REPAIR)\s[\w, ]+$/` or is `SELECT FOUND_ROWS()` or a bare verb. (DDL verbs are emitted as verb + table only, same as DML.)

- [ ] **Outbound HTTP URLs are reduced to scheme + host.** Stored, displayed, shared, and REST-returned `http_calls[].url` values contain ONLY scheme + host (+ port) — never the path, query string, or fragment. Webhook/bot endpoints embed secret tokens in the PATH (`hooks.slack.com/services/T../B../<token>`, `api.telegram.org/bot<token>/...`), so the path must never leave. Reduced at write time (`Storage::sanitize_profile`), re-applied on read (`Storage::get_profile`), and at the output boundary (`Sanitizer` reduces every `http_calls` entry) — same defense-in-depth as the SQL reducer, so legacy rows can't leak a path. (See D46.)
  - _Verify:_ `wp eval` to fetch a stored profile's `http_calls` — every `url` is `scheme://host` with no path/query; a request to `https://hooks.slack.com/services/.../SECRET` stores `https://hooks.slack.com`. `SanitizerTest::test_http_call_urls_are_reduced_to_host_on_output` guards the output path.

- [ ] **Shared reports contain only user-approved sections.** The include/exclude checklist defaults all-on, but the published artifact matches exactly what the preview showed.
  - _Verify:_ `Share::build_report()` filters sections by user selection. Test covers section omission.

- [ ] **Capability IDs are 128-bit cryptographic random.** Share URLs use URL-safe encoded 128-bit random tokens, not sequential IDs, UUIDs, or hashes of content.
  - _Verify:_ `Share::generate_capability_id()` uses `random_bytes(16)`.

## Profiling Integrity

- [ ] **One active session at a time.** Starting a new session stops any existing one.
  - _Verify:_ `Session::start()` calls `Session::stop_session()` first.

- [ ] **Activation token is HMAC-signed and short-lived.** Token includes nonce + expiry + admin user ID. Verified before setting profiling cookie.
  - _Verify:_ `Session::generate_activation_url()` uses `hash_hmac('sha256', ...)` with expiry.

- [ ] **Profiling cookie is HttpOnly, Secure, SameSite=Strict.** No JavaScript access, no cross-site leakage.
  - _Verify:_ `setcookie()` call in `Session::handle_activation()` sets all three flags.

- [ ] **Only cookied requests are instrumented.** No request without a valid `scrutinizer_session` cookie hits the instrumentation path.
  - _Verify:_ `Profiler::init()` bails early without valid cookie.

- [ ] **No `all` hook.** Instrumentation wraps individual callbacks. Never registers a WordPress `all` hook. Never uses `declare(ticks=1)`.
  - _Verify:_ `grep -r "add_action.*'all'" --include="*.php" includes/` — zero results.

- [ ] **Monotonic high-resolution clock.** Timing uses `hrtime(true)` (PHP 7.3+), not `microtime()`.
  - _Verify:_ `grep -r 'microtime' --include="*.php" includes/Profiler/` — zero results for timing (allowed in non-timing contexts).

## Regression Language

- [ ] **"Likely Regression" requires all three thresholds.** ≥5 matched requests, ≥20% + 100ms median increase, consistent direction in ≥3/5 comparisons. Below that: "Difference Observed" only.
  - _Status:_ **Server-side classifier shipped.** `Report::classify_change()` enforces all three thresholds and `Report::describe_change()` renders constitution-compliant verdict text; both are unit-tested. The dashboard *display* of the verdict is the remaining piece — until it lands, the UI must not assert a verdict stronger than "Difference observed" for a single comparison (enforced in `dashboard.js` `classifyDelta`).
  - _Verify:_ `Report::classify_change()` checks all three before returning `likely_regression` (`ReportClassifyTest`).

- [ ] **Route-matched comparison, not URL-based.** Baselines match by route fingerprint (route class + frontend/admin + anon/auth + cache state), not raw URL string.
  - _Status:_ **Shipped.** `Report::route_fingerprint()` + `match_samples()` + `compare_route()` exist; `Storage::get_route_comparison_samples()` and `GET /v1/regression` wire them to stored data. (`match_baseline()` was realized as `compare_route()`.) Comparison no longer keys on raw URL.
  - _Verify:_ `Report::compare_route()` fingerprints via `route_fingerprint()`, not `$_SERVER['REQUEST_URI']` (`ReportFingerprintTest`).

## Infrastructure

- [ ] **Shared reports expire and auto-delete.** R2 lifecycle rules remove artifacts at user-selected expiry (1-30 days). No indefinite storage.
  - _Verify:_ R2 lifecycle policy matches object key path prefix scheme.

- [ ] **Report viewer never executes uploaded content.** Hosted viewer at scrutinizer.dev renders structured data. No HTML injection, no script execution from report content.
  - _Verify:_ Viewer uses escaped template rendering, not `innerHTML` or `eval`.

- [ ] **Revocation is immediate.** Revoking a shared report blocks all future retrieval from scrutinizer.dev. No cache window, no grace period.
  - _Verify:_ Revocation updates control plane and purges edge cache in same request.

## Build & Quality

- [ ] **WordPress Coding Standards enforced.** `phpcs` with WordPress-Extra ruleset passes with zero errors.
  - _Verify:_ CI runs `phpcs --standard=phpcs.xml.dist` on every push.

- [ ] **PHP 7.4 compatibility.** No typed properties (PHP 7.4), no enums (PHP 8.1), no readonly (PHP 8.1), no intersection types (PHP 8.1), no fibers (PHP 8.1). Union types allowed only in PHP 8.0+ code paths with fallback.
  - _Verify:_ CI matrix includes PHP 7.4 and tests pass.

- [ ] **No remote code loading.** Plugin never loads JavaScript, CSS, or PHP from external URLs at runtime. All assets bundled locally.
  - _Verify:_ `grep -r 'wp_enqueue_script\|wp_enqueue_style' --include="*.php"` — all URLs use `SCRUTINIZER_URL` prefix or `plugins_url()`.

- [ ] **i18n-ready.** All user-facing strings wrapped in `__()`, `_e()`, `esc_html__()`, etc. with text domain `scrutinizer`.
  - _Verify:_ `phpcs` i18n sniffs pass. `grep -r "echo '" --include="*.php" includes/Admin/` — zero bare English strings in templates.
