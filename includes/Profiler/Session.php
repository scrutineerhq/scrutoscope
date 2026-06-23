<?php
/**
 * Profiling session manager.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

/**
 * Manages the profiling session lifecycle: activation URLs, cookies, and
 * session identity.
 */
class Session {

	/**
	 * Cookie name.
	 *
	 * @var string
	 */
	const COOKIE_NAME = 'scrutinizer_session';

	/**
	 * Default session TTL in seconds (30 minutes).
	 *
	 * @var int
	 */
	const SESSION_TTL = 1800;

	/**
	 * Activation token TTL in seconds (5 minutes).
	 *
	 * @var int
	 */
	const ACTIVATION_TTL = 300;

	/**
	 * Transient key for active session.
	 *
	 * @var string
	 */
	const TRANSIENT_KEY = 'scrutinizer_active_session';

	/**
	 * Option key for the HMAC pepper.
	 *
	 * @var string
	 */
	const PEPPER_OPTION = 'scrutinizer_hmac_pepper';

	/**
	 * Create an HMAC-signed activation URL.
	 *
	 * @param string $target_url  URL to redirect to after activation.
	 * @return string  Signed activation URL.
	 */
	public static function create_activation_url( $target_url = '' ) {
		if ( empty( $target_url ) ) {
			$target_url = home_url( '/' );
		}

		$session_id = wp_generate_uuid4();
		$expires    = time() + self::ACTIVATION_TTL;

		$token = self::sign_token(
			array(
				'session_id' => $session_id,
				'expires'    => $expires,
			)
		);

		return add_query_arg(
			array(
				'scrutinizer_activate' => $token,
				'scrutinizer_session'  => $session_id,
				'scrutinizer_expires'  => $expires,
			),
			$target_url
		);
	}

	/**
	 * Handle activation on `init`. Validates the URL token, sets the cookie,
	 * stores the session ID, and redirects to a clean URL.
	 */
	public static function handle_activation() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		if ( empty( $_GET['scrutinizer_activate'] ) ) {
			return;
		}

		$token      = sanitize_text_field( wp_unslash( $_GET['scrutinizer_activate'] ) );
		$session_id = isset( $_GET['scrutinizer_session'] ) ? sanitize_text_field( wp_unslash( $_GET['scrutinizer_session'] ) ) : '';
		$expires    = isset( $_GET['scrutinizer_expires'] ) ? absint( $_GET['scrutinizer_expires'] ) : 0;
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		// Validate expiry.
		if ( $expires < time() ) {
			return;
		}

		// Validate HMAC.
		$expected = self::sign_token(
			array(
				'session_id' => $session_id,
				'expires'    => $expires,
			)
		);

		if ( ! hash_equals( $expected, $token ) ) {
			return;
		}

		// Set profiling cookie.
		$cookie_expires = time() + self::SESSION_TTL;
		$secure         = is_ssl();

		setcookie(
			self::COOKIE_NAME,
			$session_id,
			array(
				'expires'  => $cookie_expires,
				'path'     => '/',
				'secure'   => $secure,
				'httponly' => true,
				'samesite' => 'Strict',
			)
		);

		// Make cookie available in current request.
		$_COOKIE[ self::COOKIE_NAME ] = $session_id;

		// Store as the active session.
		set_transient( self::TRANSIENT_KEY, $session_id, self::SESSION_TTL );

		// Redirect to a clean URL.
		$clean_url = remove_query_arg(
			array( 'scrutinizer_activate', 'scrutinizer_session', 'scrutinizer_expires' )
		);

		wp_safe_redirect( $clean_url );
		exit;
	}

	/**
	 * Check whether a valid profiling cookie is present.
	 *
	 * @return bool
	 */
	public static function has_valid_cookie() {
		if ( empty( $_COOKIE[ self::COOKIE_NAME ] ) ) {
			return false;
		}

		$session_id = sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE_NAME ] ) );
		$active     = get_transient( self::TRANSIENT_KEY );

		return ( false !== $active && $active === $session_id );
	}

	/**
	 * Get the current session ID from the cookie.
	 *
	 * @return string  Session ID or empty string.
	 */
	public static function get_session_id() {
		if ( empty( $_COOKIE[ self::COOKIE_NAME ] ) ) {
			return '';
		}

		return sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE_NAME ] ) );
	}

	/**
	 * Stop the current profiling session.
	 */
	public static function stop_session() {
		delete_transient( self::TRANSIENT_KEY );

		setcookie(
			self::COOKIE_NAME,
			'',
			array(
				'expires'  => time() - YEAR_IN_SECONDS,
				'path'     => '/',
				'secure'   => is_ssl(),
				'httponly' => true,
				'samesite' => 'Strict',
			)
		);

		unset( $_COOKIE[ self::COOKIE_NAME ] );
	}

	/**
	 * Get or create the HMAC pepper.
	 *
	 * @return string
	 */
	private static function get_pepper() {
		$pepper = get_option( self::PEPPER_OPTION );
		if ( false === $pepper || empty( $pepper ) ) {
			$pepper = wp_generate_password( 64, true, true );
			update_option( self::PEPPER_OPTION, $pepper, false );
		}
		return $pepper;
	}

	/**
	 * Sign data with HMAC-SHA256 using the auth salt and plugin pepper.
	 *
	 * @param array $data  Data to sign.
	 * @return string  Hex-encoded HMAC signature.
	 */
	private static function sign_token( $data ) {
		$key     = wp_salt( 'auth' ) . self::get_pepper();
		$message = wp_json_encode( $data );
		return hash_hmac( 'sha256', $message, $key );
	}
}
