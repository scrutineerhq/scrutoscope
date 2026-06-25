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
	 * Handle GET /v1/prompt.
	 *
	 * Returns raw text/plain — not JSON-wrapped.
	 *
	 * @param \WP_REST_Request $request  Request object.
	 * @return void
	 */
	public static function handle_prompt( $request ) {
		$prompt = Prompt::build();

		// Bypass WP REST JSON encoding — send raw text.
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'Cache-Control: private, max-age=3600' );
		echo $prompt;
		exit;
	}

	/**
	 * Handle GET /v1/diagnostics.
	 *
	 * @param \WP_REST_Request $request  Request object.
	 * @return \WP_REST_Response
	 */
	public static function handle_diagnostics( $request ) {
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
				'avg_query_count'   => null !== $group['avg_query_count'] ? (int) round( (float) $group['avg_query_count'] ) : null,
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
