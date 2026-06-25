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
					'type'         => $attr['type'],
					'slug'         => $attr['slug'],
					'name'         => $attr['name'],
					'exclusive_ns' => 0,
					'inclusive_ns' => 0,
					'call_count'   => 0,
					'memory_delta' => 0,
					'callbacks'    => array(),
				);
			}

			$mem_delta = $timing['memory_after'] - $timing['memory_before'];

			$by_source[ $key ]['exclusive_ns'] += $timing['exclusive_ns'];
			$by_source[ $key ]['inclusive_ns'] += $timing['inclusive_ns'];
			$by_source[ $key ]['memory_delta'] += $mem_delta;
			++$by_source[ $key ]['call_count'];

			// Per-callback detail.
			$cb_key = $timing['identity'];
			if ( ! isset( $by_source[ $key ]['callbacks'][ $cb_key ] ) ) {
				$by_source[ $key ]['callbacks'][ $cb_key ] = array(
					'callback'     => $timing['callback'],
					'tag'          => $timing['tag'],
					'priority'     => $timing['priority'],
					'exclusive_ns' => 0,
					'inclusive_ns' => 0,
					'call_count'   => 0,
					'memory_delta' => 0,
				);
			}

			$by_source[ $key ]['callbacks'][ $cb_key ]['exclusive_ns'] += $timing['exclusive_ns'];
			$by_source[ $key ]['callbacks'][ $cb_key ]['inclusive_ns'] += $timing['inclusive_ns'];
			$by_source[ $key ]['callbacks'][ $cb_key ]['memory_delta'] += $mem_delta;
			++$by_source[ $key ]['callbacks'][ $cb_key ]['call_count'];

			// Track total allocated memory (only positive deltas = actual allocations).
			if ( $mem_delta > 0 ) {
				$total_mem_allocated += $mem_delta;
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
			);
		}

		return $timeline;
	}
}
