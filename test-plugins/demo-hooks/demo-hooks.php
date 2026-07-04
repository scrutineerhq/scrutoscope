<?php
/**
 * Plugin Name: Demo Hooks
 * Description: Test plugin that hooks into WordPress lifecycle and makes external HTTP calls for profiling demos.
 * Version: 1.0.0
 * Author: Demo
 *
 * @package DemoHooks
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Hook into init — simulates typical plugin setup work.
 */
add_action( 'init', 'demo_hooks_init', 10 );
function demo_hooks_init() {
	// Register a custom post type (typical plugin behavior).
	register_post_type(
		'sct_demo',
		array(
			'labels'  => array( 'name' => 'Demo Items', 'singular_name' => 'Demo Item' ),
			'public'  => false,
			'show_ui' => false,
		)
	);

	// Simulate some string processing work (~2-5ms).
	$data = array();
	for ( $i = 0; $i < 500; $i++ ) {
		$data[] = wp_generate_password( 32, true, true );
	}
	sort( $data );
}

/**
 * Hook into wp_loaded — make an external HTTP call.
 */
add_action( 'wp_loaded', 'demo_hooks_http_calls', 10 );
function demo_hooks_http_calls() {
	// Only run on front-end requests, not AJAX/cron.
	if ( wp_doing_ajax() || wp_doing_cron() || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
		return;
	}

	// External API call — httpbin echo.
	$response = wp_remote_get(
		'https://httpbin.org/get?scrutoscope=test',
		array( 'timeout' => 5 )
	);

	// Second call — a small JSON endpoint.
	$response2 = wp_remote_get(
		'https://jsonplaceholder.typicode.com/posts/1',
		array( 'timeout' => 5 )
	);
}

/**
 * Hook into template_redirect — register some autoloaded options.
 */
add_action( 'template_redirect', 'demo_hooks_options', 10 );
function demo_hooks_options() {
	// Read an option (creates it if missing, autoloaded).
	$counter = (int) get_option( 'sct_test_counter', 0 );
	update_option( 'sct_test_counter', $counter + 1, true );

	// Read a few more options to show autoloaded option tracking.
	get_option( 'sct_test_config', array( 'version' => '1.0', 'mode' => 'demo' ) );
	get_option( 'sct_test_feature_flags', array( 'dark_mode' => true, 'beta' => false ) );
}

/**
 * Enqueue a small inline script on the front end.
 */
add_action( 'wp_enqueue_scripts', 'demo_hooks_enqueue', 10 );
function demo_hooks_enqueue() {
	wp_register_script( 'sct-test-demo', false, array(), '1.0.0', true );
	wp_enqueue_script( 'sct-test-demo' );
	wp_add_inline_script( 'sct-test-demo', '/* Demo Hooks Plugin — demo inline script */' );

	wp_register_style( 'sct-test-demo-style', false, array(), '1.0.0' );
	wp_enqueue_style( 'sct-test-demo-style' );
	wp_add_inline_style( 'sct-test-demo-style', '/* Demo Hooks Plugin — demo inline style */' );
}

/**
 * Add a filter on the_content to simulate content filtering.
 */
add_filter( 'the_content', 'demo_hooks_content_filter', 10 );
function demo_hooks_content_filter( $content ) {
	// Simulate a typical content filter — add a small wrapper.
	if ( is_singular() ) {
		$content = '<div class="sct-test-wrap">' . $content . '</div>';
	}
	return $content;
}
