<?php
/**
 * Profile retention and pruning.
 *
 * @package Scrutoscope
 */

namespace Scrutoscope\Profiler;

defined( 'ABSPATH' ) || exit;

/**
 * Retention policies for profile data.
 */
class Cleanup {

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
			$keep = (int) get_option( 'scrutoscope_max_per_route', 100 );
		}
		if ( $keep <= 0 ) {
			return 0; // Unlimited.
		}

		$table = Storage::table_name();

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

		$table   = Storage::table_name();
		$expired = 0;
		$trimmed = 0;

		// Step 1: Delete unpinned profiles older than retention_days.
		if ( $retention_days > 0 ) {
			$cutoff_date = gmdate( 'Y-m-d H:i:s', time() - ( $retention_days * DAY_IN_SECONDS ) );

			// Exempt shared profiles — their data is referenced by relay links.
			$shared_reports = get_option( 'scrutoscope_shared_reports', array() );
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
}
