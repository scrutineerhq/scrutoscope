<?php
/**
 * Profile report compiler.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

/**
 * Aggregates raw callback timings into a structured profile report.
 */
class Report {

	/**
	 * Compile raw timings and call stack trace into a report.
	 *
	 * @param array $raw_timings       Timing entries from Instrumentor.
	 * @param array $call_stack_trace   Trace from CallStack.
	 * @param array $request_metadata  Request metadata (url, method, start time, etc).
	 * @return array  Compiled profile data structure.
	 */
	public static function compile( $raw_timings, $call_stack_trace, $request_metadata ) {
		$duration_ns = isset( $request_metadata['duration_ns'] ) ? $request_metadata['duration_ns'] : 0;

		// Group timings by attribution.
		$by_source           = array();
		$total_excl_ns       = 0;
		$total_mem_allocated = 0;

		foreach ( $raw_timings as $timing ) {
			$attr = $timing['attribution'];
			$key  = $attr['type'] . ':' . $attr['slug'];

			if ( ! isset( $by_source[ $key ] ) ) {
				$by_source[ $key ] = array(
					'type'             => $attr['type'],
					'slug'             => $attr['slug'],
					'name'             => $attr['name'],
					'exclusive_ns'     => 0,
					'inclusive_ns'     => 0,
					'call_count'       => 0,
					'memory_delta'     => 0,
					'memory_exclusive' => 0,
					'callbacks'        => array(),
				);
			}

			// Inclusive memory delta (includes nested allocations).
			$mem_delta = $timing['memory_after'] - $timing['memory_before'];
			// Exclusive memory delta (nested allocations subtracted) — additive
			// across sources. Falls back to the inclusive delta for legacy data
			// captured before exclusive memory accounting existed.
			$mem_excl = isset( $timing['memory_exclusive'] ) ? $timing['memory_exclusive'] : $mem_delta;

			$by_source[ $key ]['exclusive_ns']     += $timing['exclusive_ns'];
			$by_source[ $key ]['inclusive_ns']     += $timing['inclusive_ns'];
			$by_source[ $key ]['memory_delta']     += $mem_delta;
			$by_source[ $key ]['memory_exclusive'] += $mem_excl;
			++$by_source[ $key ]['call_count'];

			// Per-callback detail.
			$cb_key = $timing['identity'];
			if ( ! isset( $by_source[ $key ]['callbacks'][ $cb_key ] ) ) {
				$by_source[ $key ]['callbacks'][ $cb_key ] = array(
					'callback'         => $timing['callback'],
					'tag'              => $timing['tag'],
					'priority'         => $timing['priority'],
					'exclusive_ns'     => 0,
					'inclusive_ns'     => 0,
					'call_count'       => 0,
					'memory_delta'     => 0,
					'memory_exclusive' => 0,
				);
			}

			$by_source[ $key ]['callbacks'][ $cb_key ]['exclusive_ns']     += $timing['exclusive_ns'];
			$by_source[ $key ]['callbacks'][ $cb_key ]['inclusive_ns']     += $timing['inclusive_ns'];
			$by_source[ $key ]['callbacks'][ $cb_key ]['memory_delta']     += $mem_delta;
			$by_source[ $key ]['callbacks'][ $cb_key ]['memory_exclusive'] += $mem_excl;
			++$by_source[ $key ]['callbacks'][ $cb_key ]['call_count'];

			// Total allocated memory uses EXCLUSIVE positive deltas so nested
			// allocations are counted once, not once per enclosing frame.
			if ( $mem_excl > 0 ) {
				$total_mem_allocated += $mem_excl;
			}

			$total_excl_ns += $timing['exclusive_ns'];
		}

		// Sort sources by exclusive time descending.
		uasort(
			$by_source,
			function ( $a, $b ) {
				return $b['exclusive_ns'] <=> $a['exclusive_ns'];
			}
		);

		// Convert callbacks from keyed map to indexed list, sorted by exclusive time.
		foreach ( $by_source as &$source ) {
			$cbs = array_values( $source['callbacks'] );
			usort(
				$cbs,
				function ( $a, $b ) {
					return $b['exclusive_ns'] <=> $a['exclusive_ns'];
				}
			);
			$source['callbacks'] = $cbs;
		}
		unset( $source );

		// Compute breakdown percentages by type.
		$bootstrap_ns = isset( $request_metadata['bootstrap_ns'] ) ? (int) $request_metadata['bootstrap_ns'] : 0;
		$breakdown    = self::compute_breakdown( $by_source, $total_excl_ns, $duration_ns, $bootstrap_ns );

		$unattributed_ns = max( 0, $duration_ns - $total_excl_ns );

		// HTTP call summary.
		$http_calls    = isset( $request_metadata['http_calls'] ) ? $request_metadata['http_calls'] : array();
		$http_total_ms = 0;
		foreach ( $http_calls as $hc ) {
			$http_total_ms += isset( $hc['duration_ms'] ) ? (float) $hc['duration_ms'] : 0;
		}

		// Route classification.
		$route_class = ! empty( $request_metadata['route_class'] )
			? $request_metadata['route_class']
			: self::classify_route( $request_metadata );

		return array(
			'summary'            => array(
				'duration_ns'        => $duration_ns,
				'duration_ms'        => round( $duration_ns / 1e6, 2 ),
				'bootstrap_ns'       => $bootstrap_ns,
				'bootstrap_ms'       => round( $bootstrap_ns / 1e6, 2 ),
				'total_exclusive_ns' => $total_excl_ns,
				'unattributed_ns'    => $unattributed_ns,
				'breakdown'          => $breakdown,
				'callback_count'     => count( $raw_timings ),
				'truncated'          => ! empty( $request_metadata['truncated'] ),
				'source_count'       => count( $by_source ),
				'query_count'        => isset( $request_metadata['query_count'] ) ? (int) $request_metadata['query_count'] : 0,
				'http_call_count'    => count( $http_calls ),
				'http_total_ms'      => round( $http_total_ms, 2 ),
				'memory_peak'        => memory_get_peak_usage(),
				'memory_allocated'   => $total_mem_allocated,
				'asset_count'        => isset( $request_metadata['enqueued_assets']['counts'] )
					? ( $request_metadata['enqueued_assets']['counts']['scripts'] + $request_metadata['enqueued_assets']['counts']['styles'] )
					: 0,
				'asset_total_size'   => isset( $request_metadata['enqueued_assets']['total_size'] )
					? (int) $request_metadata['enqueued_assets']['total_size']
					: 0,
			),
			'sources'            => array_values( $by_source ),
			'trace'              => $call_stack_trace,
			'request'            => array(
				'url'         => isset( $request_metadata['url'] ) ? $request_metadata['url'] : '',
				'method'      => isset( $request_metadata['method'] ) ? $request_metadata['method'] : 'GET',
				'route_class' => $route_class,
				'php_version' => PHP_VERSION,
				'wp_version'  => isset( $request_metadata['wp_version'] ) ? $request_metadata['wp_version'] : '',
				'timestamp'   => isset( $request_metadata['timestamp'] ) ? $request_metadata['timestamp'] : time(),
				'memory_peak' => memory_get_peak_usage(),
				'user_role'   => isset( $request_metadata['user_role'] ) ? $request_metadata['user_role'] : 'anonymous',
				'referer'     => isset( $request_metadata['referer'] ) ? $request_metadata['referer'] : '',
				'ajax_action' => isset( $request_metadata['ajax_action'] ) ? $request_metadata['ajax_action'] : '',
			),
			'phase_markers'      => isset( $request_metadata['phase_markers'] ) ? $request_metadata['phase_markers'] : array(),
			'queries'            => isset( $request_metadata['queries'] ) ? $request_metadata['queries'] : array(),
			'http_calls'         => $http_calls,
			'autoloaded_options' => isset( $request_metadata['autoloaded_options'] ) ? $request_metadata['autoloaded_options'] : array(),
			'enqueued_assets'    => isset( $request_metadata['enqueued_assets'] ) ? $request_metadata['enqueued_assets'] : array(),
			'timeline'           => self::build_timeline( $raw_timings, $duration_ns ),
		);
	}

