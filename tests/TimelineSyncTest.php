<?php
/**
 * Guards that the shared timeline renderer stays byte-identical across repos.
 *
 * assets/js/scrutinizer-timeline.js here must match src/scrutinizer-timeline.js
 * in the relay (scrutineerhq/scrutinizer-relay) exactly, so the WordPress
 * dashboard and the relay viewer render profiles the same way.
 *
 * When you change the timeline:
 *   1. Edit the canonical file and copy it to BOTH repos (identical bytes).
 *   2. Update EXPECTED_SHA256 below AND the matching constant in the relay's
 *      test/timeline-sync.test.js to the new hash (they must be equal).
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;

/**
 * @coversNothing
 */
class TimelineSyncTest extends TestCase {

	/**
	 * sha256 the shared renderer is pinned to. Must equal the relay's constant.
	 */
	const EXPECTED_SHA256 = '186b8f2d512b988f1273b3a07168a4360d47b365f220b6f29303cd412914c0c1';

	/**
	 * The shared renderer must match the byte-identical hash shared with the relay.
	 */
	public function test_shared_timeline_renderer_hash() {
		$path = dirname( __DIR__ ) . '/assets/js/scrutinizer-timeline.js';
		$this->assertFileExists( $path );
		$this->assertSame(
			self::EXPECTED_SHA256,
			hash_file( 'sha256', $path ),
			'scrutinizer-timeline.js drifted from the relay copy — re-sync both repos and update both hashes.'
		);
	}
}
