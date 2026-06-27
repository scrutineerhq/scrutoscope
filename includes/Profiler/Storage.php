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
		self::create_route_stats_table();
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
	 * Strip query strings (and fragments) from every URL in a profile.
	 *
	 * The CONSTITUTION lists "Full HTTP URLs, query strings" under hard
	 * never-collect. Query strings routinely carry secrets — password-reset
	 * keys, auth tokens, nonces, outbound API keys — and PII such as search
	 * terms. We keep only scheme + host + path so the route and destination
	 * stay legible without persisting the sensitive tail.
	 *
	 * Applied at write time (here) so raw values never reach the database,
	 * complementing the read-time \Scrutinizer\Api\Sanitizer as
	 * defense-in-depth.
	 *
	 * @param array $profile_data Compiled report from Report::compile().
	 * @return array Sanitized profile data.
	 */
	public static function sanitize_profile( $profile_data ) {
		if ( ! is_array( $profile_data ) ) {
			return $profile_data;
		}

		if ( isset( $profile_data['request']['url'] ) ) {
			$profile_data['request']['url'] = self::strip_url_query( $profile_data['request']['url'] );
		}

		if ( isset( $profile_data['request']['referer'] ) ) {
			$profile_data['request']['referer'] = self::strip_url_query( $profile_data['request']['referer'] );
		}

		if ( ! empty( $profile_data['http_calls'] ) && is_array( $profile_data['http_calls'] ) ) {
			foreach ( $profile_data['http_calls'] as $i => $call ) {
				if ( isset( $call['url'] ) ) {
					// Outbound calls are reduced to scheme + host, not just the
					// query string. Webhook/bot endpoints embed secret tokens in
					// the PATH (e.g. hooks.slack.com/services/T../B../<token>,
					// api.telegram.org/bot<token>/...), which strip_url_query
					// would preserve. The destination host is enough for
					// attribution; the path never reaches storage or a share.
					$profile_data['http_calls'][ $i ]['url'] = self::strip_url_to_host( $call['url'] );
				}
			}
		}

		// Enqueued asset URLs carry query strings — cache-busting ?ver= values
		// and, for some commercial plugins/themes, license or API keys appended
		// as query args. Keep scheme+host+path so the asset stays identifiable,
		// drop the query.
		if ( ! empty( $profile_data['enqueued_assets'] ) && is_array( $profile_data['enqueued_assets'] ) ) {
			foreach ( array( 'scripts', 'styles' ) as $group ) {
				if ( empty( $profile_data['enqueued_assets'][ $group ] ) || ! is_array( $profile_data['enqueued_assets'][ $group ] ) ) {
					continue;
				}
				foreach ( $profile_data['enqueued_assets'][ $group ] as $i => $asset ) {
					if ( isset( $asset['src'] ) ) {
						$profile_data['enqueued_assets'][ $group ][ $i ]['src'] = self::strip_url_query( $asset['src'] );
					}
				}
			}
		}

		return $profile_data;
	}

	/**
	 * Reduce a URL to scheme + host (+ port), dropping path, query, and fragment.
	 *
	 * Used for outbound HTTP calls, whose paths commonly carry credentials.
	 *
	 * @param string $url URL to reduce.
	 * @return string Reduced URL, or '' when the input is empty/unparseable.
	 */
	private static function strip_url_to_host( $url ) {
		if ( ! is_string( $url ) || '' === $url ) {
			return '';
		}

		$parts = wp_parse_url( $url );

		if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
			return '';
		}

		$scheme = isset( $parts['scheme'] ) ? $parts['scheme'] . '://' : '';
		$port   = isset( $parts['port'] ) ? ':' . $parts['port'] : '';

		return $scheme . $parts['host'] . $port;
	}

	/**
	 * Reduce a URL to scheme + host + path, dropping query string and fragment.
	 *
	 * @param string $url URL to reduce.
	 * @return string Reduced URL, or '' when the input is empty.
	 */
	private static function strip_url_query( $url ) {
		if ( ! is_string( $url ) || '' === $url ) {
			return '';
		}

		$parts = wp_parse_url( $url );

		// Unparseable — truncate at the first '?' as a conservative fallback.
		if ( ! is_array( $parts ) || empty( $parts ) ) {
			$pos = strpos( $url, '?' );
			return ( false === $pos ) ? $url : substr( $url, 0, $pos );
		}

		$scheme = isset( $parts['scheme'] ) ? $parts['scheme'] . '://' : '';
		$host   = isset( $parts['host'] ) ? $parts['host'] : '';
		$port   = isset( $parts['port'] ) ? ':' . $parts['port'] : '';
		$path   = isset( $parts['path'] ) ? $parts['path'] : '';

		return $scheme . $host . $port . $path;
	}

	/**
	 * Save a profile.
	 *
	 * @param string $session_id     Session identifier (empty for background).
	 * @param array  $profile_data   Compiled profile data.
	 * @param string $profile_type   'session' or 'background'.
	 * @param int    $response_status HTTP response status code (0 if unknown).
	 * @return int|false  Inserted row ID or false on failure.
	 */
	public static function save_profile( $session_id, $profile_data, $profile_type = 'session', $response_status = 0 ) {
		global $wpdb;

		// Strip query strings from URLs before anything is persisted. The
		// CONSTITUTION lists "Full HTTP URLs, query strings" under hard
		// never-collect, so the sensitive tail must never reach the database.
		$profile_data = self::sanitize_profile( $profile_data );

		$url         = isset( $profile_data['request']['url'] ) ? $profile_data['request']['url'] : '';
		$method      = isset( $profile_data['request']['method'] ) ? $profile_data['request']['method'] : 'GET';
		$route       = isset( $profile_data['request']['route_class'] ) ? $profile_data['request']['route_class'] : '';
		$dur_ns      = isset( $profile_data['summary']['duration_ns'] ) ? $profile_data['summary']['duration_ns'] : 0;
		$role        = isset( $profile_data['request']['user_role'] ) ? $profile_data['request']['user_role'] : 'anonymous';
		$ajax_action = isset( $profile_data['request']['ajax_action'] ) ? $profile_data['request']['ajax_action'] : '';

		// Normalize URL to a grouping key: method + path (no query string, no host).
		// AJAX requests get action-specific keys: POST:ajax:heartbeat.
		$route_key   = self::normalize_route_key( $method, $url, $ajax_action );
		$captured_at = current_time( 'mysql' );

		$insert_data   = array(
			'session_id'     => $session_id,
			'profile_type'   => $profile_type,
			'request_url'    => $url,
			'request_method' => $method,
			'route_class'    => $route,
			'route_key'      => $route_key,
			'duration_ns'    => $dur_ns,
			'user_role'      => $role,
			'profile_data'   => gzcompress( wp_json_encode( $profile_data ) ),
			'captured_at'    => $captured_at,
		);
		$insert_format = array( '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s' );

		if ( $response_status > 0 ) {
			$insert_data['response_status'] = (int) $response_status;
			$insert_format[]                = '%d';
		}

		$result = $wpdb->insert(
			self::table_name(),
			$insert_data,
			$insert_format
		);

		if ( false === $result ) {
			return false;
		}

		$insert_id = (int) $wpdb->insert_id;

		// Record into the long-term route-stats aggregate so the statistical
		// history survives after the raw profile rolls off (TTL). Best-effort:
		// a stats failure must never lose the profile.
		try {
			$request     = isset( $profile_data['request'] ) && is_array( $profile_data['request'] ) ? $profile_data['request'] : array();
			$fingerprint = Report::route_fingerprint( $request );
			self::record_route_stat( $fingerprint, $captured_at, (int) $dur_ns );
		} catch ( \Throwable $e ) {
			// Secondary signal; swallow so profile saving is unaffected.
			unset( $e );
		}

		// Auto-prune old unpinned profiles for this route.
		self::auto_prune( $route_key );

		return $insert_id;
	}

	/**
	 * Table holding the long-term per-route duration aggregate.
	 *
	 * @return string
	 */
	public static function route_stats_table() {
		global $wpdb;
		return $wpdb->prefix . 'scrutinizer_route_stats';
	}

	/**
	 * Create the route-stats aggregate table (idempotent via dbDelta).
	 */
	public static function create_route_stats_table() {
		global $wpdb;

		$table   = self::route_stats_table();
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			fingerprint varchar(191) NOT NULL,
			stat_day date NOT NULL,
			histogram text NOT NULL,
			sample_count int unsigned NOT NULL DEFAULT 0,
			updated_at datetime NOT NULL DEFAULT '0000-00-00 00:00:00',
			PRIMARY KEY  (fingerprint, stat_day)
		) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Record one duration sample into the (fingerprint, day) histogram.
	 *
	 * Read-modify-write: concurrent saves to the same bucket can rarely lose an
	 * increment, which is acceptable for an aggregate trend signal.
	 *
	 * @param string $fingerprint Route fingerprint (Report::route_fingerprint()).
	 * @param string $captured_at MySQL datetime the profile was captured.
	 * @param int    $duration_ns Server request duration in nanoseconds.
	 * @return void
	 */
	public static function record_route_stat( $fingerprint, $captured_at, $duration_ns ) {
		global $wpdb;

		$fingerprint = (string) $fingerprint;
		if ( '' === $fingerprint ) {
			return;
		}

		$day = substr( (string) $captured_at, 0, 10 );
		if ( '' === $day || '0000-00-00' === $day ) {
			$day = gmdate( 'Y-m-d' );
		}

		$table = self::route_stats_table();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$row = $wpdb->get_row(
			$wpdb->prepare( "SELECT histogram, sample_count FROM {$table} WHERE fingerprint = %s AND stat_day = %s", $fingerprint, $day ),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		$histogram = $row ? json_decode( $row['histogram'], true ) : RouteStats::empty_histogram();
		$histogram = RouteStats::add( $histogram, $duration_ns );
		$count     = ( $row ? (int) $row['sample_count'] : 0 ) + 1;
		$now       = current_time( 'mysql' );

		if ( $row ) {
			$wpdb->update(
				$table,
				array(
					'histogram'    => wp_json_encode( $histogram ),
					'sample_count' => $count,
					'updated_at'   => $now,
				),
				array(
					'fingerprint' => $fingerprint,
					'stat_day'    => $day,
				),
				array( '%s', '%d', '%s' ),
				array( '%s', '%s' )
			);
		} else {
			$wpdb->insert(
				$table,
				array(
					'fingerprint'  => $fingerprint,
					'stat_day'     => $day,
					'histogram'    => wp_json_encode( $histogram ),
					'sample_count' => $count,
					'updated_at'   => $now,
				),
				array( '%s', '%s', '%s', '%d', '%s' )
			);
		}
	}

	/**
	 * Merge a route's daily histograms over a recent window.
	 *
	 * @param string $fingerprint Route fingerprint.
	 * @param int    $days        Look-back window in days.
	 * @return array { @type int[] $histogram, @type int $sample_count, @type int $days }.
	 */
	public static function get_route_stat_window( $fingerprint, $days = 30 ) {
		global $wpdb;

		$fingerprint = (string) $fingerprint;
		$days        = max( 1, (int) $days );
		$from        = gmdate( 'Y-m-d', time() - $days * DAY_IN_SECONDS );
		$table       = self::route_stats_table();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_results(
			$wpdb->prepare( "SELECT histogram, sample_count FROM {$table} WHERE fingerprint = %s AND stat_day >= %s", $fingerprint, $from ),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		$histograms = array();
		$count      = 0;
		foreach ( (array) $rows as $r ) {
			$histograms[] = json_decode( $r['histogram'], true );
			$count       += (int) $r['sample_count'];
		}

		return array(
			'histogram'    => RouteStats::merge( $histograms ),
			'sample_count' => $count,
			'days'         => count( (array) $rows ),
		);
	}

	/**
	 * Rebuild the route-stats aggregate from all stored profiles.
	 *
	 * Accumulates in memory keyed by (fingerprint, day) and writes one row per
	 * bucket, so a full backfill is a handful of writes rather than two queries
	 * per profile.
	 *
	 * @return int Number of profiles folded in.
	 */
	public static function rebuild_route_stats() {
		global $wpdb;

		$stats_table    = self::route_stats_table();
		$profiles_table = self::table_name();

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.SchemaChange, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( "TRUNCATE TABLE {$stats_table}" );

		$acc    = array();
		$total  = 0;
		$offset = 0;
		$batch  = 1000;

		while ( true ) {
			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$rows = $wpdb->get_results(
				$wpdb->prepare( "SELECT route_class, user_role, duration_ns, captured_at FROM {$profiles_table} ORDER BY id ASC LIMIT %d OFFSET %d", $batch, $offset ),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

			if ( empty( $rows ) ) {
				break;
			}

			foreach ( $rows as $r ) {
				$fingerprint = Report::route_fingerprint(
					array(
						'route_class' => isset( $r['route_class'] ) ? $r['route_class'] : '',
						'user_role'   => isset( $r['user_role'] ) ? $r['user_role'] : 'anonymous',
					)
				);
				$day         = substr( (string) $r['captured_at'], 0, 10 );
				if ( '' === $day || '0000-00-00' === $day ) {
					continue;
				}
				$key = $fingerprint . '|' . $day;
				if ( ! isset( $acc[ $key ] ) ) {
					$acc[ $key ] = array(
						'fingerprint' => $fingerprint,
						'day'         => $day,
						'histogram'   => RouteStats::empty_histogram(),
						'count'       => 0,
					);
				}
				$acc[ $key ]['histogram'] = RouteStats::add( $acc[ $key ]['histogram'], (int) $r['duration_ns'] );
				++$acc[ $key ]['count'];
				++$total;
			}

			$offset += $batch;
		}

		$now = current_time( 'mysql' );
		foreach ( $acc as $bucket ) {
			$wpdb->insert(
				$stats_table,
				array(
					'fingerprint'  => $bucket['fingerprint'],
					'stat_day'     => $bucket['day'],
					'histogram'    => wp_json_encode( $bucket['histogram'] ),
					'sample_count' => $bucket['count'],
					'updated_at'   => $now,
				),
				array( '%s', '%s', '%s', '%d', '%s' )
			);
		}

		return $total;
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
	/**
	 * Normalize a URL into a route grouping key.
	 *
	 * For admin-ajax.php requests, the AJAX action is appended so profiles
	 * group by action: POST:ajax:heartbeat instead of one blob.
	 *
	 * @param string $method       HTTP method.
	 * @param string $url          Full request URL.
	 * @param string $ajax_action  AJAX action name (empty for non-AJAX).
	 * @return string
	 */
	private static function normalize_route_key( $method, $url, $ajax_action = '' ) {
		$path = wp_parse_url( $url, PHP_URL_PATH );
		if ( empty( $path ) ) {
			$path = '/';
		}
		// Collapse trailing slashes.
		$path = rtrim( $path, '/' );
		if ( '' === $path ) {
			$path = '/';
		}

		// Group AJAX calls by action instead of the generic admin-ajax.php path.
		if ( ! empty( $ajax_action ) && false !== strpos( $path, 'admin-ajax.php' ) ) {
			return strtoupper( $method ) . ':ajax:' . $ajax_action;
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
				"SELECT id, session_id, request_url, request_method, route_class, duration_ns, user_role, captured_at, is_pinned, note, tags FROM {$table} WHERE session_id = %s ORDER BY captured_at DESC",
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

		$row['profile_data'] = self::decode_profile_data( $row['profile_data'] );

		return $row;
	}

	/**
	 * Decode profile_data from storage.
	 *
	 * Handles both gzip-compressed (LONGBLOB) and legacy uncompressed JSON (LONGTEXT).
	 *
	 * @param string $raw  Raw profile_data from the database.
	 * @return array|null
	 */
	private static function decode_profile_data( $raw ) {
		if ( empty( $raw ) ) {
			return null;
		}

		// Try gzip decompression first (new format). Legacy rows are stored
		// uncompressed, so gzuncompress() emits a warning and returns false on
		// them; the silence is intentional and the false-return fallback below
		// handles that case cleanly.
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		$json = @gzuncompress( $raw );

		if ( false === $json ) {
			// Fallback: legacy uncompressed JSON.
			$json = $raw;
		}

		return json_decode( $json, true );
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
	 * Delete multiple profiles in a single query.
	 *
	 * @param int[] $ids  Array of profile IDs.
	 * @return int|false  Number of rows deleted, or false on error.
	 */
	public static function delete_profiles_bulk( $ids ) {
		global $wpdb;

		$ids = array_map( 'absint', $ids );
		$ids = array_filter( $ids );

		if ( empty( $ids ) ) {
			return 0;
		}

		$table        = self::table_name();
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		$sql = $wpdb->prepare( "DELETE FROM {$table} WHERE id IN ({$placeholders})", $ids );

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->query( $sql );
	}

	/**
	 * Pin a profile and optionally set a note and tags.
	 *
	 * @param int    $profile_id  Profile row ID.
	 * @param string $note        Optional annotation.
	 * @param string $tags        Optional comma-separated tags.
	 * @return bool
	 */
	public static function pin_profile( $profile_id, $note = '', $tags = '' ) {
		global $wpdb;

		$data   = array( 'is_pinned' => 1 );
		$format = array( '%d' );

		if ( '' !== $note ) {
			$data['note'] = $note;
			$format[]     = '%s';
		}
		if ( '' !== $tags ) {
			$data['tags'] = $tags;
			$format[]     = '%s';
		}

		$result = $wpdb->update(
			self::table_name(),
			$data,
			array( 'id' => $profile_id ),
			$format,
			array( '%d' )
		);

		return ( false !== $result );
	}

	/**
	 * Pin multiple profiles in a single query.
	 *
	 * @param int[] $ids  Array of profile IDs.
	 * @return int|false  Number of rows updated, or false on error.
	 */
	public static function pin_profiles_bulk( $ids ) {
		global $wpdb;

		$ids = array_map( 'absint', $ids );
		$ids = array_filter( $ids );

		if ( empty( $ids ) ) {
			return 0;
		}

		$table        = self::table_name();
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		$sql = $wpdb->prepare( "UPDATE {$table} SET is_pinned = 1 WHERE id IN ({$placeholders})", $ids );

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->query( $sql );
	}

	/**
	 * Unpin a profile.
	 *
	 * @param int $profile_id  Profile row ID.
	 * @return bool
	 */
	public static function unpin_profile( $profile_id ) {
		global $wpdb;

		$result = $wpdb->update(
			self::table_name(),
			array( 'is_pinned' => 0 ),
			array( 'id' => $profile_id ),
			array( '%d' ),
			array( '%d' )
		);

		return ( false !== $result );
	}

	/**
	 * Unpin multiple profiles in a single query.
	 *
	 * @param int[] $ids  Array of profile IDs.
	 * @return int|false  Number of rows updated, or false on error.
	 */
	public static function unpin_profiles_bulk( $ids ) {
		global $wpdb;

		$ids = array_map( 'absint', $ids );
		$ids = array_filter( $ids );

		if ( empty( $ids ) ) {
			return 0;
		}

		$table        = self::table_name();
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		$sql = $wpdb->prepare( "UPDATE {$table} SET is_pinned = 0 WHERE id IN ({$placeholders})", $ids );

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->query( $sql );
	}

	/**
	 * Update the note and tags on a profile.
	 *
	 * @param int    $profile_id  Profile row ID.
	 * @param string $note        Annotation text.
	 * @param string $tags        Comma-separated tags.
	 * @return bool
	 */
	public static function update_annotation( $profile_id, $note, $tags ) {
		global $wpdb;

		$result = $wpdb->update(
			self::table_name(),
			array(
				'note' => $note,
				'tags' => $tags,
			),
			array( 'id' => $profile_id ),
			array( '%s', '%s' ),
			array( '%d' )
		);

		return ( false !== $result );
	}

	/**
	 * Auto-prune unpinned profiles for a route, keeping the most recent N.
	 *
	 * Uses the configurable retention max-per-route option.
	 *
	 * @param string $route_key  Normalized route key.
	 * @param int    $keep       Number of unpinned profiles to keep per route (0 = use option).
	 * @return int  Number of profiles deleted.
	 */
	public static function auto_prune( $route_key, $keep = 0 ) {
		global $wpdb;

		if ( 0 === $keep ) {
			$keep = (int) get_option( 'scrutinizer_max_per_route', 100 );
		}
		if ( $keep <= 0 ) {
			return 0; // Unlimited.
		}

		$table = self::table_name();

		// Count unpinned profiles for this route.
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$count = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$table} WHERE route_key = %s AND is_pinned = 0",
				$route_key
			)
		);

		if ( $count <= $keep ) {
			return 0;
		}

		// Find the ID threshold: keep the most recent $keep unpinned rows.
		$cutoff_id = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT id FROM {$table} WHERE route_key = %s AND is_pinned = 0 ORDER BY captured_at DESC, id DESC LIMIT 1 OFFSET %d",
				$route_key,
				$keep
			)
		);

		if ( ! $cutoff_id ) {
			return 0;
		}

		$deleted = (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE route_key = %s AND is_pinned = 0 AND id <= %d",
				$route_key,
				$cutoff_id
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return $deleted;
	}

	/**
	 * Clean up profiles based on retention policy.
	 *
	 * Deletes unpinned profiles older than $retention_days and trims
	 * to $max_per_route per route key. Pinned profiles are always kept.
	 *
	 * @param int $retention_days  Delete profiles older than this many days (0 = no age limit).
	 * @param int $max_per_route   Keep at most this many unpinned profiles per route (0 = unlimited).
	 * @return array{expired: int, trimmed: int}
	 */
	public static function cleanup_profiles( $retention_days = 0, $max_per_route = 0 ) {
		global $wpdb;

		$table   = self::table_name();
		$expired = 0;
		$trimmed = 0;

		// Step 1: Delete unpinned profiles older than retention_days.
		if ( $retention_days > 0 ) {
			$cutoff_date = gmdate( 'Y-m-d H:i:s', time() - ( $retention_days * DAY_IN_SECONDS ) );

			// Exempt shared profiles — their data is referenced by relay links.
			$shared_reports = get_option( 'scrutinizer_shared_reports', array() );
			$shared_ids     = array_filter(
				array_map(
					function ( $r ) {
						return isset( $r['profile_id'] ) ? (int) $r['profile_id'] : 0;
					},
					$shared_reports
				)
			);

			$exclude_sql = '';
			if ( ! empty( $shared_ids ) ) {
				$placeholders = implode( ',', array_fill( 0, count( $shared_ids ), '%d' ) );
				// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber,WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
				$exclude_sql = $wpdb->prepare( " AND id NOT IN ({$placeholders})", $shared_ids );
				// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber,WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
			}

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$expired = (int) $wpdb->query(
				$wpdb->prepare(
					"DELETE FROM {$table} WHERE is_pinned = 0 AND captured_at < %s",
					$cutoff_date
				) . $exclude_sql
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		}

		// Step 2: Trim per-route excess.
		if ( $max_per_route > 0 ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$routes = $wpdb->get_col( "SELECT DISTINCT route_key FROM {$table}" );

			if ( is_array( $routes ) ) {
				foreach ( $routes as $route_key ) {
					$trimmed += self::auto_prune( $route_key, $max_per_route );
				}
			}
		}

		return array(
			'expired' => $expired,
			'trimmed' => $trimmed,
		);
	}

	/**
	 * Get pinned profiles.
	 *
	 * @param int $limit  Maximum number of profiles to return.
	 * @return array
	 */
	public static function get_pinned_profiles( $limit = 50 ) {
		global $wpdb;

		$table = self::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, session_id, profile_type, request_url, request_method, route_class, route_key, duration_ns, user_role, captured_at, is_pinned, note, tags FROM {$table} WHERE is_pinned = 1 ORDER BY captured_at DESC LIMIT %d",
				$limit
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * Search profiles with flexible filtering.
	 *
	 * @param array $args {
	 *     Optional. Search arguments.
	 *     @type string $route_key    Filter by route key.
	 *     @type string $tag          Filter by tag (partial match within comma-separated tags).
	 *     @type bool   $pinned_only  Only return pinned profiles.
	 *     @type string $date_from    Filter from date (Y-m-d).
	 *     @type string $date_to      Filter to date (Y-m-d).
	 *     @type int    $limit        Maximum results.
	 * }
	 * @return array
	 */
	public static function search_profiles( $args = array() ) {
		global $wpdb;

		$table = self::table_name();
		$where = array( '1=1' );
		$vals  = array();

		if ( ! empty( $args['route_key'] ) ) {
			$where[] = 'route_key = %s';
			$vals[]  = $args['route_key'];
		}

		if ( ! empty( $args['route_class'] ) ) {
			$where[] = 'route_class = %s';
			$vals[]  = $args['route_class'];
		}

		if ( ! empty( $args['tag'] ) ) {
			$where[] = 'tags LIKE %s';
			$vals[]  = '%' . $wpdb->esc_like( $args['tag'] ) . '%';
		}

		if ( ! empty( $args['pinned_only'] ) ) {
			$where[] = 'is_pinned = 1';
		}

		if ( ! empty( $args['date_from'] ) ) {
			$where[] = 'captured_at >= %s';
			$vals[]  = $args['date_from'] . ' 00:00:00';
		}

		if ( ! empty( $args['date_to'] ) ) {
			$where[] = 'captured_at <= %s';
			$vals[]  = $args['date_to'] . ' 23:59:59';
		}

		$where_sql = implode( ' AND ', $where );
		$per_page  = isset( $args['per_page'] ) ? absint( $args['per_page'] ) : 0;
		$page      = isset( $args['page'] ) ? max( 1, absint( $args['page'] ) ) : 0;

		// When page is requested, return paginated result with total count.
		if ( $page > 0 && $per_page > 0 ) {
			// Count total matching rows.
			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared
			$count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}";
			if ( ! empty( $vals ) ) {
				$count_sql = $wpdb->prepare( $count_sql, $vals );
			}
			$total = (int) $wpdb->get_var( $count_sql );

			$offset     = ( $page - 1 ) * $per_page;
			$query_vals = array_merge( $vals, array( $per_page, $offset ) );

			$sql = "SELECT id, session_id, profile_type, request_url, request_method, route_class, route_key, duration_ns, user_role, captured_at, is_pinned, note, tags
				FROM {$table}
				WHERE {$where_sql}
				ORDER BY captured_at DESC
				LIMIT %d OFFSET %d";

			$sql = $wpdb->prepare( $sql, $query_vals );

			$profiles = $wpdb->get_results( $sql, ARRAY_A );
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared

			return array(
				'profiles' => $profiles,
				'total'    => $total,
				'page'     => $page,
				'pages'    => (int) ceil( $total / $per_page ),
			);
		}

		// Legacy non-paginated path.
		$limit  = isset( $args['limit'] ) ? absint( $args['limit'] ) : 100;
		$vals[] = $limit;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared
		$sql = "SELECT id, session_id, profile_type, request_url, request_method, route_class, route_key, duration_ns, user_role, captured_at, is_pinned, note, tags
			FROM {$table}
			WHERE {$where_sql}
			ORDER BY captured_at DESC
			LIMIT %d";

		if ( ! empty( $vals ) ) {
			$sql = $wpdb->prepare( $sql, $vals );
		}

		return $wpdb->get_results( $sql, ARRAY_A );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared
	}

	/**
	 * Load two profiles and compute comparison deltas.
	 *
	 * @param int $id_a  First profile ID.
	 * @param int $id_b  Second profile ID.
	 * @return array|null  Comparison data or null if either profile not found.
	 */
	public static function get_comparison( $id_a, $id_b ) {
		$a = self::get_profile( $id_a );
		$b = self::get_profile( $id_b );

		if ( null === $a || null === $b ) {
			return null;
		}

		$sum_a = isset( $a['profile_data']['summary'] ) ? $a['profile_data']['summary'] : array();
		$sum_b = isset( $b['profile_data']['summary'] ) ? $b['profile_data']['summary'] : array();

		$dur_a = isset( $sum_a['duration_ns'] ) ? (int) $sum_a['duration_ns'] : 0;
		$dur_b = isset( $sum_b['duration_ns'] ) ? (int) $sum_b['duration_ns'] : 0;

		$qc_a = isset( $sum_a['query_count'] ) ? (int) $sum_a['query_count'] : 0;
		$qc_b = isset( $sum_b['query_count'] ) ? (int) $sum_b['query_count'] : 0;

		$mem_peak_a  = isset( $sum_a['memory_peak'] ) ? (int) $sum_a['memory_peak'] : 0;
		$mem_peak_b  = isset( $sum_b['memory_peak'] ) ? (int) $sum_b['memory_peak'] : 0;
		$mem_alloc_a = isset( $sum_a['memory_allocated'] ) ? (int) $sum_a['memory_allocated'] : 0;
		$mem_alloc_b = isset( $sum_b['memory_allocated'] ) ? (int) $sum_b['memory_allocated'] : 0;

		// Fallback for older profiles that stored memory_peak in request.
		if ( 0 === $mem_peak_a ) {
			$req_a      = isset( $a['profile_data']['request'] ) ? $a['profile_data']['request'] : array();
			$mem_peak_a = isset( $req_a['memory_peak'] ) ? (int) $req_a['memory_peak'] : 0;
		}
		if ( 0 === $mem_peak_b ) {
			$req_b      = isset( $b['profile_data']['request'] ) ? $b['profile_data']['request'] : array();
			$mem_peak_b = isset( $req_b['memory_peak'] ) ? (int) $req_b['memory_peak'] : 0;
		}

		// Build per-source breakdown comparison.
		$sources_a = self::index_sources( isset( $a['profile_data']['sources'] ) ? $a['profile_data']['sources'] : array() );
		$sources_b = self::index_sources( isset( $b['profile_data']['sources'] ) ? $b['profile_data']['sources'] : array() );

		$all_keys      = array_unique( array_merge( array_keys( $sources_a ), array_keys( $sources_b ) ) );
		$source_deltas = array();
		foreach ( $all_keys as $key ) {
			$ea                    = isset( $sources_a[ $key ] ) ? (int) $sources_a[ $key ]['exclusive_ns'] : 0;
			$eb                    = isset( $sources_b[ $key ] ) ? (int) $sources_b[ $key ]['exclusive_ns'] : 0;
			$ma                    = isset( $sources_a[ $key ] ) ? (int) $sources_a[ $key ]['memory_delta'] : 0;
			$mb                    = isset( $sources_b[ $key ] ) ? (int) $sources_b[ $key ]['memory_delta'] : 0;
			$source_deltas[ $key ] = array(
				'a_ns'      => $ea,
				'b_ns'      => $eb,
				'delta_ns'  => $eb - $ea,
				'a_mem'     => $ma,
				'b_mem'     => $mb,
				'delta_mem' => $mb - $ma,
			);
		}

		// Compute unattributed time.
		$total_excl_a = isset( $sum_a['total_exclusive_ns'] ) ? (int) $sum_a['total_exclusive_ns'] : 0;
		$total_excl_b = isset( $sum_b['total_exclusive_ns'] ) ? (int) $sum_b['total_exclusive_ns'] : 0;
		$unattr_a     = $dur_a - $total_excl_a;
		$unattr_b     = $dur_b - $total_excl_b;

		// Compute callback count.
		$cb_a = isset( $sum_a['callback_count'] ) ? (int) $sum_a['callback_count'] : 0;
		$cb_b = isset( $sum_b['callback_count'] ) ? (int) $sum_b['callback_count'] : 0;

		// HTTP call counts.
		$http_a = isset( $a['profile_data']['http_calls'] ) ? count( $a['profile_data']['http_calls'] ) : 0;
		$http_b = isset( $b['profile_data']['http_calls'] ) ? count( $b['profile_data']['http_calls'] ) : 0;

		// Compute query time totals.
		$qt_a = self::sum_query_time( isset( $a['profile_data']['queries'] ) ? $a['profile_data']['queries'] : array() );
		$qt_b = self::sum_query_time( isset( $b['profile_data']['queries'] ) ? $b['profile_data']['queries'] : array() );

		return array(
			'a'     => $a,
			'b'     => $b,
			'delta' => array(
				'duration_ns'           => $dur_b - $dur_a,
				'duration_a_ns'         => $dur_a,
				'duration_b_ns'         => $dur_b,
				'query_count_a'         => $qc_a,
				'query_count_b'         => $qc_b,
				'query_count_delta'     => $qc_b - $qc_a,
				'query_time_a_ms'       => $qt_a,
				'query_time_b_ms'       => $qt_b,
				'query_time_delta_ms'   => $qt_b - $qt_a,
				'memory_peak_a'         => $mem_peak_a,
				'memory_peak_b'         => $mem_peak_b,
				'memory_peak_delta'     => $mem_peak_b - $mem_peak_a,
				'memory_alloc_a'        => $mem_alloc_a,
				'memory_alloc_b'        => $mem_alloc_b,
				'memory_alloc_delta'    => $mem_alloc_b - $mem_alloc_a,
				'unattributed_a_ns'     => $unattr_a,
				'unattributed_b_ns'     => $unattr_b,
				'unattributed_delta_ns' => $unattr_b - $unattr_a,
				'callback_count_a'      => $cb_a,
				'callback_count_b'      => $cb_b,
				'callback_count_delta'  => $cb_b - $cb_a,
				'http_count_a'          => $http_a,
				'http_count_b'          => $http_b,
				'http_count_delta'      => $http_b - $http_a,
				'sources'               => $source_deltas,
			),
		);
	}

	/**
	 * Index sources array by slug for comparison.
	 *
	 * @param array $sources  Sources array from profile data.
	 * @return array  Keyed by "type:slug".
	 */
	private static function index_sources( $sources ) {
		$indexed = array();
		foreach ( $sources as $src ) {
			$key             = ( isset( $src['type'] ) ? $src['type'] : 'unknown' ) . ':' . ( isset( $src['slug'] ) ? $src['slug'] : '' );
			$indexed[ $key ] = $src;
		}
		return $indexed;
	}

	/**
	 * Sum query time in milliseconds.
	 *
	 * @param array $queries  Queries array from profile data.
	 * @return float
	 */
	private static function sum_query_time( $queries ) {
		$total = 0.0;
		foreach ( $queries as $q ) {
			if ( isset( $q['time_ms'] ) ) {
				$total += (float) $q['time_ms'];
			}
		}
		return round( $total, 2 );
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
				"SELECT id, session_id, request_url, request_method, route_class, duration_ns, user_role, captured_at, is_pinned, note, tags FROM {$table} ORDER BY captured_at DESC LIMIT %d",
				$limit
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * Get profiles grouped by route key.
	 *
	 * Returns one row per unique route_key with aggregate stats.
	 *
	 * @param string $profile_type    Filter by profile type ('session', 'background', or '' for all).
	 * @param string $session_id      Filter by session ID (empty for all).
	 * @param int    $limit           Maximum groups to return.
	 * @param string $status_filter   Response status filter: '2xx', '4xx', or '' for all.
	 * @return array
	 */
	public static function get_profiles_grouped( $profile_type = '', $session_id = '', $limit = 100, $status_filter = '' ) {
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
				GROUP_CONCAT(DISTINCT profile_type) AS profile_types,
				SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END) AS count_2xx,
				SUM(CASE WHEN response_status >= 300 AND response_status < 400 THEN 1 ELSE 0 END) AS count_3xx,
				SUM(CASE WHEN response_status >= 400 AND response_status < 500 THEN 1 ELSE 0 END) AS count_4xx,
				SUM(CASE WHEN response_status >= 500 THEN 1 ELSE 0 END) AS count_5xx,
				COUNT(*) AS count_total
			FROM {$table}
			WHERE {$where_sql}
			GROUP BY route_key, route_class, request_method
			ORDER BY MAX(captured_at) DESC
			LIMIT %d";

		if ( ! empty( $args ) ) {
			$sql = $wpdb->prepare( $sql, $args );
		}

		$results = $wpdb->get_results( $sql, ARRAY_A );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared

		// Apply status filter in PHP since it operates on aggregates.
		if ( ! empty( $status_filter ) && is_array( $results ) ) {
			$results = array_values(
				array_filter(
					$results,
					function ( $row ) use ( $status_filter ) {
						if ( '2xx' === $status_filter ) {
							return (int) $row['count_2xx'] > 0;
						}
						if ( '4xx' === $status_filter ) {
							return 0 === (int) $row['count_2xx'] && (int) $row['count_4xx'] > 0;
						}
						return true;
					}
				)
			);
		}

		return is_array( $results ) ? $results : array();
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
				"SELECT id, session_id, profile_type, request_url, request_method, route_class, route_key, duration_ns, user_role, captured_at, is_pinned, note, tags FROM {$table} WHERE route_key = %s ORDER BY captured_at DESC LIMIT %d",
				$route_key,
				$limit
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * Pull recent profiles for a route split into a current window and an older
	 * baseline window, as lightweight pseudo-profiles ready for
	 * Report::compare_route().
	 *
	 * Only the columns the route fingerprint and classifier need are read
	 * (route_class, user_role, duration_ns) — the heavy profile_data blob is
	 * never decoded, so this stays cheap to call on demand.
	 *
	 * @param string $route_key      Route grouping key.
	 * @param int    $current_limit  Size of the recent window (newest rows).
	 * @param int    $baseline_limit Size of the older baseline window.
	 * @return array{current: array<int, array>, baseline: array<int, array>}
	 */
	public static function get_route_comparison_samples( $route_key, $current_limit = 10, $baseline_limit = 10 ) {
		global $wpdb;

		$current_limit  = max( 0, (int) $current_limit );
		$baseline_limit = max( 0, (int) $baseline_limit );
		$total          = $current_limit + $baseline_limit;
		$empty          = array(
			'current'  => array(),
			'baseline' => array(),
		);

		if ( '' === (string) $route_key || $total <= 0 ) {
			return $empty;
		}

		$table = self::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT route_class, user_role, duration_ns FROM {$table} WHERE route_key = %s ORDER BY captured_at DESC LIMIT %d",
				$route_key,
				$total
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		if ( ! is_array( $rows ) ) {
			return $empty;
		}

		$profiles = array_map(
			function ( $row ) {
				return array(
					'request' => array(
						'route_class' => isset( $row['route_class'] ) ? $row['route_class'] : '',
						'user_role'   => isset( $row['user_role'] ) ? $row['user_role'] : 'anonymous',
					),
					'summary' => array(
						'duration_ns' => isset( $row['duration_ns'] ) ? (int) $row['duration_ns'] : 0,
					),
				);
			},
			$rows
		);

		// Rows are newest-first: the recent window is the head, the baseline is
		// the older tail.
		return array(
			'current'  => array_slice( $profiles, 0, $current_limit ),
			'baseline' => array_slice( $profiles, $current_limit, $baseline_limit ),
		);
	}

	/**
	 * Delete all profiles, optionally keeping pinned ones.
	 *
	 * @param bool $keep_pinned  Whether to preserve pinned profiles.
	 * @return int  Number of rows deleted.
	 */
	public static function delete_all_profiles( $keep_pinned = false ) {
		global $wpdb;

		$table = self::table_name();

		if ( $keep_pinned ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			return (int) $wpdb->query( "DELETE FROM {$table} WHERE is_pinned = 0" );
		}

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (int) $wpdb->query( "DELETE FROM {$table}" );
	}

	/**
	 * Get table statistics.
	 *
	 * @return array{rows: int, route_count: int, pinned_count: int, oldest: string|null, size_bytes: int}
	 */
	public static function get_table_stats() {
		global $wpdb;

		$table = self::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$stats = $wpdb->get_row(
			"SELECT
				COUNT(*) AS total_rows,
				COUNT(DISTINCT route_key) AS route_count,
				SUM(CASE WHEN is_pinned = 1 THEN 1 ELSE 0 END) AS pinned_count,
				MIN(captured_at) AS oldest
			FROM {$table}",
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$size = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT data_length + index_length AS size_bytes FROM information_schema.TABLES WHERE table_schema = %s AND table_name = %s',
				DB_NAME,
				$table
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array(
			'rows'         => isset( $stats['total_rows'] ) ? (int) $stats['total_rows'] : 0,
			'route_count'  => isset( $stats['route_count'] ) ? (int) $stats['route_count'] : 0,
			'pinned_count' => isset( $stats['pinned_count'] ) ? (int) $stats['pinned_count'] : 0,
			'oldest'       => isset( $stats['oldest'] ) ? $stats['oldest'] : null,
			'size_bytes'   => isset( $size['size_bytes'] ) ? (int) $size['size_bytes'] : 0,
		);
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
		self::create_route_stats_table();
	}
}
