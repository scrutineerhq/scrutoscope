<?php
/**
 * Tests for Report::classify_change() — the "Likely Regression" gate.
 *
 * The locked invariant (D7): a `likely_regression` verdict requires ALL THREE
 * thresholds — >=5 matched samples, >=20% AND +100ms median increase, and a
 * slower direction in >=3 of 5 quantiles. If any one fails, the strongest
 * verdict is `difference_observed`. These tests pin each threshold boundary.
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Profiler\Report;

require_once __DIR__ . '/../includes/Profiler/Report.php';

/**
 * @covers \Scrutinizer\Profiler\Report::classify_change
 */
class ReportClassifyTest extends TestCase {

	/** Convert milliseconds to nanoseconds. */
	private function ms( $ms ) {
		return (int) ( $ms * 1000000 );
	}

	/** Build $count samples of $ms milliseconds (nanoseconds). */
	private function samples( $ms, $count ) {
		return array_fill( 0, $count, $this->ms( $ms ) );
	}

	public function test_insufficient_samples_is_not_a_verdict() {
		$r = Report::classify_change( $this->samples( 200, 4 ), $this->samples( 400, 4 ) );
		$this->assertSame( 'insufficient_data', $r['verdict'] );
	}

	public function test_clear_regression_meets_all_three_thresholds() {
		// 200ms -> 350ms: +150ms (+75%), every quantile slower.
		$r = Report::classify_change( $this->samples( 200, 6 ), $this->samples( 350, 6 ) );
		$this->assertSame( 'likely_regression', $r['verdict'] );
		$this->assertSame( 5, $r['direction_slower'] );
	}

	public function test_boundary_exactly_100ms_and_20pct_and_5of5_is_regression() {
		// 500ms -> 600ms: exactly +100ms and exactly +20%.
		$r = Report::classify_change( $this->samples( 500, 6 ), $this->samples( 600, 6 ) );
		$this->assertSame( 'likely_regression', $r['verdict'] );
	}

	public function test_under_100ms_absolute_is_not_regression() {
		// +30ms (+30%): percentage passes, absolute fails.
		$r = Report::classify_change( $this->samples( 100, 6 ), $this->samples( 130, 6 ) );
		$this->assertSame( 'difference_observed', $r['verdict'] );
	}

	public function test_under_20pct_is_not_regression() {
		// +150ms (+15%): absolute passes, percentage fails.
		$r = Report::classify_change( $this->samples( 1000, 6 ), $this->samples( 1150, 6 ) );
		$this->assertSame( 'difference_observed', $r['verdict'] );
	}

	public function test_inconsistent_direction_is_not_regression() {
		// Median jumps far (+195ms) but only 2 of 5 quantiles are slower
		// (half the current samples are actually faster) — direction fails.
		$baseline = $this->samples( 100, 6 );
		$current  = array(
			$this->ms( 90 ), $this->ms( 90 ), $this->ms( 90 ),
			$this->ms( 500 ), $this->ms( 500 ), $this->ms( 500 ),
		);
		$r = Report::classify_change( $baseline, $current );
		$this->assertLessThan( 3, $r['direction_slower'] );
		$this->assertSame( 'difference_observed', $r['verdict'] );
	}

	public function test_small_change_is_within_noise() {
		// +3ms (+1.5%).
		$r = Report::classify_change( $this->samples( 200, 6 ), $this->samples( 203, 6 ) );
		$this->assertSame( 'within_noise', $r['verdict'] );
	}

	public function test_faster_is_never_a_regression() {
		// 300ms -> 200ms: a clear improvement must never read as a regression.
		$r = Report::classify_change( $this->samples( 300, 6 ), $this->samples( 200, 6 ) );
		$this->assertNotSame( 'likely_regression', $r['verdict'] );
		$this->assertLessThan( 0, $r['delta_ns'] );
	}

	public function test_reports_median_and_delta() {
		$r = Report::classify_change( $this->samples( 100, 6 ), $this->samples( 250, 6 ) );
		$this->assertSame( $this->ms( 100 ), $r['median_baseline_ns'] );
		$this->assertSame( $this->ms( 250 ), $r['median_current_ns'] );
		$this->assertSame( $this->ms( 150 ), $r['delta_ns'] );
		$this->assertEqualsWithDelta( 1.5, $r['pct_change'], 0.001 );
	}
}
