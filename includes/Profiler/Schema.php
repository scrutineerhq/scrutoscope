<?php
/**
 * Database schema management.
 *
 * @package Scrutoscope
 */

namespace Scrutoscope\Profiler;

defined( 'ABSPATH' ) || exit;

/**
 * DDL and migrations for Scrutoscope tables.
 */
class Schema {

	/**
	 * Create the profiles table using dbDelta.
	 */
	public static function create_table() {
		global $wpdb;

		$table   = Storage::table_name();
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			session_id varchar(64) NOT NULL DEFAULT '',
			profile_type varchar(20) NOT NULL DEFAULT 'session',
			request_url text NOT NULL,
			request_method varchar(10) NOT NULL DEFAULT 'GET',
			route_class varchar(50) NOT NULL DEFAULT '',
			route_key varchar(255) NOT NULL DEFAULT '',
			duration_ns bigint(20) unsigned NOT NULL DEFAULT 0,
			user_role varchar(50) NOT NULL DEFAULT 'anonymous',
			profile_data longblob NOT NULL,
			captured_at datetime NOT NULL DEFAULT '0000-00-00 00:00:00',
			is_pinned tinyint(1) NOT NULL DEFAULT 0,
			note text NOT NULL,
			tags varchar(255) NOT NULL DEFAULT '',
			response_status smallint(5) unsigned DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY session_id (session_id),
			KEY profile_type (profile_type),
			KEY route_key (route_key),
			KEY is_pinned (is_pinned),
			KEY response_status (response_status)
		) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Migration: drop deprecated baseline columns (never implemented).
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$columns = $wpdb->get_col( "SHOW COLUMNS FROM {$table}" );
		if ( in_array( 'is_baseline', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE {$table} DROP COLUMN is_baseline" );
		}
		if ( in_array( 'baseline_name', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE {$table} DROP COLUMN baseline_name" );
		}

		// Long-term route-stats aggregate (survives the profile TTL).
		StorageRouteAggregates::create_route_stats_table();
	}

	/**
	 * Drop the profiles table.
	 */
	public static function drop_table() {
		global $wpdb;

		$table = Storage::table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( "DROP TABLE IF EXISTS {$table}" );
	}

	/**
	 * Create the route-stats aggregate table (idempotent via dbDelta).
	 */
	public static function create_route_stats_table() {
		StorageRouteAggregates::create_route_stats_table();
	}

	/**
	 * Upgrade the table schema to add new columns.
	 *
	 * Safe to call repeatedly — checks column existence before altering.
	 */
	public static function maybe_upgrade_table() {
		global $wpdb;

		$table = Storage::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$columns = $wpdb->get_col( "SHOW COLUMNS FROM {$table}", 0 );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		if ( ! in_array( 'profile_type', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN profile_type varchar(20) NOT NULL DEFAULT 'session' AFTER session_id, ADD KEY profile_type (profile_type)" );
		}

		if ( ! in_array( 'route_key', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN route_key varchar(255) NOT NULL DEFAULT '' AFTER route_class, ADD KEY route_key (route_key)" );
		}

		if ( ! in_array( 'user_role', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN user_role varchar(50) NOT NULL DEFAULT 'anonymous' AFTER duration_ns" );
		}

		if ( ! in_array( 'is_pinned', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN is_pinned tinyint(1) NOT NULL DEFAULT 0 AFTER captured_at, ADD KEY is_pinned (is_pinned)" );
		}

		if ( ! in_array( 'note', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN note text NOT NULL AFTER is_pinned" );
		}

		if ( ! in_array( 'tags', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN tags varchar(255) NOT NULL DEFAULT '' AFTER note" );
		}

		if ( ! in_array( 'response_status', $columns, true ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN response_status smallint(5) unsigned DEFAULT NULL AFTER captured_at, ADD KEY response_status (response_status)" );
		}

		// Ensure the route-stats aggregate exists on upgraded installs (dbDelta
		// is idempotent — no-op when the table is already present).
		StorageRouteAggregates::create_route_stats_table();
	}

	/**
	 * Migrate from the old "Scrutinizer" table and option names.
	 *
	 * Renames wp_scrutinizer_profiles → wp_scrutoscope_profiles and
	 * wp_scrutinizer_route_stats → wp_scrutoscope_route_stats if the old
	 * tables exist and the new ones do not. Also copies option values from
	 * scrutinizer_* keys to scrutoscope_* keys.
	 *
	 * Safe to call repeatedly — skips when migration is unnecessary.
	 */
	public static function maybe_migrate_from_scrutinizer() {
		global $wpdb;

		$old_profiles = $wpdb->prefix . 'scrutinizer_profiles';
		$new_profiles = Storage::table_name(); // wp_scrutoscope_profiles.

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$old_exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $old_profiles ) );
		$new_exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $new_profiles ) );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		if ( $old_exists && ! $new_exists ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE `{$old_profiles}` RENAME TO `{$new_profiles}`" );
		}

		$old_stats = $wpdb->prefix . 'scrutinizer_route_stats';
		$new_stats = StorageRouteAggregates::route_stats_table();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$old_stats_exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $old_stats ) );
		$new_stats_exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $new_stats ) );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		if ( $old_stats_exists && ! $new_stats_exists ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE `{$old_stats}` RENAME TO `{$new_stats}`" );
		}

		// Migrate option keys.
		$option_keys = array(
			'background_profiling',
			'sample_rate',
			'only_successful',
			'query_profiling',
			'lightweight_mode',
			'profile_cron',
			'cron_hook_costs',
			'shared_reports',
			'retention_days',
			'trust_proxy_headers',
			'user_scope',
			'exclude_paths',
			'hmac_pepper',
			'stats_retention_days',
		);

		foreach ( $option_keys as $suffix ) {
			$old_key = 'scrutinizer_' . $suffix;
			$new_key = 'scrutoscope_' . $suffix;
			$old_val = get_option( $old_key, null );

			if ( null !== $old_val && false === get_option( $new_key, false ) ) {
				update_option( $new_key, $old_val, true );
				delete_option( $old_key );
			}
		}

		// Migrate the mu-plugin file.
		if ( defined( 'WPMU_PLUGIN_DIR' ) ) {
			$old_mu = WPMU_PLUGIN_DIR . '/scrutinizer-early.php';
			$new_mu = WPMU_PLUGIN_DIR . '/scrutoscope-early.php';
			if ( file_exists( $old_mu ) && ! file_exists( $new_mu ) ) {
				// phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
				rename( $old_mu, $new_mu );
			}
		}
	}
}
