<?php
/**
 * Cron inventory diagnostic.
 *
 * Walks _get_cron_array() and reports all scheduled events with
 * overdue detection, duplicate identification, and source attribution.
 *
 * @package Scrutinizer\Diagnostics
 */

namespace Scrutinizer\Diagnostics;

use Scrutinizer\Profiler\Attribution;

class Cron {

	/**
	 * Collect full cron inventory.
	 *
	 * @return array {
	 *     @type array  $events    Flat list of scheduled events.
	 *     @type array  $summary   Counts, overdue count, next event, etc.
	 *     @type array  $schedules Available recurrence schedules.
	 *     @type array  $warnings  Issues found (overdue, duplicates).
	 * }
	 */
	public static function collect() {
		$cron_array = _get_cron_array();
		$schedules  = wp_get_schedules();
		$now        = time();

		$events   = array();
		$hooks    = array();
		$warnings = array();

		if ( ! is_array( $cron_array ) ) {
			return array(
				'events'    => array(),
				'summary'   => self::build_summary( array(), $now ),
				'schedules' => self::format_schedules( $schedules ),
				'warnings'  => array(),
			);
		}

		foreach ( $cron_array as $timestamp => $cron_hooks ) {
			if ( ! is_array( $cron_hooks ) ) {
				continue;
			}

			foreach ( $cron_hooks as $hook => $hook_events ) {
				if ( ! is_array( $hook_events ) ) {
					continue;
				}

				foreach ( $hook_events as $hash => $event ) {
					$schedule = ! empty( $event['schedule'] ) ? $event['schedule'] : false;
					$interval = ! empty( $event['interval'] ) ? (int) $event['interval'] : 0;
					$args     = ! empty( $event['args'] ) ? $event['args'] : array();
					$is_overdue = ( $timestamp <= $now );

					// Attribution: try to find who registered this hook.
					$attribution = self::attribute_hook( $hook );

					$entry = array(
						'hook'        => $hook,
						'timestamp'   => (int) $timestamp,
						'time_human'  => gmdate( 'Y-m-d H:i:s', $timestamp ) . ' UTC',
						'schedule'    => $schedule ?: 'once',
						'interval'    => $interval,
						'args'        => $args,
						'args_hash'   => $hash,
						'overdue'     => $is_overdue,
						'overdue_by'  => $is_overdue ? ( $now - $timestamp ) : 0,
						'attribution' => $attribution,
					);

					$events[] = $entry;

					// Track hook occurrences for duplicate detection.
					if ( ! isset( $hooks[ $hook ] ) ) {
						$hooks[ $hook ] = 0;
					}
					$hooks[ $hook ]++;

					if ( $is_overdue && $schedule ) {
						$warnings[] = array(
							'type'    => 'overdue_recurring',
							'hook'    => $hook,
							'overdue' => $now - $timestamp,
							'message' => sprintf(
								'Recurring event "%s" is %s overdue',
								$hook,
								self::human_interval( $now - $timestamp )
							),
						);
					}
				}
			}
		}

		// Detect duplicate hooks (same hook scheduled multiple times).
		foreach ( $hooks as $hook => $count ) {
			if ( $count > 1 ) {
				$warnings[] = array(
					'type'    => 'duplicate',
					'hook'    => $hook,
					'count'   => $count,
					'message' => sprintf(
						'Hook "%s" is scheduled %d times (possible duplicate)',
						$hook,
						$count
					),
				);
			}
		}

		// Sort events by timestamp.
		usort( $events, function ( $a, $b ) {
			return $a['timestamp'] - $b['timestamp'];
		});

		return array(
			'events'    => $events,
			'summary'   => self::build_summary( $events, $now ),
			'schedules' => self::format_schedules( $schedules ),
			'warnings'  => $warnings,
		);
	}

	/**
	 * Build summary stats.
	 *
	 * @param array $events All events.
	 * @param int   $now    Current timestamp.
	 * @return array
	 */
	private static function build_summary( $events, $now ) {
		$total     = count( $events );
		$recurring = 0;
		$oneshot   = 0;
		$overdue   = 0;
		$next_ts   = PHP_INT_MAX;

		$by_source = array();

		foreach ( $events as $ev ) {
			if ( 'once' === $ev['schedule'] ) {
				$oneshot++;
			} else {
				$recurring++;
			}

			if ( $ev['overdue'] ) {
				$overdue++;
			}

			if ( $ev['timestamp'] > $now && $ev['timestamp'] < $next_ts ) {
				$next_ts = $ev['timestamp'];
			}

			$source_key = $ev['attribution']['type'] . ':' . $ev['attribution']['slug'];
			if ( ! isset( $by_source[ $source_key ] ) ) {
				$by_source[ $source_key ] = array(
					'attribution' => $ev['attribution'],
					'count'       => 0,
				);
			}
			$by_source[ $source_key ]['count']++;
		}

		// Sort sources by count descending.
		usort( $by_source, function ( $a, $b ) {
			return $b['count'] - $a['count'];
		});

		return array(
			'total'      => $total,
			'recurring'  => $recurring,
			'one_shot'   => $oneshot,
			'overdue'    => $overdue,
			'next_event' => $next_ts < PHP_INT_MAX ? $next_ts : null,
			'by_source'  => $by_source,
		);
	}

