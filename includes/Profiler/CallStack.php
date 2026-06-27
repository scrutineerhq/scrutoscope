<?php
/**
 * Call stack tracker for nested callback execution.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

/**
 * Tracks nested callback execution for exclusive/inclusive time calculation.
 *
 * Maintains a stack of active callback frames. When a frame pops, its
 * inclusive time is added to the parent frame's children_time_ns so that
 * the parent can later derive its own exclusive time.
 */
class CallStack {

	/**
	 * Hard cap on stored trace entries (mirrors Instrumentor::MAX_TIMINGS) so
	 * memory stays bounded on pages with very many callback invocations.
	 */
	const MAX_TRACE = 20000;

	/**
	 * Stack of active frames.
	 *
	 * Each frame is an associative array:
	 *   - id              (string)  Unique frame identifier.
	 *   - start_ns        (int)     hrtime start.
	 *   - children_time_ns (int)    Sum of direct children's wall time.
	 *   - mem_start       (int)     memory_get_usage() at push.
	 *   - children_mem    (int)     Sum of direct children's inclusive memory.
	 *
	 * @var array<int, array>
	 */
	private $stack = array();

	/**
	 * Completed trace entries, built as frames are popped.
	 *
	 * @var array<int, array>
	 */
	private $trace = array();

	/**
	 * Push a new frame onto the stack.
	 *
	 * @param string $frame_id  Unique callback identifier.
	 * @param int    $start_ns  Monotonic nanosecond timestamp.
	 * @param int    $mem_start memory_get_usage() at frame start.
	 */
	public function push( $frame_id, $start_ns, $mem_start = 0 ) {
		$this->stack[] = array(
			'id'               => $frame_id,
			'start_ns'         => $start_ns,
			'children_time_ns' => 0,
			'mem_start'        => $mem_start,
			'children_mem'     => 0,
		);
	}

	/**
	 * Pop a frame off the stack and return its data.
	 *
	 * Adds this frame's inclusive time to the parent frame's children_time_ns.
	 *
	 * @param string   $frame_id  Expected frame identifier (for sanity).
	 * @param int      $end_ns    Monotonic nanosecond timestamp.
	 * @param int|null $mem_end   memory_get_usage() at frame end (null to skip).
	 * @return array|null
	 */
	public function pop( $frame_id, $end_ns, $mem_end = null ) {
		if ( empty( $this->stack ) ) {
			return null;
		}

		$frame        = array_pop( $this->stack );
		$inclusive_ns = $end_ns - $frame['start_ns'];
		$exclusive_ns = $inclusive_ns - $frame['children_time_ns'];

		// Guard against negative exclusive time from clock jitter.
		if ( $exclusive_ns < 0 ) {
			$exclusive_ns = 0;
		}

		// Memory accounting mirrors time. Inclusive memory is this frame's
		// net delta; exclusive subtracts the children's inclusive deltas so the
		// per-source totals are additive instead of double-counting nested
		// allocations. Deltas may be negative (memory freed) — not clamped,
		// because a negative Observed Memory Delta is meaningful.
		$inclusive_mem = ( null === $mem_end ) ? 0 : $mem_end - $frame['mem_start'];
		$exclusive_mem = $inclusive_mem - $frame['children_mem'];

		// Attribute this frame's wall time and memory to the parent.
		$parent_idx = count( $this->stack ) - 1;
		if ( $parent_idx >= 0 ) {
			$this->stack[ $parent_idx ]['children_time_ns'] += $inclusive_ns;
			$this->stack[ $parent_idx ]['children_mem']     += $inclusive_mem;
		}

		$result = array(
			'id'            => $frame['id'],
			'start_ns'      => $frame['start_ns'],
			'end_ns'        => $end_ns,
			'inclusive_ns'  => $inclusive_ns,
			'exclusive_ns'  => $exclusive_ns,
			'inclusive_mem' => $inclusive_mem,
			'exclusive_mem' => $exclusive_mem,
		);

		if ( count( $this->trace ) < self::MAX_TRACE ) {
			$this->trace[] = $result;
		}

		return $result;
	}

	/**
	 * Return current nesting depth.
	 *
	 * @return int
	 */
	public function depth() {
		return count( $this->stack );
	}

	/**
	 * Return the full trace of completed frames.
	 *
	 * @return array<int, array>
	 */
	public function get_trace() {
		return $this->trace;
	}

	/**
	 * Reset the call stack for a new profiling session.
	 */
	public function reset() {
		$this->stack = array();
		$this->trace = array();
	}
}
