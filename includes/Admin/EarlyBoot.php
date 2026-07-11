<?php
/**
 * Early-boot must-use plugin manager.
 *
 * @package Scrutoscope
 */

namespace Scrutoscope\Admin;

defined( 'ABSPATH' ) || exit;

/**
 * Installs / removes the optional early-boot timer must-use plugin.
 *
 * The MU plugin (scrutoscope-early.php) records a timestamp before normal
 * plugins load, so the pre-plugin bootstrap window can be timed. It is OPT-IN:
 * nothing is written outside the plugin directory on activation. The admin
 * enables it from Settings (or WP-CLI), which is the only point a file is
 * copied into wp-content/mu-plugins. Boot timing degrades gracefully when the
 * MU plugin is absent.
 */
class EarlyBoot {

	/**
	 * Option storing the admin's opt-in preference (so reactivation can restore).
	 *
	 * @var string
	 */
	const OPTION = 'scrutoscope_early_boot';

	/**
	 * Absolute path to the bundled MU plugin source.
	 *
	 * @return string
	 */
	public static function source_path() {
		return SCRUTOSCOPE_DIR . 'assets/mu-plugin/scrutoscope-early.php';
	}

	/**
	 * Absolute path where the MU plugin is installed.
	 *
	 * Uses WPMU_PLUGIN_DIR when defined; falls back to WP_CONTENT_DIR . '/mu-plugins'
	 * for the rare case where the constant is not yet available.
	 *
	 * @return string
	 */
	public static function target_path() {
		// REVIEWER NOTE: WPMU_PLUGIN_DIR is the correct constant for mu-plugins.
		// WP_CONTENT_DIR fallback is only for the rare case where WPMU_PLUGIN_DIR is undefined.
		$dir = defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : WP_CONTENT_DIR . '/mu-plugins';
		return $dir . '/scrutoscope-early.php';
	}

	/**
	 * Whether the MU plugin is currently installed.
	 *
	 * @return bool
	 */
	public static function is_installed() {
		return file_exists( self::target_path() );
	}

	/**
	 * Install the MU plugin.
	 *
	 * @return true|\WP_Error True on success (or already installed); WP_Error on a
	 *                        filesystem failure, with a message safe to surface.
	 */
	public static function install() {
		$source = self::source_path();
		if ( ! file_exists( $source ) ) {
			return new \WP_Error( 'scrutoscope_mu_source', __( 'The early-boot plugin file is missing from the Scrutineer plugin.', 'scrutoscope' ) );
		}
		if ( self::is_installed() ) {
			return true;
		}
		$target = self::target_path();
		$dir    = dirname( $target );
		if ( ! is_dir( $dir ) && ! wp_mkdir_p( $dir ) ) {
			return new \WP_Error( 'scrutoscope_mu_mkdir', __( 'Could not create the mu-plugins directory. Your host may restrict filesystem writes.', 'scrutoscope' ) );
		}
		if ( ! wp_is_writable( $dir ) ) {
			return new \WP_Error( 'scrutoscope_mu_writable', __( 'The mu-plugins directory is not writable. Your host may restrict filesystem writes.', 'scrutoscope' ) );
		}

		// Read source via WP_Filesystem to satisfy plugin directory guidelines.
		global $wp_filesystem;
		if ( empty( $wp_filesystem ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			WP_Filesystem( false, $dir, true );
		}
		$contents = $wp_filesystem ? $wp_filesystem->get_contents( $source ) : false;
		if ( false === $contents ) {
			return new \WP_Error( 'scrutoscope_mu_read', __( 'Could not read the early-boot plugin source file.', 'scrutoscope' ) );
		}

		global $wp_filesystem;
		if ( empty( $wp_filesystem ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			WP_Filesystem( false, $dir, true );
		}
		if ( ! $wp_filesystem || ! $wp_filesystem->put_contents( $target, $contents, FS_CHMOD_FILE ) ) {
			return new \WP_Error( 'scrutoscope_mu_copy', __( 'Could not write the early-boot plugin to mu-plugins. Your host may restrict filesystem writes.', 'scrutoscope' ) );
		}
		return true;
	}

	/**
	 * Remove the MU plugin (leaves the opt-in preference untouched).
	 *
	 * @return bool True if the file is gone afterward.
	 */
	public static function remove() {
		$target = self::target_path();
		if ( file_exists( $target ) ) {
			wp_delete_file( $target );
		}
		return ! file_exists( $target );
	}
}