	/**
	 * Compute a percentage breakdown by attribution type.
	 *
	 * When bootstrap_ns is non-zero (mu-plugin installed), the total
	 * denominator expands to include pre-plugin boot time so percentages
	 * reflect the full request lifecycle.
	 *
	 * @param array $by_source      Sources keyed by type:slug.
	 * @param int   $total_excl_ns  Total exclusive nanoseconds.
	 * @param int   $duration_ns    Total request duration nanoseconds (profiler_start → shutdown).
	 * @param int   $bootstrap_ns   Pre-plugin boot time (mu-plugin → profiler_start). 0 when not available.
	 * @return array
	 */
	private static function compute_breakdown( $by_source, $total_excl_ns, $duration_ns, $bootstrap_ns = 0 ) {
		$types = array(
			'plugin'    => 0,
			'theme'     => 0,
			'core'      => 0,
			'mu-plugin' => 0,
			'drop-in'   => 0,
			'unknown'   => 0,
		);

		foreach ( $by_source as $source ) {
			$type = $source['type'];
			if ( isset( $types[ $type ] ) ) {
				$types[ $type ] += $source['exclusive_ns'];
			} else {
				$types['unknown'] += $source['exclusive_ns'];
			}
		}

		// Bootstrap is pre-plugin overhead; unattributed is between-hook gaps.
		if ( $bootstrap_ns > 0 ) {
			$types['bootstrap'] = $bootstrap_ns;
		}
		$unattributed_ns       = max( 0, $duration_ns - $total_excl_ns );
		$types['unattributed'] = $unattributed_ns;

		// Total denominator includes bootstrap so all segments sum to 100%.
		$total_ns = $duration_ns + $bootstrap_ns;

		$breakdown = array();
		foreach ( $types as $type => $ns ) {
			$pct = ( $total_ns > 0 ) ? round( ( $ns / $total_ns ) * 100, 1 ) : 0;
			if ( $ns > 0 || 'unattributed' === $type ) {
				$breakdown[ $type ] = array(
					'ns'      => $ns,
					'ms'      => round( $ns / 1e6, 2 ),
					'percent' => $pct,
				);
			}
		}

		return $breakdown;
	}

