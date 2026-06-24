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
		add_action( 'wp_ajax_scrutinizer_toggle_background', array( __CLASS__, 'toggle_background' ) );
		add_action( 'wp_ajax_scrutinizer_pin_profile', array( __CLASS__, 'pin_profile' ) );
		add_action( 'wp_ajax_scrutinizer_unpin_profile', array( __CLASS__, 'unpin_profile' ) );
		add_action( 'wp_ajax_scrutinizer_update_annotation', array( __CLASS__, 'update_annotation' ) );
		add_action( 'wp_ajax_scrutinizer_compare_profiles', array( __CLASS__, 'compare_profiles' ) );
		add_action( 'wp_ajax_scrutinizer_get_history', array( __CLASS__, 'get_history' ) );
		add_action( 'wp_ajax_scrutinizer_get_cron_inventory', array( __CLASS__, 'get_cron_inventory' ) );
		add_action( 'wp_ajax_scrutinizer_save_diagnostics_fields', array( __CLASS__, 'save_diagnostics_fields' ) );
		add_action( 'wp_ajax_scrutinizer_create_api_password', array( __CLASS__, 'create_api_password' ) );
		add_action( 'wp_ajax_scrutinizer_revoke_api_password', array( __CLASS__, 'revoke_api_password' ) );
		add_action( 'wp_ajax_scrutinizer_toggle_query_profiling', array( __CLASS__, 'toggle_query_profiling' ) );
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

		$groups = Storage::get_profiles_grouped( $profile_type, $session_id );

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
		$rate    = 5;
		if ( isset( $_POST['rate'] ) ) {
			$rate = max( 1, min( 100, absint( $_POST['rate'] ) ) );
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

		wp_send_json_success( array( 'profile' => $profile ) );
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

		$profiles = Storage::search_profiles( $args );

		wp_send_json_success( array( 'profiles' => $profiles ) );
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

		// Build the one-liner prompt for clipboard.
		$api_base = rest_url( 'scrutinizer/v1/' );
		$username = wp_get_current_user()->user_login;
		$prompt   = sprintf(
			'Read %sprompt and follow its instructions to diagnose my site\'s performance. Use this Application Password to authenticate: username: %s / password: %s',
			$api_base,
			$username,
			$result['password']
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
}
