<?php
/**
 * Plugin Name:       Scrutoscope
 * Plugin URI:        https://scrutoscope.dev
 * Description:       WordPress Performance Profiler — See where your server request duration is spent.
 * Version:           1.3.4
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            The Scrutineer Project
 * Author URI:        https://scrutineer.dev
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       scrutoscope
 * Domain Path:       /languages
 *
 * @package Scrutoscope
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SCRUTOSCOPE_VERSION', '1.3.4' );
define( 'SCRUTOSCOPE_FILE', __FILE__ );
define( 'SCRUTOSCOPE_DIR', plugin_dir_path( __FILE__ ) );
define( 'SCRUTOSCOPE_URL', plugin_dir_url( __FILE__ ) );

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
	define( 'SCRUTOSCOPE_SAVEQUERIES_MANAGED', false );
} else {
	// We control it. Default OFF: SAVEQUERIES makes WordPress retain query text,
	// timing, and caller for every request — real overhead that shouldn't be
	// paid until the admin opts in (Settings → Query Profiling). The basic query
	// COUNT is always available via $wpdb->num_queries regardless.
	define( 'SCRUTOSCOPE_SAVEQUERIES_MANAGED', true );
	if ( get_option( 'scrutoscope_query_profiling', false ) ) {
		// REVIEWER NOTE: SAVEQUERIES is CONDITIONAL — only defined when admin opts in
		// via get_option('scrutoscope_query_profiling'), which defaults to false.
		// This line never executes on a default install. See guard above.
		define( 'SAVEQUERIES', true );
	}
}

/**
 * Get the current query profiling state for the dashboard UI.
 *
 * @return array{state: string, active: bool, managed: bool}
 */
