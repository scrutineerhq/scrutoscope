<?php
/**
 * Profiler orchestrator.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

/**
 * Central profiler orchestrator. Singleton.
 *
 * Checks for an active session, instruments hooks, collects timing data,
 * compiles a report, and stores it when the request ends.
 */
class Profiler {

	/**
	 * Singleton instance.
	 *
	 * @var Profiler|null
	 */
	private static $instance = null;

	/**
	 * Whether profiling is active for this request.
	 *
	 * @var bool
	 */
	private $active = false;

	/**
	 * The instrumentor instance.
	 *
	 * @var Instrumentor|null
	 */
	private $instrumentor = null;

	/**
	 * The call stack tracker.
	 *
	 * @var CallStack|null
	 */
	private $call_stack = null;

	/**
	 * Pre-plugin boot timestamp from the mu-plugin (nanoseconds, monotonic).
	 *
	 * Zero when the mu-plugin is not installed.
	 *
	 * @var int
	 */
	private $boot_ns = 0;

	/**
	 * Request start time in nanoseconds (monotonic).
	 *
	 * @var int
	 */
	private $request_start_ns = 0;

	/**
	 * Request start time as microtime(true).
	 *
	 * Bridges wall-clock timestamps (e.g. $wpdb->queries start_time)
	 * to our monotonic hrtime-based timeline.
	 *
	 * @var float
	 */
	private $request_start_microtime = 0.0;

	/**
	 * Route class, refined after WP query is parsed.
	 *
	 * @var string
	 */
	private $route_class = '';

	/**
	 * WordPress lifecycle phase timestamps (nanoseconds).
	 *
	 * Each key is a lifecycle hook name, value is hrtime(true) when it fired.
	 *
	 * @var array<string, int>
	 */
	private $phase_markers = array();

	/**
	 * Memory usage (bytes) sampled at each phase marker, keyed by hook.
	 *
	 * Sampled at the same priority-0 lifecycle hooks as the phase markers, so
	 * the cost is one memory_get_usage() per marker (~a dozen per request) and
	 * the resulting curve aligns exactly to the timeline phases.
	 *
	 * @var array<string, int>
	 */
	private $phase_memory = array();

	/**
	 * Aggregated core-developer signals (deprecations + doing_it_wrong),
	 * keyed by type|name|source so repeats coalesce into a count.
	 *
	 * @var array<string, array>
	 */
	private $dev_signals = array();

	/**
	 * Just-in-time textdomain loads, keyed by domain|hook so repeats coalesce.
	 *
	 * @var array<string, array>
	 */
	private $textdomain_jit = array();

	/**
	 * Completed external HTTP call records.
	 *
	 * @var array<int, array>
	 */
	private $http_calls = array();

	/**
	 * Stack of in-flight HTTP calls (for matching pre/response pairs).
	 *
	 * @var array<int, array>
	 */
	private $http_pending = array();

	/**
	 * Get the singleton instance.
	 *
	 * @return Profiler
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Private constructor — use instance().
	 */
	private function __construct() {}

	/**
	 * Whether this is a background-sampled profile.
	 *
	 * @var bool
	 */
	private $is_background = false;

	/**
	 * Initialize the profiler. Called early on `plugins_loaded` priority 0.
	 *
	 * Checks for a valid profiling session or background sampling.
	 */
	public function init() {
		// Don't profile our own AJAX requests — they'd flood the list.
		if ( wp_doing_ajax() ) {
			$action = '';
			// Read-only request-context detection (deciding whether to profile),
			// not form processing — nonce verification does not apply.
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			if ( isset( $_REQUEST['action'] ) ) {
				// phpcs:ignore WordPress.Security.NonceVerification.Recommended
				$action = sanitize_text_field( wp_unslash( $_REQUEST['action'] ) );
			}
			if ( 0 === strpos( $action, 'scrutinizer_' ) ) {
				return;
			}
		}

		// Active session takes priority.
		if ( Session::has_valid_cookie() ) {
			$this->start();
			return;
		}

		// Background sampling — probabilistic, no session required.
		if ( self::should_background_sample() ) {
			$this->is_background = true;
			$this->start();
		}
	}

	/**
	 * Check whether this request should be background-sampled.
	 *
	 * Supports float sample rates from 0.0 to 100.0 (e.g. 0.1% for busy sites).
	 *
	 * @return bool
	 */
	private static function should_background_sample() {
		$enabled = get_option( 'scrutinizer_background_profiling', false );
		if ( ! $enabled ) {
			return false;
		}

		// Don't background-profile WP-CLI, cron, or XML-RPC.
		if ( defined( 'WP_CLI' ) || defined( 'DOING_CRON' ) || defined( 'XMLRPC_REQUEST' ) ) {
			return false;
		}

		// User scope filter.
		$user_scope = get_option( 'scrutinizer_user_scope', 'all' );
		if ( 'anonymous' === $user_scope && is_user_logged_in() ) {
			return false;
		}
		if ( 'logged_in' === $user_scope && ! is_user_logged_in() ) {
			return false;
		}

		// Exclude paths filter.
		$exclude_paths = get_option( 'scrutinizer_exclude_paths', '' );
		if ( ! empty( $exclude_paths ) && isset( $_SERVER['REQUEST_URI'] ) ) {
			$request_path = wp_parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
			if ( $request_path ) {
				$patterns = array_filter( array_map( 'trim', explode( "\n", $exclude_paths ) ) );
				foreach ( $patterns as $pattern ) {
					if ( self::path_matches( $request_path, $pattern ) ) {
						return false;
					}
				}
			}
		}

		$rate = (float) get_option( 'scrutinizer_sample_rate', 10 );
		$rate = max( 0.0, min( 100.0, $rate ) );

		if ( $rate <= 0.0 ) {
			return false;
		}
		if ( $rate >= 100.0 ) {
			return true;
		}

		// Use mt_rand with enough precision for rates like 0.1%.
		// Random value 0–100000, rate scaled to same range.
		// phpcs:ignore WordPress.WP.AlternativeFunctions.rand_mt_rand
		return mt_rand( 1, 100000 ) <= (int) round( $rate * 1000 );
	}

