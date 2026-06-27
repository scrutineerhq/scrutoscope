<?php
/**
 * Tests for Report::classify_histograms() — the aggregate (histogram) path of
 * the regression classifier.
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Profiler\Report;
use Scrutinizer\Profiler\RouteStats;

require_once __DIR__ . '/../includes/Profiler/RouteStats.php';
require_once __DIR__ . '/../includes/Profiler/Report.php';

/**
 * Covers the histogram-based classifier path.
 *
 * @covers \Scrutinizer\Profiler\Report::classify_histograms
 */
class ReportClassifyHistogramsTest extends TestCase {

	/**
	 * A histogram of N samples at a fixed millisecond duration.
	 *
	 * @param int $n  Sample count.
	 * @param int $ms Duration in milliseconds.
	 * @return int[] Histogram.
	 */
	private function hist( $n, $ms ) {
		$h = RouteStats::empty_histogram();
		for ( $i = 0; $i < $n; $i++ ) {
			$h = RouteStats::add( $h, (int) ( $ms * 1000000 ) );
		}
		return $h;
	}

	/**
	 * A clear bucket-crossing slowdown is a likely regression.
	 */
	public function test_bucket_crossing_slowdown_is_likely_regression() {
		$result = Report::classify_histograms( $this->hist( 40, 60 ), $this->hist( 40, 300 ) );
		$this->assertSame( 'likely_regression', $result['verdict'] );
		$this->assertSame( 5, $result['direction_slower'] );
	}

	/**
	 * A change within a single bucket is below resolution — within noise.
	 */
	public function test_within_bucket_change_is_within_noise() {
		$result = Report::classify_histograms( $this->hist( 40, 60 ), $this->hist( 40, 65 ) );
		$this->assertSame( 'within_noise', $result['verdict'] );
	}

	/**
	 * A real but sub-threshold move is reported as a difference, not a regression.
	 */
	public function test_small_move_is_difference_observed() {
		$result = Report::classify_histograms( $this->hist( 40, 60 ), $this->hist( 40, 130 ) );
		$this->assertSame( 'difference_observed', $result['verdict'] );
	}

	/**
	 * Too few samples on a side yields insufficient_data.
	 */
	public function test_too_few_samples_is_insufficient_data() {
		$result = Report::classify_histograms( $this->hist( 2, 60 ), $this->hist( 2, 300 ) );
		$this->assertSame( 'insufficient_data', $result['verdict'] );
		$this->assertSame( 0, $result['direction_slower'] );
	}

	/**
	 * classify_change (raw samples) still works after the shared-helper refactor.
	 */
	public function test_raw_classify_change_still_works() {
		$baseline = array_fill( 0, 8, 60000000 );  // 60ms.
		$current  = array_fill( 0, 8, 300000000 ); // 300ms.
		$result   = Report::classify_change( $baseline, $current );
		$this->assertSame( 'likely_regression', $result['verdict'] );
	}
}
