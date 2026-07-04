<?php
/**
 * Scrutoscope uninstall handler.
 *
 * Fired when the plugin is deleted (not just deactivated) via the
 * WordPress plugin admin. Removes all data created by the plugin:
 *
 * - Custom database table (wp_scrutoscope_profiles)
 * - API access log table (wp_scrutoscope_api_log)
 * - Plugin options (scrutoscope_*)
 * - Scheduled cron events
 * - Application Passwords with our app_id
 * - Transients
 *
 * Handles multisite by iterating all sites on the network.
 *
 * @package Scrutoscope
 */

// Exit if not called by WordPress.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Clean up all Scrutoscope data for a single site.
 */
function scrutoscope_uninstall_site() {
	global $wpdb;

	// 1. Drop the profiles table.
	$profiles_table = $wpdb->prefix . 'scrutoscope_profiles';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query( "DROP TABLE IF EXISTS {$profiles_table}" );

	// 2. Drop the API access log table.
	$api_log_table = $wpdb->prefix . 'scrutoscope_api_log';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query( "DROP TABLE IF EXISTS {$api_log_table}" );

	// 2b. Drop the route-stats aggregate table.
	$route_stats_table = $wpdb->prefix . 'scrutoscope_route_stats';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query( "DROP TABLE IF EXISTS {$route_stats_table}" );

	// 3. Delete all scrutoscope_* options.
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
			$wpdb->esc_like( 'scrutoscope_' ) . '%'
		)
	);

	// 4. Delete scrutoscope transients.
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_scrutoscope_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_scrutoscope_' ) . '%'
		)
	);

	// 5. Clear scheduled cron events.
	wp_clear_scheduled_hook( 'scrutoscope_cleanup_profiles' );
	wp_clear_scheduled_hook( 'scrutoscope_cleanup_passwords' );

	// 6. Remove early boot mu-plugin + its opt-in preference.
	$mu_file = WPMU_PLUGIN_DIR . '/scrutoscope-early.php';
	if ( file_exists( $mu_file ) ) {
		wp_delete_file( $mu_file );
	}
	delete_option( 'scrutoscope_early_boot' );

	// 7. Delete Application Passwords with our app_id.
	$app_id = '7c9a3f2e-1b4d-4e8a-9f6c-2d5e8a1b3c7f';

	$users = get_users(
		array(
			'fields'       => 'ID',
			'meta_key'     => '_application_passwords',
			'meta_compare' => 'EXISTS',
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
		scrutoscope_uninstall_site();
		restore_current_blog();
	}
} else {
	scrutoscope_uninstall_site();
}