	/**
	 * Classify a request URL into a route category.
	 *
	 * @param array $metadata  Request metadata.
	 * @return string  Route class label.
	 */
	private static function classify_route( $metadata ) {
		$url = isset( $metadata['url'] ) ? $metadata['url'] : '';

		if ( empty( $url ) ) {
			return 'unknown';
		}

		$path = wp_parse_url( $url, PHP_URL_PATH );
		if ( null === $path ) {
			$path = '/';
		}

		// WP Admin.
		$admin_path = wp_parse_url( admin_url(), PHP_URL_PATH );
		if ( $admin_path && 0 === strpos( $path, $admin_path ) ) {
			return 'wp-admin';
		}

		// REST API.
		if ( false !== strpos( $path, '/wp-json/' ) || false !== strpos( $path, '/?rest_route=' ) ) {
			return 'rest-api';
		}

		// WP-Cron.
		if ( false !== strpos( $path, '/wp-cron.php' ) ) {
			return 'wp-cron';
		}

		// AJAX.
		if ( false !== strpos( $path, '/admin-ajax.php' ) ) {
			return 'admin-ajax';
		}

		// Login.
		if ( false !== strpos( $path, '/wp-login.php' ) ) {
			return 'wp-login';
		}

		// Front-end — can only be classified after WP has loaded query vars,
		// so we return 'frontend' and let a later pass refine it.
		return 'frontend';
	}

