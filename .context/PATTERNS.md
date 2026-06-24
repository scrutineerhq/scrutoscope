# PATTERNS

> Operational coding guide. Follow these when working in the Scrutinizer codebase.

## Project Layout

```
scrutineer/
├── .context/                    # Agent context (this directory)
├── .github/workflows/      # CI (phpcs + phpunit matrix)
├── assets/
│   ├── css/dashboard.css   # Admin dashboard styles
│   └── js/dashboard.js     # Admin dashboard behavior
├── includes/
│   ├── Admin/
│   │   ├── Ajax.php        # AJAX handlers (start, stop, delete, share)
│   │   └── Dashboard.php   # wp-admin page registration and rendering
│   ├── CLI/                # WP-CLI commands (M5)
│   ├── Profiler/
│   │   ├── Attribution.php # Callback → plugin/theme/core resolution
│   │   ├── CallStack.php   # Nested callback tracking, exclusive/inclusive
│   │   ├── Instrumentor.php# Hook callback wrapping
│   │   ├── Profiler.php    # Orchestrator — init, collect, finalize
│   │   ├── Report.php      # Profile → structured report, comparison, regression
│   │   ├── Session.php     # Activation URL, cookie management, session lifecycle
│   │   └── Storage.php     # wpdb table for captured profiles
│   └── Share/              # Report sharing, capability links (M4)
├── languages/              # i18n .pot/.po/.mo
├── tests/                  # PHPUnit tests
├── scrutinizer.php         # Plugin entry point, autoloader, bootstrap hooks
├── composer.json           # Dev dependencies: phpcs, phpunit
└── phpcs.xml.dist          # WordPress-Extra coding standards
```

## Namespace & Autoloading

PSR-4 autoloading: `Scrutinizer\` namespace maps to `includes/`.

```php
// Scrutinizer\Profiler\Profiler → includes/Profiler/Profiler.php
// Scrutinizer\Admin\Dashboard   → includes/Admin/Dashboard.php
```

The autoloader is in `scrutinizer.php`. No Composer autoload — wp.org plugins can't require `composer install`.

## Data Flow: Instrumentation → Report

```
1. Admin clicks "Start Profiling" in dashboard
   └→ Ajax::start_profiling()
      └→ Session::generate_activation_url()  ← HMAC-signed, 5-min expiry

2. Admin visits the activation URL
   └→ Session::handle_activation()
      ├→ Verify HMAC + expiry + user ID
      ├→ Set profiling cookie (HttpOnly, Secure, SameSite=Strict)
      └→ Redirect (strip token from URL)

3. Subsequent requests carry the profiling cookie
   └→ Profiler::init()  (plugins_loaded, priority 0)
      ├→ Session::is_active() ← check cookie validity
      ├→ Instrumentor::wrap_hooks() ← wrap registered callbacks
      └→ Register shutdown function for finalization

4. During request execution
   └→ Instrumentor (wrapping layer)
      ├→ CallStack::push() ← record start time (hrtime)
      ├→ Original callback executes
      ├→ CallStack::pop()  ← record end time, compute exclusive
      └→ Attribution::resolve() ← callback → source file → plugin/theme/core

5. At shutdown
   └→ Profiler::finalize()
      ├→ Compute Server Request Duration
      ├→ Compute unattributed time (duration - sum of exclusive)
      ├→ Build profile data structure
      └→ Storage::save_profile() ← wpdb insert

6. Admin clicks "Stop Profiling"
   └→ Ajax::stop_profiling()
      └→ Session::stop_session() ← clear cookie

7. Admin views results in dashboard
   └→ Dashboard::render()
      ├→ Storage::get_profiles()
      └→ Report::build() ← aggregate, rank, classify
