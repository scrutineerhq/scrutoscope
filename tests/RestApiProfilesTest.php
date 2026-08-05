<?php
/**
 * Tests for the GET /scrutoscope/v1/profiles list endpoint helpers.
 *
 * The endpoint exists so external integrations (e.g. Minn Admin) can list
 * individual captures without reading the profiles table directly. Its
 * response field names and types are part of the public API contract
 * (see .context/INVARIANTS.md → Public API Surface), so these tests guard
 * the shape against accidental drift.
 *
 * @package Scrutoscope
 */

use PHPUnit\Framework\TestCase;
use Scrutoscope\Api\RestApi;

/**
 * @covers \Scrutoscope\Api\RestApi
 */
class RestApiProfilesTest extends TestCase {

	public function test_kind_filter_maps_pinned_to_pinned_only() {
		$this->assertSame( array( 'pinned_only' => true ), RestApi::map_profiles_kind_filter( 'pinned' ) );
	}

	public function test_kind_filter_maps_profile_types() {
		foreach ( array( 'session', 'background', 'on_demand' ) as $type ) {
			$this->assertSame( array( 'profile_type' => $type ), RestApi::map_profiles_kind_filter( $type ) );
		}
	}

	public function test_kind_filter_ignores_empty_and_unknown() {
		$this->assertSame( array(), RestApi::map_profiles_kind_filter( '' ) );
		$this->assertSame( array(), RestApi::map_profiles_kind_filter( 'bogus' ) );
	}

	public function test_list_item_shape_is_complete_and_typed() {
		$item = RestApi::shape_profile_list_item(
			array(
				'id'              => '42',
				'route_key'       => 'GET:/shop',
				'route_class'     => 'frontend',
				'request_method'  => 'GET',
				'request_url'     => 'https://site.example/shop',
				'profile_type'    => 'background',
				'duration_ns'     => '25150000',
				'user_role'       => 'administrator',
				'captured_at'     => '2026-08-05 03:59:07',
				'is_pinned'       => '1',
				'note'            => 'baseline',
				'tags'            => 'ability-test',
				'response_status' => '200',
			)
		);

		// Contract field set, in order.
		$this->assertSame(
			array( 'id', 'route', 'route_class', 'request_method', 'request_url', 'profile_type', 'duration_ns', 'duration_ms', 'user_role', 'captured_at', 'is_pinned', 'note', 'tags', 'response_status' ),
			array_keys( $item )
		);

		$this->assertSame( 42, $item['id'] );
		$this->assertSame( 'GET:/shop', $item['route'] );
		$this->assertSame( 'background', $item['profile_type'] );
		$this->assertSame( 25150000.0, $item['duration_ns'] );
		$this->assertSame( 25.2, $item['duration_ms'] );
		$this->assertTrue( $item['is_pinned'] );
		$this->assertSame( 200, $item['response_status'] );
	}

	public function test_list_item_defaults_are_safe() {
		$item = RestApi::shape_profile_list_item( array() );

		$this->assertSame( 0, $item['id'] );
		$this->assertSame( '', $item['route'] );
		$this->assertSame( 'session', $item['profile_type'] );
		$this->assertSame( 0.0, $item['duration_ns'] );
		$this->assertSame( 0.0, $item['duration_ms'] );
		$this->assertFalse( $item['is_pinned'] );
		$this->assertSame( 0, $item['response_status'] );
	}
}