	/**
	 * Refine the route class using WordPress query conditionals.
	 *
	 * Should be called after the main query has run (e.g. on `wp`).
	 *
	 * @return string
	 */
	public static function classify_frontend_route() {
		if ( is_front_page() || is_home() ) {
			return 'frontend-home';
		}

		if ( is_singular() ) {
			return 'singular';
		}

		if ( is_archive() || is_category() || is_tag() || is_author() || is_date() ) {
			return 'archive';
		}

		if ( is_search() ) {
			return 'search';
		}

		if ( is_404() ) {
			return 'not-found';
		}

		// WooCommerce conditionals if available.
		if ( function_exists( 'is_shop' ) ) {
			if ( is_shop() ) {
				return 'woocommerce-shop';
			}
			if ( function_exists( 'is_cart' ) && is_cart() ) {
				return 'woocommerce-cart';
			}
			if ( function_exists( 'is_checkout' ) && is_checkout() ) {
				return 'woocommerce-checkout';
			}
			if ( function_exists( 'is_product' ) && is_product() ) {
				return 'woocommerce-product';
			}
		}

		return 'frontend';
	}

	/**
	 * Build a timeline of callback executions for the horizontal bar visualization.
	 *
	 * Each entry is a simplified representation of a timing event with its offset
	 * from request start, suitable for rendering as a horizontal bar chart.
	 *
	 * @param array $raw_timings  Raw timing entries from Instrumentor.
	 * @param int   $duration_ns  Total request duration.
	 * @return array<int, array>
	 */
	private static function build_timeline( $raw_timings, $duration_ns ) {
		if ( empty( $raw_timings ) || $duration_ns <= 0 ) {
			return array();
		}

		// Find the earliest start_ns to calculate offsets.
		$earliest_ns = PHP_INT_MAX;
		foreach ( $raw_timings as $t ) {
			if ( isset( $t['start_ns'] ) && $t['start_ns'] < $earliest_ns ) {
				$earliest_ns = $t['start_ns'];
			}
		}

		// Sort by start time.
		$sorted = $raw_timings;
		usort(
			$sorted,
			function ( $a, $b ) {
				return ( $a['start_ns'] ?? 0 ) <=> ( $b['start_ns'] ?? 0 );
			}
		);

		$timeline = array();
		foreach ( $sorted as $t ) {
			$offset_ns = max( 0, ( $t['start_ns'] ?? 0 ) - $earliest_ns );
			$wall_ns   = max( 0, ( $t['end_ns'] ?? 0 ) - ( $t['start_ns'] ?? 0 ) );
			$pct_start = ( $duration_ns > 0 ) ? round( ( $offset_ns / $duration_ns ) * 100, 3 ) : 0;
			$pct_width = ( $duration_ns > 0 ) ? round( ( $wall_ns / $duration_ns ) * 100, 3 ) : 0;

			$timeline[] = array(
				'callback'  => $t['callback'] ?? '',
				'tag'       => $t['tag'] ?? '',
				'source'    => ( $t['attribution']['slug'] ?? '' ),
				'type'      => ( $t['attribution']['type'] ?? '' ),
				'offset_ns' => $offset_ns,
				'wall_ns'   => $wall_ns,
				'excl_ns'   => $t['exclusive_ns'] ?? 0,
				'pct_start' => $pct_start,
				'pct_width' => $pct_width,
				'mem_after' => $t['memory_after'] ?? 0,
			);
		}

		return $timeline;
	}

