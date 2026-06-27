<?php
/**
 * Route regression orchestration.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

/**
 * Produces a route's regression verdict, preferring the long-term aggregate
 * (which can compare across windows that outlive the profile TTL) and falling
 * back to the retained raw profiles when there isn't enough aggregate history
 * yet (e.g. a fresh install before a baseline window has accrued).
 */
class Regression {

	/**
	 * Regression verdict for a route.
	 *
	 * @param string $route_key     Route grouping key.
	 * @param int    $recent_days   Recent window length in days (aggregate path).
	 * @param int    $baseline_days Baseline window length in days (aggregate path).
	 * @return array { verdict, message, fingerprint, source, delta_ns, delta_ms, pct_change, sample_count }.
	 */
	public static function for_route( $route_key, $recent_days = 7, $baseline_days = 7 ) {
		$route_key   = (string) $route_key;
		$fingerprint = Storage::fingerprint_for_route_key( $route_key );

		// Aggregate path: recent window vs an older baseline window (cross-TTL).
		if ( '' !== $fingerprint ) {
			$windows = Storage::get_route_stat_windows( $fingerprint, $recent_days, $baseline_days );
			$result  = Report::classify_histograms( $windows['baseline']['histogram'], $windows['recent']['histogram'] );

			if ( 'insufficient_data' !== $result['verdict'] ) {
				$delta_ns = (int) $result['delta_ns'];
				return array(
					'verdict'      => $result['verdict'],
					'message'      => Report::describe_change( $result ),
					'fingerprint'  => $fingerprint,
					'source'       => 'aggregate',
					'delta_ns'     => $delta_ns,
					'delta_ms'     => round( $delta_ns / 1e6, 1 ),
					'pct_change'   => $result['pct_change'],
					'sample_count' => $result['sample_count'],
				);
			}
		}

		// Fallback: recent-vs-older within the retained raw profiles.
		$samples        = Storage::get_route_comparison_samples( $route_key );
		$data           = Report::regression_summary( $samples );
		$data['source'] = 'recent';

		return $data;
	}
}
