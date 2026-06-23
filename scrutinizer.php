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
 *
 * Maps the Scrutinizer\ namespace to the includes/ directory using PSR-4
 * conventions with directory separators derived from the namespace path.
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
 * Plugin activation callback.
 *
 * Creates the profiles database table.
 */
function scrutinizer_activate() {
	\Scrutinizer\Profiler\Storage::create_table();
}
register_activation_hook( __FILE__, 'scrutinizer_activate' );

/**
 * Plugin deactivation callback.
 *
 * Stops any active profiling session.
 */
function scrutinizer_deactivate() {
	\Scrutinizer\Profiler\Session::stop_session();
}
register_deactivation_hook( __FILE__, 'scrutinizer_deactivate' );

/**
 * Start the profiler early.
 *
 * Hooked at `plugins_loaded` priority 0 so that instrumentation wraps as
 * many callbacks as possible before they fire.
 */
function scrutinizer_boot_profiler() {
	\Scrutinizer\Profiler\Profiler::instance()->init();
}
add_action( 'plugins_loaded', 'scrutinizer_boot_profiler', 0 );

/**
 * Handle session activation tokens on `init`.
 */
function scrutinizer_handle_activation() {
	\Scrutinizer\Profiler\Session::handle_activation();
}
add_action( 'init', 'scrutinizer_handle_activation' );

/**
 * Load text domain for translations.
 */
function scrutinizer_load_textdomain() {
	load_plugin_textdomain( 'scrutinizer', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
}
add_action( 'init', 'scrutinizer_load_textdomain' );

/**
 * Show admin bar indicator when profiling is active.
 *
 * Works on both admin and frontend pages so the user can always
 * navigate back to the dashboard.
 *
 * @param WP_Admin_Bar $wp_admin_bar  The admin bar instance.
 */
function scrutinizer_admin_bar_menu( $wp_admin_bar ) {
	if ( empty( $_COOKIE['scrutinizer_session'] ) ) {
		return;
	}

	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$wp_admin_bar->add_node(
		array(
			'id'    => 'scrutinizer-profiling',
			'title' => '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00ba37;margin-right:6px;vertical-align:middle;"></span>Scrutinizer',
			'href'  => admin_url( 'tools.php?page=scrutinizer' ),
			'meta'  => array(
				'title' => __( 'Profiling active — click to view dashboard', 'scrutinizer' ),
			),
		)
	);
}
add_action( 'admin_bar_menu', 'scrutinizer_admin_bar_menu', 100 );

/**
 * Register admin page and AJAX handlers.
 */
function scrutinizer_admin_init() {
	\Scrutinizer\Admin\Dashboard::register();
	\Scrutinizer\Admin\Ajax::register();
	\Scrutinizer\Profiler\Storage::maybe_upgrade_table();
}
add_action( 'plugins_loaded', 'scrutinizer_admin_init' );