	/**
	 * Regression-classification thresholds (INVARIANTS / D7). A "Likely
	 * Regression" requires ALL THREE; anything weaker is "Difference Observed"
	 * or within noise.
	 */
	const REGRESSION_MIN_SAMPLES   = 5;          // Matched requests per set.
	const REGRESSION_MIN_PCT       = 0.20;       // +20% median.
	const REGRESSION_MIN_DELTA_NS  = 100000000;  // +100ms median (in ns).
	const REGRESSION_MIN_DIRECTION = 3;          // Slower in >=3 of 5 quantiles.
	const NOISE_DELTA_NS           = 10000000;   // <10ms is within noise.
	const NOISE_PCT                = 0.05;       // <5% is within noise.

	/**
	 * Classify a duration change between two sets of route-matched requests.
	 *
	 * This is the statistical gate behind the "Likely Regression" language. It
	 * is deliberately conservative: a verdict of `likely_regression` is only
	 * returned when ALL THREE thresholds hold — enough samples, a meaningful
	 * median increase (both percentage AND absolute), and a consistent slower
	 * direction across quantiles. Otherwise the strongest claim is
	 * `difference_observed`. Pure function; callers supply route-matched
	 * baseline/current duration samples (nanoseconds).
	 *
	 * @param int[] $baseline_ns Baseline request durations (ns).
	 * @param int[] $current_ns  Current request durations (ns).
	 * @return array{verdict: string, median_baseline_ns: int, median_current_ns: int, delta_ns: int, pct_change: float, sample_count: array{baseline: int, current: int}, direction_slower: int}
	 */
	public static function classify_change( array $baseline_ns, array $current_ns ) {
		$nb = count( $baseline_ns );
		$nc = count( $current_ns );

		$median_baseline = self::median( $baseline_ns );
		$median_current  = self::median( $current_ns );
		$delta_ns        = $median_current - $median_baseline;
		$pct             = ( $median_baseline > 0 ) ? ( $delta_ns / $median_baseline ) : 0.0;

		$result = array(
			'verdict'            => 'within_noise',
			'median_baseline_ns' => $median_baseline,
			'median_current_ns'  => $median_current,
			'delta_ns'           => $delta_ns,
			'pct_change'         => $pct,
			'sample_count'       => array(
				'baseline' => $nb,
				'current'  => $nc,
			),
			'direction_slower'   => 0,
		);

		// Threshold 1: enough matched samples on both sides.
		if ( $nb < self::REGRESSION_MIN_SAMPLES || $nc < self::REGRESSION_MIN_SAMPLES ) {
			$result['verdict'] = 'insufficient_data';
			return $result;
		}

		// Threshold 3 input: how many of 5 quantiles moved slower.
		$slower                     = self::direction_slower_count( $baseline_ns, $current_ns );
		$result['direction_slower'] = $slower;

		// Threshold 2: median increase >= 20% AND >= 100ms.
		$meets_magnitude = ( $delta_ns >= self::REGRESSION_MIN_DELTA_NS ) && ( $pct >= self::REGRESSION_MIN_PCT );
		$meets_direction = ( $slower >= self::REGRESSION_MIN_DIRECTION );

		if ( $meets_magnitude && $meets_direction ) {
			$result['verdict'] = 'likely_regression';
			return $result;
		}

		// Past the noise floor but not all three thresholds: difference observed.
		$within_noise      = ( abs( $delta_ns ) < self::NOISE_DELTA_NS ) && ( abs( $pct ) < self::NOISE_PCT );
		$result['verdict'] = $within_noise ? 'within_noise' : 'difference_observed';

		return $result;
	}

