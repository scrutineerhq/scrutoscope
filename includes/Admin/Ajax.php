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
}
