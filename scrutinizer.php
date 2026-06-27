<?php
/**
 * Plugin Name:       Scrutinizer
 * Plugin URI:        https://scrutineer.dev/scrutinizer
 * Description:       WordPress Performance Profiler — See where your server request duration is spent.
 * Version:           1.1.0
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

define( 'SCRUTINIZER_VERSION', '1.1.0' );
define( 'SCRUTINIZER_FILE', __FILE__ );
define( 'SCRUTINIZER_DIR', plugin_dir_path( __FILE__ ) );
define( 'SCRUTINIZER_URL', plugin_dir_url( __FILE__ ) );

/*
 * Query profiling: manage the SAVEQUERIES constant.
 *
 * If SAVEQUERIES is already defined (by wp-config.php or another plugin),
 * we respect it and mark it as externally managed. Otherwise, we control
 * it via a plugin option so the user can toggle it from the dashboard.
 *
 * This runs at plugin include time — after WP core is fully bootstrapped
 * but before our profiler hooks fire, so queries from this point forward
 * are captured when enabled.
 */
if ( defined( 'SAVEQUERIES' ) ) {
	// Externally managed — respect whatever wp-config.php set.
	define( 'SCRUTINIZER_SAVEQUERIES_MANAGED', false );
} else {
	// We control it. Default: on (you installed a profiler — you want data).
	define( 'SCRUTINIZER_SAVEQUERIES_MANAGED', true );
	if ( get_option( 'scrutinizer_query_profiling', true ) ) {
		define( 'SAVEQUERIES', true );
	}
}

/**
 * Get the current query profiling state for the dashboard UI.
 *
 * @return array{state: string, active: bool, managed: bool}
 */
function scrutinizer_query_profiling_state() {
	$active = defined( 'SAVEQUERIES' ) && SAVEQUERIES;

	if ( SCRUTINIZER_SAVEQUERIES_MANAGED ) {
		return array(
			'state'   => $active ? 'controllable_on' : 'controllable_off',
			'active'  => $active,
			'managed' => true,
		);
	}

	return array(
		'state'   => $active ? 'forced_on' : 'forced_off',
		'active'  => $active,
		'managed' => false,
	);
}

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

		// Only plain namespaced class paths (letters, digits, underscore,
		// backslash). Reject anything with '.' or '/' that a crafted class name
		// could use to escape the includes/ directory.
		if ( ! preg_match( '/^[A-Za-z0-9_\\\\]+$/', $relative ) ) {
			return;
		}

		$file = SCRUTINIZER_DIR . 'includes/' . str_replace( '\\', '/', $relative ) . '.php';

		if ( file_exists( $file ) ) {
			require $file;
		}
	}
);

/**
 * Plugin activation callback.
 *
 * Creates the profiles database table and schedules cleanup cron.
 */
function scrutinizer_activate() {
	\Scrutinizer\Profiler\Storage::create_table();

	// Schedule twice-daily profile cleanup if not already scheduled.
	if ( ! wp_next_scheduled( 'scrutinizer_cleanup_profiles' ) ) {
		wp_schedule_event( time(), 'twicedaily', 'scrutinizer_cleanup_profiles' );
	}

	// Install early boot timer mu-plugin.
	$source  = SCRUTINIZER_DIR . 'assets/mu-plugin/scrutinizer-early.php';
	$mu_file = WPMU_PLUGIN_DIR . '/scrutinizer-early.php';
	if ( file_exists( $source ) && ! file_exists( $mu_file ) ) {
		if ( ! is_dir( WPMU_PLUGIN_DIR ) ) {
			wp_mkdir_p( WPMU_PLUGIN_DIR );
		}
		copy( $source, $mu_file );
	}
}
register_activation_hook( __FILE__, 'scrutinizer_activate' );

/**
 * Plugin deactivation callback.
 *
 * Stops any active profiling session, cleans up API credentials,
 * and removes the cleanup cron schedule.
 */
function scrutinizer_deactivate() {
	\Scrutinizer\Profiler\Session::stop_session();
	\Scrutinizer\Api\ApplicationPassword::deactivate();
	wp_clear_scheduled_hook( 'scrutinizer_cleanup_profiles' );

	// Remove the early-boot mu-plugin so no Scrutineer code keeps running on
	// every request while the plugin is deactivated. It is opt-in and can be
	// reinstalled after reactivation.
	if ( defined( 'WPMU_PLUGIN_DIR' ) ) {
		$mu_file = WPMU_PLUGIN_DIR . '/scrutinizer-early.php';
		if ( file_exists( $mu_file ) ) {
			wp_delete_file( $mu_file );
		}
	}
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
 * Register admin page, AJAX handlers, and REST API.
 */
function scrutinizer_admin_init() {
	\Scrutinizer\Admin\Dashboard::register();
	\Scrutinizer\Admin\Ajax::register();
	\Scrutinizer\Profiler\Storage::maybe_upgrade_table();
	\Scrutinizer\Api\RestApi::register();
	\Scrutinizer\Api\ApplicationPassword::register();

	// Ensure cleanup cron is scheduled — only check on admin pages
	// to avoid a wp_next_scheduled() DB hit on every frontend load.
	if ( is_admin() || wp_doing_cron() ) {
		if ( ! wp_next_scheduled( 'scrutinizer_cleanup_profiles' ) ) {
			wp_schedule_event( time(), 'twicedaily', 'scrutinizer_cleanup_profiles' );
		}
	}
}
add_action( 'plugins_loaded', 'scrutinizer_admin_init' );

/**
 * Handle profile cleanup cron event.
 *
 * Runs on `scrutinizer_cleanup_profiles` (twice daily).
 * Uses configurable retention options. Pinned profiles are always kept.
 */
function scrutinizer_run_cleanup() {
	$retention_days = (int) get_option( 'scrutinizer_retention_days', 7 );
	$max_per_route  = (int) get_option( 'scrutinizer_max_per_route', 100 );

	\Scrutinizer\Profiler\Storage::cleanup_profiles( $retention_days, $max_per_route );

	// Prune the long-term stats aggregate. Kept far longer than raw profiles
	// (it's tiny and exists to outlive them), but still bounded.
	$stats_retention = (int) get_option( 'scrutinizer_stats_retention_days', 365 );
	\Scrutinizer\Profiler\Storage::prune_route_stats( $stats_retention );
}
add_action( 'scrutinizer_cleanup_profiles', 'scrutinizer_run_cleanup' );

/**
 * Register WP-CLI commands.
 */
if ( defined( 'WP_CLI' ) && WP_CLI ) {
	add_action(
		'cli_init',
		function () {
			\WP_CLI::add_command( 'scrutinizer', 'Scrutinizer\\Cli\\Commands' );
		}
	);
}