	/**
	 * Build a coarse route fingerprint for baseline matching (D6).
	 *
	 * Only requests with the same fingerprint are comparable — this keeps
	 * checkout matched to checkout, not to the homepage. Dimensions: route
	 * class (which already encodes the page type, admin/front, and ajax/rest),
	 * authenticated vs anonymous, and — when a collector provides it — cache
	 * state. The fingerprint is deliberately coarse so genuinely-similar
	 * requests group together.
	 *
	 * @param array $request The `request` section of a compiled profile.
	 * @return string Stable fingerprint key.
	 */
	public static function route_fingerprint( array $request ) {
		$route_class = isset( $request['route_class'] ) && '' !== $request['route_class']
			? $request['route_class']
			: 'unknown';

		$role = ( isset( $request['user_role'] ) && 'anonymous' !== $request['user_role'] ) ? 'auth' : 'anon';

		$parts = array(
			'route:' . $route_class,
			'role:' . $role,
		);

		// Cache state is a forward-looking dimension; included only when present
		// so existing profiles (captured without it) still match each other.
		if ( ! empty( $request['cache_state'] ) ) {
			$parts[] = 'cache:' . $request['cache_state'];
		}

		return implode( '|', $parts );
	}

	/**
	 * Extract the duration samples (ns) of the profiles whose request matches
	 * a given route fingerprint.
	 *
	 * @param array[] $profiles    Compiled profiles (each with `request` + `summary`).
	 * @param string  $fingerprint Target fingerprint from route_fingerprint().
	 * @return int[] Matched durations in nanoseconds.
	 */
	public static function match_samples( array $profiles, $fingerprint ) {
		$samples = array();
		foreach ( $profiles as $profile ) {
			$request = isset( $profile['request'] ) && is_array( $profile['request'] ) ? $profile['request'] : array();
			if ( self::route_fingerprint( $request ) !== $fingerprint ) {
				continue;
			}
			if ( isset( $profile['summary']['duration_ns'] ) ) {
				$samples[] = (int) $profile['summary']['duration_ns'];
			}
		}
		return $samples;
	}

	/**
	 * Compare two route-matched sets of profiles and classify the change.
	 *
	 * Fingerprints the current set (using its first profile), gathers the
	 * route-matched duration samples from each set, and runs them through
	 * classify_change(). The returned verdict carries the fingerprint used so
	 * callers can show what was compared.
	 *
	 * @param array[] $baseline_profiles Earlier profiles.
	 * @param array[] $current_profiles  Later profiles.
	 * @return array classify_change() result plus a `fingerprint` key.
	 */
	public static function compare_route( array $baseline_profiles, array $current_profiles ) {
		$reference   = isset( $current_profiles[0]['request'] ) && is_array( $current_profiles[0]['request'] )
			? $current_profiles[0]['request']
			: array();
		$fingerprint = self::route_fingerprint( $reference );

		$result                = self::classify_change(
			self::match_samples( $baseline_profiles, $fingerprint ),
			self::match_samples( $current_profiles, $fingerprint )
		);
		$result['fingerprint'] = $fingerprint;

		return $result;
	}

	/**
	 * Render a classify_change()/compare_route() result as a human-readable,
	 * constitution-compliant sentence.
	 *
	 * Uses the exact approved terminology — "Likely Regression" and "Difference
	 * observed" — and never causal language ("caused", "slow"). Pure function;
	 * safe for both the dashboard and the API.
	 *
	 * @param array $result A classify_change() result.
	 * @return string One-line description.
	 */
	public static function describe_change( array $result ) {
		$verdict  = isset( $result['verdict'] ) ? $result['verdict'] : 'insufficient_data';
		$delta_ns = isset( $result['delta_ns'] ) ? (int) $result['delta_ns'] : 0;
		$delta_ms = round( $delta_ns / 1e6, 1 );
		$pct      = isset( $result['pct_change'] ) ? round( $result['pct_change'] * 100, 1 ) : 0.0;
		$count    = isset( $result['sample_count']['current'] ) ? (int) $result['sample_count']['current'] : 0;

		$signed_ms  = ( $delta_ms >= 0 ? '+' : '' ) . $delta_ms . 'ms';
		$signed_pct = ( $pct >= 0 ? '+' : '' ) . $pct . '%';

		switch ( $verdict ) {
			case 'likely_regression':
				return sprintf(
					'Likely Regression: %s (%s) median across %d matched requests.',
					$signed_ms,
					$signed_pct,
					$count
				);
			case 'difference_observed':
				$direction = ( $delta_ms >= 0 ) ? 'slower' : 'faster';
				return sprintf(
					'Difference observed: %s (%s) median, %s — not enough to call a regression.',
					$signed_ms,
					$signed_pct,
					$direction
				);
			case 'within_noise':
				return 'Within noise — no meaningful difference in server request duration.';
			case 'insufficient_data':
			default:
				return 'Not enough matched requests yet to compare.';
		}
	}