```

## Timing

All timing uses `hrtime(true)` (nanoseconds, monotonic). Never `microtime()`.

```php
$start = hrtime( true );
// ... work ...
$elapsed_ns = hrtime( true ) - $start;
$elapsed_ms = $elapsed_ns / 1e6;
```

Store nanoseconds internally. Convert to milliseconds only for display.

## Attribution Resolution

`Attribution::resolve($callback)` takes a WordPress callback (string, array, or closure) and returns a classification:

```php
[
    'type'   => 'plugin',       // plugin | theme | core | mu-plugin | drop-in | unknown
    'name'   => 'woocommerce',  // slug
    'file'   => '/path/to/woocommerce/includes/class-wc-cart.php',
    'function' => 'WC_Cart::calculate_totals',
]
```

Resolution is memoized per callback identity. The memoization key is derived from the callback structure, not its string representation (closures don't have stable string representations).

## CallStack: Exclusive vs Inclusive

```php
// Stack: [hook_A, hook_B (nested inside A)]
//
// hook_A starts at t=0
//   hook_B starts at t=3
//   hook_B ends at t=7    → B inclusive = 4ms, B exclusive = 4ms
// hook_A ends at t=10     → A inclusive = 10ms, A exclusive = 10 - 4 = 6ms
```

`CallStack` maintains a stack of active callbacks. When a callback pops:
- **Inclusive** = end - start
- **Exclusive** = inclusive - sum of children's inclusive times

Children's time is accumulated on the parent's stack frame, not looked up afterward.

## Storage Schema

Single custom table: `{$wpdb->prefix}scrutinizer_profiles`

```sql
CREATE TABLE {prefix}scrutinizer_profiles (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id    VARCHAR(64)   NOT NULL,
    request_uri   VARCHAR(2048) NOT NULL,
    route_fingerprint VARCHAR(255) NOT NULL,
    request_method VARCHAR(10)  NOT NULL,
    duration_ns   BIGINT UNSIGNED NOT NULL,
    profile_data  LONGTEXT      NOT NULL,  -- JSON
    profile_mode  VARCHAR(20)   NOT NULL DEFAULT 'standard',
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_route (route_fingerprint),
    INDEX idx_created (created_at)
) {$charset_collate};
```

`profile_data` is JSON containing per-callback timing, attribution, and metadata. No PHP `serialize()` — JSON only.

## AJAX Pattern

All AJAX handlers follow this pattern:

```php
class Ajax {
    public static function register() {
        add_action( 'wp_ajax_scrutinizer_start', array( __CLASS__, 'start_profiling' ) );
        // ...
    }

    public static function start_profiling() {
        check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( array( 'message' => __( 'Insufficient permissions.', 'scrutinizer' ) ) );
        }

        // ... do work ...

        wp_send_json_success( $result );
    }
}
```

Every handler: nonce check first, capability check second, work third. No exceptions.

## Coding Standards

- WordPress-Extra via phpcs (`phpcs.xml.dist`)
- `array()` syntax (not `[]`) for consistency
- Yoda conditions: `if ( 'value' === $var )`
- Tabs for indentation (WordPress standard)
- PHP 7.4 compatibility floor — no typed properties, no enums, no readonly, no union types in signatures
- All user-facing strings use `__()` / `_e()` / `esc_html__()` with text domain `scrutinizer`
- No bare `echo` of unescaped output — `esc_html()`, `esc_attr()`, `wp_kses()` as appropriate

## Security Patterns

| Context | Pattern |
|---------|---------|
| AJAX handlers | `check_ajax_referer()` + `current_user_can('manage_options')` |
| Activation URLs | HMAC-SHA256 + expiry + user ID |
| Profiling cookie | HttpOnly, Secure, SameSite=Strict |
| Database writes | `$wpdb->prepare()` — no raw interpolation |
| Output | `esc_html()`, `esc_attr()`, `esc_url()` — context-appropriate |
| Report data | `wp_json_encode()` for JSON output |

## Anti-Patterns — Don't Do These

- **No `serialize()` / `unserialize()`** — JSON only for stored data. `unserialize` is a known PHP attack vector.
- **No direct `$_POST` / `$_GET` without sanitization** — `sanitize_text_field()`, `absint()`, etc.
- **No `file_get_contents()` for remote URLs** — use `wp_remote_get()` when network access is needed (M4+).
- **No `eval()`, `call_user_func()` from user input** — callbacks come from WP hook registry only.
- **No `wp_die()` in non-AJAX contexts** without checking `wp_doing_ajax()`.
- **No hardcoded capability strings** — use constants if capability names might change.
- **No output buffering for profiling** — measure timing, don't capture output.
- **No `register_shutdown_function` stacking** — one shutdown handler for the profiler, registered once.

## Testing

```bash
# Local
composer install  # dev deps: phpcs, phpunit
vendor/bin/phpcs --standard=phpcs.xml.dist  # coding standards
vendor/bin/phpunit                          # unit + integration tests