	/**
	 * Check if a request path matches a simple wildcard pattern.
	 *
	 * Supports * as a wildcard for any number of characters.
	 * Patterns are matched case-insensitively.
	 *
	 * @param string $path    The request path.
	 * @param string $pattern The pattern to match (e.g. /wp-admin/*).
	 * @return bool
	 */
	private static function path_matches( $path, $pattern ) {
		// Escape regex special chars, then convert * to .* wildcard.
		$regex = str_replace( '\*', '.*', preg_quote( $pattern, '#' ) );
		return (bool) preg_match( '#^' . $regex . '$#i', $path );
	}

	/**
	 * Begin profiling this request.
	 */
	public function start() {
		$this->active = true;

		// Always use hrtime for consistent monotonic clock domain.
		// We lose the few ms between SAPI start and plugin load, but
		// mixing REQUEST_TIME_FLOAT (wall clock) with hrtime (monotonic)
		// produces garbage durations.
		$this->request_start_ns        = hrtime( true );
		$this->request_start_microtime = microtime( true );

		// Capture pre-plugin boot timestamp from the mu-plugin.
		if ( defined( 'SCRUTINIZER_BOOT_NS' ) && SCRUTINIZER_BOOT_NS > 0 ) {
			$this->boot_ns = (int) SCRUTINIZER_BOOT_NS;
		}

		// Record the start as the first phase marker.
		$this->phase_markers['profiler_start'] = $this->request_start_ns;
		$this->phase_memory['profiler_start']  = memory_get_usage();

		$this->call_stack   = new CallStack();
		$this->instrumentor = new Instrumentor( $this->call_stack );

		// Instrument all currently registered hooks.
		$this->instrumentor->instrument_all();

		// Register lifecycle phase markers at priority 0 to capture timing
		// as early as possible within each phase.
		$lifecycle_hooks = array(
			// Early boot (may not fire if profiler starts late).
			'muplugins_loaded',
			'plugins_loaded',
			'setup_theme',
			'after_setup_theme',

			// Core init.
			'init',
			'widgets_init',
			'wp_loaded',

			// Front-end request lifecycle.
			'parse_request',
			'wp',
			'template_redirect',
			'get_header',
			'wp_head',
			'wp_enqueue_scripts',
			'the_post',
			'loop_start',
			'loop_end',
			'get_footer',
			'wp_footer',
			'wp_print_footer_scripts',

			// Admin request lifecycle.
			'admin_init',
			'admin_menu',
			'admin_enqueue_scripts',

			// Terminal.
			'shutdown',
		);
		foreach ( $lifecycle_hooks as $hook ) {
			add_action( $hook, array( $this, 'record_phase_marker' ), 0 );
		}

		// Track external HTTP calls via WP HTTP API.
		add_filter( 'pre_http_request', array( $this, 'track_http_start' ), 1, 3 );
		add_filter( 'http_response', array( $this, 'track_http_end' ), PHP_INT_MAX, 3 );

		// Core-developer signals: deprecations + doing_it_wrong. Captured only
		// while profiling (non-profiled requests pay nothing). Aggregate only —
		// the API name, the version, and the triggering source; never argument
		// values.
		add_action( 'deprecated_function_run', array( $this, 'record_deprecated_function' ), 10, 3 );
		add_action( 'deprecated_hook_run', array( $this, 'record_deprecated_hook' ), 10, 4 );
		add_action( 'deprecated_argument_run', array( $this, 'record_deprecated_argument' ), 10, 3 );
		add_action( 'deprecated_file_included', array( $this, 'record_deprecated_file' ), 10, 4 );
		add_action( 'doing_it_wrong_run', array( $this, 'record_doing_it_wrong' ), 10, 3 );

		// i18n just-in-time translation loads — a textdomain loaded on demand
		// because a translation function ran before it was registered.
		add_action( 'load_textdomain', array( $this, 'record_textdomain_load' ), 10, 1 );

		// Catch late-registered hooks at key lifecycle points.
		add_action( 'wp_loaded', array( $this, 'reinstrument' ), PHP_INT_MAX );
		add_action( 'admin_init', array( $this, 'reinstrument' ), PHP_INT_MAX );

		// Refine route classification after query parsing.
		add_action( 'wp', array( $this, 'capture_route_class' ), PHP_INT_MAX );

		// Classify admin routes (the `wp` action doesn't fire in wp-admin).
		add_action( 'admin_init', array( $this, 'capture_admin_route_class' ), PHP_INT_MAX );

		// Stop and save at shutdown.
		add_action( 'shutdown', array( $this, 'stop' ), PHP_INT_MAX );
	}

	/**
	 * Record a lifecycle phase marker timestamp.
	 *
	 * Hooked at priority 0 on key WordPress lifecycle actions.
	 */
	public function record_phase_marker() {
		$hook = current_filter();
		if ( ! isset( $this->phase_markers[ $hook ] ) ) {
			$this->phase_markers[ $hook ] = hrtime( true );
			$this->phase_memory[ $hook ]  = memory_get_usage();
		}
	}

