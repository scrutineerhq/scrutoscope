<?php
/**
 * Callback-to-source attribution utility.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Profiler;

/**
 * Maps a WordPress callback to its originating plugin, theme, or core file.
 *
 * Results are memoized per callback identity so that reflection is never
 * performed in the hot path after the first resolution.
 */
class Attribution {

	/**
	 * Memoization cache keyed by callback identity string.
	 *
	 * @var array<string, array>
	 */
	private static $cache = array();

	/**
	 * Resolve a WordPress callback to its source attribution.
	 *
	 * @param callable $callback  A WordPress callback (string, array, or Closure).
	 * @return array{type: string, slug: string, name: string, file: string, line: int}
	 */
	public static function resolve( $callback ) {
		$key = self::callback_identity( $callback );

		if ( isset( self::$cache[ $key ] ) ) {
			return self::$cache[ $key ];
		}

		$file = '';
		$line = 0;

		try {
			if ( $callback instanceof \Closure ) {
				$ref  = new \ReflectionFunction( $callback );
				$file = (string) $ref->getFileName();
				$line = (int) $ref->getStartLine();
			} elseif ( is_array( $callback ) && count( $callback ) >= 2 ) {
				$ref  = new \ReflectionMethod( $callback[0], $callback[1] );
				$file = (string) $ref->getFileName();
				$line = (int) $ref->getStartLine();
			} elseif ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
				// String static method callback: 'ClassName::methodName' or '\Namespace\Class::method'.
				$parts  = explode( '::', $callback, 2 );
				$class  = ltrim( $parts[0], '\\' );
				$method = $parts[1];
				if ( class_exists( $class, false ) ) {
					$ref  = new \ReflectionMethod( $class, $method );
					$file = (string) $ref->getFileName();
					$line = (int) $ref->getStartLine();
				} elseif ( class_exists( $class ) ) {
					// Trigger autoloader, then reflect.
					$ref  = new \ReflectionMethod( $class, $method );
					$file = (string) $ref->getFileName();
					$line = (int) $ref->getStartLine();
				}
			} elseif ( is_string( $callback ) && function_exists( $callback ) ) {
				$ref  = new \ReflectionFunction( $callback );
				$file = (string) $ref->getFileName();
				$line = (int) $ref->getStartLine();
			}
		} catch ( \ReflectionException $e ) {
			// Silently fall through to unknown.
			$file = '';
		}

		$result = self::classify( $file );

		// Namespace fallback: when file-path matching fails but we know the
		// class, try to match the class's namespace root to a plugin slug.
		if ( 'unknown' === $result['type'] ) {
			$class_name = self::extract_class_name( $callback );
			if ( $class_name ) {
				$ns_result = self::classify_by_namespace( $class_name );
				if ( 'unknown' !== $ns_result['type'] ) {
					$result = $ns_result;
				}
			}
		}

		$result['file'] = $file;
		$result['line'] = $line;

		self::$cache[ $key ] = $result;

