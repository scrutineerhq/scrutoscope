<?php
namespace Scrutoscope\Util;

/**
 * Shared helper for WP 6.6+ 7-value autoload system.
 *
 * WP 6.6 introduced on/off/auto/auto-on/auto-off in addition to
 * legacy yes/no. Core autoloads yes, on, auto, auto-on by default
 * but allows filtering via wp_autoload_values_to_autoload.
 *
 * This helper centralizes the filter + sanitization so Profiler
 * and Diagnostics stay in sync.
 */
class Autoload {
	/**
	 * Allowed raw values in wp_options.autoload.
	 */
	const ALLOWED = array( 'yes', 'on', 'auto', 'auto-on', 'auto-off', 'no', 'off' );

	/**
	 * Default values that indicate "autoloaded" (core default).
	 */
	const DEFAULT_AUTOLOADED = array( 'yes', 'on', 'auto', 'auto-on' );

	/**
	 * Get sanitized list of autoload values that mean "autoloaded".
	 *
	 * Mirrors WP core logic: apply_filters('wp_autoload_values_to_autoload', DEFAULT_AUTOLOADED)
	 * then intersect with ALLOWED.
	 *
	 * @return string[]
	 */
	public static function get_autoloaded_values() {
		// Use core filter if available (WP 6.6+), fallback to DEFAULT.
		if ( has_filter( 'wp_autoload_values_to_autoload' ) || function_exists( 'apply_filters' ) ) {
			$values = apply_filters( 'wp_autoload_values_to_autoload', self::DEFAULT_AUTOLOADED );
		} else {
			$values = self::DEFAULT_AUTOLOADED;
		}

		if ( ! is_array( $values ) || empty( $values ) ) {
			return self::DEFAULT_AUTOLOADED;
		}

		$values = array_values( array_intersect( array_map( 'strval', $values ), self::ALLOWED ) );

		return ! empty( $values ) ? $values : self::DEFAULT_AUTOLOADED;
	}

	/**
	 * Build a SQL IN ('yes','on',...) list for current autoloaded values.
	 *
	 * @return string e.g. "'yes','on','auto','auto-on'"
	 */
	public static function get_in_list_sql() {
		$values = self::get_autoloaded_values();
		// esc_sql is available in WP context; fallback to addslashes for unit tests.
		if ( function_exists( 'esc_sql' ) ) {
			$escaped = array_map( 'esc_sql', $values );
		} else {
			$escaped = array_map( 'addslashes', $values );
		}
		return "'" . implode( "','", $escaped ) . "'";
	}
}
