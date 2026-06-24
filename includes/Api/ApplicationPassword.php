<?php
/**
 * Application Password lifecycle management.
 *
 * Handles auto-creation, rotation, TTL enforcement, and cleanup
 * of WordPress Application Passwords for Scrutineer API access.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Api;

/**
 * Manages Scrutineer-owned Application Passwords.
 */
class ApplicationPassword {

	/**
	 * Fixed app_id UUID for all Scrutineer-created passwords.
	 * Used to find and revoke our passwords without touching others.
	 */
	const APP_ID = '7c9a3f2e-1b4d-4e8a-9f6c-2d5e8a1b3c7f';

	/**
	 * Application password name shown in the WP profile.
	 */
	const APP_NAME = 'Scrutineer API';

	/**
	 * Option key for storing TTL setting.
	 */
	const OPTION_TTL = 'scrutinizer_api_password_ttl';

	/**
	 * Default TTL in seconds (1 hour).
	 */
	const DEFAULT_TTL = 3600;

	/**
	 * Maximum TTL in seconds (24 hours).
	 */
	const MAX_TTL = 86400;

	/**
	 * Register hooks.
	 */
	public static function register() {
		add_action( 'rest_api_init', array( __CLASS__, 'enforce_scope' ) );
		add_action( 'scrutinizer_cleanup_passwords', array( __CLASS__, 'garbage_collect' ) );

		// Schedule garbage collection if not already scheduled.
		if ( ! wp_next_scheduled( 'scrutinizer_cleanup_passwords' ) ) {
			wp_schedule_event( time(), 'hourly', 'scrutinizer_cleanup_passwords' );
		}
	}

	/**
	 * Create a fresh Application Password for the current user.
	 *
	 * Always revokes any existing Scrutineer password first (auto-rotate).
	 * Returns the plaintext password (shown only once) or WP_Error.
	 *
	 * @param int $user_id  User ID to create the password for.
	 * @return array|\WP_Error  Array with 'password' and 'uuid' keys, or WP_Error.
	 */
	public static function create_for_user( $user_id ) {
		// Revoke any existing Scrutineer passwords first.
		self::revoke_all_for_user( $user_id );

		// Core may return WP_Error if name already exists (5.7+).
		// We just revoked, so this should not happen, but handle it.
		$result = \WP_Application_Passwords::create_new_application_password(
			$user_id,
			array(
				'name'   => self::APP_NAME,
				'app_id' => self::APP_ID,
			)
		);

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		list( $new_password, $item ) = $result;

		return array(
			'password' => $new_password,
			'uuid'     => $item['uuid'],
			'created'  => $item['created'],
			'ttl'      => self::get_ttl(),
			'expires'  => $item['created'] + self::get_ttl(),
		);
	}

	/**
	 * Revoke all Scrutineer Application Passwords for a user.
	 *
	 * Matches by our fixed app_id.
	 *
	 * @param int $user_id  User ID.
	 * @return int  Number of passwords revoked.
	 */
	public static function revoke_all_for_user( $user_id ) {
		$passwords = \WP_Application_Passwords::get_user_application_passwords( $user_id );
		$revoked   = 0;

		foreach ( $passwords as $item ) {
			if ( isset( $item['app_id'] ) && self::APP_ID === $item['app_id'] ) {
				\WP_Application_Passwords::delete_application_password( $user_id, $item['uuid'] );
				++$revoked;
			}
		}

		return $revoked;
	}

	/**
	 * Check if the current REST request is authenticated via a Scrutineer password.
	 *
	 * Reads the REMOTE_USER / PHP_AUTH_USER that WP sets after Basic Auth validation.
	 *
	 * @return bool
	 */
	public static function is_scrutineer_auth() {
		$user_id = get_current_user_id();
		if ( 0 === $user_id ) {
			return false;
		}

		// Check if this request was authenticated via an Application Password.
		// WP sets this global after successful app password auth.
		global $wp_current_application_password;
		if ( empty( $wp_current_application_password ) ) {
			return false;
		}

		return isset( $wp_current_application_password['app_id'] )
			&& self::APP_ID === $wp_current_application_password['app_id'];
	}