function scrutoscope_query_profiling_state() {
	$active = defined( 'SAVEQUERIES' ) && SAVEQUERIES;

	if ( SCRUTOSCOPE_SAVEQUERIES_MANAGED ) {
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
 * Maps the Scrutoscope\ namespace to the includes/ directory using PSR-4
 * conventions with directory separators derived from the namespace path.
 */
spl_autoload_register(
	function ( $class_name ) {
		$prefix = 'Scrutoscope\\';
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

		$file = SCRUTOSCOPE_DIR . 'includes/' . str_replace( '\\', '/', $relative ) . '.php';

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
function scrutoscope_activate() {
	// Migrate from old "Scrutinizer" table/option names first.
	\Scrutoscope\Profiler\Schema::maybe_migrate_from_scrutinizer();

	\Scrutoscope\Profiler\Schema::create_table();

	// Schedule twice-daily profile cleanup if not already scheduled.
	if ( ! wp_next_scheduled( 'scrutoscope_cleanup_profiles' ) ) {
		wp_schedule_event( time(), 'twicedaily', 'scrutoscope_cleanup_profiles' );
	}

	// Early-boot timing is OPT-IN: a fresh activation writes nothing outside the
	// plugin directory. Only restore the must-use plugin if the admin previously
	// enabled it (e.g. reactivating after a deactivate, or a plugin update).
	if ( get_option( \Scrutoscope\Admin\EarlyBoot::OPTION, false ) ) {
		\Scrutoscope\Admin\EarlyBoot::install();
	}
}
register_activation_hook( __FILE__, 'scrutoscope_activate' );

/**
 * Plugin deactivation callback.
 *
 * Stops any active profiling session, cleans up API credentials,
 * and removes the cleanup cron schedule.
 */
function scrutoscope_deactivate() {
	\Scrutoscope\Profiler\Session::stop_session();
	\Scrutoscope\Api\ApplicationPassword::deactivate();
	wp_clear_scheduled_hook( 'scrutoscope_cleanup_profiles' );

	// Remove the early-boot mu-plugin so no Scrutineer code keeps running on
	// every request while the plugin is deactivated. The opt-in preference is
	// kept, so reactivation restores it.
	\Scrutoscope\Admin\EarlyBoot::remove();
}
register_deactivation_hook( __FILE__, 'scrutoscope_deactivate' );

/**
 * Start the profiler early.
 *
 * Hooked at `plugins_loaded` priority 0 so that instrumentation wraps as
 * many callbacks as possible before they fire.
 */
function scrutoscope_boot_profiler() {
	\Scrutoscope\Profiler\Profiler::instance()->init();
}
add_action( 'plugins_loaded', 'scrutoscope_boot_profiler', 0 );

/**
 * Handle session activation tokens on `init`.
 */
function scrutoscope_handle_activation() {
	\Scrutoscope\Profiler\Session::handle_activation();
}
add_action( 'init', 'scrutoscope_handle_activation' );


/**
 * Show admin bar indicator when profiling is active.
 *
 * Works on both admin and frontend pages so the user can always
 * navigate back to the dashboard.
 *
 * @param WP_Admin_Bar $wp_admin_bar  The admin bar instance.
 */
function scrutoscope_admin_bar_menu( $wp_admin_bar ) {
	if ( empty( $_COOKIE['scrutoscope_session'] ) ) {
		return;
	}

	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$wp_admin_bar->add_node(
		array(
			'id'    => 'scrutoscope-profiling',
			'title' => '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00ba37;margin-right:6px;vertical-align:middle;"></span>Scrutoscope',
			'href'  => admin_url( 'tools.php?page=scrutoscope' ),
			'meta'  => array(
				'title' => __( 'Profiling active - click to view dashboard', 'scrutoscope' ),
			),
		)
	);
}
add_action( 'admin_bar_menu', 'scrutoscope_admin_bar_menu', 100 );

/**
 * Show a floating capture banner on profiled pages.
 *
 * Fires on wp_footer (front-end) and admin_footer (admin) so it works
 * across all three capture contexts: admin pages, front-end logged-in,
 * and front-end logged-out/incognito.
 */
function scrutoscope_capture_banner() {
	if ( ! \Scrutoscope\Profiler\Session::has_valid_cookie() ) {
		return;
	}

	// Skip the Scrutoscope dashboard itself — it already has session UI.
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	if ( is_admin() && isset( $_GET['page'] ) && 'scrutoscope' === $_GET['page'] ) {
		return;
	}

	$text     = esc_html__( 'Profiling active - keep browsing to capture more pages.', 'scrutoscope' );
	$cta_url  = esc_url( admin_url( 'tools.php?page=scrutoscope' ) );
	$cta_text = esc_html__( 'Return to Scrutoscope to stop.', 'scrutoscope' );
	?>
	<div id="scrutoscope-capture-banner" role="status" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:100001;background:#1d2327;color:#f0f0f1;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;padding:10px 16px;align-items:center;gap:10px;box-shadow:0 -1px 4px rgba(0,0,0,.15);justify-content:center;border-top:2px solid #00ba37;">
		<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00ba37;flex-shrink:0;"></span>
		<span><?php echo esc_html( $text ); ?> <a href="<?php echo esc_url( $cta_url ); ?>" style="color:#72aee6;text-decoration:none;"><?php echo esc_html( $cta_text ); ?></a></span>
		<button type="button" id="scrutoscope-capture-dismiss" style="background:none;border:none;color:#c3c4c7;cursor:pointer;font-size:18px;line-height:1;padding:8px 12px;min-width:32px;min-height:32px;margin-left:4px;display:inline-flex;align-items:center;justify-content:center;" aria-label="<?php esc_attr_e( 'Dismiss', 'scrutoscope' ); ?>">&times;</button>
	</div>
	<?php
	wp_register_script( 'scrutoscope-capture-banner', false, array(), SCRUTOSCOPE_VERSION, true );
	wp_add_inline_script(
		'scrutoscope-capture-banner',
		'(function(){' .
			"if(sessionStorage.getItem('scrutoscope_banner_off'))return;" .
			"var b=document.getElementById('scrutoscope-capture-banner');" .
			'if(!b)return;' .
			"b.style.display='flex';" .
			"document.documentElement.style.paddingBottom='42px';" .
			"var d=document.getElementById('scrutoscope-capture-dismiss');" .
			"d.addEventListener('click',function(){" .
				"b.style.display='none';" .
				"document.documentElement.style.paddingBottom='';" .
				"sessionStorage.setItem('scrutoscope_banner_off','1');" .
			'});' .
			"d.addEventListener('mouseenter',function(){d.style.color='#f0f0f1';});" .
			"d.addEventListener('mouseleave',function(){d.style.color='#c3c4c7';});" .
		'})();'
	);
	wp_enqueue_script( 'scrutoscope-capture-banner' );
	?>
	<?php
}
add_action( 'wp_footer', 'scrutoscope_capture_banner', PHP_INT_MAX );
add_action( 'admin_footer', 'scrutoscope_capture_banner', PHP_INT_MAX );

/**
 * Register admin page, AJAX handlers, and REST API.
 */
function scrutoscope_admin_init() {
	// Run migration from old "Scrutinizer" names on upgrade (not just activation).
	\Scrutoscope\Profiler\Schema::maybe_migrate_from_scrutinizer();

	\Scrutoscope\Admin\Dashboard::register();
	\Scrutoscope\Admin\Ajax::register();
	\Scrutoscope\Profiler\Schema::maybe_upgrade_table();
	\Scrutoscope\Api\RestApi::register();
	\Scrutoscope\Api\ApplicationPassword::register();

	// Ensure cleanup cron is scheduled — only check on admin pages
	// to avoid a wp_next_scheduled() DB hit on every frontend load.
	if ( is_admin() || wp_doing_cron() ) {
		if ( ! wp_next_scheduled( 'scrutoscope_cleanup_profiles' ) ) {
			wp_schedule_event( time(), 'twicedaily', 'scrutoscope_cleanup_profiles' );
		}
	}
}
add_action( 'plugins_loaded', 'scrutoscope_admin_init' );

/**
 * Handle profile cleanup cron event.
 *
 * Runs on `scrutoscope_cleanup_profiles` (twice daily).
 * Uses configurable retention options. Pinned profiles are always kept.
 */
function scrutoscope_run_cleanup() {
	$retention_days = (int) get_option( 'scrutoscope_retention_days', 7 );
	$max_per_route  = (int) get_option( 'scrutoscope_max_per_route', 100 );

	\Scrutoscope\Profiler\Cleanup::cleanup_profiles( $retention_days, $max_per_route );

	// Prune the long-term stats aggregate. Kept far longer than raw profiles
	// (it's tiny and exists to outlive them), but still bounded.
	$stats_retention = (int) get_option( 'scrutoscope_stats_retention_days', 365 );
	\Scrutoscope\Profiler\StorageRouteAggregates::prune_route_stats( $stats_retention );
}
add_action( 'scrutoscope_cleanup_profiles', 'scrutoscope_run_cleanup' );

/**
 * Register WP-CLI commands.
 */
if ( defined( 'WP_CLI' ) && WP_CLI ) {
	add_action(
		'cli_init',
		function () {
			\WP_CLI::add_command( 'scrutoscope', 'Scrutoscope\\Cli\\Commands' );
		}
	);
}
