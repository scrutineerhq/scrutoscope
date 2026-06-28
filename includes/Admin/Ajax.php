<?php
/**
 * Admin AJAX handlers.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Admin;

use Scrutinizer\Profiler\Session;
use Scrutinizer\Profiler\Storage;
use Scrutinizer\Profiler\Report;
use Scrutinizer\Profiler\Regression;
use Scrutinizer\Api\Sanitizer;

// Every action in this file is registered through self::add_ajax(), which runs
// self::guard() — check_ajax_referer( 'scrutinizer_nonce', 'nonce' ) plus a
// manage_options check — before the handler. The nonce is therefore verified
// centrally for every entry point (proven by AjaxGuardTest), but WPCS's
// per-function NonceVerification sniff can't see across the wrapper, so it is
// disabled for this file. Input is still individually sanitized.
// phpcs:disable WordPress.Security.NonceVerification.Recommended
// phpcs:disable WordPress.Security.NonceVerification.Missing

/**
 * Registers and handles AJAX actions for the dashboard.
 */
class Ajax {

	/**
	 * AJAX action suffixes; each maps to a same-named handler method and is
	 * registered through add_ajax() so the nonce + capability guard always
	 * runs first.
	 *
	 * @var string[]
	 */
	private static $actions = array(
		'start_profiling',
		'stop_profiling',
		'get_profiles',
		'get_profiles_grouped',
		'get_route_profiles',
		'get_route_regression',
		'get_profile_detail',
		'delete_profile',
		'delete_profiles_bulk',
		'toggle_background',
		'toggle_only_successful',
		'pin_profile',
		'pin_profiles_bulk',
		'unpin_profile',
		'unpin_profiles_bulk',
		'update_annotation',
		'compare_profiles',
		'compare_targets',
		'get_history',
		'get_cron_inventory',
		'save_diagnostics_fields',
		'create_api_password',
		'revoke_api_password',
		'toggle_query_profiling',
		'toggle_early_boot',
		'toggle_lightweight_mode',
		'toggle_profile_cron',
		'dismiss_early_boot_banner',
		'get_api_log',
		'clear_api_log',
		'get_profile_trace',
		'get_profile_timeline',
		'save_share',
		'get_shares',
		'delete_share',
		'save_retention',
		'save_proxy_trust',
		'save_background_filters',
	);

	/**
	 * Register AJAX handlers, each wrapped with the security guard.
	 */
	public static function register() {
		foreach ( self::$actions as $action ) {
			self::add_ajax( $action );
		}
	}

	/**
	 * Register one authenticated AJAX action.
	 *
	 * The handler is wrapped so guard() — the nonce + capability check — always
	 * runs before it. Centralizing the gate here means it can never be omitted
	 * from an individual handler.
	 *
	 * @param string $action Action suffix; also the handler method name.
	 */
	private static function add_ajax( $action ) {
		add_action(
			'wp_ajax_scrutinizer_' . $action,
			function () use ( $action ) {
				self::guard();
				call_user_func( array( __CLASS__, $action ) );
			}
		);
	}