	/**
	 * Build the full regression-verdict payload for a route from its baseline +
	 * current sample windows (from Storage::get_route_comparison_samples()).
	 *
	 * Pure: runs compare_route() + describe_change() and shapes the response the
	 * REST endpoint and the dashboard AJAX handler both return, so the verdict
	 * is computed in exactly one place.
	 *
	 * @param array $samples { @type array[] $baseline, @type array[] $current }.
	 * @return array { verdict, message, fingerprint, delta_ns, delta_ms, pct_change, sample_count }.
	 */
	public static function regression_summary( array $samples ) {
		$baseline = isset( $samples['baseline'] ) && is_array( $samples['baseline'] ) ? $samples['baseline'] : array();
		$current  = isset( $samples['current'] ) && is_array( $samples['current'] ) ? $samples['current'] : array();

		$result   = self::compare_route( $baseline, $current );
		$delta_ns = isset( $result['delta_ns'] ) ? (int) $result['delta_ns'] : 0;

		return array(
			'verdict'      => isset( $result['verdict'] ) ? $result['verdict'] : 'insufficient_data',
			'message'      => self::describe_change( $result ),
			'fingerprint'  => isset( $result['fingerprint'] ) ? $result['fingerprint'] : '',
			'delta_ns'     => $delta_ns,
			'delta_ms'     => round( $delta_ns / 1e6, 1 ),
			'pct_change'   => isset( $result['pct_change'] ) ? $result['pct_change'] : 0,
			'sample_count' => isset( $result['sample_count'] ) ? $result['sample_count'] : array(),
		);
	}

	/**
	 * Integer median of a list of values.
	 *
	 * @param int[] $values Values.
	 * @return int Median (0 for an empty list).
	 */
	private static function median( array $values ) {
		$n = count( $values );
		if ( 0 === $n ) {
			return 0;
		}
		sort( $values );
		$mid = intdiv( $n, 2 );
		if ( 0 !== $n % 2 ) {
			return (int) $values[ $mid ];
		}
		return (int) round( ( $values[ $mid - 1 ] + $values[ $mid ] ) / 2 );
	}

	/**
	 * Count how many of five quantiles (10/30/50/70/90%) are slower in the
	 * current set than the baseline — the "consistent direction" signal.
	 *
	 * @param int[] $baseline Baseline durations.
	 * @param int[] $current  Current durations.
	 * @return int Number of quantiles (0-5) that moved slower.
	 */
	private static function direction_slower_count( array $baseline, array $current ) {
		sort( $baseline );
		sort( $current );
		$slower = 0;
		foreach ( array( 0.10, 0.30, 0.50, 0.70, 0.90 ) as $q ) {
			if ( self::quantile( $current, $q ) > self::quantile( $baseline, $q ) ) {
				++$slower;
			}
		}
		return $slower;
	}

	/**
	 * Nearest-rank quantile of a pre-sorted list.
	 *
	 * @param int[] $sorted Sorted values.
	 * @param float $q      Quantile in [0, 1].
	 * @return int Value at the quantile (0 for an empty list).
	 */
	private static function quantile( array $sorted, $q ) {
		$n = count( $sorted );
		if ( 0 === $n ) {
			return 0;
		}
		$idx = (int) floor( $q * ( $n - 1 ) );
		return (int) $sorted[ $idx ];
	}
}
