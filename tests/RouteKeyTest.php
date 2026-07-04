<?php
/**
 * Tests for StorageRouteAggregates::normalize_route_key().
 *
 * @package Scrutoscope
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../includes/Profiler/StorageRouteAggregates.php';

use Scrutoscope\Profiler\StorageRouteAggregates;

class RouteKeyTest extends \PHPUnit\Framework\TestCase {

	public function test_simple_get_path() {
		$key = StorageRouteAggregates::normalize_route_key( 'GET', 'https://example.com/shop' );
		$this->assertSame( 'GET:/shop', $key );
	}

	public function test_method_uppercased() {
		$key = StorageRouteAggregates::normalize_route_key( 'post', 'https://example.com/wp-login.php' );
		$this->assertSame( 'POST:/wp-login.php', $key );
	}

	public function test_trailing_slash_collapsed() {
		$key = StorageRouteAggregates::normalize_route_key( 'GET', 'https://example.com/shop/' );
		$this->assertSame( 'GET:/shop', $key );
	}

	public function test_root_path() {
		$key = StorageRouteAggregates::normalize_route_key( 'GET', 'https://example.com/' );
		$this->assertSame( 'GET:/', $key );
	}

	public function test_root_no_trailing_slash() {
		$key = StorageRouteAggregates::normalize_route_key( 'GET', 'https://example.com' );
		$this->assertSame( 'GET:/', $key );
	}

	public function test_ajax_action_groups_by_action() {
		$key = StorageRouteAggregates::normalize_route_key(
			'POST',
			'https://example.com/wp-admin/admin-ajax.php',
			'heartbeat'
		);
		$this->assertSame( 'POST:ajax:heartbeat', $key );
	}

	public function test_ajax_without_action_uses_path() {
		$key = StorageRouteAggregates::normalize_route_key(
			'POST',
			'https://example.com/wp-admin/admin-ajax.php'
		);
		$this->assertSame( 'POST:/wp-admin/admin-ajax.php', $key );
	}

	public function test_query_string_stripped() {
		$key = StorageRouteAggregates::normalize_route_key( 'GET', 'https://example.com/page?foo=bar&baz=1' );
		$this->assertSame( 'GET:/page', $key );
	}

	public function test_deep_path() {
		$key = StorageRouteAggregates::normalize_route_key( 'GET', 'https://example.com/wp-json/scrutoscope/v1/profile/42' );
		$this->assertSame( 'GET:/wp-json/scrutoscope/v1/profile/42', $key );
	}

	public function test_multiple_trailing_slashes() {
		$key = StorageRouteAggregates::normalize_route_key( 'GET', 'https://example.com/path///' );
		$this->assertSame( 'GET:/path', $key );
	}
}
