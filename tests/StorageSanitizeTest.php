<?php
/**
 * Tests for write-time URL reduction in Storage::sanitize_profile().
 *
 * The CONSTITUTION lists full URLs / query strings under hard never-collect.
 * Query strings carry secrets (reset keys, tokens, API keys) and PII; outbound
 * call paths carry webhook/bot secrets. These assert the reduction happens
 * before anything is persisted.
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Profiler\Storage;

/**
 * @covers \Scrutinizer\Profiler\Storage
 */
class StorageSanitizeTest extends TestCase {

	public function test_request_url_keeps_path_drops_query() {
		$out = Storage::sanitize_profile(
			array( 'request' => array( 'url' => 'https://site.example/checkout?reset_key=SECRET&step=2' ) )
		);
		$this->assertSame( 'https://site.example/checkout', $out['request']['url'] );
	}

	public function test_request_referer_query_is_stripped() {
		$out = Storage::sanitize_profile(
			array( 'request' => array( 'referer' => 'https://google.com/search?q=private+search+terms' ) )
		);
		$this->assertSame( 'https://google.com/search', $out['request']['referer'] );
	}

	public function test_outbound_http_call_is_reduced_to_host() {
		$out = Storage::sanitize_profile(
			array(
				'http_calls' => array(
					array( 'url' => 'https://hooks.slack.com/services/T000/B000/XXXXSECRETtoken' ),
					array( 'url' => 'https://api.telegram.org/bot123456:SECRET/sendMessage' ),
				),
			)
		);
		// Host only — the secret-bearing path is gone.
		$this->assertSame( 'https://hooks.slack.com', $out['http_calls'][0]['url'] );
		$this->assertSame( 'https://api.telegram.org', $out['http_calls'][1]['url'] );
		$this->assertStringNotContainsString( 'SECRET', wp_json_encode( $out['http_calls'] ) );
	}

	public function test_enqueued_asset_src_query_is_stripped() {
		$out = Storage::sanitize_profile(
			array(
				'enqueued_assets' => array(
					'scripts' => array(
						array( 'src' => 'https://site.example/wp-content/plugins/pro/app.js?ver=2.1&license=ABCD-SECRET' ),
					),
					'styles'  => array(
						array( 'src' => 'https://site.example/wp-content/themes/x/style.css?ver=9' ),
					),
				),
			)
		);
		$this->assertSame( 'https://site.example/wp-content/plugins/pro/app.js', $out['enqueued_assets']['scripts'][0]['src'] );
		$this->assertSame( 'https://site.example/wp-content/themes/x/style.css', $out['enqueued_assets']['styles'][0]['src'] );
		$this->assertStringNotContainsString( 'license', wp_json_encode( $out['enqueued_assets'] ) );
	}

	public function test_non_array_input_passes_through() {
		$this->assertSame( 'not an array', Storage::sanitize_profile( 'not an array' ) );
	}

	public function test_missing_keys_do_not_error() {
		$out = Storage::sanitize_profile( array( 'summary' => array( 'duration_ns' => 5 ) ) );
		$this->assertSame( array( 'summary' => array( 'duration_ns' => 5 ) ), $out );
	}
}
