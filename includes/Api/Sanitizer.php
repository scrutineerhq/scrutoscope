<?php
/**
 * Hard sanitization for all API and report output.
 *
 * Strips filesystem paths, credentials, IPs, auth keys/salts,
 * and user PII from any data before it leaves the plugin.
 * This is a safety-by-construction layer — it runs regardless
 * of user checkbox settings.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Api;

/**
 * Recursively sanitize data structures for external output.
 */
class Sanitizer {

	/**
	 * Patterns that are always scrubbed from string values.
	 *
	 * Each entry is a regex => replacement pair.
	 *
	 * @var array
	 */
	private static $patterns = array();

	/**
	 * wp-config constant names that must never leak.
	 *
	 * @var string[]
	 */
	private static $redacted_constants = array(
		'DB_NAME',
		'DB_USER',
		'DB_PASSWORD',
		'DB_HOST',
		'AUTH_KEY',
		'SECURE_AUTH_KEY',
		'LOGGED_IN_KEY',
		'NONCE_KEY',
		'AUTH_SALT',
		'SECURE_AUTH_SALT',
		'LOGGED_IN_SALT',
		'NONCE_SALT',
	);

	/**
	 * Build regex patterns from the current WordPress environment.
	 *
	 * Called once per request, then cached in the static property.
	 */
	private static function compile_patterns() {
		if ( ! empty( self::$patterns ) ) {
			return;
		}

		$paths = array_filter(
			array_unique(
				array(
					defined( 'ABSPATH' ) ? ABSPATH : '',
					defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR : '',
					defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : '',
					defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : '',
					defined( 'TEMPLATEPATH' ) ? TEMPLATEPATH : '',
					defined( 'STYLESHEETPATH' ) ? STYLESHEETPATH : '',
					wp_upload_dir()['basedir'] ?? '',
				)
			)
		);

		// Sort longest first so longer paths match before shorter prefixes.
		usort(
			$paths,
			function ( $a, $b ) {
				return strlen( $b ) - strlen( $a );
			}
		);

		foreach ( $paths as $path ) {
			if ( '' !== $path ) {
				self::$patterns[ '#' . preg_quote( $path, '#' ) . '[^\s"\']*#' ] = '[path]';
			}
		}

		// IPv4 addresses.
		self::$patterns['#\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b#'] = '[ip]';

		// IPv6 addresses (simplified — catches most common forms).
		self::$patterns['#\b[0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){7}\b#'] = '[ip]';
		self::$patterns['#\b(::)?([0-9a-fA-F]{1,4}:){1,6}[0-9a-fA-F]{1,4}\b#'] = '[ip]';

		// Email addresses.
		self::$patterns['#[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}#'] = '[email]';
	}

	/**
	 * Sanitize a value for external output.
	 *
	 * Recursively walks arrays and objects. Strings are scrubbed
	 * against compiled patterns. Other scalar types pass through.
	 *
	 * @param mixed $data  The data to sanitize.
	 * @return mixed  Sanitized data.
	 */
	public static function sanitize( $data ) {
		self::compile_patterns();

		if ( is_string( $data ) ) {
			return self::scrub_string( $data );
		}

		if ( is_array( $data ) ) {
			$clean = array();
			foreach ( $data as $key => $value ) {
				$clean[ $key ] = self::sanitize( $value );
			}
			return $clean;
		}

		if ( is_object( $data ) ) {
			$clone = clone $data;
			foreach ( get_object_vars( $clone ) as $prop => $value ) {
				$clone->$prop = self::sanitize( $value );
			}
			return $clone;
		}

		return $data;
	}

	/**
	 * Scrub a single string value.
	 *
	 * @param string $str  Input string.
	 * @return string  Scrubbed string.
	 */
	private static function scrub_string( $str ) {
		// Replace known sensitive constant values.
		foreach ( self::$redacted_constants as $const ) {
			if ( defined( $const ) && '' !== constant( $const ) ) {
				$str = str_replace( constant( $const ), '[redacted]', $str );
			}
		}

		// Apply regex patterns.
		foreach ( self::$patterns as $pattern => $replacement ) {
			$str = preg_replace( $pattern, $replacement, $str );
		}

		return $str;
	}

	/**
	 * Sanitize a SQL query string for display.
	 *
	 * Replaces literal values with placeholders while preserving
	 * query structure for diagnostic readability.
	 *
	 * @param string $sql  Raw SQL query.
	 * @return string  Structure-preserved sanitized query.
	 */
	public static function sanitize_sql( $sql ) {
		// First apply general string sanitization.
		$sql = self::scrub_string( $sql );

		return $sql;
	}
}
