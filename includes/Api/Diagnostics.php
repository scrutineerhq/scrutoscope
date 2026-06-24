<?php
/**
 * Site diagnostics collector.
 *
 * Gathers WordPress environment data for the /v1/diagnostics endpoint,
 * respecting user opt-in preferences. All output passes through Sanitizer
 * before leaving the plugin.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Api;

/**
 * Collects site fingerprint data for diagnostic context.
 */
class Diagnostics {

	/**
	 * Option key for storing which diagnostic fields are enabled.
	 *
	 * @var string
	 */
	const OPTION_FIELDS = 'scrutinizer_diagnostics_fields';

	/**
	 * Opt-in field keys and their display labels.
	 *
	 * @var array
	 */
	const OPT_IN_FIELDS = array(
		'php_memory_limit'       => 'PHP memory limit',
		'php_max_execution_time' => 'PHP max execution time',
		'opcache_enabled'        => 'OPcache status',
		'opcache_memory'         => 'OPcache memory allocation',
		'upload_max_filesize'    => 'Upload max filesize',
		'web_server'             => 'Web server identity',
		'https'                  => 'HTTPS status',
		'wp_debug'               => 'WP_DEBUG state',
		'cron_transport'         => 'Cron transport',
		'autoloaded_options_size' => 'Autoloaded options size',
		'scale'                  => 'Post/user/comment counts',
	);

	/**
	 * Get the list of currently enabled opt-in field keys.
	 *
	 * @return string[]
	 */
	public static function get_enabled_fields() {
		$enabled = get_option( self::OPTION_FIELDS, array() );
		return is_array( $enabled ) ? $enabled : array();
	}

	/**
	 * Update the list of enabled opt-in field keys.
	 *
	 * @param string[] $fields  Array of field keys from OPT_IN_FIELDS.
	 * @return bool
	 */
	public static function set_enabled_fields( $fields ) {
		// Validate against known field keys.
		$valid = array_intersect( $fields, array_keys( self::OPT_IN_FIELDS ) );
		return update_option( self::OPTION_FIELDS, $valid );
	}

	/**
	 * Collect the full diagnostics payload.
	 *
	 * Always-included fields are always present. Opt-in fields appear
	 * only when enabled by the user.
	 *
	 * @return array  Sanitized diagnostics data.
	 */
	public static function collect() {
		$enabled = self::get_enabled_fields();

		$data = array(
			'api_version' => '1',
			'site'        => self::collect_site( $enabled ),
			'plugins'     => self::collect_plugins(),
			'theme'       => self::collect_theme(),
		);

		if ( in_array( 'scale', $enabled, true ) ) {
			$data['scale'] = self::collect_scale();
		}

		return Sanitizer::sanitize( $data );
	}

