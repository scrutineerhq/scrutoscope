<?php
/**
 * Guards that the shared timeline renderer stays byte-identical across repos.
 *
 * assets/js/scrutoscope-timeline.js here must match src/scrutoscope-timeline.js
 * in the relay (scrutineerhq/scrutoscope-relay) exactly, so the WordPress
 * dashboard and the relay viewer render profiles the same way.
 *
 * When you change the timeline:
 *   1. Edit the canonical file and copy it to BOTH repos (identical bytes).
 *   2. Update EXPECTED_SHA256 below AND the matching constant in the relay's
 *      test/timeline-sync.test.js to the new hash (they must be equal).
 *
 * @package Scrutoscope
 */

use PHPUnit\Framework\TestCase;

/**
 * @coversNothing
 */
class TimelineSyncTest extends TestCase {

	/**
	 * sha256 the shared renderer is pinned to. Must equal the relay's constant.
	 */
	const EXPECTED_SHA256 = '106196b977c7f935ed96eb014c23e4b4ce2b89debb009dcd11f6f1a19aa10b6f';

	/**
	 * The shared renderer must match the byte-identical hash shared with the relay.
	 */
	public function test_shared_timeline_renderer_hash() {
		$path = dirname( __DIR__ ) . '/assets/js/scrutoscope-timeline.js';
		$this->assertFileExists( $path );
		$this->assertSame(
			self::EXPECTED_SHA256,
			hash_file( 'sha256', $path ),
			'scrutoscope-timeline.js drifted from the relay copy — re-sync both repos and update both hashes.'
		);
	}
}
