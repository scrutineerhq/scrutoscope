<?php
/**
 * Hook callback instrumentor.
 *
 * @package Scrutoscope
 */

namespace Scrutoscope\Profiler;

defined( 'ABSPATH' ) || exit;

/**
 * Walks the global hook registry and wraps callbacks with timing closures.
 *
 * Instrumentation is performed once at profiler start, with additional
 * passes at `wp_loaded` and `admin_init` to catch late-registered callbacks.
 * The global `all` hook is never used for profiling.
 */
class Instrumentor {

	/**
	 * Hard cap on stored per-invocation timing entries. A page that fires
	 * hundreds of thousands of hook callbacks would otherwise exhaust the PHP
	 * memory limit by recording one entry per invocation. Past this cap we
	 * stop recording (is_truncated() reports it); the request still runs.
	 */
	const MAX_TIMINGS = 20000;

	/**
	 * Reference to the CallStack instance for nested tracking.
	 *
	 * @var CallStack
	 */
	private $call_stack;

	/**
	 * Collected raw timing entries.
	 *
	 * @var array<int, array>
	 */
	private $timings = array();

	/**
	 * Set of callback identity keys already instrumented.
	 *
	 * @var array<string, true>
	 */
	private $instrumented = array();

	/**
	 * Constructor.
	 *
	 * @param CallStack $call_stack  The call stack tracker.
	 */
	public function __construct( CallStack $call_stack ) {
		$this->call_stack = $call_stack;
	}

	/**
	 * Instrument all currently registered hooks.
	 *
	 * Iterates $GLOBALS['wp_filter'] and wraps each callback that has not
	 * already been instrumented.
	 */
	public function instrument_all() {
		if ( ! isset( $GLOBALS['wp_filter'] ) || ! is_array( $GLOBALS['wp_filter'] ) ) {
			return;
		}

		foreach ( $GLOBALS['wp_filter'] as $tag => $hook_obj ) {
			if ( ! ( $hook_obj instanceof \WP_Hook ) ) {
				continue;
			}

			$this->instrument_hook( $tag, $hook_obj );
		}
	}

	/**
	 * Instrument all callbacks registered under a single hook tag.
	 *
	 * @param string   $tag       Hook name.
	 * @param \WP_Hook $hook_obj  The WP_Hook instance.
	 */
	private function instrument_hook( $tag, \WP_Hook $hook_obj ) {
		foreach ( $hook_obj->callbacks as $priority => $callbacks ) {
			foreach ( $callbacks as $idx => $callback_data ) {
				$this->wrap_callback( $tag, $priority, $idx, $callback_data, $hook_obj );
			}
		}
	}

