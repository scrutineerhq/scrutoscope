<?php
/**
 * Scrutinizer uninstall handler.
 *
 * Fired when the plugin is deleted (not just deactivated) via the
 * WordPress plugin admin. Removes all data created by the plugin:
 *
 * - Custom database table (wp_scrutinizer_profiles)
 * - API access log table (wp_scrutinizer_api_log)
 * - Plugin options (scrutinizer_*)
 * - Scheduled cron events
 * - Application Passwords with our app_id
 * - Transients
 *
 * Handles multisite by iterating all sites on the network.
 *
 * @package Scrutinizer
 */

// Exit if not called by WordPress.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Clean up all Scrutinizer data for a single site.
 */
function scrutinizer_uninstall_site() {
	global $wpdb;

	// 1. Drop the profiles table.
	$profiles_table = $wpdb->prefix . 'scrutinizer_profiles';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query( "DROP TABLE IF EXISTS {$profiles_table}" );

	// 2. Drop the API access log table.
	$api_log_table = $wpdb->prefix . 'scrutinizer_api_log';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query( "DROP TABLE IF EXISTS {$api_log_table}" );

	// 2b. Drop the route-stats aggregate table.
	$route_stats_table = $wpdb->prefix . 'scrutinizer_route_stats';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query( "DROP TABLE IF EXISTS {$route_stats_table}" );

	// 3. Delete all scrutinizer_* options.
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
			$wpdb->esc_like( 'scrutinizer_' ) . '%'
		)
	);

	// 4. Delete scrutinizer transients.
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_scrutinizer_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_scrutinizer_' ) . '%'
		)
	);

	// 5. Clear scheduled cron events.
	wp_clear_scheduled_hook( 'scrutinizer_cleanup_profiles' );
	wp_clear_scheduled_hook( 'scrutinizer_cleanup_passwords' );

	// 6. Remove early boot mu-plugin + its opt-in preference.
	$mu_file = WPMU_PLUGIN_DIR . '/scrutinizer-early.php';
	if ( file_exists( $mu_file ) ) {
		wp_delete_file( $mu_file );
	}
	delete_option( 'scrutinizer_early_boot' );

	// 7. Delete Application Passwords with our app_id.
	$app_id = '7c9a3f2e-1b4d-4e8a-9f6c-2d5e8a1b3c7f';

	$users = get_users(
		array(
			'fields' => 'ID',
		)
	);

	foreach ( $users as $user_id ) {
		if ( ! class_exists( 'WP_Application_Passwords' ) ) {
			break;
		}

		$passwords = WP_Application_Passwords::get_user_application_passwords( $user_id );

		if ( ! is_array( $passwords ) ) {
			continue;
		}

		foreach ( $passwords as $item ) {
			if ( isset( $item['app_id'] ) && $app_id === $item['app_id'] ) {
				WP_Application_Passwords::delete_application_password( $user_id, $item['uuid'] );
			}
		}
	}
}

// Run cleanup — handle multisite if applicable.
if ( is_multisite() ) {
	$sites = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0, // All sites.
		)
	);

	foreach ( $sites as $site_id ) {
		switch_to_blog( $site_id );
		scrutinizer_uninstall_site();
		restore_current_blog();
	}
} else {
	scrutinizer_uninstall_site();
}
