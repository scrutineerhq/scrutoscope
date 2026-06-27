<?php
/**
 * Mergeable duration histogram for long-term route statistics.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

/**
 * A tiny, fixed-bucket duration histogram. Pure aggregate — counts of requests
 * per duration band, never values — so it stays inside the output boundary
 * (measure & attribute, don't inspect) and is safe to keep long after the raw
 * profiles roll off. Histograms are mergeable (element-wise sum), so any set of
 * daily buckets folds into a window from which approximate quantiles are read.
 */
class RouteStats {

	/**
	 * Exclusive upper bounds of each duration bucket, in milliseconds. The final
	 * bucket is the overflow (everything at or above the last bound). Log-ish
	 * spacing keeps relative error bounded across the range that matters.
	 */
	const BUCKET_BOUNDS_MS = array( 5, 10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400 );

	/**
	 * Number of buckets (bounds + the overflow bucket).
	 *
	 * @return int
	 */
	public static function bucket_count() {
		return count( self::BUCKET_BOUNDS_MS ) + 1;
	}

	/**
	 * A zero-filled histogram.
	 *
	 * @return int[]
	 */
	public static function empty_histogram() {
		return array_fill( 0, self::bucket_count(), 0 );
	}

	/**
	 * The bucket index a duration falls into.
	 *
	 * @param int $duration_ns Duration in nanoseconds.
	 * @return int Bucket index (0 .. bucket_count()-1).
	 */
	public static function bucket_index( $duration_ns ) {
		$ms = max( 0, (int) $duration_ns ) / 1e6;
		foreach ( self::BUCKET_BOUNDS_MS as $i => $bound ) {
			if ( $ms < $bound ) {
				return $i;
			}
		}
		return count( self::BUCKET_BOUNDS_MS );
	}

	/**
	 * Add one duration sample to a histogram.
	 *
	 * @param int[] $histogram   Existing histogram (any length; normalized).
	 * @param int   $duration_ns Duration in nanoseconds.
	 * @return int[] New histogram.
	 */
	public static function add( $histogram, $duration_ns ) {
		$histogram = self::normalize( $histogram );
		++$histogram[ self::bucket_index( $duration_ns ) ];
		return $histogram;
	}

	/**
	 * Merge histograms by summing bucket counts.
	 *
	 * @param array<int, int[]> $histograms Histograms to merge.
	 * @return int[] Merged histogram.
	 */
	public static function merge( array $histograms ) {
		$out   = self::empty_histogram();
		$count = self::bucket_count();
		foreach ( $histograms as $histogram ) {
			$histogram = self::normalize( $histogram );
			for ( $i = 0; $i < $count; $i++ ) {
				$out[ $i ] += $histogram[ $i ];
			}
		}
		return $out;
	}

	/**
	 * Total number of samples in a histogram.
	 *
	 * @param int[] $histogram Histogram.
	 * @return int
	 */
	public static function total( $histogram ) {
		return array_sum( self::normalize( $histogram ) );
	}

	/**
	 * Approximate quantile value, in nanoseconds, via linear interpolation
	 * within the containing bucket.
	 *
	 * @param int[] $histogram Histogram.
	 * @param float $q         Quantile in [0, 1].
	 * @return int Duration at the quantile, in nanoseconds (0 if empty).
	 */
	public static function quantile( $histogram, $q ) {
		$histogram = self::normalize( $histogram );
		$total     = array_sum( $histogram );
		if ( $total <= 0 ) {
			return 0;
		}

		$q      = max( 0.0, min( 1.0, (float) $q ) );
		$target = $q * $total;
		$count  = self::bucket_count();
		$cum    = 0;

		for ( $i = 0; $i < $count; $i++ ) {
			$bucket = $histogram[ $i ];
			if ( $bucket <= 0 ) {
				continue;
			}
			if ( $cum + $bucket >= $target ) {
				$lo = ( 0 === $i ) ? 0 : self::BUCKET_BOUNDS_MS[ $i - 1 ];
				// Overflow bucket has no upper bound — report its floor.
				if ( $i >= count( self::BUCKET_BOUNDS_MS ) ) {
					return (int) round( $lo * 1e6 );
				}
				$hi   = self::BUCKET_BOUNDS_MS[ $i ];
				$frac = ( $target - $cum ) / $bucket;
				$ms   = $lo + $frac * ( $hi - $lo );
				return (int) round( $ms * 1e6 );
			}
			$cum += $bucket;
		}

		$last_lo = self::BUCKET_BOUNDS_MS[ count( self::BUCKET_BOUNDS_MS ) - 1 ];
		return (int) round( $last_lo * 1e6 );
	}

	/**
	 * Coerce a (possibly JSON-decoded or wrong-length) histogram to the canonical
	 * length of non-negative integers.
	 *
	 * @param mixed $histogram Candidate histogram.
	 * @return int[] Normalized histogram.
	 */
	private static function normalize( $histogram ) {
		if ( ! is_array( $histogram ) ) {
			$histogram = array();
		}
		$count = self::bucket_count();
		$out   = array();
		for ( $i = 0; $i < $count; $i++ ) {
			$out[ $i ] = isset( $histogram[ $i ] ) ? max( 0, (int) $histogram[ $i ] ) : 0;
		}
		return $out;
	}
}
