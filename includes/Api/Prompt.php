<?php
/**
 * Self-bootstrapping prompt builder.
 *
 * Generates the system prompt served by /v1/prompt that teaches
 * an AI agent how to use the Scrutoscope API, interpret profile data,
 * and provide diagnostic analysis.
 *
 * @package Scrutoscope
 */

namespace Scrutoscope\Api;

defined( 'ABSPATH' ) || exit;

/**
 * Builds the /v1/prompt response — the living API contract.
 */
class Prompt {

	/**
	 * Build the complete prompt text.
	 *
	 * @return string  The system prompt as plain text.
	 */
	public static function build() {
		$site_url = site_url();
		$api_base = rest_url( 'scrutoscope/v1/' );
		$wp_ver   = get_bloginfo( 'version' );
		$php_ver  = PHP_VERSION;

		$plugin_count = count( get_option( 'active_plugins', array() ) );

		global $wp_filesystem;
		if ( ! $wp_filesystem ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			WP_Filesystem();
		}
		$template = $wp_filesystem->get_contents( __DIR__ . '/prompt-template.txt' );

		return str_replace(
			array( '{site_url}', '{api_base}', '{wp_ver}', '{php_ver}', '{plugin_count}' ),
			array( $site_url, $api_base, $wp_ver, $php_ver, $plugin_count ),
			$template
		);
	}
}
