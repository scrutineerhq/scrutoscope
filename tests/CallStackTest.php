<?php
/**
 * Unit tests for the call stack's exclusive/inclusive time accounting.
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Profiler\CallStack;

/**
 * @covers \Scrutinizer\Profiler\CallStack
 */
class CallStackTest extends TestCase {

	/**
	 * A leaf frame's exclusive time equals its inclusive time.
	 */
	public function test_leaf_exclusive_equals_inclusive() {
		$cs    = new CallStack();
		$cs->push( 'leaf', 0 );
		$frame = $cs->pop( 'leaf', 100 );

		$this->assertSame( 100, $frame['inclusive_ns'] );
		$this->assertSame( 100, $frame['exclusive_ns'] );
	}

	/**
	 * A parent's exclusive time excludes time spent in a nested child, and the
	 * child's inclusive time is fully its own. Exclusive across both is
	 * additive and equals the parent's inclusive time.
	 */
	public function test_nested_child_time_is_subtracted_from_parent() {
		$cs = new CallStack();
		$cs->push( 'parent', 0 );
		$cs->push( 'child', 3 );
		$child  = $cs->pop( 'child', 7 );   // inclusive 4
		$parent = $cs->pop( 'parent', 10 ); // inclusive 10, child 4 => exclusive 6

		$this->assertSame( 4, $child['inclusive_ns'] );
		$this->assertSame( 4, $child['exclusive_ns'] );
		$this->assertSame( 10, $parent['inclusive_ns'] );
		$this->assertSame( 6, $parent['exclusive_ns'] );

		// Exclusive sum is additive and matches the parent's inclusive total.
		$this->assertSame(
			$parent['inclusive_ns'],
			$parent['exclusive_ns'] + $child['exclusive_ns']
		);
	}

	/**
	 * Negative exclusive time from clock jitter is clamped to zero.
	 */
	public function test_negative_exclusive_time_is_clamped() {
		$cs = new CallStack();
		$cs->push( 'parent', 0 );
		$cs->push( 'child', 1 );
		// Child reports a wildly long inclusive time (clock jitter).
		$cs->pop( 'child', 1000 );
		$parent = $cs->pop( 'parent', 10 ); // inclusive 10, child 999 => negative

		$this->assertSame( 0, $parent['exclusive_ns'] );
	}

	/**
	 * Popping an empty stack is safe and returns null.
	 */
	public function test_pop_empty_stack_returns_null() {
		$cs = new CallStack();
		$this->assertNull( $cs->pop( 'nope', 5 ) );
	}
}
