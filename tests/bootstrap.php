<?php
/**
 * PHPUnit bootstrap.
 *
 * Most classes under test have no WordPress dependencies. The few that touch a
 * handful of WP functions/constants (Sanitizer, Storage's URL reduction) are
 * exercised against lightweight stubs defined here — no full WP test suite
 * required. Integration tests that need WP_UnitTestCase remain a future suite.
 *
 * @package Scrutinizer
 */

// --- Minimal WordPress stubs -------------------------------------------------

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', '/var/www/html/' );
}
if ( ! defined( 'WP_CONTENT_DIR' ) ) {
	define( 'WP_CONTENT_DIR', '/var/www/html/wp-content' );
}
if ( ! defined( 'WP_PLUGIN_DIR' ) ) {
	define( 'WP_PLUGIN_DIR', '/var/www/html/wp-content/plugins' );
}
if ( ! defined( 'WPMU_PLUGIN_DIR' ) ) {
	define( 'WPMU_PLUGIN_DIR', '/var/www/html/wp-content/mu-plugins' );
}
// Known secret values, to assert hard redaction.
if ( ! defined( 'AUTH_SALT' ) ) {
	define( 'AUTH_SALT', 'k9Q-super-secret-salt-value-x7' );
}
if ( ! defined( 'DB_PASSWORD' ) ) {
	define( 'DB_PASSWORD', 'hunter2-db-pass' );
}

if ( ! function_exists( 'wp_upload_dir' ) ) {
	function wp_upload_dir() {
		return array( 'basedir' => '/var/www/html/wp-content/uploads' );
	}
}
if ( ! function_exists( 'get_template_directory' ) ) {
	function get_template_directory() {
		return '/var/www/html/wp-content/themes/parent';
	}
}
if ( ! function_exists( 'get_stylesheet_directory' ) ) {
	function get_stylesheet_directory() {
		return '/var/www/html/wp-content/themes/child';
	}
}
if ( ! function_exists( 'wp_parse_url' ) ) {
	function wp_parse_url( $url, $component = -1 ) {
		return parse_url( $url, $component );
	}
}
if ( ! function_exists( 'wp_json_encode' ) ) {
	function wp_json_encode( $data, $options = 0, $depth = 512 ) {
		return json_encode( $data, $options, $depth );
	}
}

// --- Classes under test ------------------------------------------------------

require_once __DIR__ . '/../includes/Profiler/QueryReducer.php';
require_once __DIR__ . '/../includes/Profiler/CallStack.php';
require_once __DIR__ . '/../includes/Api/Sanitizer.php';
require_once __DIR__ . '/../includes/Profiler/Storage.php';
