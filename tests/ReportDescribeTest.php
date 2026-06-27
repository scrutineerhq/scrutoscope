<?php
/**
 * Tests for Report::describe_change() — the human-readable verdict text.
 *
 * Guards the constitution terminology contract: the exact approved terms
 * ("Likely Regression", "Difference observed") and never causal language.
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Profiler\Report;

require_once __DIR__ . '/../includes/Profiler/Report.php';

/**
 * @covers \Scrutinizer\Profiler\Report::describe_change
 */
class ReportDescribeTest extends TestCase {

	private function result( $verdict, $delta_ms, $pct, $current = 6 ) {
		return array(
			'verdict'      => $verdict,
			'delta_ns'     => (int) ( $delta_ms * 1000000 ),
			'pct_change'   => $pct,
			'sample_count' => array( 'baseline' => $current, 'current' => $current ),
		);
	}

	public function test_regression_uses_approved_term_and_numbers() {
		$text = Report::describe_change( $this->result( 'likely_regression', 150, 0.75 ) );
		$this->assertStringContainsString( 'Likely Regression', $text );
		$this->assertStringContainsString( '+150ms', $text );
		$this->assertStringContainsString( '+75%', $text );
		$this->assertStringContainsString( '6 matched requests', $text );
	}

	public function test_difference_observed_slower_and_faster() {
		$slower = Report::describe_change( $this->result( 'difference_observed', 40, 0.4 ) );
		$this->assertStringContainsString( 'Difference observed', $slower );
		$this->assertStringContainsString( 'slower', $slower );

		$faster = Report::describe_change( $this->result( 'difference_observed', -40, -0.4 ) );
		$this->assertStringContainsString( 'faster', $faster );
		$this->assertStringContainsString( '-40ms', $faster );
	}

	public function test_within_noise_and_insufficient_data() {
		$this->assertStringContainsString( 'Within noise', Report::describe_change( $this->result( 'within_noise', 2, 0.01 ) ) );
		$this->assertStringContainsString( 'Not enough matched requests', Report::describe_change( $this->result( 'insufficient_data', 0, 0 ) ) );
	}

	public function test_no_causal_language_for_any_verdict() {
		foreach ( array( 'likely_regression', 'difference_observed', 'within_noise', 'insufficient_data' ) as $verdict ) {
			$text = Report::describe_change( $this->result( $verdict, 150, 0.75 ) );
			foreach ( array( 'caused', 'slow plugin', 'is slow', 'page load', 'slowing' ) as $forbidden ) {
				$this->assertStringNotContainsStringIgnoringCase( $forbidden, $text, "'{$forbidden}' must not appear: {$text}" );
			}
		}
	}

	public function test_unknown_verdict_falls_back_safely() {
		$this->assertStringContainsString( 'Not enough matched requests', Report::describe_change( array() ) );
	}
}
