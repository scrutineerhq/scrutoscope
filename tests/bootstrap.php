<?php
/**
 * PHPUnit bootstrap for pure-unit tests.
 *
 * These tests exercise classes that have no WordPress dependencies, so no WP
 * test suite is required. The classes are required directly. Integration tests
 * that need WP_UnitTestCase are a separate, future suite.
 *
 * @package Scrutinizer
 */

require_once __DIR__ . '/../includes/Profiler/QueryReducer.php';
require_once __DIR__ . '/../includes/Profiler/CallStack.php';
