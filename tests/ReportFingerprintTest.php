<?php
/**
 * Tests for route fingerprinting + baseline matching (regression gate, phase 2).
 *
 * route_fingerprint() decides which requests are comparable (D6 — checkout vs
 * checkout, not homepage); match_samples() pulls the matched durations; and
 * compare_route() wires them into classify_change().
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Profiler\Report;

require_once __DIR__ . '/../includes/Profiler/Report.php';

/**
 * @covers \Scrutinizer\Profiler\Report::route_fingerprint
 * @covers \Scrutinizer\Profiler\Report::match_samples
 * @covers \Scrutinizer\Profiler\Report::compare_route
 */
class ReportFingerprintTest extends TestCase {

	private function ms( $ms ) {
		return (int) ( $ms * 1000000 );
	}

	/** Build a compiled-profile-shaped array. */
	private function profile( $route_class, $role, $ms, $cache = null ) {
		$request = array( 'route_class' => $route_class, 'user_role' => $role );
		if ( null !== $cache ) {
			$request['cache_state'] = $cache;
		}
		return array(
			'request' => $request,
			'summary' => array( 'duration_ns' => $this->ms( $ms ) ),
		);
	}

	public function test_same_route_and_role_share_a_fingerprint() {
		$a = Report::route_fingerprint( array( 'route_class' => 'woocommerce_checkout', 'user_role' => 'customer' ) );
		$b = Report::route_fingerprint( array( 'route_class' => 'woocommerce_checkout', 'user_role' => 'subscriber' ) );
		$this->assertSame( $a, $b ); // both authenticated, same route
	}

	public function test_different_route_class_differs() {
		$checkout = Report::route_fingerprint( array( 'route_class' => 'checkout', 'user_role' => 'anonymous' ) );
		$home     = Report::route_fingerprint( array( 'route_class' => 'home', 'user_role' => 'anonymous' ) );
		$this->assertNotSame( $checkout, $home );
	}

	public function test_anonymous_and_authenticated_differ() {
		$anon = Report::route_fingerprint( array( 'route_class' => 'home', 'user_role' => 'anonymous' ) );
		$auth = Report::route_fingerprint( array( 'route_class' => 'home', 'user_role' => 'editor' ) );
		$this->assertNotSame( $anon, $auth );
	}

	public function test_cache_state_included_only_when_present() {
		$without = Report::route_fingerprint( array( 'route_class' => 'home', 'user_role' => 'anonymous' ) );
		$hit     = Report::route_fingerprint( array( 'route_class' => 'home', 'user_role' => 'anonymous', 'cache_state' => 'hit' ) );
		$miss    = Report::route_fingerprint( array( 'route_class' => 'home', 'user_role' => 'anonymous', 'cache_state' => 'miss' ) );

		$this->assertStringNotContainsString( 'cache:', $without );
		$this->assertNotSame( $hit, $miss );
		$this->assertNotSame( $without, $hit );
	}

	public function test_missing_route_class_defaults_to_unknown() {
		$this->assertStringContainsString( 'route:unknown', Report::route_fingerprint( array() ) );
	}

	public function test_match_samples_filters_by_fingerprint() {
		$fp       = Report::route_fingerprint( array( 'route_class' => 'home', 'user_role' => 'anonymous' ) );
		$profiles = array(
			$this->profile( 'home', 'anonymous', 100 ),
			$this->profile( 'checkout', 'anonymous', 999 ), // different route — excluded
			$this->profile( 'home', 'editor', 999 ),        // authenticated — excluded
			$this->profile( 'home', 'anonymous', 120 ),
		);
		$samples = Report::match_samples( $profiles, $fp );
		$this->assertSame( array( $this->ms( 100 ), $this->ms( 120 ) ), $samples );
	}

	public function test_compare_route_end_to_end_regression() {
		$baseline = array();
		$current  = array();
		for ( $i = 0; $i < 6; $i++ ) {
			$baseline[] = $this->profile( 'home', 'anonymous', 200 );
			$current[]  = $this->profile( 'home', 'anonymous', 350 );
		}
		// A different route mixed into current must not pollute the samples.
		$current[] = $this->profile( 'checkout', 'anonymous', 50 );

		$result = Report::compare_route( $baseline, $current );
		$this->assertSame( 'likely_regression', $result['verdict'] );
		$this->assertStringContainsString( 'route:home', $result['fingerprint'] );
		$this->assertSame( 6, $result['sample_count']['current'] ); // checkout excluded
	}

	public function test_compare_route_empty_current_is_insufficient() {
		$result = Report::compare_route( array(), array() );
		$this->assertSame( 'insufficient_data', $result['verdict'] );
	}
}