	/**
	 * Wrap a single callback with a timing closure.
	 *
	 * @param string   $tag            Hook name.
	 * @param int      $priority       Hook priority.
	 * @param string   $idx            Callback index key inside WP_Hook.
	 * @param array    $callback_data  The callback entry (function, accepted_args).
	 * @param \WP_Hook $hook_obj       The WP_Hook instance.
	 */
	private function wrap_callback( $tag, $priority, $idx, $callback_data, \WP_Hook $hook_obj ) {
		$original = $callback_data['function'];
		$identity = Attribution::callback_identity( $original );

		// Skip already-instrumented callbacks.
		$unique_key = $tag . '|' . $priority . '|' . $identity;
		if ( isset( $this->instrumented[ $unique_key ] ) ) {
			return;
		}

		// Resolve attribution once at wrap time (not in the hot path).
		$attribution = Attribution::resolve( $original );

		// Skip Scrutoscope's own callbacks.
		if ( Attribution::is_self( $attribution ) ) {
			return;
		}

		// Skip callbacks with by-reference parameters. Our wrapper uses
		// func_get_args() + call_user_func_array() which strips reference
		// semantics. Wrapping such callbacks would silently break their
		// contract (reference modifications wouldn't propagate back) and
		// trigger PHP warnings that can produce output before headers are
		// sent, blocking setcookie() and breaking login/auth flows.
		if ( self::has_reference_params( $original ) ) {
			return;
		}

		$label      = Attribution::callback_label( $original );
		$call_stack = $this->call_stack;
		$timings    = &$this->timings;
		$max        = self::MAX_TIMINGS;

		/*
		 * Build the wrapper closure. It pushes/pops the call stack, records
		 * timing, and delegates to the original callback.
		 *
		 * The closure captures $original by value so the reference remains
		 * valid even if the hook registry is later modified.
		 */
		$wrapper = function () use ( $original, $tag, $priority, $identity, $label, $attribution, $call_stack, &$timings, $max ) {
			$args       = func_get_args();
			$frame_id   = $identity . '@' . $tag . ':' . $priority;
			$mem_before = memory_get_usage();
			$start_ns   = hrtime( true );

			$call_stack->push( $frame_id, $start_ns, $mem_before );

			try {
				$result = call_user_func_array( $original, $args );
			} catch ( \Throwable $e ) {
				$end_ns    = hrtime( true );
				$mem_after = memory_get_usage();

				$frame = $call_stack->pop( $frame_id, $end_ns, $mem_after );

				if ( count( $timings ) < $max ) {
					$timings[] = array(
						'tag'              => $tag,
						'priority'         => $priority,
						'callback'         => $label,
						'identity'         => $identity,
						'attribution'      => $attribution,
						'start_ns'         => $start_ns,
						'end_ns'           => $end_ns,
						'inclusive_ns'     => $frame ? $frame['inclusive_ns'] : ( $end_ns - $start_ns ),
						'exclusive_ns'     => $frame ? $frame['exclusive_ns'] : ( $end_ns - $start_ns ),
						'memory_before'    => $mem_before,
						'memory_after'     => $mem_after,
						'memory_exclusive' => $frame ? $frame['exclusive_mem'] : ( $mem_after - $mem_before ),
						'threw'            => true,
					);
				}

				throw $e;
			}

			$end_ns    = hrtime( true );
			$mem_after = memory_get_usage();

			$frame = $call_stack->pop( $frame_id, $end_ns, $mem_after );

			if ( count( $timings ) < $max ) {
				$timings[] = array(
					'tag'              => $tag,
					'priority'         => $priority,
					'callback'         => $label,
					'identity'         => $identity,
					'attribution'      => $attribution,
					'start_ns'         => $start_ns,
					'end_ns'           => $end_ns,
					'inclusive_ns'     => $frame ? $frame['inclusive_ns'] : ( $end_ns - $start_ns ),
					'exclusive_ns'     => $frame ? $frame['exclusive_ns'] : ( $end_ns - $start_ns ),
					'memory_before'    => $mem_before,
					'memory_after'     => $mem_after,
					'memory_exclusive' => $frame ? $frame['exclusive_mem'] : ( $mem_after - $mem_before ),
					'threw'            => false,
				);
			}

			return $result;
		};

		// Replace the callback in the hook registry.
		$hook_obj->callbacks[ $priority ][ $idx ]['function'] = $wrapper;

		$this->instrumented[ $unique_key ] = true;
	}

	/**
	 * Whether the per-invocation cap was hit (captured data is partial).
	 *
	 * @return bool
	 */
	public function is_truncated() {
		return count( $this->timings ) >= self::MAX_TIMINGS;
	}

	/**
	 * Return all collected timing entries.
	 *
	 * @return array<int, array>
	 */
	public function get_timings() {
		return $this->timings;
	}

	/**
	 * Reset collected timings.
	 */
	public function reset() {
		$this->timings      = array();
		$this->instrumented = array();
	}

	/**
	 * Check whether a callback has any pass-by-reference parameters.
	 *
	 * Callbacks with reference parameters cannot be safely wrapped because
	 * func_get_args() + call_user_func_array() strips reference semantics.
	 * Wrapping them would silently break their contract and trigger PHP
	 * warnings that produce output before headers, blocking setcookie().
	 *
	 * @param callable $callback  WordPress callback.
	 * @return bool
	 */
	private static function has_reference_params( $callback ) {
		try {
			if ( $callback instanceof \Closure ) {
				$ref = new \ReflectionFunction( $callback );
			} elseif ( is_array( $callback ) && count( $callback ) >= 2 ) {
				$ref = new \ReflectionMethod( $callback[0], $callback[1] );
			} elseif ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
				// String static-method callback ('Class::method'). function_exists()
				// is false for these, so without this branch they fell through to
				// "no reference params" and got wrapped — which broke Wordfence's
				// authAction( &$username, &$passwd ) on wp_authenticate (a live
				// PHP "must be passed by reference" warning on the test host).
				$parts = explode( '::', $callback, 2 );
				$ref   = new \ReflectionMethod( $parts[0], $parts[1] );
			} elseif ( is_string( $callback ) && function_exists( $callback ) ) {
				$ref = new \ReflectionFunction( $callback );
			} elseif ( is_object( $callback ) && method_exists( $callback, '__invoke' ) ) {
				$ref = new \ReflectionMethod( $callback, '__invoke' );
			} else {
				return false;
			}

			foreach ( $ref->getParameters() as $param ) {
				if ( $param->isPassedByReference() ) {
					return true;
				}
			}
		} catch ( \ReflectionException $e ) {
			// Can't reflect — we cannot prove the callback is free of
			// by-reference params, and wrapping one of those breaks its
			// contract (and has broken login before — see GOTCHAS). Fail
			// closed: treat it as having reference params so it is skipped.
			return true;
		}

		return false;
	}
}
