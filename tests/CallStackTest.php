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

	/**
	 * Exclusive memory subtracts a nested child's inclusive memory from the
	 * parent, so per-source totals are additive instead of double-counting.
	 */
	public function test_nested_child_memory_is_subtracted_from_parent() {
		$cs = new CallStack();
		$cs->push( 'parent', 0, 0 );    // parent starts at 0 bytes
		$cs->push( 'child', 3, 100 );   // child starts at 100 bytes
		$child  = $cs->pop( 'child', 7, 300 );   // child inclusive 200
		$parent = $cs->pop( 'parent', 10, 500 ); // parent inclusive 500, child 200 => exclusive 300

		$this->assertSame( 200, $child['inclusive_mem'] );
		$this->assertSame( 200, $child['exclusive_mem'] );
		$this->assertSame( 500, $parent['inclusive_mem'] );
		$this->assertSame( 300, $parent['exclusive_mem'] );

		// Exclusive sum is additive and equals the parent's inclusive total.
		$this->assertSame(
			$parent['inclusive_mem'],
			$parent['exclusive_mem'] + $child['exclusive_mem']
		);
	}

	/**
	 * Memory deltas are not clamped — freed memory yields a negative
	 * Observed Memory Delta, which is meaningful (not per-plugin ownership).
	 */
	public function test_negative_memory_delta_is_not_clamped() {
		$cs = new CallStack();
		$cs->push( 'frees', 0, 1000 );
		$frame = $cs->pop( 'frees', 5, 600 ); // freed 400 bytes

		$this->assertSame( -400, $frame['inclusive_mem'] );
		$this->assertSame( -400, $frame['exclusive_mem'] );
	}

	/**
	 * pop() without a memory argument leaves memory deltas at zero (the
	 * legacy/timing-only call path stays valid).
	 */
	public function test_memory_optional_on_pop() {
		$cs = new CallStack();
		$cs->push( 'frame', 0 );
		$frame = $cs->pop( 'frame', 10 );

		$this->assertSame( 0, $frame['inclusive_mem'] );
		$this->assertSame( 0, $frame['exclusive_mem'] );
	}
}
