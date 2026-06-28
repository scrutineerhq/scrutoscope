<?php
/**
 * Scrutinizer Early Boot Timer
 *
 * Captures the earliest possible timestamp for pre-plugin bootstrap measurement.
 * Auto-installed by Scrutinizer. Remove via WP-CLI: wp scrutinizer mu-plugin remove
 *
 * @package Scrutinizer
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SCRUTINIZER_BOOT_NS', hrtime( true ) );

// Capture muplugins_loaded so the pre-plugin bootstrap can be split into the
// must-use phase and the active-plugin-loading phase. add_action() is available
// here — plugin.php loads in wp-settings before mu-plugins.
add_action(
	'muplugins_loaded',
	function () {
		if ( ! defined( 'SCRUTINIZER_MUPLUGINS_LOADED_NS' ) ) {
			define( 'SCRUTINIZER_MUPLUGINS_LOADED_NS', hrtime( true ) );
		}
	},
	-2147483648 // PHP_INT_MIN — run as early as possible.
);
