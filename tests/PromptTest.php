<?php
/**
 * Guards the AI-agent prompt's description of HTTP capture against the privacy
 * invariant: outbound URLs are reduced to scheme + host, never the full path.
 * This wording has regressed before, so assert the contract directly.
 *
 * @package Scrutoscope
 */

use PHPUnit\Framework\TestCase;
use Scrutoscope\Api\Prompt;

/**
 * @covers \Scrutoscope\Api\Prompt
 */
class PromptTest extends TestCase {

	public function test_http_capture_is_described_as_host_only() {
		$prompt = Prompt::build();
		$this->assertStringContainsString( 'scheme + host', $prompt );
	}

	public function test_prompt_never_claims_full_url_capture() {
		$prompt = Prompt::build();
		// The two phrasings that previously over-claimed full-URL capture.
		$this->assertStringNotContainsString( 'captured with URL', $prompt );
		$this->assertStringNotContainsString( 'HTTP calls with URL', $prompt );
	}
}
