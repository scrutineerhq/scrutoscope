<?php
/**
 * Tests for Report::regression_summary() — the shared payload builder used by
 * both the REST endpoint and the dashboard AJAX handler.
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Profiler\Report;

require_once __DIR__ . '/../includes/Profiler/Report.php';

/**
 * Covers the regression-verdict payload builder.
 *
 * @covers \Scrutinizer\Profiler\Report::regression_summary
 */
class ReportRegressionSummaryTest extends TestCase {

	/**
	 * Build N matching pseudo-profiles at a fixed duration.
	 *
	 * @param int $count       Number of profiles.
	 * @param int $duration_ms Duration per profile, in milliseconds.
	 * @return array<int, array> Pseudo-profiles for compare_route().
	 */
	private function profiles( $count, $duration_ms ) {
		$out = array();
		for ( $i = 0; $i < $count; $i++ ) {
			$out[] = array(
				'request' => array(
					'route_class' => 'single',
					'user_role'   => 'anonymous',
				),
				'summary' => array(
					'duration_ns' => (int) ( $duration_ms * 1000000 ),
				),
			);
		}
		return $out;
	}

	/**
	 * Every documented key is present in the payload.
	 */
	public function test_shape_has_all_keys() {
		$data = Report::regression_summary(
			array(
				'baseline' => $this->profiles( 6, 200 ),
				'current'  => $this->profiles( 6, 200 ),
			)
		);
		foreach ( array( 'verdict', 'message', 'fingerprint', 'delta_ns', 'delta_ms', 'pct_change', 'sample_count' ) as $key ) {
			$this->assertArrayHasKey( $key, $data );
		}
	}

	/**
	 * A clear, consistent slowdown classifies as a likely regression.
	 */
	public function test_clear_slowdown_is_likely_regression() {
		$data = Report::regression_summary(
			array(
				'baseline' => $this->profiles( 8, 200 ),
				'current'  => $this->profiles( 8, 350 ),
			)
		);
		$this->assertSame( 'likely_regression', $data['verdict'] );
		$this->assertStringContainsString( 'Likely Regression', $data['message'] );
		$this->assertSame( 150.0, $data['delta_ms'] );
		$this->assertSame( 8, $data['sample_count']['current'] );
	}

	/**
	 * A negligible change stays within noise.
	 */
	public function test_tiny_change_is_within_noise() {
		$data = Report::regression_summary(
			array(
				'baseline' => $this->profiles( 8, 200 ),
				'current'  => $this->profiles( 8, 202 ),
			)
		);
		$this->assertSame( 'within_noise', $data['verdict'] );
	}

	/**
	 * Too few matched samples yields insufficient_data, not a verdict.
	 */
	public function test_too_few_samples_is_insufficient_data() {
		$data = Report::regression_summary(
			array(
				'baseline' => $this->profiles( 2, 200 ),
				'current'  => $this->profiles( 2, 400 ),
			)
		);
		$this->assertSame( 'insufficient_data', $data['verdict'] );
	}

	/**
	 * Empty input is handled safely.
	 */
	public function test_empty_input_is_safe() {
		$data = Report::regression_summary( array() );
		$this->assertSame( 'insufficient_data', $data['verdict'] );
		$this->assertNotEmpty( $data['message'] );
	}
}
