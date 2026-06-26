<?php
/**
 * Admin AJAX handlers.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Admin;

use Scrutinizer\Profiler\Session;
use Scrutinizer\Profiler\Storage;

/**
 * Registers and handles AJAX actions for the dashboard.
 */
class Ajax {

	/**
	 * Register AJAX handlers.
	 */
	public static function register() {
		add_action( 'wp_ajax_scrutinizer_start_profiling', array( __CLASS__, 'start_profiling' ) );
		add_action( 'wp_ajax_scrutinizer_stop_profiling', array( __CLASS__, 'stop_profiling' ) );
		add_action( 'wp_ajax_scrutinizer_get_profiles', array( __CLASS__, 'get_profiles' ) );
		add_action( 'wp_ajax_scrutinizer_get_profiles_grouped', array( __CLASS__, 'get_profiles_grouped' ) );
		add_action( 'wp_ajax_scrutinizer_get_route_profiles', array( __CLASS__, 'get_route_profiles' ) );
		add_action( 'wp_ajax_scrutinizer_get_profile_detail', array( __CLASS__, 'get_profile_detail' ) );
		add_action( 'wp_ajax_scrutinizer_delete_profile', array( __CLASS__, 'delete_profile' ) );
		add_action( 'wp_ajax_scrutinizer_delete_profiles_bulk', array( __CLASS__, 'delete_profiles_bulk' ) );
		add_action( 'wp_ajax_scrutinizer_toggle_background', array( __CLASS__, 'toggle_background' ) );
		add_action( 'wp_ajax_scrutinizer_toggle_only_successful', array( __CLASS__, 'toggle_only_successful' ) );
		add_action( 'wp_ajax_scrutinizer_pin_profile', array( __CLASS__, 'pin_profile' ) );
		add_action( 'wp_ajax_scrutinizer_pin_profiles_bulk', array( __CLASS__, 'pin_profiles_bulk' ) );
		add_action( 'wp_ajax_scrutinizer_unpin_profile', array( __CLASS__, 'unpin_profile' ) );
		add_action( 'wp_ajax_scrutinizer_unpin_profiles_bulk', array( __CLASS__, 'unpin_profiles_bulk' ) );
		add_action( 'wp_ajax_scrutinizer_update_annotation', array( __CLASS__, 'update_annotation' ) );
		add_action( 'wp_ajax_scrutinizer_compare_profiles', array( __CLASS__, 'compare_profiles' ) );
		add_action( 'wp_ajax_scrutinizer_compare_targets', array( __CLASS__, 'compare_targets' ) );
		add_action( 'wp_ajax_scrutinizer_get_history', array( __CLASS__, 'get_history' ) );
		add_action( 'wp_ajax_scrutinizer_get_cron_inventory', array( __CLASS__, 'get_cron_inventory' ) );
		add_action( 'wp_ajax_scrutinizer_save_diagnostics_fields', array( __CLASS__, 'save_diagnostics_fields' ) );
		add_action( 'wp_ajax_scrutinizer_create_api_password', array( __CLASS__, 'create_api_password' ) );
		add_action( 'wp_ajax_scrutinizer_revoke_api_password', array( __CLASS__, 'revoke_api_password' ) );
		add_action( 'wp_ajax_scrutinizer_toggle_query_profiling', array( __CLASS__, 'toggle_query_profiling' ) );
		add_action( 'wp_ajax_scrutinizer_get_api_log', array( __CLASS__, 'get_api_log' ) );
		add_action( 'wp_ajax_scrutinizer_clear_api_log', array( __CLASS__, 'clear_api_log' ) );
		add_action( 'wp_ajax_scrutinizer_get_profile_trace', array( __CLASS__, 'get_profile_trace' ) );
		add_action( 'wp_ajax_scrutinizer_get_profile_timeline', array( __CLASS__, 'get_profile_timeline' ) );
	}

	/**
	 * Start a profiling session.
	 */
	public static function start_profiling() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
	 * Toggle background profiling.
	 */
	public static function toggle_background() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
	 * Get full detail for a single profile.
	 */
	public static function get_profile_detail() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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

		wp_send_json_success( array( 'profile' => $profile ) );
	}

	/**
	 * Get trace data for a profile (lazy-loaded by the Trace tab).
	 */
	public static function get_profile_trace() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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

		wp_send_json_success( array( 'trace' => $trace ) );
	}

	/**
	 * Get timeline data for a profile (lazy-loaded by the Timeline tab).
	 */
	public static function get_profile_timeline() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
			array(
				'timeline'      => $timeline,
				'phase_markers' => $phase_markers,
			)
		);
	}

	/**
	 * Delete a profile.
	 */
	public static function delete_profile() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

		$inventory = \Scrutinizer\Diagnostics\Cron::collect();

		wp_send_json_success( $inventory );
	}

	/**
	 * AJAX: Save diagnostics sharing field preferences.
	 */
	public static function save_diagnostics_fields() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

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
		$prompt = sprintf(
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
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

		$revoked = \Scrutinizer\Api\ApplicationPassword::revoke_all_for_user( get_current_user_id() );

		wp_send_json_success( array( 'revoked' => $revoked ) );
	}

	/**
	 * AJAX: Get the API access audit log.
	 */
	public static function get_api_log() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

		$log = \Scrutinizer\Api\RestApi::get_access_log();

		wp_send_json_success( array( 'log' => array_reverse( $log ) ) );
	}

	/**
	 * AJAX: Clear the API access audit log.
	 */
	public static function clear_api_log() {
		check_ajax_referer( 'scrutinizer_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Permission denied.', 'scrutinizer' ) ),
				403
			);
		}

		\Scrutinizer\Api\RestApi::clear_access_log();

		wp_send_json_success();
	}
}
