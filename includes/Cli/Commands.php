<?php
/**
 * WP-CLI commands for Scrutinizer.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Cli;

use Scrutinizer\Profiler\Storage;
use Scrutinizer\Profiler\Session;
use WP_CLI;
use WP_CLI\Utils;

/**
 * WordPress Performance Profiler — inspect and manage profiling data.
 *
 * ## EXAMPLES
 *
 *     # List recent profiles
 *     wp scrutinizer list
 *
 *     # Show pinned profiles for a specific route
 *     wp scrutinizer list --route="GET:/wp-admin/index.php" --pinned
 *
 *     # View profile detail
 *     wp scrutinizer show 42
 *
 *     # Export a profile as JSON
 *     wp scrutinizer export 42 --file=profile-42.json
 *
 *     # Check profiler status
 *     wp scrutinizer status
 */
class Commands {

	/**
	 * List saved profiles.
	 *
	 * ## OPTIONS
	 *
	 * [--route=<route_key>]
	 * : Filter by route key (e.g. "GET:/wp-admin/index.php").
	 *
	 * [--pinned]
	 * : Show only pinned profiles.
	 *
	 * [--limit=<number>]
	 * : Maximum rows to return.
	 * ---
	 * default: 20
	 * ---
	 *
	 * [--format=<format>]
	 * : Output format.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 *   - csv
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp scrutinizer list --limit=10
	 *     wp scrutinizer list --route="POST:/wp-admin/admin-ajax.php" --format=json
	 *     wp scrutinizer list --pinned
	 *
	 * @subcommand list
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function list_( $args, $assoc_args ) {
		$search_args = array(
			'limit' => (int) Utils\get_flag_value( $assoc_args, 'limit', 20 ),
		);

		$route = Utils\get_flag_value( $assoc_args, 'route', '' );
		if ( $route ) {
			$search_args['route_key'] = $route;
		}

		if ( Utils\get_flag_value( $assoc_args, 'pinned', false ) ) {
			$search_args['pinned_only'] = true;
		}

		$profiles = Storage::search_profiles( $search_args );

		if ( empty( $profiles ) ) {
			WP_CLI::log( 'No profiles found.' );
			return;
		}

		$rows = array();
		foreach ( $profiles as $p ) {
			$duration_ms = round( $p['duration_ns'] / 1e6, 1 );
			$rows[]      = array(
				'ID'       => $p['id'],
				'Route'    => $p['route_key'] ?: $p['route_class'],
				'Method'   => $p['request_method'],
				'Duration' => $duration_ms . ' ms',
				'Captured' => $p['captured_at'],
				'Pinned'   => $p['is_pinned'] ? '📌' : '',
			);
		}

		$format = Utils\get_flag_value( $assoc_args, 'format', 'table' );
		Utils\format_items( $format, $rows, array( 'ID', 'Route', 'Method', 'Duration', 'Captured', 'Pinned' ) );
	}

	/**
	 * Display full detail for a single profile.
	 *
	 * ## OPTIONS
	 *
	 * <id>
	 * : Profile ID.
	 *
	 * [--format=<format>]
	 * : Output format.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp scrutinizer show 42
	 *     wp scrutinizer show 42 --format=json
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function show( $args, $assoc_args ) {
		$id      = (int) $args[0];
		$profile = Storage::get_profile( $id );

		if ( ! $profile ) {
			WP_CLI::error( "Profile {$id} not found." );
		}

		$format = Utils\get_flag_value( $assoc_args, 'format', 'table' );

		if ( 'json' === $format ) {
			WP_CLI::log( wp_json_encode( $profile, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) );
			return;
		}

		$data    = $profile['profile_data'];
		$summary = isset( $data['summary'] ) ? $data['summary'] : array();

		// Header.
		WP_CLI::log( '' );
		WP_CLI::log( WP_CLI::colorize( '%BProfile #' . $id . '%n' ) );
		WP_CLI::log( str_repeat( '─', 60 ) );

		// Summary.
		$summary_rows = array(
			array( 'Key' => 'URL', 'Value' => $profile['request_url'] ),
			array( 'Key' => 'Method', 'Value' => $profile['request_method'] ),
			array( 'Key' => 'Route', 'Value' => $profile['route_key'] ?: $profile['route_class'] ),
			array( 'Key' => 'Duration', 'Value' => round( isset( $summary['duration_ms'] ) ? $summary['duration_ms'] : 0, 1 ) . ' ms' ),
			array( 'Key' => 'Peak Memory', 'Value' => self::format_bytes( isset( $summary['peak_memory'] ) ? $summary['peak_memory'] : 0 ) ),
			array( 'Key' => 'DB Queries', 'Value' => isset( $summary['query_count'] ) ? $summary['query_count'] : 'n/a' ),
			array( 'Key' => 'HTTP Calls', 'Value' => isset( $summary['http_call_count'] ) ? $summary['http_call_count'] : 0 ),
			array( 'Key' => 'Callbacks', 'Value' => isset( $summary['callback_count'] ) ? $summary['callback_count'] : 0 ),
			array( 'Key' => 'Sources', 'Value' => isset( $summary['source_count'] ) ? $summary['source_count'] : 0 ),
			array( 'Key' => 'Role', 'Value' => $profile['user_role'] ),
			array( 'Key' => 'Captured', 'Value' => $profile['captured_at'] ),
			array( 'Key' => 'Pinned', 'Value' => $profile['is_pinned'] ? 'Yes' : 'No' ),
		);

		if ( ! empty( $profile['note'] ) ) {
			$summary_rows[] = array( 'Key' => 'Note', 'Value' => $profile['note'] );
		}
		if ( ! empty( $profile['tags'] ) ) {
			$summary_rows[] = array( 'Key' => 'Tags', 'Value' => $profile['tags'] );
		}

		Utils\format_items( 'table', $summary_rows, array( 'Key', 'Value' ) );

		// Sources breakdown.
		$sources = isset( $data['sources'] ) ? $data['sources'] : array();
		if ( ! empty( $sources ) ) {
			WP_CLI::log( '' );
			WP_CLI::log( WP_CLI::colorize( '%BSources%n' ) );

			$source_rows = array();
			foreach ( $sources as $s ) {
				$source_rows[] = array(
					'Source'    => isset( $s['name'] ) ? $s['name'] : '(unknown)',
					'Type'     => isset( $s['type'] ) ? $s['type'] : '',
					'Excl.'    => round( isset( $s['exclusive_ms'] ) ? $s['exclusive_ms'] : 0, 2 ) . ' ms',
					'Weight'   => isset( $s['weight_pct'] ) ? round( $s['weight_pct'], 1 ) . '%' : '',
					'Calls'    => isset( $s['call_count'] ) ? $s['call_count'] : '',
				);
			}

			Utils\format_items( 'table', $source_rows, array( 'Source', 'Type', 'Excl.', 'Weight', 'Calls' ) );
		}
	}

	/**
	 * Delete a profile.
	 *
	 * ## OPTIONS
	 *
	 * <id>
	 * : Profile ID to delete.
	 *
	 * [--yes]
	 * : Skip confirmation prompt.
	 *
	 * ## EXAMPLES
	 *
	 *     wp scrutinizer delete 42
	 *     wp scrutinizer delete 42 --yes
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function delete( $args, $assoc_args ) {
		$id = (int) $args[0];

		$profile = Storage::get_profile( $id );
		if ( ! $profile ) {
			WP_CLI::error( "Profile {$id} not found." );
		}

		WP_CLI::confirm(
			sprintf(
				'Delete profile #%d (%s %s, %s ms)?',
				$id,
				$profile['request_method'],
				$profile['request_url'],
				round( $profile['profile_data']['summary']['duration_ms'], 1 )
			),
			$assoc_args
		);

		$deleted = Storage::delete_profile( $id );

		if ( $deleted ) {
			WP_CLI::success( "Deleted profile #{$id}." );
		} else {
			WP_CLI::error( "Failed to delete profile #{$id}." );
		}
	}

	/**
	 * Export a profile as JSON.
	 *
	 * ## OPTIONS
	 *
	 * <id>
	 * : Profile ID to export.
	 *
	 * [--file=<path>]
	 * : Write to a file instead of stdout.
	 *
	 * ## EXAMPLES
	 *
	 *     wp scrutinizer export 42
	 *     wp scrutinizer export 42 --file=profile-42.json
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function export( $args, $assoc_args ) {
		$id      = (int) $args[0];
		$profile = Storage::get_profile( $id );

		if ( ! $profile ) {
			WP_CLI::error( "Profile {$id} not found." );
		}

		$json = wp_json_encode( $profile, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
		$file = Utils\get_flag_value( $assoc_args, 'file', '' );

		if ( $file ) {
			$bytes = file_put_contents( $file, $json . "\n" );
			if ( false === $bytes ) {
				WP_CLI::error( "Could not write to {$file}." );
			}
			WP_CLI::success( "Exported profile #{$id} to {$file} ({$bytes} bytes)." );
		} else {
			WP_CLI::log( $json );
		}
	}

	/**
	 * Delete all profiles.
	 *
	 * ## OPTIONS
	 *
	 * [--keep-pinned]
	 * : Preserve pinned profiles.
	 *
	 * [--yes]
	 * : Skip confirmation prompt.
	 *
	 * ## EXAMPLES
	 *
	 *     wp scrutinizer clear --yes
	 *     wp scrutinizer clear --keep-pinned --yes
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function clear( $args, $assoc_args ) {
		$keep_pinned = Utils\get_flag_value( $assoc_args, 'keep-pinned', false );
		$stats       = Storage::get_table_stats();

		if ( 0 === $stats['rows'] ) {
			WP_CLI::log( 'No profiles to delete.' );
			return;
		}

		$msg = sprintf( 'Delete all %d profiles?', $stats['rows'] );
		if ( $keep_pinned ) {
			$msg = sprintf( 'Delete all unpinned profiles (%d total in table)?', $stats['rows'] );
		}

		WP_CLI::confirm( $msg, $assoc_args );

		$deleted = Storage::delete_all_profiles( $keep_pinned );
		WP_CLI::success( "Deleted {$deleted} profiles." );
	}

	/**
	 * Show profiler status.
	 *
	 * ## OPTIONS
	 *
	 * [--format=<format>]
	 * : Output format.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp scrutinizer status
	 *     wp scrutinizer status --format=json
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function status( $args, $assoc_args ) {
		$stats = Storage::get_table_stats();
		$qp    = scrutinizer_query_profiling_state();

		// Query profiling state label.
		if ( $qp['managed'] ) {
			$qp_label = $qp['active'] ? 'On (managed by Scrutineer)' : 'Off (toggle disabled)';
		} else {
			$qp_label = $qp['active'] ? 'On (set in wp-config.php)' : 'Off (blocked by wp-config.php)';
		}

		$rows = array(
			array( 'Key' => 'Active Session', 'Value' => Session::get_session_id() ?: 'None' ),
			array( 'Key' => 'Background Profiling', 'Value' => get_option( 'scrutinizer_background_profiling', false ) ? 'Enabled' : 'Disabled' ),
			array( 'Key' => 'Sample Rate', 'Value' => get_option( 'scrutinizer_sample_rate', 5 ) . '%' ),
			array( 'Key' => 'Query Profiling', 'Value' => $qp_label ),
			array( 'Key' => 'Total Profiles', 'Value' => $stats['rows'] ),
			array( 'Key' => 'Table Size', 'Value' => self::format_bytes( $stats['size_bytes'] ) ),
			array( 'Key' => 'PHP', 'Value' => PHP_VERSION ),
			array( 'Key' => 'WordPress', 'Value' => get_bloginfo( 'version' ) ),
			array( 'Key' => 'Plugin Version', 'Value' => SCRUTINIZER_VERSION ),
		);

		$format = Utils\get_flag_value( $assoc_args, 'format', 'table' );

		if ( 'json' === $format ) {
			$kv = array();
			foreach ( $rows as $r ) {
				$kv[ $r['Key'] ] = $r['Value'];
			}
			WP_CLI::log( wp_json_encode( $kv, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) );
			return;
		}

		WP_CLI::log( '' );
		WP_CLI::log( WP_CLI::colorize( '%BScrutinizer Status%n' ) );
		WP_CLI::log( str_repeat( '─', 50 ) );
		Utils\format_items( 'table', $rows, array( 'Key', 'Value' ) );
	}

	/**
	 * Format bytes into a human-readable string.
	 *
	 * @param int $bytes  Byte count.
	 * @return string
	 */
	private static function format_bytes( $bytes ) {
		$bytes = (int) $bytes;
		if ( $bytes < 1024 ) {
			return $bytes . ' B';
		}
		if ( $bytes < 1048576 ) {
			return round( $bytes / 1024, 1 ) . ' KB';
		}
		return round( $bytes / 1048576, 1 ) . ' MB';
	}
}
