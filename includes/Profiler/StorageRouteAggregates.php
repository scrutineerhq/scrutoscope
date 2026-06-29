<?php
/**
 * Long-term route-stats aggregate storage.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

defined( 'ABSPATH' ) || exit;

/**
 * Per-route duration histograms aggregated by day.
 */
class StorageRouteAggregates {

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
	 * Merge a fingerprint's daily histograms over a [from, to) day range.
	 *
	 * @param string      $fingerprint Route fingerprint.
	 * @param string      $from_day    Inclusive start day (Y-m-d).
	 * @param string|null $to_day      Exclusive end day (Y-m-d), or null for "up to now".
	 * @return array { @type int[] $histogram, @type int $sample_count }.
	 */
	private static function merge_stat_range( $fingerprint, $from_day, $to_day = null ) {
		global $wpdb;

		$table = self::route_stats_table();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared
		if ( null === $to_day ) {
			$sql = $wpdb->prepare( "SELECT histogram, sample_count FROM {$table} WHERE fingerprint = %s AND stat_day >= %s", $fingerprint, $from_day );
		} else {
			$sql = $wpdb->prepare( "SELECT histogram, sample_count FROM {$table} WHERE fingerprint = %s AND stat_day >= %s AND stat_day < %s", $fingerprint, $from_day, $to_day );
		}
		$rows = $wpdb->get_results( $sql, ARRAY_A );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared

		$histograms = array();
		$count      = 0;
		foreach ( (array) $rows as $r ) {
			$histograms[] = json_decode( $r['histogram'], true );
			$count       += (int) $r['sample_count'];
		}

		return array(
			'histogram'    => RouteStats::merge( $histograms ),
			'sample_count' => $count,
		);
	}

	/**
	 * Recent and baseline aggregate windows for a fingerprint.
	 *
	 * Recent = the last $recent_days. Baseline = the $baseline_days window ending
	 * $gap_days before the recent window starts (default: the period immediately
	 * before it — "this week vs last week", extending past the profile TTL).
	 *
	 * @param string $fingerprint   Route fingerprint.
	 * @param int    $recent_days   Recent window length in days.
	 * @param int    $baseline_days Baseline window length in days.
	 * @param int    $gap_days      Gap between the two windows.
	 * @return array { @type array $recent, @type array $baseline } (each histogram + count).
	 */
	public static function get_route_stat_windows( $fingerprint, $recent_days = 7, $baseline_days = 7, $gap_days = 0 ) {
		$recent_days   = max( 1, (int) $recent_days );
		$baseline_days = max( 1, (int) $baseline_days );
		$gap_days      = max( 0, (int) $gap_days );

		$now           = time();
		$recent_from   = gmdate( 'Y-m-d', $now - $recent_days * DAY_IN_SECONDS );
		$baseline_to   = gmdate( 'Y-m-d', $now - ( $recent_days + $gap_days ) * DAY_IN_SECONDS );
		$baseline_from = gmdate( 'Y-m-d', $now - ( $recent_days + $gap_days + $baseline_days ) * DAY_IN_SECONDS );

		return array(
			'recent'   => self::merge_stat_range( (string) $fingerprint, $recent_from, null ),
			'baseline' => self::merge_stat_range( (string) $fingerprint, $baseline_from, $baseline_to ),
		);
	}

	/**
	 * The aggregate fingerprint for a route key (from its most recent profile).
	 *
	 * @param string $route_key Route grouping key.
	 * @return string Fingerprint, or '' when the route has no profiles.
	 */
	public static function fingerprint_for_route_key( $route_key ) {
		global $wpdb;

		$table = Storage::table_name();

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$row = $wpdb->get_row(
			$wpdb->prepare( "SELECT route_class, user_role FROM {$table} WHERE route_key = %s ORDER BY captured_at DESC LIMIT 1", $route_key ),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		if ( ! $row ) {
			return '';
		}

		return Report::route_fingerprint(
			array(
				'route_class' => isset( $row['route_class'] ) ? $row['route_class'] : '',
				'user_role'   => isset( $row['user_role'] ) ? $row['user_role'] : 'anonymous',
			)
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
		$profiles_table = Storage::table_name();

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
	 * Delete route-stats daily buckets older than the retention window.
	 *
	 * The aggregate is tiny (a few dozen ints per fingerprint per day), so the
	 * default keeps a year of history — far longer than the raw-profile TTL,
	 * which is the whole point of the aggregate. Still pruned so the table
	 * can't grow without bound.
	 *
	 * @param int $keep_days Days of daily buckets to retain.
	 * @return int Rows deleted.
	 */
	public static function prune_route_stats( $keep_days = 365 ) {
		global $wpdb;

		$keep_days = max( 1, (int) $keep_days );
		$cutoff    = gmdate( 'Y-m-d', time() - $keep_days * DAY_IN_SECONDS );
		$table     = self::route_stats_table();

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.NoCaching
		return (int) $wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE stat_day < %s", $cutoff ) );
	}

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
	public static function normalize_route_key( $method, $url, $ajax_action = '' ) {
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
}