	/**
	 * Verify the AJAX nonce and the manage_options capability.
	 *
	 * Dies (via check_ajax_referer / wp_send_json_error) if either fails, so a
	 * wrapped handler never runs for an unauthenticated or unauthorized request.
	 */
	private static function guard() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}
	}

	/**
	 * Start a profiling session.
	 */
	public static function start_profiling() {
		$target = '';
		if ( isset( $_POST['target'] ) ) {
			$target = sanitize_text_field( wp_unslash( $_POST['target'] ) );
		}

		$activation_url = Session::create_activation_url( $target );

		wp_send_json_success(
			array(
				'activation_url' => $activation_url,
				'message'        => __( 'Profiling session created. Visit the activation URL to begin capturing.', 'scrutinizer' ),
			)
		);
	}

	/**
	 * Stop the active profiling session.
	 */
	public static function stop_profiling() {
		$session_id = Session::get_session_id();
		Session::stop_session();

		$profiles = array();
		if ( ! empty( $session_id ) ) {
			$profiles = Storage::get_profiles( $session_id );
		}

		wp_send_json_success(
			array(
				'session_id'    => $session_id,
				'profile_count' => count( $profiles ),
				'profiles'      => $profiles,
				'message'       => __( 'Profiling session stopped.', 'scrutinizer' ),
			)
		);
	}

	/**
	 * Get profiles for a session.
	 */
	public static function get_profiles() {
		$session_id = '';
		if ( isset( $_GET['session_id'] ) ) {
			$session_id = sanitize_text_field( wp_unslash( $_GET['session_id'] ) );
		}

		if ( empty( $session_id ) ) {
			$session_id = Session::get_session_id();
		}

		if ( empty( $session_id ) ) {
			// No active session — return the most recent profiles across all sessions.
			$profiles = Storage::get_recent_profiles( 50 );
			wp_send_json_success( array( 'profiles' => $profiles ) );
		}

		$profiles = Storage::get_profiles( $session_id );

		wp_send_json_success( array( 'profiles' => $profiles ) );
	}

	/**
	 * Get profiles grouped by route.
	 */
	public static function get_profiles_grouped() {
		$profile_type = '';
		if ( isset( $_GET['profile_type'] ) ) {
			$profile_type = sanitize_text_field( wp_unslash( $_GET['profile_type'] ) );
		}

		$session_id = '';
		if ( isset( $_GET['session_id'] ) ) {
			$session_id = sanitize_text_field( wp_unslash( $_GET['session_id'] ) );
		}

		$status_filter = '';
		if ( isset( $_GET['status_filter'] ) ) {
			$status_filter = sanitize_text_field( wp_unslash( $_GET['status_filter'] ) );
		}

		$groups = Storage::get_profiles_grouped( $profile_type, $session_id, 100, $status_filter );

		wp_send_json_success( array( 'groups' => $groups ) );
	}

	/**
	 * Get individual profiles for a specific route key.
	 */
	public static function get_route_profiles() {
		$route_key = '';
		if ( isset( $_GET['route_key'] ) ) {
			$route_key = sanitize_text_field( wp_unslash( $_GET['route_key'] ) );
		}

		if ( empty( $route_key ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No route specified.', 'scrutinizer' ) ),
				400
			);
		}

		$profiles = Storage::get_profiles_for_route( $route_key );

		wp_send_json_success( array( 'profiles' => $profiles ) );
	}

	/**
	 * Get the regression verdict for a route (recent window vs older baseline).
	 */
	public static function get_route_regression() {
		$route_key = '';
		if ( isset( $_GET['route_key'] ) ) {
			$route_key = sanitize_text_field( wp_unslash( $_GET['route_key'] ) );
		}

		if ( empty( $route_key ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No route specified.', 'scrutinizer' ) ),
				400
			);
		}

		wp_send_json_success( Regression::for_route( $route_key ) );
	}

	/**
	 * Toggle background profiling.
	 */
	public static function toggle_background() {
		$enabled = ! empty( $_POST['enabled'] );
		$rate    = 10.0;
		if ( isset( $_POST['rate'] ) ) {
			$rate = (float) $_POST['rate'];
			$rate = max( 0.0, min( 100.0, $rate ) );
			// Round to one decimal place.
			$rate = round( $rate, 1 );
		}

		update_option( 'scrutinizer_background_profiling', $enabled, true );
		update_option( 'scrutinizer_sample_rate', $rate, true );

		wp_send_json_success(
			array(
				'enabled' => $enabled,
				'rate'    => $rate,
				'message' => $enabled
					? __( 'Background profiling enabled.', 'scrutinizer' )
					: __( 'Background profiling disabled.', 'scrutinizer' ),
			)
		);
	}

	/**
	 * Toggle "only successful requests" filter.
	 */
	public static function toggle_only_successful() {
		$enabled = ! empty( $_POST['enabled'] );
		update_option( 'scrutinizer_only_successful', $enabled, true );

		wp_send_json_success(
			array(
				'enabled' => $enabled,
				'message' => $enabled
					? __( 'Only capturing successful (200) requests.', 'scrutinizer' )
					: __( 'Capturing all requests regardless of status.', 'scrutinizer' ),
			)
		);
	}

	/**
	 * Toggle query profiling (SAVEQUERIES management).
	 *
	 * Only works when the constant isn't externally defined. The change
	 * takes effect on the next request.
	 */
	public static function toggle_query_profiling() {
		if ( ! SCRUTINIZER_SAVEQUERIES_MANAGED ) {
			wp_send_json_error(
				array( 'message' => __( 'Query profiling is managed by wp-config.php and cannot be toggled here.', 'scrutinizer' ) )
			);
		}

		$enabled = ! empty( $_POST['enabled'] );
		update_option( 'scrutinizer_query_profiling', $enabled, true );

		wp_send_json_success(
			array(
				'enabled' => $enabled,
				'message' => $enabled
					? __( 'Query profiling enabled. New captures will include SQL timing.', 'scrutinizer' )
					: __( 'Query profiling disabled. New captures will skip SQL timing.', 'scrutinizer' ),
			)
		);
	}

	/**
	 * Toggle early-boot timing — installs / removes the must-use plugin.
	 *
	 * Enabling writes scrutinizer-early.php into wp-content/mu-plugins (the only
	 * write outside the plugin dir). On a filesystem failure the option is NOT
	 * set and the error is returned so the UI can show an admin notice.
	 */
	public static function toggle_early_boot() {
		$enabled = ! empty( $_POST['enabled'] );

		if ( $enabled ) {
			$result = EarlyBoot::install();
			if ( is_wp_error( $result ) ) {
				wp_send_json_error( array( 'message' => $result->get_error_message() ) );
			}
			update_option( EarlyBoot::OPTION, true, false );
			wp_send_json_success(
				array(
					'enabled' => true,
					'message' => __( 'Early-boot timing enabled. The next profiled request will include the pre-plugin bootstrap.', 'scrutinizer' ),
				)
			);
		}

		EarlyBoot::remove();
		update_option( EarlyBoot::OPTION, false, false );
		wp_send_json_success(
			array(
				'enabled' => false,
				'message' => __( 'Early-boot timing disabled and the must-use plugin removed.', 'scrutinizer' ),
			)
		);
	}

	/**
	 * Persist dismissal of the early-boot discovery banner (per user).
	 */
	public static function dismiss_early_boot_banner() {
		update_user_meta( get_current_user_id(), 'scrutinizer_early_boot_banner_dismissed', 1 );
		wp_send_json_success();
	}

	/**
	 * Toggle lightweight capture mode (source totals only — no timeline/trace).
	 */
	public static function toggle_lightweight_mode() {
		$enabled = ! empty( $_POST['enabled'] );
		update_option( 'scrutinizer_lightweight_mode', $enabled, true );

		wp_send_json_success(
			array(
				'enabled' => $enabled,
				'message' => $enabled
					? __( 'Lightweight mode on. New captures record source totals only — no timeline or per-callback trace — for much smaller profiles, safe for always-on production sampling.', 'scrutinizer' )
					: __( 'Lightweight mode off. New captures include the full timeline and trace.', 'scrutinizer' ),
			)
		);
	}

	/**
	 * Toggle cron profiling — whether WP-Cron runs are sampled.
	 */
	public static function toggle_profile_cron() {
		$enabled = ! empty( $_POST['enabled'] );
		update_option( 'scrutinizer_profile_cron', $enabled, true );

		wp_send_json_success(
			array(
				'enabled' => $enabled,
				'message' => $enabled
					? __( 'Cron profiling on. WP-Cron runs are now sampled (at your background sample rate), so the Cron tab can show per-hook cost.', 'scrutinizer' )
					: __( 'Cron profiling off. WP-Cron runs are no longer sampled.', 'scrutinizer' ),
			)
		);
	}

	/**
	 * Get full detail for a single profile.
	 */
	public static function get_profile_detail() {
		$profile_id = 0;
		if ( isset( $_GET['profile_id'] ) ) {
			$profile_id = absint( $_GET['profile_id'] );
		}

		if ( empty( $profile_id ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile ID specified.', 'scrutinizer' ) ),
				400
			);
		}

		$profile = Storage::get_profile( $profile_id );

		if ( null === $profile ) {
			wp_send_json_error(
				array( 'message' => __( 'Profile not found.', 'scrutinizer' ) ),
				404
			);
		}

		// Lightweight mode: strip trace (large) and add counts for tab badges.
		$lightweight = isset( $_GET['lightweight'] ) && '1' === $_GET['lightweight'];

		if ( $lightweight && isset( $profile['profile_data'] ) ) {
			$data = &$profile['profile_data'];

			$profile['trace_count']    = isset( $data['trace'] ) ? count( $data['trace'] ) : 0;
			$profile['timeline_count'] = isset( $data['timeline'] ) ? count( $data['timeline'] ) : 0;
			unset( $data['trace'] );
			unset( $data['timeline'] );
		}

		// Hard sanitization (D26) — this endpoint feeds the share/export flow
		// (the relay payload is the full, non-lightweight response), so the
		// read-time safety pass must run here, not only on the REST routes.
		if ( isset( $profile['profile_data'] ) ) {
			$profile['profile_data'] = Sanitizer::sanitize( $profile['profile_data'] );
		}

		wp_send_json_success( array( 'profile' => $profile ) );
	}

	/**
	 * Get trace data for a profile (lazy-loaded by the Trace tab).
	 */
	public static function get_profile_trace() {
		$profile_id = 0;
		if ( isset( $_GET['profile_id'] ) ) {
			$profile_id = absint( $_GET['profile_id'] );
		}

		if ( empty( $profile_id ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile ID specified.', 'scrutinizer' ) ),
				400
			);
		}

		$profile = Storage::get_profile( $profile_id );

		if ( null === $profile ) {
			wp_send_json_error(
				array( 'message' => __( 'Profile not found.', 'scrutinizer' ) ),
				404
			);
		}

		$trace = isset( $profile['profile_data']['trace'] ) ? $profile['profile_data']['trace'] : array();
		$trace = Sanitizer::sanitize( $trace );

		wp_send_json_success( array( 'trace' => $trace ) );
	}

	/**
	 * Get timeline data for a profile (lazy-loaded by the Timeline tab).
	 */
	public static function get_profile_timeline() {
		$profile_id = 0;
		if ( isset( $_GET['profile_id'] ) ) {
			$profile_id = absint( $_GET['profile_id'] );
		}

		if ( empty( $profile_id ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile ID specified.', 'scrutinizer' ) ),
				400
			);
		}

		$profile = Storage::get_profile( $profile_id );

		if ( null === $profile ) {
			wp_send_json_error(
				array( 'message' => __( 'Profile not found.', 'scrutinizer' ) ),
				404
			);
		}

		$data          = $profile['profile_data'];
		$timeline      = isset( $data['timeline'] ) ? $data['timeline'] : array();
		$phase_markers = isset( $data['phase_markers'] ) ? $data['phase_markers'] : array();

		wp_send_json_success(
			Sanitizer::sanitize(
				array(
					'timeline'      => $timeline,
					'phase_markers' => $phase_markers,
				)
			)
		);
	}

	/**
	 * Delete a profile.
	 */
	public static function delete_profile() {
		$profile_id = 0;
		if ( isset( $_POST['profile_id'] ) ) {
			$profile_id = absint( $_POST['profile_id'] );
		}

		if ( empty( $profile_id ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile ID specified.', 'scrutinizer' ) ),
				400
			);
		}

		$deleted = Storage::delete_profile( $profile_id );

		if ( ! $deleted ) {
			wp_send_json_error(
				array( 'message' => __( 'Failed to delete profile.', 'scrutinizer' ) ),
				500
			);
		}

		wp_send_json_success(
			array( 'message' => __( 'Profile deleted.', 'scrutinizer' ) )
		);
	}

	/**
	 * Delete multiple profiles in one request.
	 */
	public static function delete_profiles_bulk() {
		$ids = isset( $_POST['profile_ids'] ) ? array_map( 'absint', (array) wp_unslash( $_POST['profile_ids'] ) ) : array();
		$ids = array_filter( $ids );

		if ( empty( $ids ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile IDs specified.', 'scrutinizer' ) ),
				400
			);
		}

		$deleted = Storage::delete_profiles_bulk( $ids );

		if ( false === $deleted ) {
			wp_send_json_error(
				array( 'message' => __( 'Failed to delete profiles.', 'scrutinizer' ) ),
				500
			);
		}

		wp_send_json_success(
			array(
				'message' => sprintf(
					/* translators: %d: number of deleted profiles */
					__( '%d profile(s) deleted.', 'scrutinizer' ),
					$deleted
				),
				'deleted' => $deleted,
			)
		);
	}

	/**
	 * Pin a profile.
	 */
	public static function pin_profile() {
		$profile_id = 0;
		if ( isset( $_POST['profile_id'] ) ) {
			$profile_id = absint( $_POST['profile_id'] );
		}

		if ( empty( $profile_id ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile ID specified.', 'scrutinizer' ) ),
				400
			);
		}

		$note = '';
		if ( isset( $_POST['note'] ) ) {
			$note = sanitize_textarea_field( wp_unslash( $_POST['note'] ) );
		}

		$tags = '';
		if ( isset( $_POST['tags'] ) ) {
			$tags = sanitize_text_field( wp_unslash( $_POST['tags'] ) );
		}

		$result = Storage::pin_profile( $profile_id, $note, $tags );

		if ( ! $result ) {
			wp_send_json_error(
				array( 'message' => __( 'Failed to pin profile.', 'scrutinizer' ) ),
				500
			);
		}

		wp_send_json_success(
			array( 'message' => __( 'Profile pinned.', 'scrutinizer' ) )
		);
	}

	/**
	 * Pin multiple profiles in one request.
	 */
	public static function pin_profiles_bulk() {
		$ids = isset( $_POST['profile_ids'] ) ? array_map( 'absint', (array) wp_unslash( $_POST['profile_ids'] ) ) : array();
		$ids = array_filter( $ids );

		if ( empty( $ids ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile IDs specified.', 'scrutinizer' ) ),
				400
			);
		}

		$updated = Storage::pin_profiles_bulk( $ids );

		if ( false === $updated ) {
			wp_send_json_error(
				array( 'message' => __( 'Failed to pin profiles.', 'scrutinizer' ) ),
				500
			);
		}

		wp_send_json_success(
			array(
				'message' => sprintf(
					/* translators: %d: number of pinned profiles */
					__( '%d profile(s) pinned.', 'scrutinizer' ),
					$updated
				),
			)
		);
	}

	/**
	 * Unpin a profile.
	 */
	public static function unpin_profile() {
		$profile_id = 0;
		if ( isset( $_POST['profile_id'] ) ) {
			$profile_id = absint( $_POST['profile_id'] );
		}

		if ( empty( $profile_id ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile ID specified.', 'scrutinizer' ) ),
				400
			);
		}

		$result = Storage::unpin_profile( $profile_id );

		if ( ! $result ) {
			wp_send_json_error(
				array( 'message' => __( 'Failed to unpin profile.', 'scrutinizer' ) ),
				500
			);
		}

		wp_send_json_success(
			array( 'message' => __( 'Profile unpinned.', 'scrutinizer' ) )
		);
	}

	/**
	 * Unpin multiple profiles in one request.
	 */
	public static function unpin_profiles_bulk() {
		$ids = isset( $_POST['profile_ids'] ) ? array_map( 'absint', (array) wp_unslash( $_POST['profile_ids'] ) ) : array();
		$ids = array_filter( $ids );

		if ( empty( $ids ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile IDs specified.', 'scrutinizer' ) ),
				400
			);
		}

		$updated = Storage::unpin_profiles_bulk( $ids );

		if ( false === $updated ) {
			wp_send_json_error(
				array( 'message' => __( 'Failed to unpin profiles.', 'scrutinizer' ) ),
				500
			);
		}

		wp_send_json_success(
			array(
				'message' => sprintf(
					/* translators: %d: number of unpinned profiles */
					__( '%d profile(s) unpinned.', 'scrutinizer' ),
					$updated
				),
			)
		);
	}

	/**
	 * Update profile annotation (note + tags).
	 */
	public static function update_annotation() {
		$profile_id = 0;
		if ( isset( $_POST['profile_id'] ) ) {
			$profile_id = absint( $_POST['profile_id'] );
		}

		if ( empty( $profile_id ) ) {
			wp_send_json_error(
				array( 'message' => __( 'No profile ID specified.', 'scrutinizer' ) ),
				400
			);
		}

		$note = '';
		if ( isset( $_POST['note'] ) ) {
			$note = sanitize_textarea_field( wp_unslash( $_POST['note'] ) );
		}

		$tags = '';
		if ( isset( $_POST['tags'] ) ) {
			$tags = sanitize_text_field( wp_unslash( $_POST['tags'] ) );
		}

		$result = Storage::update_annotation( $profile_id, $note, $tags );

		if ( ! $result ) {
			wp_send_json_error(
				array( 'message' => __( 'Failed to update annotation.', 'scrutinizer' ) ),
				500
			);
		}

		wp_send_json_success(
			array( 'message' => __( 'Annotation updated.', 'scrutinizer' ) )
		);
	}

	/**
	 * Compare two profiles.
	 */
	public static function compare_profiles() {
		$id_a = 0;
		$id_b = 0;
		if ( isset( $_GET['profile_a'] ) ) {
			$id_a = absint( $_GET['profile_a'] );
		}
		if ( isset( $_GET['profile_b'] ) ) {
			$id_b = absint( $_GET['profile_b'] );
		}

		if ( empty( $id_a ) || empty( $id_b ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Two profile IDs required.', 'scrutinizer' ) ),
				400
			);
		}

		$comparison = Storage::get_comparison( $id_a, $id_b );

		if ( null === $comparison ) {
			wp_send_json_error(
				array( 'message' => __( 'One or both profiles not found.', 'scrutinizer' ) ),
				404
			);
		}

		wp_send_json_success( array( 'comparison' => $comparison ) );
	}

	/**
	 * Get compare target candidates for a profile.
	 *
	 * Returns pinned profiles on the same route (first) and all other pinned profiles.
	 */
	public static function compare_targets() {
		$profile_id = 0;
		if ( isset( $_GET['profile_id'] ) ) {
			$profile_id = absint( $_GET['profile_id'] );
		}

		$route_key = '';
		if ( isset( $_GET['route_key'] ) ) {
			$route_key = sanitize_text_field( wp_unslash( $_GET['route_key'] ) );
		}

		// Get pinned profiles on the same route.
		$route_pinned = array();
		if ( ! empty( $route_key ) ) {
			$route_pinned = Storage::search_profiles(
				array(
					'route_key'   => $route_key,
					'pinned_only' => true,
					'limit'       => 20,
				)
			);
		}

		// Get all other pinned profiles.
		$all_pinned = Storage::get_pinned_profiles( 30 );

		// Exclude the current profile from both lists.
		$route_pinned = array_filter(
			$route_pinned,
			function ( $p ) use ( $profile_id ) {
				return (int) $p['id'] !== $profile_id;
			}
		);

		$all_pinned = array_filter(
			$all_pinned,
			function ( $p ) use ( $profile_id, $route_key ) {
				// Exclude self and anything already in the route list.
				return (int) $p['id'] !== $profile_id
					&& ( empty( $route_key ) || $p['route_key'] !== $route_key );
			}
		);

		wp_send_json_success(
			array(
				'route_matches' => array_values( $route_pinned ),
				'other_pinned'  => array_values( $all_pinned ),
			)
		);
	}

	/**
	 * Get profile history with filtering.
	 */
	public static function get_history() {
		$args = array();

		if ( ! empty( $_GET['route_key'] ) ) {
			$args['route_key'] = sanitize_text_field( wp_unslash( $_GET['route_key'] ) );
		}
		if ( ! empty( $_GET['route_class'] ) ) {
			$args['route_class'] = sanitize_text_field( wp_unslash( $_GET['route_class'] ) );
		}
		if ( ! empty( $_GET['tag'] ) ) {
			$args['tag'] = sanitize_text_field( wp_unslash( $_GET['tag'] ) );
		}
		if ( ! empty( $_GET['pinned_only'] ) ) {
			$args['pinned_only'] = true;
		}
		if ( ! empty( $_GET['date_from'] ) ) {
			$args['date_from'] = sanitize_text_field( wp_unslash( $_GET['date_from'] ) );
		}
		if ( ! empty( $_GET['date_to'] ) ) {
			$args['date_to'] = sanitize_text_field( wp_unslash( $_GET['date_to'] ) );
		}

		// Pagination.
		$per_page = isset( $_GET['per_page'] ) ? absint( $_GET['per_page'] ) : 50;
		$page     = isset( $_GET['paged'] ) ? max( 1, absint( $_GET['paged'] ) ) : 1;

		$args['per_page'] = min( $per_page, 200 );
		$args['page']     = $page;

		$result = Storage::search_profiles( $args );

		wp_send_json_success( $result );
	}

	/**
	 * AJAX: Get cron inventory.
	 *
	 * Returns all scheduled WP-Cron events with attribution,
	 * overdue detection, and duplicate warnings.
	 */
	public static function get_cron_inventory() {
		$inventory = \Scrutinizer\Diagnostics\Cron::collect();

		// Attach measured per-hook cost (from profiled cron runs) to each event.
		$costs = get_option( 'scrutinizer_cron_hook_costs', array() );
		if ( is_array( $costs ) && ! empty( $inventory['events'] ) && is_array( $inventory['events'] ) ) {
			foreach ( $inventory['events'] as &$event ) {
				$hook = isset( $event['hook'] ) ? $event['hook'] : '';
				if ( $hook && isset( $costs[ $hook ] ) ) {
					$event['cost'] = array(
						'last_ms' => round( $costs[ $hook ]['last_ns'] / 1e6, 1 ),
						'max_ms'  => round( $costs[ $hook ]['max_ns'] / 1e6, 1 ),
						'runs'    => (int) $costs[ $hook ]['runs'],
					);
				}
			}
			unset( $event );
		}
		$inventory['profiling_enabled'] = (bool) get_option( 'scrutinizer_profile_cron', false );

		wp_send_json_success( $inventory );
	}

	/**
	 * AJAX: Save diagnostics sharing field preferences.
	 */
	public static function save_diagnostics_fields() {
		$fields = isset( $_POST['fields'] ) ? array_map( 'sanitize_text_field', (array) wp_unslash( $_POST['fields'] ) ) : array();

		\Scrutinizer\Api\Diagnostics::set_enabled_fields( $fields );

		wp_send_json_success( array( 'fields' => \Scrutinizer\Api\Diagnostics::get_enabled_fields() ) );
	}

	/**
	 * AJAX: Create a new Scrutineer Application Password for the current user.
	 *
	 * Revokes any existing one first (auto-rotate per D25a).
	 */
	public static function create_api_password() {
		$result = \Scrutinizer\Api\ApplicationPassword::create_for_user( get_current_user_id() );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error(
				array( 'message' => $result->get_error_message() ),
				500
			);
		}

		// Build the clipboard prompt: bake the full prompt content inline
		// so the agent has the API contract without needing to fetch it.
		// The prompt endpoint stays authenticated to prevent fingerprinting.
		$username       = wp_get_current_user()->user_login;
		$prompt_content = \Scrutinizer\Api\Prompt::build();
		$prompt         = sprintf(
			"The following is the Scrutineer Performance Diagnostics API contract for my WordPress site. Use these credentials to authenticate all API calls:\n\nUsername: %s\nPassword: %s\n\n---\n\n%s",
			$username,
			$result['password'],
			$prompt_content
		);

		$ttl_hours = round( $result['ttl'] / 3600, 1 );

		wp_send_json_success(
			array(
				'prompt'    => $prompt,
				'password'  => $result['password'],
				'username'  => $username,
				'ttl_hours' => $ttl_hours,
				'expires'   => gmdate( 'c', $result['expires'] ),
			)
		);
	}

	/**
	 * AJAX: Revoke all Scrutineer Application Passwords for the current user.
	 */
	public static function revoke_api_password() {
		$revoked = \Scrutinizer\Api\ApplicationPassword::revoke_all_for_user( get_current_user_id() );

		wp_send_json_success( array( 'revoked' => $revoked ) );
	}

	/**
	 * AJAX: Get the API access audit log.
	 */
	public static function get_api_log() {
		$log = \Scrutinizer\Api\RestApi::get_access_log();

		wp_send_json_success( array( 'log' => array_reverse( $log ) ) );
	}

	/**
	 * AJAX: Clear the API access audit log.
	 */
	public static function clear_api_log() {
		\Scrutinizer\Api\RestApi::clear_access_log();

		wp_send_json_success();
	}

	/**
	 * AJAX: Save a shared report record to the ledger.
	 *
	 * Called after a successful relay upload. Stores the share metadata
	 * so the user can manage shared reports from the API tab.
	 */
	public static function save_share() {
		$share_id = '';
		if ( isset( $_POST['share_id'] ) ) {
			$share_id = sanitize_text_field( wp_unslash( $_POST['share_id'] ) );
		}
		if ( empty( $share_id ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Missing share ID.', 'scrutinizer' ) ),
				400
			);
		}

		$record = array(
			'id'            => $share_id,
			'url'           => isset( $_POST['url'] ) ? esc_url_raw( wp_unslash( $_POST['url'] ) ) : '',
			'revoke_token'  => isset( $_POST['revoke_token'] ) ? sanitize_text_field( wp_unslash( $_POST['revoke_token'] ) ) : '',
			'expires_at'    => isset( $_POST['expires_at'] ) ? sanitize_text_field( wp_unslash( $_POST['expires_at'] ) ) : '',
			'created_at'    => gmdate( 'Y-m-d H:i:s' ),
			'profile_id'    => isset( $_POST['profile_id'] ) ? absint( $_POST['profile_id'] ) : 0,
			'profile_route' => isset( $_POST['profile_route'] ) ? sanitize_text_field( wp_unslash( $_POST['profile_route'] ) ) : '',
		);

		$shares   = get_option( 'scrutinizer_shared_reports', array() );
		$shares[] = $record;

		// Cap at 100 entries to prevent option bloat.
		if ( count( $shares ) > 100 ) {
			$shares = array_slice( $shares, -100 );
		}

		update_option( 'scrutinizer_shared_reports', $shares, false );

		wp_send_json_success( array( 'record' => $record ) );
	}

	/**
	 * AJAX: Get all shared report records from the ledger.
	 *
	 * Auto-prunes expired shares before returning.
	 */
	public static function get_shares() {
		$shares = get_option( 'scrutinizer_shared_reports', array() );

		// Auto-prune expired shares.
		$now    = time();
		$pruned = false;
		$active = array();
		foreach ( $shares as $share ) {
			if ( ! empty( $share['expires_at'] ) ) {
				$expiry = strtotime( $share['expires_at'] );
				if ( false !== $expiry && $expiry < $now ) {
					$pruned = true;
					continue;
				}
			}
			$active[] = $share;
		}

		if ( $pruned ) {
			update_option( 'scrutinizer_shared_reports', $active, false );
		}

		wp_send_json_success( array( 'shares' => $active ) );
	}

	/**
	 * AJAX: Remove a shared report from the ledger.
	 *
	 * The client handles the relay DELETE request (cross-origin fetch).
	 * This handler only cleans up the local ledger entry.
	 */
	public static function delete_share() {
		$share_id = '';
		if ( isset( $_POST['share_id'] ) ) {
			$share_id = sanitize_text_field( wp_unslash( $_POST['share_id'] ) );
		}

		if ( empty( $share_id ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Missing share ID.', 'scrutinizer' ) ),
				400
			);
		}

		$shares = get_option( 'scrutinizer_shared_reports', array() );
		$shares = array_values(
			array_filter(
				$shares,
				function ( $s ) use ( $share_id ) {
					return ! isset( $s['id'] ) || $s['id'] !== $share_id;
				}
			)
		);

		update_option( 'scrutinizer_shared_reports', $shares, false );

		wp_send_json_success(
			array( 'message' => __( 'Share record removed.', 'scrutinizer' ) )
		);
	}

	/**
	 * AJAX: Save the profile retention days setting.
	 */
	public static function save_retention() {
		$days = isset( $_POST['retention_days'] ) ? absint( $_POST['retention_days'] ) : 7;

		// Validate: must be one of the allowed values.
		$allowed = array( 0, 7, 14, 30 );
		if ( ! in_array( $days, $allowed, true ) ) {
			$days = 7;
		}

		update_option( 'scrutinizer_retention_days', $days, true );

		wp_send_json_success(
			array(
				'retention_days' => $days,
				'message'        => 0 === $days
					? __( 'Profile retention disabled — profiles kept indefinitely.', 'scrutinizer' )
					: sprintf(
						/* translators: %d: number of days */
						__( 'Profiles will auto-expire after %d days.', 'scrutinizer' ),
						$days
					),
			)
		);
	}

	/**
	 * Save the proxy-trust setting.
	 */
	public static function save_proxy_trust() {
		$enabled = ! empty( $_POST['enabled'] );
		update_option( 'scrutinizer_trust_proxy_headers', $enabled, true );

		wp_send_json_success(
			array(
				'enabled' => $enabled,
				'message' => $enabled
					? __( 'Proxy headers will be trusted for client IP detection.', 'scrutinizer' )
					: __( 'Only REMOTE_ADDR will be used for client IP detection.', 'scrutinizer' ),
			)
		);
	}

	/**
	 * Save background profiling filter settings.
	 */
	public static function save_background_filters() {
		$user_scope = isset( $_POST['user_scope'] ) ? sanitize_text_field( wp_unslash( $_POST['user_scope'] ) ) : 'all';
		if ( ! in_array( $user_scope, array( 'all', 'anonymous', 'logged_in' ), true ) ) {
			$user_scope = 'all';
		}

		$exclude_paths = '';
		if ( isset( $_POST['exclude_paths'] ) ) {
			// Sanitize each line individually, strip empty lines.
			$raw           = sanitize_textarea_field( wp_unslash( $_POST['exclude_paths'] ) );
			$lines         = array_filter( array_map( 'trim', explode( "\n", $raw ) ) );
			$exclude_paths = implode( "\n", $lines );
		}

		update_option( 'scrutinizer_user_scope', $user_scope, true );
		update_option( 'scrutinizer_exclude_paths', $exclude_paths, true );

		wp_send_json_success(
			array(
				'user_scope'    => $user_scope,
				'exclude_paths' => $exclude_paths,
				'message'       => __( 'Background profiling filters saved.', 'scrutinizer' ),
			)
		);
	}
}
