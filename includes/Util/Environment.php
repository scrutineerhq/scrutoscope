<?php
/**
 * Environment detection – OPCache, JIT, object cache, autoload limits.
 *
 * Centralizes read-only environment checks so Profiler, Diagnostics,
 * and API stay consistent.
 *
 * @package Scrutoscope
 */

namespace Scrutoscope\Util;

defined( 'ABSPATH' ) || exit;

/**
 * Shared helper for host environment health.
 */
class Environment {

	/**
	 * Detect persistent object cache type.
	 *
	 * @return string 'none','redis','memcached','unknown'
	 */
	public static function detect_object_cache() {
		if ( ! function_exists( 'wp_using_ext_object_cache' ) || ! wp_using_ext_object_cache() ) {
			return 'none';
		}
		if ( class_exists( 'Redis' ) || class_exists( 'Predis\\Client' ) ) {
			return 'redis';
		}
		if ( class_exists( 'Memcached' ) || class_exists( 'Memcache' ) ) {
			return 'memcached';
		}
		return 'unknown';
	}

	/**
	 * Get OPCache status.
	 *
	 * @return array{enabled: bool, hit_rate: float|null, memory_used: int|null, memory_free: int|null}
	 */
	public static function get_opcache_info() {
		$enabled  = false;
		$hit_rate = null;
		$used     = null;
		$free     = null;

		if ( function_exists( 'opcache_get_status' ) ) {
			// @phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			$status = @opcache_get_status( false );
			if ( is_array( $status ) ) {
				if ( isset( $status['opcache_enabled'] ) ) {
					$enabled = (bool) $status['opcache_enabled'];
				}
				if ( isset( $status['opcache_statistics']['opcache_hit_rate'] ) ) {
					$hit_rate = (float) $status['opcache_statistics']['opcache_hit_rate'];
				} elseif ( isset( $status['opcache_statistics']['hits'], $status['opcache_statistics']['misses'] ) ) {
					$hits  = (int) $status['opcache_statistics']['hits'];
					$miss  = (int) $status['opcache_statistics']['misses'];
					$total = $hits + $miss;
					if ( $total > 0 ) {
						$hit_rate = round( $hits / $total * 100, 2 );
					}
				}
				if ( isset( $status['memory_usage']['used_memory'] ) ) {
					$used = (int) $status['memory_usage']['used_memory'];
				}
				if ( isset( $status['memory_usage']['free_memory'] ) ) {
					$free = (int) $status['memory_usage']['free_memory'];
				}
			}
		}

		// Fallback to ini when status unavailable (e.g., CLI).
		if ( ! $enabled ) {
			$ini = ini_get( 'opcache.enable' );
			if ( '1' === $ini || 'true' === strtolower( (string) $ini ) ) {
				$enabled = true;
			}
			if ( PHP_SAPI === 'cli' ) {
				$cli = ini_get( 'opcache.enable_cli' );
				if ( '1' === $cli || 'true' === strtolower( (string) $cli ) ) {
					$enabled = true;
				}
			}
		}

		return array(
			'enabled'     => $enabled,
			'hit_rate'    => $hit_rate,
			'memory_used' => $used,
			'memory_free' => $free,
		);
	}

	/**
	 * Get JIT status (PHP 8+).
	 *
	 * @return array{enabled: bool, buffer_size: string|null, kind: string|null}
	 */
	public static function get_jit_info() {
		$enabled     = false;
		$buffer_size = null;
		$kind        = null;

		if ( function_exists( 'opcache_get_status' ) ) {
			// @phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			$status = @opcache_get_status( false );
			if ( is_array( $status ) && isset( $status['jit'] ) && is_array( $status['jit'] ) ) {
				if ( isset( $status['jit']['enabled'] ) ) {
					$enabled = (bool) $status['jit']['enabled'];
				}
				if ( isset( $status['jit']['buffer_size'] ) ) {
					$buffer_size = (string) $status['jit']['buffer_size'];
				}
				if ( isset( $status['jit']['kind'] ) ) {
					$kind = (string) $status['jit']['kind'];
				}
				if ( isset( $status['jit']['on'] ) ) {
					$enabled = (bool) $status['jit']['on'];
				}
			}
		}

		if ( ! $enabled ) {
			$jit = ini_get( 'opcache.jit' );
			if ( is_string( $jit ) && '' !== $jit && '0' !== $jit && 'disable' !== $jit && 'off' !== strtolower( $jit ) ) {
				$enabled = true;
				$kind    = $jit;
			}
			$buf = ini_get( 'opcache.jit_buffer_size' );
			if ( is_string( $buf ) && '' !== $buf && '0' !== $buf ) {
				$buffer_size = $buf;
			}
		}

		return array(
			'enabled'     => $enabled,
			'buffer_size' => $buffer_size,
			'kind'        => $kind,
		);
	}

	/**
	 * Get full environment health snapshot for profile.
	 *
	 * @return array
	 */
	public static function get_env_health() {
		return array(
			'php_version'  => PHP_VERSION,
			'opcache'      => self::get_opcache_info(),
			'jit'          => self::get_jit_info(),
			'object_cache' => self::detect_object_cache(),
		);
	}

	/**
	 * Get max autoloaded option size (WP 6.6+).
	 *
	 * @return int Bytes
	 */
	public static function get_max_autoload_size() {
		if ( function_exists( 'wp_max_autoloaded_option_size' ) ) {
			return (int) wp_max_autoloaded_option_size();
		}
		if ( function_exists( 'apply_filters' ) ) {
			$filtered = apply_filters( 'wp_max_autoloaded_option_size', 150000 );
			if ( is_int( $filtered ) && $filtered > 0 ) {
				return $filtered;
			}
			if ( is_numeric( $filtered ) && (int) $filtered > 0 ) {
				return (int) $filtered;
			}
		}
		return 150000;
	}
}
