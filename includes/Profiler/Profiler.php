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
	 * Request start time in nanoseconds.
	 *
	 * @var int
	 */
	private $request_start_ns = 0;

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
			if ( isset( $_REQUEST['action'] ) ) {
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

		$rate = (int) get_option( 'scrutinizer_sample_rate', 5 );
		$rate = max( 1, min( 100, $rate ) ); // Clamp 1-100%.

		// phpcs:ignore WordPress.WP.AlternativeFunctions.rand_mt_rand
		return mt_rand( 1, 100 ) <= $rate;
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
		$this->request_start_ns = hrtime( true );

		// Record the start as the first phase marker.
		$this->phase_markers['profiler_start'] = $this->request_start_ns;

		$this->call_stack   = new CallStack();
		$this->instrumentor = new Instrumentor( $this->call_stack );

		// Instrument all currently registered hooks.
		$this->instrumentor->instrument_all();

		// Register lifecycle phase markers at priority 0 to capture timing
		// as early as possible within each phase.
		$lifecycle_hooks = array(
			'muplugins_loaded',
			'plugins_loaded',
			'setup_theme',
			'after_setup_theme',
			'init',
			'wp_loaded',
			'template_redirect',
			'wp',
		);
		foreach ( $lifecycle_hooks as $hook ) {
			add_action( $hook, array( $this, 'record_phase_marker' ), 0 );
		}

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
			'url'           => $request_url,
			'method'        => $request_method,
			'duration_ns'   => $duration_ns,
			'route_class'   => $this->route_class,
			'wp_version'    => get_bloginfo( 'version' ),
			'timestamp'     => time(),
			'phase_markers' => $this->build_phase_offsets(),
			'user_role'     => self::get_current_role(),
			'query_count'   => self::get_query_count(),
			'queries'       => self::get_query_log(),
		);

		try {
			$raw_timings = $this->instrumentor->get_timings();
			$trace       = $this->call_stack->get_trace();
			$report      = Report::compile( $raw_timings, $trace, $metadata );

			$profile_type = $this->is_background ? 'background' : 'session';
			Storage::save_profile( $session_id, $report, $profile_type );
		} catch ( \Throwable $e ) {
			// Fail silently — never break the site.
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( 'Scrutinizer profiler error: ' . $e->getMessage() );
			}
		}
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
	 * @return array  Array of {sql, time_ms, caller} or empty array.
	 */
	private static function get_query_log() {
		global $wpdb;

		if ( ! defined( 'SAVEQUERIES' ) || ! SAVEQUERIES ) {
			return array();
		}

		if ( empty( $wpdb->queries ) || ! is_array( $wpdb->queries ) ) {
			return array();
		}

		$log = array();
		foreach ( $wpdb->queries as $q ) {
			$log[] = array(
				'sql'     => isset( $q[0] ) ? $q[0] : '',
				'time_ms' => isset( $q[1] ) ? round( (float) $q[1] * 1000, 2 ) : 0,
				'caller'  => isset( $q[2] ) ? $q[2] : '',
			);
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
}