	/**
	 * Enforce scope restriction and TTL on Scrutineer Application Passwords.
	 *
	 * If the current request is authenticated via a Scrutineer password:
	 * 1. Check TTL — reject if expired.
	 * 2. Check route — only allow scrutinizer/v1/* endpoints.
	 */
	public static function enforce_scope() {
		add_filter( 'rest_pre_dispatch', array( __CLASS__, 'check_scope_and_ttl' ), 10, 3 );
	}

	/**
	 * Filter callback for rest_pre_dispatch.
	 *
	 * @param mixed            $result   Response to replace the requested response with.
	 * @param \WP_REST_Server  $server   Server instance.
	 * @param \WP_REST_Request $request  Request used to generate the response.
	 * @return mixed|\WP_Error
	 */
	public static function check_scope_and_ttl( $result, $server, $request ) {
		if ( ! self::is_scrutineer_auth() ) {
			return $result;
		}

		global $wp_current_application_password;

		// Check TTL.
		$created = isset( $wp_current_application_password['created'] )
			? (int) $wp_current_application_password['created']
			: 0;
		$ttl     = self::get_ttl();

		if ( $created > 0 && ( time() - $created ) > $ttl ) {
			// Expired — revoke it and reject.
			$user_id = get_current_user_id();
			if ( isset( $wp_current_application_password['uuid'] ) ) {
				\WP_Application_Passwords::delete_application_password(
					$user_id,
					$wp_current_application_password['uuid']
				);
			}

			return new \WP_Error(
				'scrutinizer_password_expired',
				__( 'This Scrutineer API key has expired. Please generate a new one from the Scrutineer dashboard.', 'scrutinizer' ),
				array( 'status' => 401 )
			);
		}

		// Check scope — only allow scrutinizer/v1/* routes.
		$route = $request->get_route();
		if ( 0 !== strpos( $route, '/scrutinizer/v1/' ) && '/scrutinizer/v1' !== $route ) {
			return new \WP_Error(
				'scrutinizer_scope_restricted',
				__( 'This API key is scoped to Scrutineer endpoints only.', 'scrutinizer' ),
				array( 'status' => 403 )
			);
		}

		return $result;
	}

	/**
	 * Get the configured TTL in seconds.
	 *
	 * @return int
	 */
	public static function get_ttl() {
		$ttl = (int) get_option( self::OPTION_TTL, self::DEFAULT_TTL );

		// Clamp to valid range.
		if ( $ttl < 60 ) {
			$ttl = self::DEFAULT_TTL;
		}
		if ( $ttl > self::MAX_TTL ) {
			$ttl = self::MAX_TTL;
		}

		return $ttl;
	}

	/**
	 * Garbage collect expired Scrutineer passwords for all users.
	 *
	 * Runs via WP-Cron hourly.
	 */
	public static function garbage_collect() {
		$users = get_users(
			array(
				'meta_key' => \WP_Application_Passwords::USERMETA_KEY_APPLICATION_PASSWORDS,
				'fields'   => 'ID',
			)
		);

		$ttl = self::get_ttl();
		$now = time();

		foreach ( $users as $user_id ) {
			$passwords = \WP_Application_Passwords::get_user_application_passwords( $user_id );

			foreach ( $passwords as $item ) {
				if ( ! isset( $item['app_id'] ) || self::APP_ID !== $item['app_id'] ) {
					continue;
				}

				$created = isset( $item['created'] ) ? (int) $item['created'] : 0;
				if ( $created > 0 && ( $now - $created ) > $ttl ) {
					\WP_Application_Passwords::delete_application_password( $user_id, $item['uuid'] );
				}
			}
		}
	}

	/**
	 * Clean up on plugin deactivation.
	 *
	 * Revoke all Scrutineer Application Passwords for all users
	 * and unschedule the garbage collection cron.
	 */
	public static function deactivate() {
		$users = get_users(
			array(
				'meta_key' => \WP_Application_Passwords::USERMETA_KEY_APPLICATION_PASSWORDS,
				'fields'   => 'ID',
			)
		);

		foreach ( $users as $user_id ) {
			self::revoke_all_for_user( $user_id );
		}

		wp_clear_scheduled_hook( 'scrutinizer_cleanup_passwords' );
	}
}
