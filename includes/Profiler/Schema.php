<?php
/**
 * Database schema management.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

defined( 'ABSPATH' ) || exit;

/**
 * DDL and migrations for Scrutinizer tables.
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
}