	/**
	 * Format available schedules for display.
	 *
	 * @param array $schedules wp_get_schedules() output.
	 * @return array
	 */
	private static function format_schedules( $schedules ) {
		$out = array();
		foreach ( $schedules as $name => $data ) {
			$out[] = array(
				'name'     => $name,
				'interval' => (int) $data['interval'],
				'display'  => $data['display'],
			);
		}
		usort( $out, function ( $a, $b ) {
			return $a['interval'] - $b['interval'];
		});
		return $out;
	}

	/**
	 * Attempt to attribute a cron hook to a source.
	 *
	 * Strategy:
	 * 1. Known WP core cron hooks (hardcoded list).
	 * 2. Hook prefix matching against active plugin basenames.
	 * 3. Check if a callback is registered and trace it.
	 *
	 * @param string $hook Hook name.
	 * @return array { type, slug, name }
	 */
	private static function attribute_hook( $hook ) {
		// WP core cron hooks.
		$core_hooks = array(
			'wp_version_check',
			'wp_update_plugins',
			'wp_update_themes',
			'wp_scheduled_delete',
			'wp_scheduled_auto_draft_delete',
			'delete_expired_transients',
			'wp_privacy_delete_old_export_files',
			'wp_site_health_scheduled_check',
			'recovery_mode_clean_expired_keys',
			'wp_https_detection',
		);

		if ( in_array( $hook, $core_hooks, true ) ) {
			return array(
				'type' => 'core',
				'slug' => 'wordpress',
				'name' => 'WordPress Core',
			);
		}

		// Check if a callback is registered for this hook and trace it.
		global $wp_filter;
		if ( ! empty( $wp_filter[ $hook ] ) ) {
			$filter = $wp_filter[ $hook ];
			if ( $filter instanceof \WP_Hook ) {
				foreach ( $filter->callbacks as $priority => $callbacks ) {
					foreach ( $callbacks as $cb ) {
						$file = self::resolve_callback_file( $cb['function'] );
						if ( $file ) {
							return Attribution::classify( $file );
						}
					}
				}
			}
		}

		// Prefix heuristics: match against active plugin directory names.
		$active_plugins = get_option( 'active_plugins', array() );
		foreach ( $active_plugins as $plugin_file ) {
			$parts = explode( '/', $plugin_file );
			$slug  = $parts[0];
			// Normalize: scrutinizer_ → scrutinizer, woocommerce_ → woocommerce.
			$prefix = str_replace( '-', '_', $slug );
			if ( 0 === strpos( $hook, $prefix . '_' ) || 0 === strpos( $hook, $slug . '_' ) ) {
				$plugin_data = get_plugin_data( WP_PLUGIN_DIR . '/' . $plugin_file, false, false );
				return array(
					'type' => 'plugin',
					'slug' => $slug,
					'name' => ! empty( $plugin_data['Name'] ) ? $plugin_data['Name'] : $slug,
				);
			}
		}

		return array(
			'type' => 'unknown',
			'slug' => '',
			'name' => '',
		);
	}

	/**
	 * Resolve a callback to its source file.
	 *
	 * @param mixed $callback The callback.
	 * @return string|false File path or false.
	 */
	private static function resolve_callback_file( $callback ) {
		try {
			if ( is_string( $callback ) && is_callable( $callback ) ) {
				$ref = new \ReflectionFunction( $callback );
				return $ref->getFileName();
			}

			if ( is_array( $callback ) && count( $callback ) === 2 ) {
				$ref = new \ReflectionMethod( $callback[0], $callback[1] );
				return $ref->getFileName();
			}

			if ( is_object( $callback ) && $callback instanceof \Closure ) {
				$ref = new \ReflectionFunction( $callback );
				return $ref->getFileName();
			}
		} catch ( \ReflectionException $e ) {
			// Callback might not be resolvable.
		}

		return false;
	}

	/**
	 * Human-readable time interval.
	 *
	 * @param int $seconds Interval in seconds.
	 * @return string
	 */
	private static function human_interval( $seconds ) {
		if ( $seconds < 60 ) {
			return $seconds . 's';
		}
		if ( $seconds < 3600 ) {
			return round( $seconds / 60 ) . 'm';
		}
		if ( $seconds < 86400 ) {
			return round( $seconds / 3600, 1 ) . 'h';
		}
		return round( $seconds / 86400, 1 ) . 'd';
	}
}
