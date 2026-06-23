<?php
/**
 * Profile data storage.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

/**
 * Persists profile data in a custom database table.
 */
class Storage {

	/**
	 * Return the table name including the WordPress prefix.
	 *
	 * @return string
	 */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . 'scrutinizer_profiles';
	}

	/**
	 * Create the profiles table using dbDelta.
	 */
	public static function create_table() {
		global $wpdb;

		$table   = self::table_name();
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
			profile_data longtext NOT NULL,
			captured_at datetime NOT NULL DEFAULT '0000-00-00 00:00:00',
			is_baseline tinyint(1) NOT NULL DEFAULT 0,
			baseline_name varchar(255) NOT NULL DEFAULT '',
			PRIMARY KEY  (id),
			KEY session_id (session_id),
			KEY profile_type (profile_type),
			KEY route_key (route_key),
			KEY is_baseline (is_baseline)
		) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Drop the profiles table.
	 */
	public static function drop_table() {
		global $wpdb;

		$table = self::table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( "DROP TABLE IF EXISTS {$table}" );
	}

	/**
	 * Save a profile.
	 *
	 * @param string $session_id    Session identifier (empty for background).
	 * @param array  $profile_data  Compiled profile data.
	 * @param string $profile_type  'session' or 'background'.
	 * @return int|false  Inserted row ID or false on failure.
	 */
	public static function save_profile( $session_id, $profile_data, $profile_type = 'session' ) {
		global $wpdb;

		$url    = isset( $profile_data['request']['url'] ) ? $profile_data['request']['url'] : '';
		$method = isset( $profile_data['request']['method'] ) ? $profile_data['request']['method'] : 'GET';
		$route  = isset( $profile_data['request']['route_class'] ) ? $profile_data['request']['route_class'] : '';
		$dur_ns = isset( $profile_data['summary']['duration_ns'] ) ? $profile_data['summary']['duration_ns'] : 0;

		// Normalize URL to a grouping key: method + path (no query string, no host).
		$route_key = self::normalize_route_key( $method, $url );

		$result = $wpdb->insert(
			self::table_name(),
			array(
				'session_id'     => $session_id,
				'profile_type'   => $profile_type,
				'request_url'    => $url,
				'request_method' => $method,
				'route_class'    => $route,
				'route_key'      => $route_key,
				'duration_ns'    => $dur_ns,
				'profile_data'   => wp_json_encode( $profile_data ),
				'captured_at'    => current_time( 'mysql' ),
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s' )
		);

		if ( false === $result ) {
			return false;
		}

		return (int) $wpdb->insert_id;
	}

	/**
	 * Normalize a URL into a route grouping key.
	 *
	 * Strips host and query string so that e.g. /wp-admin/edit.php?post_type=page
	 * and /wp-admin/edit.php?post_type=post both group under GET:/wp-admin/edit.php.
	 *
	 * @param string $method  HTTP method.
	 * @param string $url     Full request URL.
	 * @return string  Normalized key like "GET:/wp-admin/edit.php".
	 */
	private static function normalize_route_key( $method, $url ) {
		$path = wp_parse_url( $url, PHP_URL_PATH );
		if ( empty( $path ) ) {
			$path = '/';
		}
		// Collapse trailing slashes.
		$path = rtrim( $path, '/' );
		if ( '' === $path ) {
			$path = '/';
		}
		return strtoupper( $method ) . ':' . $path;
	}

	/**
	 * Get all profiles for a session.
	 *
	 * @param string $session_id  Session identifier.
	 * @return array
	 */
	public static function get_profiles( $session_id ) {
		global $wpdb;

		$table = self::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is safe from self::table_name().
		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, session_id, request_url, request_method, route_class, duration_ns, captured_at, is_baseline, baseline_name FROM {$table} WHERE session_id = %s ORDER BY captured_at DESC",
				$session_id
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * Get a single profile by ID.
	 *
	 * @param int $id  Profile row ID.
	 * @return array|null
	 */
	public static function get_profile( $id ) {
		global $wpdb;

		$table = self::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is safe from self::table_name().
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$table} WHERE id = %d",
				$id
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		if ( null === $row ) {
			return null;
		}

		$row['profile_data'] = json_decode( $row['profile_data'], true );

		return $row;
	}

	/**
	 * Delete a profile by ID.
	 *
	 * @param int $id  Profile row ID.
	 * @return bool
	 */
	public static function delete_profile( $id ) {
		global $wpdb;

		$result = $wpdb->delete(
			self::table_name(),
			array( 'id' => $id ),
			array( '%d' )
		);

		return ( false !== $result );
	}

	/**
	 * Mark a profile as a baseline.
	 *
	 * @param int    $profile_id  Profile row ID.
	 * @param string $name        Baseline name.
	 * @return bool
	 */
	public static function save_baseline( $profile_id, $name ) {
		global $wpdb;

		$result = $wpdb->update(
			self::table_name(),
			array(
				'is_baseline'   => 1,
				'baseline_name' => $name,
			),
			array( 'id' => $profile_id ),
			array( '%d', '%s' ),
			array( '%d' )
		);

		return ( false !== $result );
	}

	/**
	 * Get recent profiles across all sessions.
	 *
	 * @param int $limit  Maximum number of profiles to return.
	 * @return array
	 */
	public static function get_recent_profiles( $limit = 50 ) {
		global $wpdb;

		$table = self::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is safe from self::table_name().
		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, session_id, request_url, request_method, route_class, duration_ns, captured_at, is_baseline, baseline_name FROM {$table} ORDER BY captured_at DESC LIMIT %d",
				$limit
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * Get all baselines.
	 *
	 * @return array
	 */
	public static function get_baselines() {
		global $wpdb;

		$table = self::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is safe from self::table_name().
		return $wpdb->get_results(
			"SELECT id, session_id, request_url, request_method, route_class, duration_ns, captured_at, baseline_name FROM {$table} WHERE is_baseline = 1 ORDER BY captured_at DESC",
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * Get profiles grouped by route key.
	 *
	 * Returns one row per unique route_key with aggregate stats.
	 *
	 * @param string $profile_type  Filter by profile type ('session', 'background', or '' for all).
	 * @param string $session_id    Filter by session ID (empty for all).
	 * @param int    $limit         Maximum groups to return.
	 * @return array
	 */
	public static function get_profiles_grouped( $profile_type = '', $session_id = '', $limit = 100 ) {
		global $wpdb;

		$table = self::table_name();
		$where = array( '1=1' );
		$args  = array();

		if ( ! empty( $profile_type ) ) {
			$where[] = 'profile_type = %s';
			$args[]  = $profile_type;
		}

		if ( ! empty( $session_id ) ) {
			$where[] = 'session_id = %s';
			$args[]  = $session_id;
		}

		$where_sql = implode( ' AND ', $where );
		$args[]    = $limit;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared
		$sql = "SELECT
				route_key,
				route_class,
				request_method,
				COUNT(*) AS request_count,
				AVG(duration_ns) AS avg_duration_ns,
				MIN(duration_ns) AS min_duration_ns,
				MAX(duration_ns) AS max_duration_ns,
				MAX(captured_at) AS last_captured,
				MIN(captured_at) AS first_captured,
				GROUP_CONCAT(DISTINCT profile_type) AS profile_types
			FROM {$table}
			WHERE {$where_sql}
			GROUP BY route_key, route_class, request_method
			ORDER BY MAX(captured_at) DESC
			LIMIT %d";

		if ( ! empty( $args ) ) {
			$sql = $wpdb->prepare( $sql, $args );
		}

		return $wpdb->get_results( $sql, ARRAY_A );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared
	}

	/**
	 * Get individual profiles for a specific route key.
	 *
	 * @param string $route_key  The normalized route key.
	 * @param int    $limit      Maximum profiles to return.
	 * @return array
	 */
	public static function get_profiles_for_route( $route_key, $limit = 50 ) {
		global $wpdb;

		$table = self::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, session_id, profile_type, request_url, request_method, route_class, route_key, duration_ns, captured_at, is_baseline, baseline_name FROM {$table} WHERE route_key = %s ORDER BY captured_at DESC LIMIT %d",
				$route_key,
				$limit
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * Upgrade the table schema to add new columns.
	 *
	 * Safe to call repeatedly — checks column existence before altering.
	 */
	public static function maybe_upgrade_table() {
		global $wpdb;

		$table = self::table_name();

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
	}
}
