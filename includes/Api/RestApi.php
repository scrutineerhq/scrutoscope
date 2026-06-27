<?php
/**
 * REST API route registration and controllers.
 *
 * Registers all Scrutineer REST API endpoints under the
 * scrutinizer/v1 namespace with permission callbacks and
 * response formatting.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Api;

use Scrutinizer\Profiler\Storage;

/**
 * Registers and handles REST API routes.
 */
class RestApi {

	/**
	 * REST namespace.
	 *
	 * @var string
	 */
	const NAMESPACE = 'scrutinizer/v1';

	/**
	 * Register hooks.
	 */
	public static function register() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_filter( 'rest_pre_serve_request', array( __CLASS__, 'serve_text_plain' ), 10, 4 );
	}

	/**
	 * Register all API routes.
	 */
	public static function register_routes() {
		register_rest_route(
			self::NAMESPACE,
			'/prompt',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_prompt' ),
				'permission_callback' => array( __CLASS__, 'check_permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/diagnostics',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_diagnostics' ),
				'permission_callback' => array( __CLASS__, 'check_permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/routes',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_routes' ),
				'permission_callback' => array( __CLASS__, 'check_permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/profile/(?P<id>\d+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_profile' ),
				'permission_callback' => array( __CLASS__, 'check_permission' ),
				'args'                => array(
					'id' => array(
						'validate_callback' => function ( $param ) {
							return is_numeric( $param ) && (int) $param > 0;
						},
						'sanitize_callback' => 'absint',
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/compare/(?P<id_a>\d+)/(?P<id_b>\d+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_compare' ),
				'permission_callback' => array( __CLASS__, 'check_permission' ),
				'args'                => array(
					'id_a' => array(
						'validate_callback' => function ( $param ) {
							return is_numeric( $param ) && (int) $param > 0;
						},
						'sanitize_callback' => 'absint',
					),
					'id_b' => array(
						'validate_callback' => function ( $param ) {
							return is_numeric( $param ) && (int) $param > 0;
						},
						'sanitize_callback' => 'absint',
					),
				),
			)
		);

		// Manifest — public, no auth required.
		register_rest_route(
			self::NAMESPACE,
			'/manifest',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_manifest' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Permission callback for all endpoints.
	 *
	 * Requires `manage_options` capability.
	 *
	 * @return bool|\WP_Error
	 */
	public static function check_permission() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new \WP_Error(
				'scrutinizer_forbidden',
				__( 'You do not have permission to access Scrutineer data.', 'scrutinizer' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Log an API access event.
	 *
	 * Stores access events in a custom database table. Creates the
	 * table on first use if it doesn't exist.
	 *
	 * @param string $endpoint  Endpoint path (e.g. '/v1/prompt').
	 * @return void
	 */
	private static function log_access( $endpoint ) {
		global $wpdb;

		self::maybe_create_log_table();

		$table = $wpdb->prefix . 'scrutinizer_api_log';

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->insert(
			$table,
			array(
				'endpoint'   => $endpoint,
				'ip'         => self::get_client_ip(),
				'user_agent' => self::coarsen_user_agent( isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '' ),
				'user_id'    => get_current_user_id(),
				'created_at' => current_time( 'mysql' ),
			),
			array( '%s', '%s', '%s', '%d', '%s' )
		);

		// Trim to last 500 entries to prevent unbounded growth.
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
		if ( $count > 500 ) {
			$cutoff_id = (int) $wpdb->get_var(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$wpdb->prepare( "SELECT id FROM {$table} ORDER BY id DESC LIMIT 1 OFFSET %d", 500 )
			);
			if ( $cutoff_id > 0 ) {
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE id <= %d", $cutoff_id ) );
			}
		}
	}

	/**
	 * Get the client IP for the access log.
	 *
	 * REMOTE_ADDR is the only address a client cannot forge. Proxy headers
	 * (X-Forwarded-For, CF-Connecting-IP, X-Real-IP) are trivially spoofable
	 * unless the site genuinely sits behind a trusted proxy that overwrites
	 * them — and a spoofed value would poison the audit log. So we use
	 * REMOTE_ADDR by default and only consult proxy headers when the site
	 * opts in via the `scrutinizer_trust_proxy_headers` filter.
	 *
	 * @return string
	 */
	private static function get_client_ip() {
		/**
		 * Whether to trust forwarded-for proxy headers for the access log.
		 *
		 * Enable only on sites behind a proxy/CDN that reliably sets these
		 * headers; otherwise clients can spoof the logged IP.
		 *
		 * @param bool $trust Default false.
		 */
		if ( apply_filters( 'scrutinizer_trust_proxy_headers', (bool) get_option( 'scrutinizer_trust_proxy_headers', false ) ) ) {
			$headers = array( 'HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR' );
			foreach ( $headers as $header ) {
				if ( ! empty( $_SERVER[ $header ] ) ) {
					$ip = sanitize_text_field( wp_unslash( $_SERVER[ $header ] ) );
					// X-Forwarded-For can be comma-separated; take the first.
					if ( strpos( $ip, ',' ) !== false ) {
						$ip = trim( explode( ',', $ip )[0] );
					}
					if ( filter_var( $ip, FILTER_VALIDATE_IP ) ) {
						return self::hash_ip( $ip );
					}
				}
			}
			return 'unknown';
		}

		if ( ! empty( $_SERVER['REMOTE_ADDR'] ) ) {
			$ip = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
			if ( filter_var( $ip, FILTER_VALIDATE_IP ) ) {
				return self::hash_ip( $ip );
			}
		}

		return 'unknown';
	}

	/**
	 * Hash an IP address for GDPR-compliant storage.
	 *
	 * Uses HMAC-SHA256 with the site's AUTH_SALT as key, producing a
	 * consistent pseudonymous identifier that can't be reversed to the
	 * original IP. The same IP always produces the same hash on this
	 * installation, so log entries remain groupable.
	 *
	 * @param string $ip Raw IP address.
	 * @return string First 16 hex chars of HMAC-SHA256 digest.
	 */
	private static function hash_ip( $ip ) {
		// wp_salt() always returns a per-site secret (generating and storing
		// one if the wp-config constants are absent), so there is never a
		// guessable hardcoded fallback that would make the hash reversible.
		$key = wp_salt( 'auth' );
		return substr( hash_hmac( 'sha256', $ip, $key ), 0, 16 );
	}

	/**
	 * Reduce a User-Agent to a coarse family for the audit log.
	 *
	 * Strips version numbers so the client family stays legible for support
	 * without storing a precisely fingerprintable string.
	 *
	 * @param string $ua Raw User-Agent.
	 * @return string Coarsened User-Agent (max 100 chars).
	 */
	private static function coarsen_user_agent( $ua ) {
		if ( '' === $ua ) {
			return '';
		}
		$ua = preg_replace( '/\d+(\.\d+)*/', 'x', $ua );
		return substr( $ua, 0, 100 );
	}

	/**
	 * Get the API access log.
	 *
	 * @param int $limit  Maximum entries to return.
	 * @return array
	 */
	public static function get_access_log( $limit = 100 ) {
		global $wpdb;

		$table = $wpdb->prefix . 'scrutinizer_api_log';

		// Check if the table exists — return legacy option data during migration.
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$table_exists = $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema = %s AND table_name = %s', DB_NAME, $table ) );

		if ( ! $table_exists ) {
			// Fall back to legacy option if table not yet created.
			return get_option( 'scrutinizer_api_log', array() );
		}

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_results(
			$wpdb->prepare( "SELECT endpoint, ip, user_agent, user_id, created_at AS timestamp FROM {$table} ORDER BY id DESC LIMIT %d", $limit ),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return is_array( $rows ) ? $rows : array();
	}

	/**
	 * Clear the API access log.
	 *
	 * @return void
	 */
	public static function clear_access_log() {
		global $wpdb;

		$table = $wpdb->prefix . 'scrutinizer_api_log';

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( "TRUNCATE TABLE {$table}" );

		// Also clean up legacy option if it exists.
		delete_option( 'scrutinizer_api_log' );
	}

	/**
	 * Create the API log table if it doesn't exist.
	 *
	 * Uses a static flag to avoid repeated checks within a request.
	 */
	private static function maybe_create_log_table() {
		static $checked = false;

		if ( $checked ) {
			return;
		}

		$checked = true;

		global $wpdb;

		$table   = $wpdb->prefix . 'scrutinizer_api_log';
		$charset = $wpdb->get_charset_collate();

		// Quick existence check — avoid dbDelta overhead on every request.
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$exists = $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema = %s AND table_name = %s', DB_NAME, $table ) );

		if ( $exists ) {
			return;
		}

		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			endpoint varchar(100) NOT NULL DEFAULT '',
			ip varchar(45) NOT NULL DEFAULT '',
			user_agent varchar(200) NOT NULL DEFAULT '',
			user_id bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL DEFAULT '0000-00-00 00:00:00',
			PRIMARY KEY  (id),
			KEY created_at (created_at)
		) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Migrate legacy option data into the table.
		$legacy = get_option( 'scrutinizer_api_log', array() );
		if ( ! empty( $legacy ) && is_array( $legacy ) ) {
			foreach ( $legacy as $entry ) {
				$wpdb->insert(
					$table,
					array(
						'endpoint'   => isset( $entry['endpoint'] ) ? $entry['endpoint'] : '',
						'ip'         => isset( $entry['ip'] ) ? $entry['ip'] : '',
						'user_agent' => isset( $entry['user_agent'] ) ? $entry['user_agent'] : '',
						'user_id'    => isset( $entry['user_id'] ) ? (int) $entry['user_id'] : 0,
						'created_at' => isset( $entry['timestamp'] ) ? $entry['timestamp'] : current_time( 'mysql' ),
					),
					array( '%s', '%s', '%s', '%d', '%s' )
				);
			}
			delete_option( 'scrutinizer_api_log' );
		}
	}

	/**
	 * Handle GET /v1/manifest.
	 *
	 * Returns a machine-readable API manifest for AI agent auto-discovery.
	 * Public endpoint — no authentication required.
	 *
	 * @param \WP_REST_Request $request  Request object.
	 * @return \WP_REST_Response
	 */
	public static function handle_manifest( $request ) {
		$base_url = rest_url( self::NAMESPACE );

		$manifest = array(
			'schema_version' => '1.0',
			'name'           => 'Scrutineer',
			'description'    => 'WordPress performance profiler — read-only API for site performance data.',
			// Major series only — the public manifest should not disclose the
			// exact patch version (aids targeted fingerprinting). API
			// compatibility is conveyed by schema_version above.
			'version'        => ( defined( 'SCRUTINIZER_VERSION' ) ? (int) SCRUTINIZER_VERSION : 1 ) . '.x',
			'auth'           => array(
				'type'        => 'http',
				'scheme'      => 'basic',
				'description' => 'WordPress Application Password. Use the "Send to Agent" button in the Scrutineer dashboard to generate a short-lived credential.',
			),
			'base_url'       => $base_url,
			'tools'          => array(
				array(
					'name'        => 'get_prompt',
					'description' => 'Get the system prompt that describes how to interpret Scrutineer data. Read this first.',
					'endpoint'    => '/v1/prompt',
					'method'      => 'GET',
					'parameters'  => array(),
					'returns'     => 'text/plain',
				),
				array(
					'name'        => 'get_diagnostics',
					'description' => 'Get server environment details (PHP version, memory limits, OPcache status, etc). Only includes fields the site admin has opted in to share.',
					'endpoint'    => '/v1/diagnostics',
					'method'      => 'GET',
					'parameters'  => array(),
					'returns'     => 'application/json',
				),
				array(
					'name'        => 'get_routes',
					'description' => 'List all profiled routes with summary statistics (count, avg/min/max/p95 duration, memory).',
					'endpoint'    => '/v1/routes',
					'method'      => 'GET',
					'parameters'  => array(),
					'returns'     => 'application/json',
				),
				array(
					'name'        => 'get_profile',
					'description' => 'Get full profile detail for one request, including timeline, trace, queries, HTTP calls, and source breakdown.',
					'endpoint'    => '/v1/profile/{id}',
					'method'      => 'GET',
					'parameters'  => array(
						array(
							'name'        => 'id',
							'type'        => 'integer',
							'required'    => true,
							'description' => 'Profile ID from the routes listing.',
						),
					),
					'returns'     => 'application/json',
				),
				array(
					'name'        => 'compare_profiles',
					'description' => 'Side-by-side comparison of two profiles, showing deltas in duration, memory, queries, and sources.',
					'endpoint'    => '/v1/compare/{id_a}/{id_b}',
					'method'      => 'GET',
					'parameters'  => array(
						array(
							'name'        => 'id_a',
							'type'        => 'integer',
							'required'    => true,
							'description' => 'First profile ID (reference).',
						),
						array(
							'name'        => 'id_b',
							'type'        => 'integer',
							'required'    => true,
							'description' => 'Second profile ID (comparison).',
						),
					),
					'returns'     => 'application/json',
				),
			),
		);

		return new \WP_REST_Response( $manifest, 200 );
	}

	/**
	 * Handle GET /v1/prompt.
	 *
	 * Returns the prompt as text/plain. Uses rest_pre_serve_request
	 * to bypass JSON encoding while staying inside the REST framework.
	 *
	 * @param \WP_REST_Request $request  Request object.
	 * @return \WP_REST_Response
	 */
	public static function handle_prompt( $request ) {
		self::log_access( '/v1/prompt' );
		$prompt = Prompt::build();

		$response = new \WP_REST_Response( $prompt, 200 );
		$response->header( 'Content-Type', 'text/plain; charset=utf-8' );
		$response->header( 'Cache-Control', 'private, max-age=3600' );

		return $response;
	}

	/**
	 * Serve text/plain responses without JSON encoding.
	 *
	 * Hooked to `rest_pre_serve_request`. When a response carries
	 * Content-Type: text/plain, echo the raw data instead of letting
	 * WP_REST_Server::serve_request() JSON-encode it.
	 *
	 * @param bool              $served  Whether the request has already been served.
	 * @param \WP_REST_Response $result  Response object.
	 * @param \WP_REST_Request  $request Request object.
	 * @param \WP_REST_Server   $server  Server instance.
	 * @return bool
	 */
	public static function serve_text_plain( $served, $result, $request, $server ) {
		if ( $served ) {
			return $served;
		}

		// Only intercept our prompt endpoint.
		$route = $request->get_route();
		if ( '/scrutinizer/v1/prompt' !== $route ) {
			return $served;
		}

		// Send headers that WP_REST_Response collected.
		$headers = $result->get_headers();
		foreach ( $headers as $key => $value ) {
			header( sprintf( '%s: %s', $key, $value ) );
		}

		// Send the status code.
		status_header( $result->get_status() );

		// Output raw text — no JSON wrapping. This is a text/plain response of
		// plugin-generated prompt content; HTML-escaping would corrupt it.
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo $result->get_data();

		return true;
	}

	/**
	 * Handle GET /v1/diagnostics.
	 *
	 * @param \WP_REST_Request $request  Request object.
	 * @return \WP_REST_Response
	 */
	public static function handle_diagnostics( $request ) {
		self::log_access( '/v1/diagnostics' );
		$data = Diagnostics::collect();

		return new \WP_REST_Response( $data, 200 );
	}

	/**
	 * Handle GET /v1/routes.
	 *
	 * @param \WP_REST_Request $request  Request object.
	 * @return \WP_REST_Response
	 */
	public static function handle_routes( $request ) {
		self::log_access( '/v1/routes' );
		$groups = Storage::get_profiles_grouped();

		$routes = array();
		foreach ( $groups as $group ) {
			$route_label = $group['route_key'];

			// Get the latest profile ID for this route.
			$route_profiles = Storage::get_profiles_for_route( $group['route_key'], 1 );
			$latest_id      = ! empty( $route_profiles ) ? (int) $route_profiles[0]['id'] : null;

			$routes[] = array(
				'route'             => $route_label,
				'route_label'       => isset( $group['route_label'] ) ? $group['route_label'] : null,
				'profile_count'     => (int) $group['request_count'],
				'latest_profile_id' => $latest_id,
				'avg_duration_ms'   => round( (float) $group['avg_duration_ns'] / 1e6, 1 ),
				'avg_query_count'   => isset( $group['avg_query_count'] ) ? (int) round( (float) $group['avg_query_count'] ) : null,
				'count_2xx'         => isset( $group['count_2xx'] ) ? (int) $group['count_2xx'] : 0,
				'count_4xx'         => isset( $group['count_4xx'] ) ? (int) $group['count_4xx'] : 0,
				'count_5xx'         => isset( $group['count_5xx'] ) ? (int) $group['count_5xx'] : 0,
			);
		}

		return new \WP_REST_Response( Sanitizer::sanitize( array( 'routes' => $routes ) ), 200 );
	}

	/**
	 * Handle GET /v1/profile/{id}.
	 *
	 * @param \WP_REST_Request $request  Request object.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function handle_profile( $request ) {
		self::log_access( '/v1/profile/' . $request->get_param( 'id' ) );
		$id      = $request->get_param( 'id' );
		$profile = Storage::get_profile( $id );

		if ( null === $profile ) {
			return new \WP_Error(
				'scrutinizer_not_found',
				__( 'Profile not found.', 'scrutinizer' ),
				array( 'status' => 404 )
			);
		}

		$data    = $profile['profile_data'];
		$summary = isset( $data['summary'] ) ? $data['summary'] : array();

		// Build response matching the spec shape.
		$response = array(
			'id'          => (int) $profile['id'],
			'route'       => $profile['route_key'],
			'captured_at' => gmdate( 'c', strtotime( $profile['captured_at'] ) ),
			'duration_ms' => round( (float) $profile['duration_ns'] / 1e6, 1 ),
			'pinned'      => ! empty( $profile['is_pinned'] ),
			'tags'        => ! empty( $profile['tags'] ) ? array_map( 'trim', explode( ',', $profile['tags'] ) ) : array(),
			'note'        => $profile['note'] ?? '',
		);

		// Summary.
		$response['summary'] = array(
			'total_callbacks'  => isset( $summary['total_callbacks'] ) ? (int) $summary['total_callbacks'] : 0,
			'total_sources'    => isset( $summary['source_count'] ) ? (int) $summary['source_count'] : 0,
			'unattributed_ms'  => isset( $summary['duration_ns'], $summary['total_exclusive_ns'] )
				? round( ( (float) $summary['duration_ns'] - (float) $summary['total_exclusive_ns'] ) / 1e6, 1 )
				: null,
			'unattributed_pct' => isset( $summary['duration_ns'], $summary['total_exclusive_ns'] ) && (float) $summary['duration_ns'] > 0
				? round( ( (float) $summary['duration_ns'] - (float) $summary['total_exclusive_ns'] ) / (float) $summary['duration_ns'] * 100, 1 )
				: null,
		);

		// Memory peak if available.
		$mem_peak = isset( $summary['memory_peak'] ) ? (int) $summary['memory_peak'] : 0;
		if ( 0 === $mem_peak && isset( $data['request']['memory_peak'] ) ) {
			$mem_peak = (int) $data['request']['memory_peak'];
		}
		if ( $mem_peak > 0 ) {
			$response['memory_peak_mb'] = round( $mem_peak / 1048576, 1 );
		}

		// Sources — top by exclusive time.
		$response['sources'] = array();
		if ( ! empty( $data['sources'] ) ) {
			$duration_ns = (float) $profile['duration_ns'];
			foreach ( $data['sources'] as $src ) {
				$excl_ns = isset( $src['exclusive_ns'] ) ? (float) $src['exclusive_ns'] : 0;
				$incl_ns = isset( $src['inclusive_ns'] ) ? (float) $src['inclusive_ns'] : 0;

				$response['sources'][] = array(
					'source'         => isset( $src['slug'] ) ? $src['slug'] : 'unknown',
					'type'           => isset( $src['type'] ) ? $src['type'] : 'unknown',
					'exclusive_ms'   => round( $excl_ns / 1e6, 1 ),
					'exclusive_pct'  => $duration_ns > 0 ? round( $excl_ns / $duration_ns * 100, 1 ) : 0,
					'inclusive_ms'   => round( $incl_ns / 1e6, 1 ),
					'inclusive_pct'  => $duration_ns > 0 ? round( $incl_ns / $duration_ns * 100, 1 ) : 0,
					'callback_count' => isset( $src['callback_count'] ) ? (int) $src['callback_count'] : 0,
				);
			}
		}

		// Queries.
		$response['queries'] = array();
		if ( ! empty( $data['queries'] ) ) {
			foreach ( $data['queries'] as $q ) {
				$response['queries'][] = array(
					'sql'     => Sanitizer::sanitize_sql( isset( $q['sql'] ) ? $q['sql'] : '' ),
					'time_ms' => isset( $q['time_ms'] ) ? round( (float) $q['time_ms'], 2 ) : 0,
					'caller'  => isset( $q['caller'] ) ? $q['caller'] : '',
					'source'  => isset( $q['source'] ) ? $q['source'] : '',
				);
			}
		}

		// HTTP calls.
		$response['http_calls'] = array();
		if ( ! empty( $data['http_calls'] ) ) {
			foreach ( $data['http_calls'] as $h ) {
				$response['http_calls'][] = array(
					'url'         => isset( $h['url'] ) ? $h['url'] : '',
					'method'      => isset( $h['method'] ) ? $h['method'] : 'GET',
					'status'      => isset( $h['status'] ) ? (int) $h['status'] : null,
					'duration_ms' => isset( $h['duration_ms'] ) ? round( (float) $h['duration_ms'], 1 ) : 0,
					'caller'      => isset( $h['caller'] ) ? $h['caller'] : '',
					'source'      => isset( $h['source_name'] ) ? $h['source_name'] : ( isset( $h['source'] ) ? $h['source'] : '' ),
					'source_type' => isset( $h['source_type'] ) ? $h['source_type'] : 'unknown',
					'is_error'    => ! empty( $h['is_error'] ),
				);
			}
		}

		// Milestones (phase markers / timeline).
		$response['milestones'] = array();
		if ( ! empty( $data['phase_markers'] ) ) {
			foreach ( $data['phase_markers'] as $marker ) {
				$response['milestones'][] = array(
					'hook'      => isset( $marker['hook'] ) ? $marker['hook'] : '',
					'label'     => isset( $marker['label'] ) ? $marker['label'] : ( isset( $marker['hook'] ) ? $marker['hook'] : '' ),
					'offset_ms' => isset( $marker['offset_ns'] ) ? round( (float) $marker['offset_ns'] / 1e6, 1 ) : 0,
				);
			}
		}

		return new \WP_REST_Response( Sanitizer::sanitize( $response ), 200 );
	}

	/**
	 * Handle GET /v1/compare/{id_a}/{id_b}.
	 *
	 * @param \WP_REST_Request $request  Request object.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function handle_compare( $request ) {
		self::log_access( '/v1/compare/' . $request->get_param( 'id_a' ) . '/' . $request->get_param( 'id_b' ) );
		$id_a = $request->get_param( 'id_a' );
		$id_b = $request->get_param( 'id_b' );

		$comparison = Storage::get_comparison( $id_a, $id_b );

		if ( null === $comparison ) {
			return new \WP_Error(
				'scrutinizer_not_found',
				__( 'One or both profiles not found.', 'scrutinizer' ),
				array( 'status' => 404 )
			);
		}

		// Format profile_a and profile_b as abbreviated profiles (same shape as /v1/profile but lighter).
		$format_brief = function ( $raw ) {
			$data    = $raw['profile_data'];
			$summary = isset( $data['summary'] ) ? $data['summary'] : array();

			return array(
				'id'          => (int) $raw['id'],
				'route'       => $raw['route_key'],
				'captured_at' => gmdate( 'c', strtotime( $raw['captured_at'] ) ),
				'duration_ms' => round( (float) $raw['duration_ns'] / 1e6, 1 ),
				'query_count' => isset( $summary['query_count'] ) ? (int) $summary['query_count'] : ( ! empty( $data['queries'] ) ? count( $data['queries'] ) : 0 ),
			);
		};

		$delta   = $comparison['delta'];
		$sources = array();
		if ( ! empty( $delta['sources'] ) ) {
			foreach ( $delta['sources'] as $key => $s ) {
				$parts     = explode( ':', $key, 2 );
				$sources[] = array(
					'source'             => isset( $parts[1] ) ? $parts[1] : $key,
					'exclusive_ms_delta' => round( (float) $s['delta_ns'] / 1e6, 1 ),
				);
			}
		}

		$response = array(
			'profile_a' => $format_brief( $comparison['a'] ),
			'profile_b' => $format_brief( $comparison['b'] ),
			'deltas'    => array(
				'duration_ms' => round( (float) $delta['duration_ns'] / 1e6, 1 ),
				'query_count' => $delta['query_count_delta'],
				'sources'     => $sources,
			),
		);

		return new \WP_REST_Response( Sanitizer::sanitize( $response ), 200 );
	}
}