	/**
	 * Re-instrument to catch any hooks registered after the initial pass.
	 *
	 * Hooked at `wp_loaded` and `admin_init` with PHP_INT_MAX priority.
	 */
	public function reinstrument() {
		if ( $this->active && null !== $this->instrumentor ) {
			$this->instrumentor->instrument_all();
		}
	}

	/**
	 * Capture the refined route class after WP parses the query.
	 *
	 * Only applies to frontend requests — admin pages are classified
	 * by capture_admin_route_class() instead.
	 */
	public function capture_route_class() {
		if ( is_admin() ) {
			return;
		}
		$this->route_class = Report::classify_frontend_route();
	}

	/**
	 * Capture route class for admin requests.
	 *
	 * The `wp` action never fires in wp-admin, so admin pages need
	 * their own classification pass.
	 */
	public function capture_admin_route_class() {
		if ( ! empty( $this->route_class ) ) {
			return;
		}

		if ( defined( 'DOING_AJAX' ) && DOING_AJAX ) {
			$this->route_class = 'admin-ajax';
		} else {
			$this->route_class = 'wp-admin';
		}
	}

	/**
	 * Stop profiling: compile the report and store it.
	 */
	public function stop() {
		if ( ! $this->active ) {
			return;
		}

		$this->active = false;
		$end_ns       = hrtime( true );
		$duration_ns  = $end_ns - $this->request_start_ns;

		// Capture HTTP response status before anything else might change it.
		$response_status = http_response_code();
		if ( false === $response_status ) {
			$response_status = 0;
		}

		// Skip non-successful responses when the filter is enabled.
		if ( get_option( 'scrutinizer_only_successful', false ) && 200 !== $response_status ) {
			return;
		}

		// Guard against negative durations from clock issues.
		if ( $duration_ns < 0 ) {
			$duration_ns = 0;
		}

		$session_id = Session::get_session_id();
		if ( empty( $session_id ) && $this->is_background ) {
			$session_id = 'bg_' . wp_generate_password( 12, false );
		}
		if ( empty( $session_id ) ) {
			return;
		}

		$request_url = '';
		if ( isset( $_SERVER['REQUEST_URI'] ) ) {
			$request_url = home_url( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) );
		}

