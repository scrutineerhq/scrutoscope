<?php
/**
 * Tests for by-reference callback detection in the instrumentor.
 *
 * Wrapping a callback with by-reference parameters breaks its contract — it
 * broke Wordfence's authAction( &$username, &$passwd ) on wp_authenticate
 * (a live "must be passed by reference" warning observed on the test host).
 * has_reference_params() must detect such callbacks in every form WordPress
 * stores them, including the string 'Class::method' form.
 *
 * @package Scrutoscope
 */

use PHPUnit\Framework\TestCase;
use Scrutoscope\Profiler\Instrumentor;

require_once __DIR__ . '/../includes/Profiler/Instrumentor.php';

/** Fixture mirroring a Wordfence-style by-reference auth callback. */
class ByRefFixture {
	public static function with_ref( &$username, &$passwd ) {}
	public static function no_ref( $a, $b ) {}
}

/**
 * @covers \Scrutoscope\Profiler\Instrumentor::has_reference_params
 */
class InstrumentorByRefTest extends TestCase {

	private function has_ref( $callback ) {
		$method = new \ReflectionMethod( Instrumentor::class, 'has_reference_params' );
		$method->setAccessible( true );
		return $method->invoke( null, $callback );
	}

	/** The actual bug: a string static-method callback with by-ref params. */
	public function test_string_static_method_with_ref_is_detected() {
		$this->assertTrue( $this->has_ref( 'ByRefFixture::with_ref' ) );
	}

	public function test_array_static_method_with_ref_is_detected() {
		$this->assertTrue( $this->has_ref( array( 'ByRefFixture', 'with_ref' ) ) );
	}

	public function test_closure_with_ref_is_detected() {
		$this->assertTrue( $this->has_ref( function ( &$x ) {} ) );
	}

	public function test_method_without_ref_is_not_flagged() {
		$this->assertFalse( $this->has_ref( 'ByRefFixture::no_ref' ) );
		$this->assertFalse( $this->has_ref( array( 'ByRefFixture', 'no_ref' ) ) );
	}

	/** Unreflectable 'Class::method' must fail closed (skip = treat as ref). */
	public function test_unreflectable_string_static_method_fails_closed() {
		$this->assertTrue( $this->has_ref( 'NoSuchClass::nope' ) );
	}
}