# CI (GitHub Actions)
# Runs against PHP 7.4, 8.0, 8.1, 8.2, 8.3 × WordPress 6.0+, latest, trunk
```

Tests are PHPUnit, following WP test conventions:
- Unit tests: pure function testing, no WordPress bootstrap
- Integration tests: `WP_UnitTestCase` subclass, requires WP test suite
- Every Profiler class should have corresponding test coverage
- Regression language thresholds get dedicated tests

## File Quick Reference

| Task | File |
|------|------|
| Add AJAX action | `includes/Admin/Ajax.php` |
| Change dashboard UI | `includes/Admin/Dashboard.php` + `assets/` |
| Modify instrumentation | `includes/Profiler/Instrumentor.php` |
| Change timing/stack tracking | `includes/Profiler/CallStack.php` |
| Modify attribution resolution | `includes/Profiler/Attribution.php` |
| Change profiling session flow | `includes/Profiler/Session.php` |
| Modify storage schema | `includes/Profiler/Storage.php` |
| Change report/comparison logic | `includes/Profiler/Report.php` |
| Add WP-CLI command | `includes/CLI/` (M5) |
| Add sharing feature | `includes/Share/` (M4) |
| Plugin constants/bootstrap | `scrutinizer.php` |
| Coding standards config | `phpcs.xml.dist` |
| CI workflow | `.github/workflows/ci.yml` |


## Contextual Help (D32)

Use `<details><summary>` for inline term explanations. The summary shows the
term with a dotted underline (`border-bottom: 1px dotted #787c82; cursor: help`).
The expanded content is one sentence in muted text (`color: #787c82; font-size: 12px`).
Never use modals, popovers, or separate help pages for terminology.

```html
<details class="scrutinizer-term">
    <summary>Server Request Duration</summary>
    Wall-clock time the server spent on this PHP request — not the same as what
    the browser shows, which includes network, DNS, and rendering.
</details>
```

Terms that MUST have explanations:
- Server Request Duration
- Exclusive Callback Time
- Inclusive Callback Time
- Unattributed time (on Breakdown tab)
- Unknown (source, on Sources tab)
- Background measurement / Capture rate
- Hook Execution Trace (Trace tab label)
- Observed Memory Delta

## Sample Rate Control (D30)

The capture rate control uses labeled snap buttons + a numeric input for custom values.

```
Capture rate
[0.1%] [1%] [10%] [100%]    or  [___]%
 very    busy  lower   debug
 busy          traffic (not recommended)
```

Clicking a snap button sets the value and highlights it. Typing a custom value
deselects all snap buttons. Valid range: 0.0–100.0, one decimal place.
Store as float in option `scrutinizer_sample_rate`.

## Profile Retention (D31)

Settings (in gear panel):
- Keep profiles for: [30] days (0 = forever)
- Max profiles per route: [100] (0 = unlimited)
- Pinned profiles: always kept

Cleanup runs on a twice-daily WP cron event (`scrutinizer_cleanup_profiles`).
Option keys: `scrutinizer_retention_days`, `scrutinizer_max_per_route`.

## Route Labels (F9)

Route cells are two-line: human label on top, route key below in muted monospace.

```css
.route-label { font-weight: 600; }
.route-key { font-size: 12px; color: #787c82; font-family: monospace; }
```

Labels are generated at profile capture time and stored in `profile_data.request.label`.
Sources: `get_admin_page_title()`, post/page title, `post_type_archive_title()`,
"AJAX: {action}", REST pattern. Fallback: route key shown once (no duplication).