		return $result;
	}

	/**
	 * Classify a source file path as plugin, theme, core, mu-plugin, drop-in, or unknown.
	 *
	 * @param string $file  Absolute file path.
	 * @return array{type: string, slug: string, name: string}
	 */
	public static function classify( $file ) {
		$result = array(
			'type' => 'unknown',
			'slug' => '',
			'name' => '',
		);

		if ( empty( $file ) ) {
			return $result;
		}

		$file = wp_normalize_path( $file );

		// Plugin directory.
		$plugin_dir = wp_normalize_path( WP_PLUGIN_DIR );
		if ( 0 === strpos( $file, $plugin_dir . '/' ) ) {
			$relative = substr( $file, strlen( $plugin_dir ) + 1 );
			$parts    = explode( '/', $relative, 2 );
			$slug     = $parts[0];

			$result['type'] = 'plugin';
			$result['slug'] = $slug;
			$result['name'] = self::plugin_name_from_slug( $slug );

			return $result;
		}

		// MU-plugins directory.
		$mu_dir = wp_normalize_path( WPMU_PLUGIN_DIR );
		if ( 0 === strpos( $file, $mu_dir . '/' ) ) {
			$relative = substr( $file, strlen( $mu_dir ) + 1 );
			$parts    = explode( '/', $relative, 2 );

			$result['type'] = 'mu-plugin';
			$result['slug'] = $parts[0];
			$result['name'] = $parts[0];

			return $result;
		}

		// Theme directory.
		$theme_roots = (array) get_theme_root();
		foreach ( $theme_roots as $theme_root ) {
			$theme_root = wp_normalize_path( $theme_root );
			if ( 0 === strpos( $file, $theme_root . '/' ) ) {
				$relative = substr( $file, strlen( $theme_root ) + 1 );
				$parts    = explode( '/', $relative, 2 );
				$slug     = $parts[0];

				$result['type'] = 'theme';
				$result['slug'] = $slug;
				$result['name'] = $slug;

				return $result;
			}
		}

		// wp-content drop-ins (e.g. object-cache.php, advanced-cache.php).
		$content_dir = wp_normalize_path( WP_CONTENT_DIR );
		if ( 0 === strpos( $file, $content_dir . '/' ) ) {
			$relative = substr( $file, strlen( $content_dir ) + 1 );
			if ( false === strpos( $relative, '/' ) ) {
				$result['type'] = 'drop-in';
				$result['slug'] = basename( $relative, '.php' );
				$result['name'] = basename( $relative );

				return $result;
			}
		}

		// WordPress core (ABSPATH).
		$abspath = wp_normalize_path( ABSPATH );
		if ( 0 === strpos( $file, $abspath ) ) {
			$result['type']      = 'core';
			$result['slug']      = 'wordpress'; // phpcs:ignore WordPress.WP.CapitalPDangit.MisspelledInText -- data slug, not prose.
			$result['name']      = 'WordPress Core';
			$result['subsystem'] = self::core_subsystem( $file );

			return $result;
		}

		return $result;
	}

	/**
	 * Map a WordPress core file to a coarse subsystem label.
	 *
	 * Breaks the single "core" attribution bucket into the parts a core
	 * developer cares about (Query, i18n, Blocks, REST...). Returns a label
	 * only — never the path. Best-effort; unrecognised files fall to
	 * "Core (other)".
	 *
	 * @param string $file Absolute path to a core file.
	 * @return string Subsystem label.
	 */
	private static function core_subsystem( $file ) {
		$file = wp_normalize_path( $file );

		// Reduce to the path within wp-includes / wp-admin.
		$rel  = basename( $file );
		$area = '';
		$pos  = strpos( $file, '/wp-includes/' );
		if ( false !== $pos ) {
			$rel = substr( $file, $pos + 13 );
		} else {
			$pos = strpos( $file, '/wp-admin/' );
			if ( false !== $pos ) {
				$rel  = substr( $file, $pos + 9 );
				$area = 'admin';
			}
		}

		// Directory-scoped subsystems (checked before filenames).
		if ( 0 === strpos( $rel, 'blocks/' ) || 0 === strpos( $rel, 'block-bindings/' ) || 0 === strpos( $rel, 'block-patterns/' ) || 0 === strpos( $rel, 'block-supports/' ) ) {
			return 'Blocks';
		}
		if ( 0 === strpos( $rel, 'rest-api/' ) ) {
			return 'REST API';
		}
		if ( 0 === strpos( $rel, 'pomo/' ) || 0 === strpos( $rel, 'l10n/' ) ) {
			return 'i18n';
		}
		if ( 0 === strpos( $rel, 'html-api/' ) ) {
			return 'HTML API';
		}
		if ( 0 === strpos( $rel, 'sodium_compat/' ) || 0 === strpos( $rel, 'Requests/' ) || 0 === strpos( $rel, 'SimplePie/' ) || 0 === strpos( $rel, 'Text/' ) || 0 === strpos( $rel, 'ID3/' ) || 0 === strpos( $rel, 'IXR/' ) ) {
			return 'Vendored libs';
		}
		if ( 'admin' === $area ) {
			return 'Admin';
		}

		// Filename-scoped subsystems — ordered, most specific needle first.
		$base = basename( $rel );
		$map  = array(
			'textdomain'        => 'i18n',
			'translation'       => 'i18n',
			'locale'            => 'i18n',
			'l10n'              => 'i18n',
			'rest'              => 'REST API',
			'block'             => 'Blocks',
			'query'             => 'Query',
			'option'            => 'Options',
			'script-loader'     => 'Assets',
			'scripts'           => 'Assets',
			'styles'            => 'Assets',
			'dependencies'      => 'Assets',
			'rewrite'           => 'Rewrite',
			'cron'              => 'Cron',
			'widget'            => 'Widgets',
			'shortcode'         => 'Shortcodes',
			'embed'             => 'Embeds',
			'kses'              => 'Sanitization',
			'formatting'        => 'Formatting',
			'taxonomy'          => 'Taxonomy',
			'category'          => 'Taxonomy',
			'term'              => 'Taxonomy',
			'comment'           => 'Comments',
			'capabilit'         => 'Users & auth',
			'pluggable'         => 'Users & auth',
			'session'           => 'Users & auth',
			'role'              => 'Users & auth',
			'user'              => 'Users & auth',
			'auth'              => 'Users & auth',
			'revision'          => 'Posts',
			'post'              => 'Posts',
			'template'          => 'Template',
			'theme'             => 'Theme',
			'media'             => 'Media',
			'image'             => 'Media',
			'thumbnail'         => 'Media',
			'http'              => 'HTTP',
			'cache'             => 'Cache',
			'hook'              => 'Hooks',
			'meta'              => 'Meta',
			'default-filters'   => 'Bootstrap',
			'default-constants' => 'Bootstrap',
			'load'              => 'Bootstrap',
		);
		foreach ( $map as $needle => $sub ) {
			if ( false !== strpos( $base, $needle ) ) {
				return $sub;
			}
		}

		return 'Core (other)';
	}

	/**
	 * Derive a human-readable name from a plugin slug.
	 *
	 * Falls back to the slug itself if the plugin data is unavailable.
	 *
	 * @param string $slug  Plugin directory name.
	 * @return string
	 */
	private static function plugin_name_from_slug( $slug ) {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$plugins = get_plugins();
		foreach ( $plugins as $path => $data ) {
			if ( 0 === strpos( $path, $slug . '/' ) ) {
				return $data['Name'];
			}
		}

		return $slug;
	}

	/**
	 * Build a string identity for a callback suitable as a memoization key.
	 *
	 * @param callable $callback  WordPress callback.
	 * @return string
	 */
	public static function callback_identity( $callback ) {
		if ( $callback instanceof \Closure ) {
			return 'closure_' . spl_object_id( $callback );
		}

		if ( is_array( $callback ) && count( $callback ) >= 2 ) {
			$class = is_object( $callback[0] )
				? get_class( $callback[0] ) . '#' . spl_object_id( $callback[0] )
				: (string) $callback[0];

			return $class . '::' . $callback[1];
		}

		if ( is_string( $callback ) ) {
			return $callback;
		}

		if ( is_object( $callback ) && method_exists( $callback, '__invoke' ) ) {
			return get_class( $callback ) . '#' . spl_object_id( $callback ) . '::__invoke';
		}

		return 'unknown_' . md5( wp_json_encode( $callback ) );
	}

	/**
	 * Build a short human-readable label for a callback.
	 *
	 * @param callable $callback  WordPress callback.
	 * @return string
	 */
	public static function callback_label( $callback ) {
		if ( $callback instanceof \Closure ) {
			try {
				$ref = new \ReflectionFunction( $callback );
				return sprintf( '{closure:%s:%d}', basename( $ref->getFileName() ), $ref->getStartLine() );
			} catch ( \ReflectionException $e ) {
				return '{closure}';
			}
		}

		if ( is_array( $callback ) && count( $callback ) >= 2 ) {
			$class = is_object( $callback[0] ) ? get_class( $callback[0] ) : (string) $callback[0];
			return $class . '::' . $callback[1];
		}

		if ( is_string( $callback ) ) {
			return $callback;
		}

		if ( is_object( $callback ) && method_exists( $callback, '__invoke' ) ) {
			return get_class( $callback ) . '::__invoke';
		}

		return '{unknown}';
	}

	/**
	 * Check whether a callback belongs to the Scrutinizer plugin.
	 *
	 * @param array $attribution  Result from resolve().
	 * @return bool
	 */
	public static function is_self( $attribution ) {
		// Match by the plugin's own directory rather than a hardcoded slug, so
		// a renamed plugin folder doesn't cause us to instrument (and double-
		// wrap) our own callbacks.
		if ( ! empty( $attribution['file'] ) && defined( 'SCRUTINIZER_DIR' ) ) {
			$dir  = wp_normalize_path( SCRUTINIZER_DIR );
			$file = wp_normalize_path( $attribution['file'] );
			if ( '' !== $dir && 0 === strpos( $file, $dir ) ) {
				return true;
			}
		}
		return 'plugin' === $attribution['type'] && 'scrutinizer' === $attribution['slug'];
	}

	/**
	 * Clear the memoization cache.
	 */
	public static function clear_cache() {
		self::$cache = array();
	}

	/**
	 * Extract the class name from a callback.
	 *
	 * @param callable $callback  WordPress callback.
	 * @return string|false  Fully qualified class name, or false.
	 */
	private static function extract_class_name( $callback ) {
		if ( is_array( $callback ) && count( $callback ) >= 2 ) {
			return is_object( $callback[0] ) ? get_class( $callback[0] ) : (string) $callback[0];
		}

		if ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
			$parts = explode( '::', $callback, 2 );
			return ltrim( $parts[0], '\\' );
		}

		if ( is_object( $callback ) && ! ( $callback instanceof \Closure ) ) {
			return get_class( $callback );
		}

		return false;
	}

	/**
	 * Namespace → plugin mapping cache.
	 *
	 * @var array<string, array>|null
	 */
	private static $namespace_map = null;

	/**
	 * Try to attribute a class to a plugin via its namespace.
	 *
	 * Builds a map of namespace prefixes → plugin slugs by scanning active
	 * plugins' composer.json autoload.psr-4 entries, then falls back to
	 * matching the root namespace (case-insensitive) against plugin directory
	 * names.
	 *
	 * @param string $class_name  Fully qualified class name (no leading backslash).
	 * @return array{type: string, slug: string, name: string}
	 */
	private static function classify_by_namespace( $class_name ) {
		$unknown = array(
			'type' => 'unknown',
			'slug' => '',
			'name' => '',
		);

		if ( empty( $class_name ) || false === strpos( $class_name, '\\' ) ) {
			// Non-namespaced class — try direct slug match (e.g., class 'wordfence').
			$slug_guess = strtolower( $class_name );
			$plugin_dir = wp_normalize_path( WP_PLUGIN_DIR );
			if ( is_dir( $plugin_dir . '/' . $slug_guess ) ) {
				return array(
					'type' => 'plugin',
					'slug' => $slug_guess,
					'name' => self::plugin_name_from_slug( $slug_guess ),
				);
			}
			return $unknown;
		}

		// Build the namespace map once.
		if ( null === self::$namespace_map ) {
			self::$namespace_map = self::build_namespace_map();
		}

		// Try longest-prefix match against the map.
		$ns_parts = explode( '\\', $class_name );
		for ( $i = count( $ns_parts ) - 1; $i >= 1; $i-- ) {
			$prefix = implode( '\\', array_slice( $ns_parts, 0, $i ) ) . '\\';
			if ( isset( self::$namespace_map[ $prefix ] ) ) {
				$slug = self::$namespace_map[ $prefix ];
				return array(
					'type' => 'plugin',
					'slug' => $slug,
					'name' => self::plugin_name_from_slug( $slug ),
				);
			}
		}

		// Last resort: match root namespace against plugin directory names.
		$root       = strtolower( $ns_parts[0] );
		$plugin_dir = wp_normalize_path( WP_PLUGIN_DIR );
		if ( is_dir( $plugin_dir . '/' . $root ) ) {
			return array(
				'type' => 'plugin',
				'slug' => $root,
				'name' => self::plugin_name_from_slug( $root ),
			);
		}

		return $unknown;
	}

	/**
	 * Build a map of PSR-4 namespace prefix → plugin slug from composer.json files.
	 *
	 * @return array<string, string>  Keys are namespace prefixes (with trailing backslash),
	 *                                values are plugin slugs.
	 */
	private static function build_namespace_map() {
		$map        = array();
		$plugin_dir = wp_normalize_path( WP_PLUGIN_DIR );

		if ( ! is_dir( $plugin_dir ) ) {
			return $map;
		}

		$entries = scandir( $plugin_dir );
		if ( ! $entries ) {
			return $map;
		}

		foreach ( $entries as $slug ) {
			if ( '.' === $slug[0] ) {
				continue;
			}

			$composer_path = $plugin_dir . '/' . $slug . '/composer.json';
			if ( ! file_exists( $composer_path ) ) {
				continue;
			}

			// Local file read of a plugin's own composer.json — not a remote
			// fetch, so wp_remote_get does not apply.
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			$json = file_get_contents( $composer_path );
			if ( ! $json ) {
				continue;
			}

			$data = json_decode( $json, true );
			if ( ! is_array( $data ) ) {
				continue;
			}

			// Extract PSR-4 autoload prefixes.
			$autoload = array();
			if ( isset( $data['autoload']['psr-4'] ) && is_array( $data['autoload']['psr-4'] ) ) {
				$autoload = array_merge( $autoload, $data['autoload']['psr-4'] );
			}
			if ( isset( $data['autoload-dev']['psr-4'] ) && is_array( $data['autoload-dev']['psr-4'] ) ) {
				$autoload = array_merge( $autoload, $data['autoload-dev']['psr-4'] );
			}

			foreach ( $autoload as $prefix => $path ) {
				$map[ $prefix ] = $slug;
			}
		}

		return $map;
	}
}
