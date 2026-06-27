<?php
/**
 * Tests for the centralized AJAX guard.
 *
 * Every AJAX action is registered through Ajax::add_ajax(), which runs
 * Ajax::guard() (nonce + manage_options) before the handler — so the security
 * gate can't be omitted from an individual handler. These verify the guard
 * blocks unauthorized callers and verifies the nonce, using lightweight stubs
 * of the WordPress functions it calls.
 *
 * @package Scrutinizer
 */

// Global stubs for the WP functions guard() calls (resolved via namespace
// fallback from Scrutinizer\Admin).
if ( ! function_exists( 'check_ajax_referer' ) ) {
	function check_ajax_referer( $action, $query_arg = false, $die = true ) {
		$GLOBALS['scrutinizer_test_nonce_checked'] = array( $action, $query_arg );
		return true;
	}
}
if ( ! function_exists( 'current_user_can' ) ) {
	function current_user_can( $capability ) {
		$GLOBALS['scrutinizer_test_last_cap'] = $capability;
		return ! empty( $GLOBALS['scrutinizer_test_can'] );
	}
}
if ( ! function_exists( 'wp_send_json_error' ) ) {
	function wp_send_json_error( $data = null, $status_code = null ) {
		throw new \RuntimeException( 'blocked:' . $status_code );
	}
}
if ( ! function_exists( '__' ) ) {
	function __( $text, $domain = 'default' ) {
		return $text;
	}
}

require_once __DIR__ . '/../includes/Admin/Ajax.php';

use PHPUnit\Framework\TestCase;
use Scrutinizer\Admin\Ajax;

/**
 * @covers \Scrutinizer\Admin\Ajax::guard
 */
class AjaxGuardTest extends TestCase {

	private function invoke_guard() {
		$method = new \ReflectionMethod( Ajax::class, 'guard' );
		$method->setAccessible( true );
		$method->invoke( null );
	}

	public function test_guard_verifies_the_nonce_and_allows_a_capable_user() {
		$GLOBALS['scrutinizer_test_can']           = true;
		$GLOBALS['scrutinizer_test_nonce_checked'] = null;

		$this->invoke_guard(); // must not throw

		$this->assertSame(
			array( 'scrutinizer_nonce', 'nonce' ),
			$GLOBALS['scrutinizer_test_nonce_checked'],
			'guard() must verify the scrutinizer nonce on the "nonce" field'
		);
	}

	public function test_guard_blocks_a_user_without_manage_options() {
		$GLOBALS['scrutinizer_test_can']      = false;
		$GLOBALS['scrutinizer_test_last_cap'] = null;

		try {
			$this->invoke_guard();
			$this->fail( 'guard() must block when the user lacks the capability' );
		} catch ( \RuntimeException $e ) {
			$this->assertSame( 'blocked:403', $e->getMessage() );
			$this->assertSame( 'manage_options', $GLOBALS['scrutinizer_test_last_cap'] );
		}
	}

	public function test_every_action_maps_to_a_real_handler_method() {
		$prop = new \ReflectionProperty( Ajax::class, 'actions' );
		$prop->setAccessible( true );
		$actions = $prop->getValue();

		$this->assertNotEmpty( $actions );
		foreach ( $actions as $action ) {
			$this->assertTrue(
				method_exists( Ajax::class, $action ),
				"Registered AJAX action '{$action}' has no handler method"
			);
		}
	}
}
