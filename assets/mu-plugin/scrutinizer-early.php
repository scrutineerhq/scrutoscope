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
