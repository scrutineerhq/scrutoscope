<?php
/**
 * Tests for the RouteStats duration histogram.
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Profiler\RouteStats;

require_once __DIR__ . '/../includes/Profiler/RouteStats.php';

/**
 * Covers the mergeable duration histogram + quantile extraction.
 *
 * @covers \Scrutinizer\Profiler\RouteStats
 */
class RouteStatsTest extends TestCase {

	/**
	 * Nanoseconds for a millisecond value.
	 *
	 * @param float $ms Milliseconds.
	 * @return int Nanoseconds.
	 */
	private function ns( $ms ) {
		return (int) ( $ms * 1000000 );
	}

	/**
	 * Build a histogram from a list of millisecond durations.
	 *
	 * @param array $ms_values Millisecond durations.
	 * @return int[] Histogram.
	 */
	private function histogram_of( array $ms_values ) {
		$h = RouteStats::empty_histogram();
		foreach ( $ms_values as $ms ) {
			$h = RouteStats::add( $h, $this->ns( $ms ) );
		}
		return $h;
	}

	/**
	 * An empty histogram is zero-filled at the canonical length.
	 */
	public function test_empty_histogram_is_zero_filled() {
		$h = RouteStats::empty_histogram();
		$this->assertCount( RouteStats::bucket_count(), $h );
		$this->assertSame( 0, array_sum( $h ) );
	}

	/**
	 * Durations map to the bucket whose range contains them.
	 */
	public function test_bucket_index_respects_boundaries() {
		$this->assertSame( 0, RouteStats::bucket_index( $this->ns( 0 ) ) );
		$this->assertSame( 0, RouteStats::bucket_index( $this->ns( 4.9 ) ) );
		$this->assertSame( 1, RouteStats::bucket_index( $this->ns( 5 ) ) );
		$this->assertSame( 1, RouteStats::bucket_index( $this->ns( 9.9 ) ) );
		$this->assertSame( 6, RouteStats::bucket_index( $this->ns( 200 ) ) );
		$this->assertSame( RouteStats::bucket_count() - 1, RouteStats::bucket_index( $this->ns( 99999 ) ) );
	}

	/**
	 * Adding a sample increments the right bucket and total() counts them.
	 */
	public function test_add_and_total() {
		$h = $this->histogram_of( array( 7, 7, 7 ) );
		$this->assertSame( 3, $h[1] );
		$this->assertSame( 3, RouteStats::total( $h ) );
	}

	/**
	 * Merging sums bucket counts across histograms.
	 */
	public function test_merge_sums_buckets() {
		$a      = $this->histogram_of( array( 7, 200 ) );
		$b      = $this->histogram_of( array( 7, 7, 99999 ) );
		$merged = RouteStats::merge( array( $a, $b ) );
		$this->assertSame( 5, RouteStats::total( $merged ) );
		$this->assertSame( 3, $merged[1] );
	}

	/**
	 * The quantile of an empty histogram is zero.
	 */
	public function test_quantile_of_empty_is_zero() {
		$this->assertSame( 0, RouteStats::quantile( RouteStats::empty_histogram(), 0.5 ) );
	}

	/**
	 * A quantile falls within the bucket that contains it.
	 */
	public function test_quantile_lands_in_the_containing_bucket() {
		$h      = $this->histogram_of( array_fill( 0, 100, 200 ) );
		$median = RouteStats::quantile( $h, 0.5 );
		$this->assertGreaterThanOrEqual( $this->ns( 200 ), $median );
		$this->assertLessThanOrEqual( $this->ns( 400 ), $median );
	}

	/**
	 * Quantiles are monotonic across a spread distribution.
	 */
	public function test_quantile_is_monotonic_across_a_spread() {
		$h   = $this->histogram_of( array( 8, 30, 60, 150, 300, 600, 1200, 3000 ) );
		$q10 = RouteStats::quantile( $h, 0.1 );
		$q50 = RouteStats::quantile( $h, 0.5 );
		$q90 = RouteStats::quantile( $h, 0.9 );
		$this->assertLessThanOrEqual( $q50, $q10 );
		$this->assertLessThanOrEqual( $q90, $q50 );
	}

	/**
	 * Daily buckets merge into a window whose median reflects the bulk.
	 */
	public function test_daily_buckets_merge_into_a_sane_window_median() {
		$day1   = $this->histogram_of( array_fill( 0, 50, 60 ) );
		$day2   = $this->histogram_of( array_fill( 0, 50, 60 ) );
		$day3   = $this->histogram_of( array_fill( 0, 10, 1200 ) );
		$window = RouteStats::merge( array( $day1, $day2, $day3 ) );
		$median = RouteStats::quantile( $window, 0.5 );
		$this->assertLessThanOrEqual( $this->ns( 100 ), $median );
	}

	/**
	 * A short or wrongly-decoded histogram is padded, not fatal.
	 */
	public function test_normalize_pads_short_or_decoded_histograms() {
		$median = RouteStats::quantile( array( 0, 5 ), 0.5 );
		$this->assertGreaterThanOrEqual( 0, $median );
	}
}
