<?php
/**
 * Tests for the hard sanitization pass (the never-collect trust foundation).
 *
 * Sanitizer::sanitize() must strip filesystem paths, IPs, emails, and secret
 * constants from anything before it leaves the plugin — regardless of user
 * settings (D26). These guard that contract directly.
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Api\Sanitizer;

/**
 * @covers \Scrutinizer\Api\Sanitizer
 */
class SanitizerTest extends TestCase {

	public function test_filesystem_paths_are_scrubbed() {
		$out = Sanitizer::sanitize( 'Fatal error in /var/www/html/wp-content/plugins/woo/inc/cart.php on line 42' );
		$this->assertStringContainsString( '[path]', $out );
		$this->assertStringNotContainsString( '/var/www/html', $out );
		$this->assertStringNotContainsString( 'cart.php', $out );
	}

	public function test_ipv4_addresses_are_scrubbed() {
		$out = Sanitizer::sanitize( 'Request from 203.0.113.45 to 198.51.100.7' );
		$this->assertSame( 'Request from [ip] to [ip]', $out );
	}

	public function test_email_addresses_are_scrubbed() {
		$out = Sanitizer::sanitize( 'Notify admin@example.com about the issue' );
		$this->assertStringContainsString( '[email]', $out );
		$this->assertStringNotContainsString( 'admin@example.com', $out );
	}

	public function test_secret_constants_are_redacted() {
		$out = Sanitizer::sanitize( 'salt=' . AUTH_SALT . ' pass=' . DB_PASSWORD );
		$this->assertStringNotContainsString( AUTH_SALT, $out );
		$this->assertStringNotContainsString( DB_PASSWORD, $out );
		$this->assertStringContainsString( '[redacted]', $out );
	}

	public function test_sanitize_recurses_into_arrays() {
		$data  = array(
			'note'  => 'see /var/www/html/wp-config.php',
			'meta'  => array( 'ip' => 'client 203.0.113.9', 'ok' => 'plain text' ),
			'count' => 7,
		);
		$clean = Sanitizer::sanitize( $data );

		$this->assertStringContainsString( '[path]', $clean['note'] );
		$this->assertStringContainsString( '[ip]', $clean['meta']['ip'] );
		$this->assertSame( 'plain text', $clean['meta']['ok'] );
		$this->assertSame( 7, $clean['count'] ); // non-strings pass through unchanged
	}

	public function test_innocuous_text_is_unchanged() {
		$this->assertSame( 'WooCommerce: 312 callbacks, 28.7ms', Sanitizer::sanitize( 'WooCommerce: 312 callbacks, 28.7ms' ) );
	}

	public function test_sanitize_sql_reduces_to_verb_and_table() {
		$this->assertSame( 'SELECT wp_options', Sanitizer::sanitize_sql( "SELECT option_value FROM wp_options WHERE option_name = 'siteurl' LIMIT 1" ) );
	}
}
