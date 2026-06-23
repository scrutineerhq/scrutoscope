<?php
/**
 * Plugin Name:       Scrutinizer
 * Plugin URI:        https://scrutineer.dev/scrutinizer
 * Description:       WordPress Performance Profiler — See where your server request duration is spent.
 * Version:           0.1.0-dev
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            The Scrutineer Project
 * Author URI:        https://scrutineer.dev
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       scrutinizer
 * Domain Path:       /languages
 *
 * @package Scrutinizer
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SCRUTINIZER_VERSION', '0.1.0-dev' );
define( 'SCRUTINIZER_FILE', __FILE__ );
define( 'SCRUTINIZER_DIR', plugin_dir_path( __FILE__ ) );
define( 'SCRUTINIZER_URL', plugin_dir_url( __FILE__ ) );

/**
 * Autoloader.
 */
spl_autoload_register(
	function ( $class_name ) {
		$prefix = 'Scrutinizer\\';
		$len    = strlen( $prefix );

		if ( strncmp( $prefix, $class_name, $len ) !== 0 ) {
			return;
		}

		$relative = substr( $class_name, $len );
		$file     = SCRUTINIZER_DIR . 'includes/' . str_replace( '\\', '/', $relative ) . '.php';

		if ( file_exists( $file ) ) {
			require $file;
		}
	}
);

/**
 * Plugin activation.
 */
function scrutinizer_activate() {
	// Activation tasks.
}
register_activation_hook( __FILE__, 'scrutinizer_activate' );

/**
 * Plugin deactivation.
 */
function scrutinizer_deactivate() {
	// Cleanup tasks.
}
register_deactivation_hook( __FILE__, 'scrutinizer_deactivate' );

/**
 * Initialize the plugin.
 */
function scrutinizer_init() {
	load_plugin_textdomain( 'scrutinizer', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
}
add_action( 'init', 'scrutinizer_init' );