		$request_method = 'GET';
		if ( isset( $_SERVER['REQUEST_METHOD'] ) ) {
			$request_method = sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) );
		}

		// Final route classification fallback.
		// If no hook-based classifier ran (e.g. REST API, wp-cron, or
		// edge cases where admin_init didn't fire), classify from context.
		if ( empty( $this->route_class ) || 'frontend' === $this->route_class ) {
			if ( is_admin() && ! ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) {
				$this->route_class = 'wp-admin';
			} elseif ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
				$this->route_class = 'rest-api';
			}
		}

		$metadata = array(
			'url'                => $request_url,
			'method'             => $request_method,
			'duration_ns'        => $duration_ns,
			'bootstrap_ns'       => ( $this->boot_ns > 0 ) ? max( 0, $this->request_start_ns - $this->boot_ns ) : 0,
			'route_class'        => $this->route_class,
			'wp_version'         => get_bloginfo( 'version' ),
			'timestamp'          => time(),
			'phase_markers'      => $this->build_phase_offsets(),
			'memory_samples'     => $this->build_memory_samples(),
			'user_role'          => self::get_current_role(),
			'query_count'        => self::get_query_count(),
			'queries'            => $this->get_query_log(),
			'http_calls'         => $this->build_http_calls(),
			'dev_signals'        => $this->build_dev_signals(),
			'textdomain_jit'     => $this->build_textdomain_jit(),
			'autoloaded_options' => self::get_autoloaded_options(),
			'enqueued_assets'    => self::get_enqueued_assets(),
			// Background sampling profiles anonymous visitor traffic, so the
			// visitor's inbound referer is never-collect data. Only capture it
			// for admin-driven session profiling (the admin's own navigation).
			// Request metadata for the profile record — read-only capture, not
			// form processing, so nonce verification does not apply.
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'referer'            => ( ! $this->is_background && isset( $_SERVER['HTTP_REFERER'] ) ) ? sanitize_url( wp_unslash( $_SERVER['HTTP_REFERER'] ) ) : '',
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'ajax_action'        => ( defined( 'DOING_AJAX' ) && DOING_AJAX && isset( $_REQUEST['action'] ) ) ? sanitize_text_field( wp_unslash( $_REQUEST['action'] ) ) : '',
			'response_status'    => (int) $response_status,
			'label'              => self::generate_route_label(),
			// True when the per-invocation cap was hit on a very heavy request;
			// the captured detail is then partial (guards against OOM).
			'truncated'          => $this->instrumentor->is_truncated(),
		);

		try {
			$raw_timings = $this->instrumentor->get_timings();
			$trace       = $this->call_stack->get_trace();
			$report      = Report::compile( $raw_timings, $trace, $metadata );

			$profile_type = $this->is_background ? 'background' : 'session';
			Storage::save_profile( $session_id, $report, $profile_type, (int) $response_status );
		} catch ( \Throwable $e ) {
			// Fail silently — never break the site.
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( 'Scrutinizer profiler error: ' . $e->getMessage() );
			}
		}
	}

	/**
	 * Generate a human-readable label for the current request.
	 *
	 * Used for F9 (two-line route labels in the UI). Stored in
	 * profile_data['request']['label'] and surfaced in grouped route listings.
	 *
	 * @return string|null  Human-readable label or null for fallback.
	 */
	private static function generate_route_label() {
		// AJAX requests: use the action name.
		if ( defined( 'DOING_AJAX' ) && DOING_AJAX ) {
			// Read-only route labelling from the AJAX action, not form
			// processing — nonce verification does not apply.
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$action = isset( $_REQUEST['action'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['action'] ) ) : '';
			return $action ? 'AJAX: ' . $action : null;
		}

		// REST API requests.
		if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
			global $wp;
			if ( ! empty( $wp->query_vars['rest_route'] ) ) {
				return 'REST: ' . $wp->query_vars['rest_route'];
			}
			return 'REST API';
		}

		// WP Login page.
		if ( isset( $GLOBALS['pagenow'] ) && 'wp-login.php' === $GLOBALS['pagenow'] ) {
			return 'Login';
		}

		// Admin pages: use the page title.
		if ( is_admin() ) {
			// Try the specific admin page title first.
			if ( function_exists( 'get_admin_page_title' ) ) {
				$title = get_admin_page_title();
				if ( ! empty( $title ) ) {
					return $title;
				}
			}

			// Fallback to the global $title set by WP admin.
			global $title;
			if ( ! empty( $title ) ) {
				return $title;
			}

			return null;
		}

		// Frontend: singular content.
		if ( function_exists( 'is_singular' ) && is_singular() ) {
			$post_title = get_the_title();
			if ( ! empty( $post_title ) ) {
				return $post_title;
			}
		}

		// Frontend: archives.
		if ( function_exists( 'is_archive' ) && is_archive() ) {
			if ( function_exists( 'get_the_archive_title' ) ) {
				$archive_title = get_the_archive_title();
				if ( ! empty( $archive_title ) ) {
					return $archive_title;
				}
			}
		}

		// Frontend: search.
		if ( function_exists( 'is_search' ) && is_search() ) {
			return 'Search';
		}

		// Frontend: home/blog page.
		if ( function_exists( 'is_home' ) && is_home() ) {
			return 'Blog';
		}

		// Frontend: front page.
		if ( function_exists( 'is_front_page' ) && is_front_page() ) {
			return 'Front Page';
		}

		// Frontend: 404.
		if ( function_exists( 'is_404' ) && is_404() ) {
			return 'Not Found';
		}

		return null;
	}

	/**
	 * Whether profiling is active for this request.
	 *
	 * @return bool
	 */
	public function is_profiling() {
		return $this->active;
	}

	/**
	 * Record the start of an external HTTP call.
	 *
	 * Hooked on `pre_http_request` filter at priority 1.
	 *
	 * @param false|array|\WP_Error $preempt     Short-circuit value.
	 * @param array                 $parsed_args Parsed request arguments.
	 * @param string                $url         The request URL.
	 * @return false|array|\WP_Error  Unchanged preempt value.
	 */
	public function track_http_start( $preempt, $parsed_args, $url ) {
		$this->http_pending[] = array(
			'url'      => $url,
			'method'   => isset( $parsed_args['method'] ) ? strtoupper( $parsed_args['method'] ) : 'GET',
			'start_ns' => hrtime( true ),
			'caller'   => self::get_http_caller(),
		);
		return $preempt; // Never interfere with the request.
	}

	/**
	 * Record the completion of an external HTTP call.
	 *
	 * Hooked on `http_response` filter at PHP_INT_MAX priority.
	 *
	 * @param array|\WP_Error $response    HTTP response or error.
	 * @param array           $parsed_args Parsed request arguments.
	 * @param string          $url         The request URL.
	 * @return array|\WP_Error  Unchanged response.
	 */
	public function track_http_end( $response, $parsed_args, $url ) {
		if ( empty( $this->http_pending ) ) {
			return $response;
		}

		$pending = array_pop( $this->http_pending );
		$end_ns  = hrtime( true );

		$status   = 0;
		$is_error = is_wp_error( $response );
		if ( ! $is_error && isset( $response['response']['code'] ) ) {
			$status = (int) $response['response']['code'];
		}

		$this->http_calls[] = array(
			'url'         => $pending['url'],
			'method'      => $pending['method'],
			'status'      => $status,
			'start_ns'    => $pending['start_ns'],
			'end_ns'      => $end_ns,
			'duration_ns' => max( 0, $end_ns - $pending['start_ns'] ),
			'caller'      => $pending['caller'],
			'is_error'    => $is_error,
		);

		return $response;
	}

	/**
	 * Build HTTP call data with offsets relative to request start.
	 *
	 * @return array
	 */
	private function build_http_calls() {
		$calls = array();
		foreach ( $this->http_calls as $call ) {
			$offset_ns = max( 0, $call['start_ns'] - $this->request_start_ns );
			$calls[]   = array(
				'url'         => $call['url'],
				'method'      => $call['method'],
				'status'      => $call['status'],
				'duration_ns' => $call['duration_ns'],
				'duration_ms' => round( $call['duration_ns'] / 1e6, 2 ),
				'offset_ns'   => $offset_ns,
				'caller'      => $call['caller'],
				'is_error'    => $call['is_error'],
			);
		}

		// Sort by offset ascending.
		usort(
			$calls,
			function ( $a, $b ) {
				return $a['offset_ns'] <=> $b['offset_ns'];
			}
		);

		return $calls;
	}

	/**
	 * Walk the debug backtrace to attribute an HTTP call to its source.
	 *
	 * Returns a short caller chain string and an attribution array
	 * compatible with the source classification system.
	 *
	 * @return array{caller: string, attribution: array}
	 */
	private static function get_http_caller() {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_debug_backtrace
		$trace        = debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 30 );
		$caller_parts = array();
		$source_file  = '';

		// Pre-scan: find the first file belonging to a plugin/theme/mu-plugin for attribution.
		// This runs before the skip logic so we don't lose the file from skipped frames.
		foreach ( $trace as $frame ) {
			$f = isset( $frame['file'] ) ? $frame['file'] : '';
			if ( '' === $f
				|| false !== strpos( $f, 'Profiler.php' )
				|| false !== strpos( $f, 'Instrumentor.php' )
				|| false !== strpos( $f, 'class-wp-hook.php' )
				|| false !== strpos( $f, 'class-http.php' )
				|| false !== strpos( $f, 'class-wp-http' )
				|| false !== strpos( $f, 'plugin.php' )
				|| false !== strpos( $f, 'http.php' )
			) {
				continue;
			}
			$source_file = $f;
			break;
		}

		// Function/class names to skip (WP hook dispatch + HTTP internals + PHP glue).
		$skip_functions = array(
			'apply_filters',
			'apply_filters_ref_array',
			'do_action',
			'do_action_ref_array',
			'do_action_deprecated',
			'call_user_func',
			'call_user_func_array',
			'wp_remote_get',
			'wp_remote_post',
			'wp_remote_head',
			'wp_remote_request',
			'wp_safe_remote_get',
			'wp_safe_remote_post',
			'wp_safe_remote_head',
			'wp_safe_remote_request',
			'require',
			'require_once',
			'include',
			'include_once',
		);
		$skip_classes   = array( 'WP_Hook', 'WP_Http', 'WP_Http_Curl', 'WP_Http_Streams', 'Requests', 'WpOrg\\Requests\\Requests' );

		foreach ( $trace as $frame ) {
			$file    = isset( $frame['file'] ) ? $frame['file'] : '';
			$fn_name = isset( $frame['function'] ) ? $frame['function'] : '';
			$class   = isset( $frame['class'] ) ? $frame['class'] : '';

			// Skip frames without file or function.
			if ( '' === $file && '' === $fn_name ) {
				continue;
			}

			// Skip profiler frames — but not user callbacks invoked from Instrumentor.
			if ( false !== strpos( $file, 'Profiler.php' ) ) {
				continue;
			}
			// Instrumentor.php: skip only if it's our own class, not the user callback.
			if ( false !== strpos( $file, 'Instrumentor.php' ) && 0 === strpos( $class, 'Scrutinizer\\' ) ) {
				continue;
			}
			if ( 0 === strpos( $class, 'Scrutinizer\\' ) ) {
				continue;
			}

			// Skip WP hook dispatch and HTTP wrapper functions.
			if ( in_array( $fn_name, $skip_functions, true ) ) {
				continue;
			}

			// Skip WP HTTP implementation classes.
			$skip_class = false;
			foreach ( $skip_classes as $sc ) {
				if ( $class === $sc || ( strlen( $class ) > strlen( $sc ) && substr( $class, -strlen( $sc ) - 1 ) === '\\' . $sc ) ) {
					$skip_class = true;
					break;
				}
			}
			if ( $skip_class ) {
				continue;
			}

			// Build a short caller label.
			$fn = '';
			if ( ! empty( $class ) ) {
				$fn = $class . '::' . $fn_name;
			} elseif ( ! empty( $fn_name ) ) {
				$fn = $fn_name;
			}

			if ( $fn && count( $caller_parts ) < 3 ) {
				$caller_parts[] = $fn;
			}
		}

		$attribution = Attribution::classify( $source_file );

		return array(
			'caller'      => implode( ', ', $caller_parts ),
			'attribution' => $attribution,
		);
	}

	/**
	 * Record a deprecated-function signal (deprecated_function_run).
	 *
	 * @param string $function_name Deprecated function name.
	 * @param string $replacement   Suggested replacement (not stored).
	 * @param string $version       Version it was deprecated in.
	 */
	public function record_deprecated_function( $function_name, $replacement, $version ) {
		$this->add_dev_signal( 'deprecated_function', (string) $function_name, (string) $version );
	}

	/**
	 * Record a deprecated-hook signal (deprecated_hook_run).
	 *
	 * @param string $hook        Deprecated hook name.
	 * @param string $replacement Suggested replacement (not stored).
	 * @param string $version     Version it was deprecated in.
	 * @param string $message     Optional message (not stored).
	 */
	public function record_deprecated_hook( $hook, $replacement, $version, $message ) {
		$this->add_dev_signal( 'deprecated_hook', (string) $hook, (string) $version );
	}

	/**
	 * Record a deprecated-argument signal (deprecated_argument_run).
	 *
	 * @param string $function_name Function called with a deprecated argument.
	 * @param string $message       Optional message (not stored).
	 * @param string $version       Version.
	 */
	public function record_deprecated_argument( $function_name, $message, $version ) {
		$this->add_dev_signal( 'deprecated_argument', (string) $function_name, (string) $version );
	}

	/**
	 * Record a deprecated-file signal (deprecated_file_included).
	 *
	 * @param string $old_file    Deprecated file path (only the basename is kept).
	 * @param string $replacement Suggested replacement (not stored).
	 * @param string $version     Version.
	 * @param string $message     Optional message (not stored).
	 */
	public function record_deprecated_file( $old_file, $replacement, $version, $message ) {
		$this->add_dev_signal( 'deprecated_file', basename( (string) $old_file ), (string) $version );
	}

	/**
	 * Record a _doing_it_wrong() signal (doing_it_wrong_run).
	 *
	 * @param string $function_name Function used incorrectly.
	 * @param string $message       Message (not stored).
	 * @param string $version       Version.
	 */
	public function record_doing_it_wrong( $function_name, $message, $version ) {
		$this->add_dev_signal( 'doing_it_wrong', (string) $function_name, (string) $version );
	}

	/**
	 * Accumulate a dev signal, coalescing repeats by type + name + source.
	 *
	 * @param string $type    Signal type.
	 * @param string $name    API name (function / hook / file).
	 * @param string $version Version string.
	 */
	private function add_dev_signal( $type, $name, $version ) {
		$src = $this->dev_signal_source();
		$key = $type . '|' . $name . '|' . $src['slug'];
		if ( ! isset( $this->dev_signals[ $key ] ) ) {
			$this->dev_signals[ $key ] = array(
				'type'        => $type,
				'name'        => $name,
				'version'     => $version,
				'source'      => $src['name'],
				'source_type' => $src['type'],
				'count'       => 0,
			);
		}
		++$this->dev_signals[ $key ]['count'];
	}

	/**
	 * Attribute the caller that triggered a dev signal to its plugin/theme.
	 *
	 * Walks the backtrace to the first frame outside WordPress core and the
	 * profiler, then classifies it. Returns the source attribution — never a
	 * path or line.
	 *
	 * @return array{type: string, slug: string, name: string}
	 */
	private function dev_signal_source() {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_debug_backtrace
		$trace = debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 25 );
		foreach ( $trace as $frame ) {
			$f = isset( $frame['file'] ) ? wp_normalize_path( $frame['file'] ) : '';
			if ( '' === $f
				|| false !== strpos( $f, '/includes/Profiler/' )
				|| false !== strpos( $f, '/wp-includes/' )
				|| false !== strpos( $f, '/wp-admin/' )
			) {
				continue;
			}
			$attr = Attribution::classify( $f );
			if ( 'unknown' !== $attr['type'] ) {
				return $attr;
			}
		}
		return array(
			'type' => 'unknown',
			'slug' => '',
			'name' => 'unknown',
		);
	}

	/**
	 * Build the aggregated dev-signals list, ordered by count (desc).
	 *
	 * @return array<int, array>
	 */
	private function build_dev_signals() {
		$signals = array_values( $this->dev_signals );
		usort(
			$signals,
			function ( $a, $b ) {
				return $b['count'] <=> $a['count'];
			}
		);
		return $signals;
	}

	/**
	 * Record a just-in-time textdomain load (load_textdomain).
	 *
	 * Flags only loads triggered on demand by _load_textdomain_just_in_time —
	 * a translation function ran before the textdomain was explicitly loaded,
	 * so WordPress loads it mid-request (a real i18n perf topic). Captures the
	 * domain and the hook it fired on. Aggregate only.
	 *
	 * @param string $domain Textdomain being loaded.
	 */
	public function record_textdomain_load( $domain ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_debug_backtrace
		$trace  = debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 15 );
		$is_jit = false;
		foreach ( $trace as $frame ) {
			if ( isset( $frame['function'] ) && '_load_textdomain_just_in_time' === $frame['function'] ) {
				$is_jit = true;
				break;
			}
		}
		if ( ! $is_jit ) {
			return;
		}
		// current_filter() here is 'load_textdomain' (the action we're inside).
		// The useful hook is the OUTER lifecycle hook that was running when the
		// translation fired — read it from the filter stack.
		$stack = isset( $GLOBALS['wp_current_filter'] ) ? (array) $GLOBALS['wp_current_filter'] : array();
		$hook  = '';
		for ( $si = count( $stack ) - 1; $si >= 0; $si-- ) {
			if ( 'load_textdomain' !== $stack[ $si ] ) {
				$hook = $stack[ $si ];
				break;
			}
		}
		$key = $domain . '|' . $hook;
		if ( ! isset( $this->textdomain_jit[ $key ] ) ) {
			$this->textdomain_jit[ $key ] = array(
				'domain' => (string) $domain,
				'hook'   => (string) $hook,
				'count'  => 0,
			);
		}
		++$this->textdomain_jit[ $key ]['count'];
	}

	/**
	 * Build the just-in-time textdomain list, ordered by count (desc).
	 *
	 * @return array<int, array>
	 */
	private function build_textdomain_jit() {
		$loads = array_values( $this->textdomain_jit );
		usort(
			$loads,
			function ( $a, $b ) {
				return $b['count'] <=> $a['count'];
			}
		);
		return $loads;
	}

	/**
	 * Capture autoloaded options from wp_options.
	 *
	 * @return array{total_size: int, count: int, options: array}
	 */
	private static function get_autoloaded_options() {
		global $wpdb;

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$results = $wpdb->get_results(
			"SELECT option_name, LENGTH(option_value) AS size_bytes FROM {$wpdb->options} WHERE autoload = 'yes' ORDER BY LENGTH(option_value) DESC",
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		if ( empty( $results ) || ! is_array( $results ) ) {
			return array(
				'total_size' => 0,
				'count'      => 0,
				'options'    => array(),
			);
		}

		$total   = 0;
		$options = array();
		foreach ( $results as $row ) {
			$size      = (int) $row['size_bytes'];
			$total    += $size;
			$options[] = array(
				'name' => $row['option_name'],
				'size' => $size,
			);
		}

		return array(
			'total_size' => $total,
			'count'      => count( $options ),
			'options'    => $options,
		);
	}

	/**
	 * Build phase marker offsets relative to request start.
	 *
	 * Returns an array of {name, offset_ns} entries for the timeline.
	 *
	 * @return array<int, array{name: string, offset_ns: int}>
	 */
	private function build_phase_offsets() {
		$offsets = array();
		foreach ( $this->phase_markers as $hook => $ts ) {
			if ( 'profiler_start' === $hook ) {
				continue; // Skip the start marker itself.
			}
			$offsets[] = array(
				'name'      => $hook,
				'offset_ns' => max( 0, $ts - $this->request_start_ns ),
			);
		}
		// Sort by offset ascending.
		usort(
			$offsets,
			function ( $a, $b ) {
				return $a['offset_ns'] <=> $b['offset_ns'];
			}
		);
		return $offsets;
	}

	/**
	 * Build the memory-over-time curve from phase-marker samples.
	 *
	 * Memory is sampled at each lifecycle phase marker (hooked at priority 0)
	 * plus a final reading here at compile time, giving an honest usage curve
	 * aligned to the request timeline. Returns ascending {offset_ns, bytes}
	 * points. The peak is reported separately in the summary.
	 *
	 * @return array<int, array{offset_ns: int, bytes: int}>
	 */
	private function build_memory_samples() {
		$samples = array();
		foreach ( $this->phase_memory as $hook => $bytes ) {
			$ts        = isset( $this->phase_markers[ $hook ] ) ? $this->phase_markers[ $hook ] : $this->request_start_ns;
			$samples[] = array(
				'offset_ns' => max( 0, $ts - $this->request_start_ns ),
				'bytes'     => (int) $bytes,
			);
		}
		// Final sample at end of request.
		$samples[] = array(
			'offset_ns' => max( 0, hrtime( true ) - $this->request_start_ns ),
			'bytes'     => memory_get_usage(),
		);
		usort(
			$samples,
			function ( $a, $b ) {
				return $a['offset_ns'] <=> $b['offset_ns'];
			}
		);
		return $samples;
	}

	/**
	 * Get the current user's role for the role pill.
	 *
	 * @return string  Role slug ('administrator', 'editor', etc.) or 'anonymous'.
	 */
	private static function get_current_role() {
		if ( ! function_exists( 'is_user_logged_in' ) || ! is_user_logged_in() ) {
			return 'anonymous';
		}
		$user = wp_get_current_user();
		if ( ! empty( $user->roles ) ) {
			return reset( $user->roles ); // First role.
		}
		return 'authenticated';
	}

	/**
	 * Get total database query count.
	 *
	 * @return int
	 */
	private static function get_query_count() {
		global $wpdb;
		return isset( $wpdb->num_queries ) ? (int) $wpdb->num_queries : 0;
	}

	/**
	 * Get individual query log if SAVEQUERIES is enabled.
	 *
	 * When $wpdb->queries includes a start_time (index 3, available
	 * since WP 5.1), each entry also gets offset_ns and duration_ns
	 * for timeline placement.
	 *
	 * @return array  Array of {sql, time_ms, caller, offset_ns?, duration_ns?} or empty array.
	 */
	private function get_query_log() {
		global $wpdb;

		if ( ! defined( 'SAVEQUERIES' ) || ! SAVEQUERIES ) {
			return array();
		}

		if ( empty( $wpdb->queries ) || ! is_array( $wpdb->queries ) ) {
			return array();
		}

		$has_offsets = $this->request_start_microtime > 0;

		$log = array();
		foreach ( $wpdb->queries as $q ) {
			$time_ms = isset( $q[1] ) ? round( (float) $q[1] * 1000, 2 ) : 0;

			$entry = array(
				'sql'     => isset( $q[0] ) ? self::sanitize_query( $q[0] ) : '',
				'time_ms' => $time_ms,
				'caller'  => isset( $q[2] ) ? $q[2] : '',
			);

			// $wpdb->queries[3] = microtime(true) when the query started.
			if ( $has_offsets && isset( $q[3] ) ) {
				$offset_s             = (float) $q[3] - $this->request_start_microtime;
				$entry['offset_ns']   = max( 0, (int) round( $offset_s * 1e9 ) );
				$entry['duration_ns'] = (int) round( $time_ms * 1e6 );
			}

			$log[] = $entry;
		}

		// Sort by time descending for the dashboard.
		usort(
			$log,
			function ( $a, $b ) {
				return $b['time_ms'] <=> $a['time_ms'];
			}
		);

		return $log;
	}

	/**
	 * Reduce a SQL query to verb + table name(s) only.
	 *
	 * Delegates to QueryReducer for tokenizer-based extraction.
	 *
	 * @see QueryReducer::reduce()
	 *
	 * @param string $sql Raw SQL query.
	 * @return string Reduced "VERB table[, table2]" string.
	 */
	private static function sanitize_query( $sql ) {
		return QueryReducer::reduce( $sql );
	}

	/**
	 * Collect enqueued scripts and styles.
	 *
	 * Called at shutdown, after wp_print_footer_scripts has run, so
	 * wp_scripts()->done and wp_styles()->done are populated.
	 *
	 * Each asset includes handle, src, version, dependencies, file size
	 * (local files only), location (header/footer), and attribution.
	 *
	 * @return array{scripts: array, styles: array, total_size: int, counts: array{scripts: int, styles: int}}
	 */
	private static function get_enqueued_assets() {
		$scripts = self::collect_asset_group( wp_scripts(), 'script' );
		$styles  = self::collect_asset_group( wp_styles(), 'style' );

		$total_size = 0;
		foreach ( $scripts as $s ) {
			$total_size += $s['size'];
		}
		foreach ( $styles as $s ) {
			$total_size += $s['size'];
		}

		return array(
			'scripts'    => $scripts,
			'styles'     => $styles,
			'total_size' => $total_size,
			'counts'     => array(
				'scripts' => count( $scripts ),
				'styles'  => count( $styles ),
			),
		);
	}

	/**
	 * Collect assets from a WP_Dependencies instance (scripts or styles).
	 *
	 * @param \WP_Dependencies $deps  The WP_Scripts or WP_Styles global.
	 * @param string           $kind  'script' or 'style'.
	 * @return array
	 */
	private static function collect_asset_group( $deps, $kind ) {
		if ( ! $deps || empty( $deps->done ) ) {
			return array();
		}

		$assets  = array();
		$abspath = wp_normalize_path( ABSPATH );

		foreach ( $deps->done as $handle ) {
			if ( ! isset( $deps->registered[ $handle ] ) ) {
				continue;
			}

			$obj = $deps->registered[ $handle ];
			$src = $obj->src ? $obj->src : '';

			// Resolve local path for file size and attribution.
			$local_path = '';
			$size       = 0;
			$location   = 'external';

			if ( empty( $src ) ) {
				// Empty src = inline/generated style (common with block themes).
				$location = 'inline';
			} else {
				$local_path = self::resolve_asset_path( $src, $abspath );
				if ( $local_path && file_exists( $local_path ) ) {
					$size     = (int) filesize( $local_path );
					$location = 'local';
				}
			}

			// Footer vs header (scripts only — styles are always header).
			if ( 'script' === $kind ) {
				$in_footer = isset( $obj->extra['group'] ) && 1 === (int) $obj->extra['group'];
				$location  = $in_footer ? 'footer' : 'header';
			}

			// Attribution via file path.
			$attribution = array(
				'type' => 'unknown',
				'slug' => '',
				'name' => '',
			);
			if ( $local_path ) {
				$attribution = Attribution::classify( $local_path );
			} elseif ( ! empty( $src ) ) {
				// Try attribution from URL path segments for known plugin/theme patterns.
				$attribution = self::classify_asset_url( $src );
			}

			// Handle-based attribution for wp-block-* and theme styles with no src.
			if ( 'unknown' === $attribution['type'] ) {
				if ( 0 === strpos( $handle, 'wp-block-' ) || 0 === strpos( $handle, 'wp-emoji' ) || 'core-block-supports' === $handle ) {
					$attribution = array(
						'type' => 'core',
						'slug' => 'wordpress',
						'name' => 'WordPress Core',
					);
				} elseif ( preg_match( '/^([a-z0-9-]+)-style$/', $handle, $hm ) ) {
					$theme = wp_get_theme( $hm[1] );
					if ( $theme->exists() ) {
						$attribution = array(
							'type' => 'theme',
							'slug' => $hm[1],
							'name' => $theme->get( 'Name' ) ? $theme->get( 'Name' ) : $hm[1],
						);
					}
				}
			}

			$assets[] = array(
				'handle'      => $handle,
				'src'         => $src,
				'version'     => $obj->ver ? $obj->ver : '',
				'deps'        => $obj->deps ? $obj->deps : array(),
				'size'        => $size,
				'location'    => $location,
				'attribution' => $attribution,
			);
		}

		// Sort by size descending (largest first).
		usort(
			$assets,
			function ( $a, $b ) {
				return $b['size'] <=> $a['size'];
			}
		);

		return $assets;
	}

	/**
	 * Resolve an enqueued asset URL to a local filesystem path.
	 *
	 * @param string $src      Asset source URL (relative or absolute).
	 * @param string $abspath  Normalized ABSPATH.
	 * @return string  Local path or empty string if external.
	 */
	private static function resolve_asset_path( $src, $abspath ) {
		// Handle protocol-relative URLs.
		if ( 0 === strpos( $src, '//' ) ) {
			$src = 'https:' . $src;
		}

		// Relative path (starts with /).
		if ( 0 === strpos( $src, '/' ) && 0 !== strpos( $src, '//' ) ) {
			$path = wp_normalize_path( $abspath . ltrim( $src, '/' ) );
			return file_exists( $path ) ? $path : '';
		}

		// Full URL — check if it's on this site.
		$site_url = wp_normalize_path( site_url( '/' ) );
		$home_url = wp_normalize_path( home_url( '/' ) );

		foreach ( array( $site_url, $home_url ) as $base ) {
			if ( 0 === strpos( $src, $base ) ) {
				$relative = substr( $src, strlen( $base ) );
				// Strip query string.
				$relative = strtok( $relative, '?' );
				$path     = wp_normalize_path( $abspath . $relative );
				return file_exists( $path ) ? $path : '';
			}
		}

		return '';
	}

	/**
	 * Attempt attribution from an asset URL's path segments.
	 *
	 * For external CDN assets or when local path resolution fails,
	 * looks for /plugins/slug/ or /themes/slug/ in the URL.
	 *
	 * @param string $src  Asset source URL.
	 * @return array{type: string, slug: string, name: string}
	 */
	private static function classify_asset_url( $src ) {
		$result = array(
			'type' => 'unknown',
			'slug' => '',
			'name' => '',
		);

		// Look for /wp-content/plugins/slug/ or /wp-content/themes/slug/.
		if ( preg_match( '#/wp-content/plugins/([^/]+)/#', $src, $m ) ) {
			$result['type'] = 'plugin';
			$result['slug'] = $m[1];
			$result['name'] = $m[1];
		} elseif ( preg_match( '#/wp-content/themes/([^/]+)/#', $src, $m ) ) {
			$result['type'] = 'theme';
			$result['slug'] = $m[1];
			$result['name'] = $m[1];
		} elseif ( preg_match( '#/wp-(?:admin|includes)/#', $src ) ) {
			$result['type'] = 'core';
			$result['slug'] = 'WordPress';
			$result['name'] = 'WordPress Core';
		}

		return $result;
	}
}