	/**
	 * Collect site environment data.
	 *
	 * @param string[] $enabled  Enabled opt-in field keys.
	 * @return array
	 */
	private static function collect_site( $enabled ) {
		global $wpdb;

		$site = array(
			'wordpress_version'  => get_bloginfo( 'version' ),
			'php_version'        => PHP_VERSION,
			'mysql_version'      => $wpdb->db_version(),
			'multisite'          => is_multisite(),
			'permalink_structure' => get_option( 'permalink_structure', '' ),
			'object_cache'       => self::detect_object_cache(),
			'page_cache_detected' => self::detect_page_cache(),
		);

		// Opt-in fields.
		if ( in_array( 'web_server', $enabled, true ) ) {
			$site['web_server'] = isset( $_SERVER['SERVER_SOFTWARE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['SERVER_SOFTWARE'] ) ) : 'unknown';
		}

		if ( in_array( 'https', $enabled, true ) ) {
			$site['https'] = is_ssl();
		}

		if ( in_array( 'wp_debug', $enabled, true ) ) {
			$site['wp_debug'] = defined( 'WP_DEBUG' ) && WP_DEBUG;
		}

		if ( in_array( 'cron_transport', $enabled, true ) ) {
			$site['cron_transport'] = ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ) ? 'system' : 'wp-cron';
		}

		if ( in_array( 'php_memory_limit', $enabled, true ) ) {
			$site['php_memory_limit'] = ini_get( 'memory_limit' );
		}

		if ( in_array( 'php_max_execution_time', $enabled, true ) ) {
			$site['php_max_execution_time'] = (int) ini_get( 'max_execution_time' );
		}

		if ( in_array( 'opcache_enabled', $enabled, true ) ) {
			$site['opcache_enabled'] = function_exists( 'opcache_get_status' ) && ! empty( opcache_get_status( false )['opcache_enabled'] );
		}

		if ( in_array( 'opcache_memory', $enabled, true ) && function_exists( 'opcache_get_configuration' ) ) {
			$config = opcache_get_configuration();
			if ( isset( $config['directives']['opcache.memory_consumption'] ) ) {
				$site['opcache_memory'] = $config['directives']['opcache.memory_consumption'] . 'M';
			}
		}

		if ( in_array( 'upload_max_filesize', $enabled, true ) ) {
			$site['upload_max_filesize'] = ini_get( 'upload_max_filesize' );
		}

		if ( in_array( 'autoloaded_options_size', $enabled, true ) ) {
			$site['autoloaded_options_size'] = self::get_autoloaded_options_size();
		}

		return $site;
	}

	/**
	 * Collect active plugins.
	 *
	 * Returns slugs only — never file paths.
	 *
	 * @return array
	 */
	private static function collect_plugins() {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$active = get_option( 'active_plugins', array() );
		$slugs  = array();

		foreach ( $active as $plugin_file ) {
			// Plugin file is "slug/slug.php" or "slug.php".
			$parts  = explode( '/', $plugin_file );
			$slugs[] = $parts[0];
		}

		return array(
			'active_count' => count( $slugs ),
			'active'       => $slugs,
		);
	}

	/**
	 * Collect active theme info.
	 *
	 * @return array
	 */
	private static function collect_theme() {
		$theme = wp_get_theme();
		$data  = array(
			'slug' => $theme->get_stylesheet(),
		);

		$parent = $theme->parent();
		if ( $parent ) {
			$data['parent'] = $parent->get_stylesheet();
		}

		return $data;
	}

	/**
	 * Collect content scale counts (order of magnitude).
	 *
	 * @return array
	 */
	private static function collect_scale() {
		$posts    = wp_count_posts();
		$total    = isset( $posts->publish ) ? (int) $posts->publish : 0;
		$users    = count_users();
		$comments = wp_count_comments();

		return array(
			'posts'    => '~' . self::round_magnitude( $total ),
			'users'    => '~' . self::round_magnitude( isset( $users['total_users'] ) ? $users['total_users'] : 0 ),
			'comments' => '~' . self::round_magnitude( isset( $comments->approved ) ? (int) $comments->approved : 0 ),
		);
	}

	/**
	 * Round a number to its order of magnitude for privacy.
	 *
	 * @param int $n  The count.
	 * @return string
	 */
	private static function round_magnitude( $n ) {
		if ( $n < 10 ) {
			return (string) $n;
		}
		$mag = pow( 10, floor( log10( $n ) ) );
		return (string) ( round( $n / $mag ) * $mag );
	}

	/**
	 * Detect the type of persistent object cache in use.
	 *
	 * @return string  'none', 'redis', 'memcached', or 'unknown'.
	 */
	private static function detect_object_cache() {
		if ( ! wp_using_ext_object_cache() ) {
			return 'none';
		}

		// Check for common object cache drop-in signatures.
		if ( class_exists( 'Redis' ) || class_exists( 'Predis\\Client' ) ) {
			return 'redis';
		}

		if ( class_exists( 'Memcached' ) || class_exists( 'Memcache' ) ) {
			return 'memcached';
		}

		return 'unknown';
	}

	/**
	 * Detect whether a page cache is likely active.
	 *
	 * Heuristic: check for common page cache indicators.
	 *
	 * @return bool
	 */
	private static function detect_page_cache() {
		// WP Super Cache.
		if ( defined( 'WPCACHEHOME' ) ) {
			return true;
		}

		// W3 Total Cache.
		if ( defined( 'W3TC' ) ) {
			return true;
		}

		// WP Fastest Cache.
		if ( class_exists( 'WpFastestCache' ) ) {
			return true;
		}

		// LiteSpeed Cache.
		if ( defined( 'LSCWP_V' ) ) {
			return true;
		}

		// Check for advanced-cache.php drop-in.
		if ( defined( 'WP_CONTENT_DIR' ) && file_exists( WP_CONTENT_DIR . '/advanced-cache.php' ) ) {
			return true;
		}

		return false;
	}

	/**
	 * Get the total size of autoloaded options.
	 *
	 * @return string  Human-readable size string.
	 */
	private static function get_autoloaded_options_size() {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$size = $wpdb->get_var(
			"SELECT SUM(LENGTH(option_value)) FROM {$wpdb->options} WHERE autoload = 'yes'"
		);

		if ( null === $size ) {
			return 'unknown';
		}

		$bytes = (int) $size;
		if ( $bytes >= 1048576 ) {
			return round( $bytes / 1048576, 1 ) . 'MB';
		}

		return round( $bytes / 1024, 1 ) . 'KB';
	}
}
