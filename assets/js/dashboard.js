/**
 * Scrutinizer Dashboard JavaScript
 *
 * Three-level drill-down: grouped routes → route profiles → single profile detail.
 * Profile detail includes: timeline visualization, breakdown bar, source table
 * with weight glyphs, query tab, role pills, and unattributed tooltip.
 *
 * @package Scrutinizer
 */

/* global jQuery, scrutinizerAdmin, wp */
( function( $ ) {
	'use strict';

	// wp.i18n translation function, with a graceful identity fallback when
	// wp-i18n is unavailable. Strings are wrapped with __( text, 'scrutinizer' ).
	var __ = ( window.wp && window.wp.i18n && window.wp.i18n.__ )
		? window.wp.i18n.__
		: function( s ) { return s; };

	// wp.i18n sprintf for interpolated strings, with an identity fallback.
	var sprintf = ( window.wp && window.wp.i18n && window.wp.i18n.sprintf )
		? window.wp.i18n.sprintf
		: function( f ) { return f; };

	var pollingTimer  = null;
	var fetchingGrouped = false;  // Guard against piling up grouped requests.
	var currentView   = 'grouped'; // 'grouped', 'route', 'detail', 'history', 'compare'
	var currentRoute  = '';        // route_key for the active drill-down
	var activeTopTab  = 'routes';  // 'routes', 'history', or 'cron'
	var sortField     = 'avg_duration_ns';
	var sortDir       = 'desc';    // 'asc' or 'desc'
	var routeFilter   = '2xx';     // '2xx', '4xx', or '' (all)
	var routeSearch   = '';
	var groupedData   = [];
	var routeData     = [];
	var historyData   = [];
	var historyPage   = 1;
	var historyPages  = 1;
	var historyTotal  = 0;
	var compareChecked = {};       // { profileId: true }
	var currentProfileId = 0;     // currently viewed profile detail
	var currentProfileData = null; // full profile object for the current detail view

	// Trace explorer state.
	var traceLoaded       = false;
	var traceRawData      = null;  // raw flat trace from AJAX
	var traceEntries      = [];    // enriched flat entries
	var traceFiltered     = [];    // after filters applied
	var tracePageSize     = 200;
	var traceShown        = 0;
	var traceSortKey      = 'exclusive_ns';
	var traceSortDir      = 'desc';

	// Timeline lazy-load state.
	var timelineLoaded = false;

	// Table sort state (per-table).
	var tableSortState = {};

	/* ------------------------------------------------------------------ */
	/*  Generic table sort utility                                         */
	/* ------------------------------------------------------------------ */

	function sortTableData( tableId, data, key, type ) {
		var state = tableSortState[ tableId ] || {};
		if ( state.key === key ) {
			state.dir = 'asc' === state.dir ? 'desc' : 'asc';
		} else {
			state.key = key;
			state.dir = 'desc';
		}
		tableSortState[ tableId ] = state;

		var dir = 'asc' === state.dir ? 1 : -1;
		data.sort( function( a, b ) {
			var va = a[ key ];
			var vb = b[ key ];
			if ( 'number' === type ) {
				va = parseFloat( va ) || 0;
				vb = parseFloat( vb ) || 0;
			} else {
				va = String( va || '' ).toLowerCase();
				vb = String( vb || '' ).toLowerCase();
			}
			if ( va < vb ) {
				return -1 * dir;
			}
			if ( va > vb ) {
				return dir;
			}
			return 0;
		} );
		return data;
	}

	function sortIndicator( tableId, key ) {
		var state = tableSortState[ tableId ] || {};
		if ( state.key !== key ) {
			return '';
		}
		return '<span class="scrutinizer-sort-indicator">' + ( 'asc' === state.dir ? '▲' : '▼' ) + '</span>';
	}

	function sortableHeader( tableId, key, label, type ) {
		return '<th class="scrutinizer-sortable' + ( 'number' === type ? ' numeric' : '' ) + '" data-sort-table="' + tableId + '" data-sort-key="' + key + '" data-sort-type="' + ( type || 'string' ) + '">' + label + sortIndicator( tableId, key ) + '</th>';
	}

	/* ------------------------------------------------------------------ */
	/*  Color palette                                                      */
	/* ------------------------------------------------------------------ */

	var sourceColors = {
		plugin:       '#2271b1',
		theme:        '#9b59b6',
		core:         '#50575e',
		'mu-plugin':  '#e67e22',
		'drop-in':    '#27ae60',
		unknown:      '#d4a017',
		bootstrap:    '#95a5a6',
		unattributed: '#dcdcde'
	};

	// Per-plugin color palette for timeline segments.
	var pluginPalette = [
		'#2271b1', '#e67e22', '#9b59b6', '#27ae60', '#e74c3c',
		'#3498db', '#f39c12', '#1abc9c', '#e91e63', '#00bcd4',
		'#8bc34a', '#ff5722', '#607d8b', '#795548', '#9c27b0'
	];
	var pluginColorMap = {};
	var colorIndex     = 0;

	function getSourceColor( slug, type ) {
		if ( 'unattributed' === type ) {
			return sourceColors.unattributed;
		}
		if ( 'unknown' === type || 'unknown' === slug ) {
			return sourceColors.unknown;
		}
		var key = type + ':' + slug;
		if ( ! pluginColorMap[ key ] ) {
			pluginColorMap[ key ] = pluginPalette[ colorIndex % pluginPalette.length ];
			colorIndex++;
		}
		return pluginColorMap[ key ];
	}

	/* ------------------------------------------------------------------ */
	/*  Role pill config                                                   */
	/* ------------------------------------------------------------------ */

	var rolePillConfig = {
		administrator: { label: __( '🔒 admin', 'scrutinizer' ), cls: 'role-admin' },
		editor:        { label: __( 'editor', 'scrutinizer' ), cls: 'role-editor' },
		author:        { label: __( 'author', 'scrutinizer' ), cls: 'role-editor' },
		contributor:   { label: __( 'contributor', 'scrutinizer' ), cls: 'role-subscriber' },
		subscriber:    { label: __( 'subscriber', 'scrutinizer' ), cls: 'role-subscriber' },
		customer:      { label: __( 'customer', 'scrutinizer' ), cls: 'role-subscriber' },
		authenticated: { label: __( 'authenticated', 'scrutinizer' ), cls: 'role-subscriber' },
		anonymous:     { label: __( '👤 anonymous', 'scrutinizer' ), cls: 'role-anonymous' }
	};

	function rolePill( role ) {
		if ( ! role ) {
			return '';
		}
		var cfg = rolePillConfig[ role ] || { label: role, cls: 'role-anonymous' };
		return '<span class="scrutinizer-role-pill ' + cfg.cls + '">' + esc( cfg.label ) + '</span>';
	}

	/* ------------------------------------------------------------------ */
	/*  Init                                                               */
	/* ------------------------------------------------------------------ */

	function init() {
		bindEvents();

		if ( scrutinizerAdmin.isActive ) {
			// Active session — go straight to capture flow with stop button.
			showCaptureFlow();
			showStopButton();
			startPolling();
		}
		// Home view is shown by default via PHP template.
		// Results are hidden until "View Profiles" is clicked.

		initBackgroundControls();
		initQueryProfilingControls();
		initRetentionControls();
		initProxySettings();
	}

	/* ------------------------------------------------------------------ */
	/*  Event binding                                                      */
	/* ------------------------------------------------------------------ */

	function bindEvents() {
		// Sortable table headers (detail-view: queries, http calls, assets).
		$( document ).on( 'click', '.scrutinizer-sortable[data-sort-table]', function() {
			var tableId  = $( this ).data( 'sort-table' );
			var key      = $( this ).data( 'sort-key' );
			var type     = $( this ).data( 'sort-type' ) || 'string';
			if ( 'queries' === tableId && currentProfileData ) {
				var q = currentProfileData.profile_data.queries || [];
				sortTableData( tableId, q, key, type );
				$( '.scrutinizer-queries-table' ).replaceWith( renderQueriesTableBody( q ) );
			} else if ( 'httpcalls' === tableId && currentProfileData ) {
				var h = currentProfileData.profile_data.http_calls || [];
				sortTableData( tableId, h, key, type );
				$( '.scrutinizer-http-table' ).replaceWith( renderHttpCallsTableBody( h ) );
			} else if ( 'assets-scripts' === tableId && currentProfileData ) {
				var s = ( currentProfileData.profile_data.enqueued_assets || {} ).scripts || [];
				sortTableData( tableId, s, key, type );
				$( '.scrutinizer-asset-table-scripts' ).replaceWith( renderAssetTableBody( s, 'scripts' ) );
			} else if ( 'assets-styles' === tableId && currentProfileData ) {
				var st = ( currentProfileData.profile_data.enqueued_assets || {} ).styles || [];
				sortTableData( tableId, st, key, type );
				$( '.scrutinizer-asset-table-styles' ).replaceWith( renderAssetTableBody( st, 'styles' ) );
			}
		} );

		// Caller cell click-to-expand.
		$( document ).on( 'click', '.scrutinizer-caller-cell', function() {
			$( this ).toggleClass( 'is-expanded' );
		} );

		// Query view toggle: Grouped / Individual.
		$( document ).on( 'click', '.scrutinizer-toggle-btn', function() {
			var view = $( this ).data( 'view' );
			$( '.scrutinizer-toggle-btn' ).removeClass( 'active' );
			$( this ).addClass( 'active' );
			$( '.scrutinizer-queries-view' ).hide();
			$( '#scrutinizer-queries-' + view ).show();
		} );

		// Click grouped row to expand duplicate detail.
		$( document ).on( 'click', '.scrutinizer-query-group-row', function() {
			var sql = $( this ).data( 'sql' );
			$( this ).toggleClass( 'is-expanded' );
			$( '.scrutinizer-group-detail' ).each( function() {
				if ( $( this ).data( 'sql' ) === sql ) {
					$( this ).toggle();
				}
			} );
		} );

		// Click-to-expand SQL.
		$( document ).on( 'click', '.scrutinizer-sql-expandable', function( e ) {
			e.stopPropagation();
			var $full = $( this ).siblings( '.scrutinizer-sql-full' );
			if ( $full.length ) {
				$( this ).toggle();
				$full.toggle();
			}
		} );
		$( document ).on( 'click', '.scrutinizer-sql-full', function( e ) {
			e.stopPropagation();
			var $short = $( this ).siblings( '.scrutinizer-sql-expandable' );
			$( this ).toggle();
			$short.toggle();
		} );

		// Source pill filter in queries.
		$( document ).on( 'click', '.scrutinizer-query-source-pill, .scrutinizer-query-filter-pill', function( e ) {
			e.stopPropagation();
			var src = $( this ).data( 'source' );
			$( '.scrutinizer-query-filter-bar' ).show().find( '.scrutinizer-filter-source-name' ).text( src );
			// Filter individual view rows.
			$( '.scrutinizer-query-row' ).each( function() {
				$( this ).toggle( $( this ).data( 'source' ) === src );
			} );
			// Filter grouped view rows.
			$( '.scrutinizer-query-group-row' ).each( function() {
				var $pills = $( this ).find( '.scrutinizer-asset-source-pill' );
				var match = false;
				$pills.each( function() {
					if ( $( this ).text().trim() === src ) { match = true; }
				} );
				$( this ).toggle( match );
				var sql = $( this ).data( 'sql' );
				$( '.scrutinizer-group-detail' ).each( function() {
					if ( $( this ).data( 'sql' ) === sql ) { $( this ).toggle( match ); }
				} );
			} );
		} );
		$( document ).on( 'click', '.scrutinizer-clear-filter', function() {
			$( '.scrutinizer-query-filter-bar' ).hide();
			$( '.scrutinizer-query-row, .scrutinizer-query-group-row' ).show();
			$( '.scrutinizer-group-detail' ).hide();
		} );

		// Home view navigation.
		$( document ).on( 'click', '#scrutinizer-home-capture, #scrutinizer-empty-capture', function() {
			showCaptureFlow();
		} );

		$( document ).on( 'click', '#scrutinizer-home-link', function( e ) {
			e.preventDefault();
			showHomeView();
		} );

		$( document ).on( 'click', '#scrutinizer-home-profiles', function() {
			showProfilesView();
		} );

		$( document ).on( 'click', '#scrutinizer-home-settings', function() {
			showSettingsView();
		} );

		// Back buttons.
		$( document ).on( 'click', '#scrutinizer-capture-back', function() {
			showHomeView();
		} );

		// Decision cards — start profiling.
		$( document ).on( 'click', '.scrutinizer-decision-card', function() {
			startProfiling( $( this ).data( 'target' ) || '', $( this ).data( 'mode' ) || '' );
		} );

		// Settings gear — show settings view.
		$( document ).on( 'click', '.scrutinizer-gear-toggle', function() {
			showSettingsView();
		} );

		// Back from settings.
		$( document ).on( 'click', '#scrutinizer-settings-back', function() {
			showHomeView();
		} );

		// Accessibility: Escape closes the settings view (mirrors the Back
		// button) when it is the active view.
		$( document ).on( 'keydown', function( e ) {
			if ( 'Escape' === e.key && 'settings' === currentView ) {
				showHomeView();
			}
		} );

		// Stop button.
		$( document ).on( 'click', '#scrutinizer-stop', stopProfiling );

		// Copy activation URL.
		$( document ).on( 'click', '#scrutinizer-copy-url, #scrutinizer-visitor-copy', copyActivationUrl );

		// Grouped row → drill into route.
		$( document ).on( 'click', '.scrutinizer-route-row', function() {
			var key = $( this ).data( 'route-key' );
			drillIntoRoute( key );
		} );

		// Profile row → view detail.
		$( document ).on( 'click', '.scrutinizer-view-profile', function( e ) {
			e.preventDefault();
			loadProfileDetail( $( this ).data( 'profile-id' ) );
		} );

		// Delete profile.
		$( document ).on( 'click', '.scrutinizer-delete-profile', function( e ) {
			e.preventDefault();
			/* eslint-disable no-alert */
			if ( ! confirm( scrutinizerAdmin.i18n.confirmDelete ) ) {
				return;
			}
			/* eslint-enable no-alert */
			deleteProfile( $( this ).data( 'profile-id' ) );
		} );

		// Breadcrumb nav.
		$( document ).on( 'click', '#scrutinizer-back-to-list', showGroupedView );
		$( document ).on( 'click', '#scrutinizer-back-to-route', function() {
			showRouteView();
		} );

		// Sortable headers (list views: grouped, route, history, cron).
		$( document ).on( 'click', '.scrutinizer-sortable[data-sort]', function() {
			var field = $( this ).data( 'sort' );
			if ( sortField === field ) {
				sortDir = ( 'asc' === sortDir ) ? 'desc' : 'asc';
			} else {
				sortField = field;
				sortDir   = 'desc';
			}
			if ( 'grouped' === currentView ) {
				renderGroupedTable( groupedData );
			} else if ( 'route' === currentView ) {
				renderRouteTable( routeData );
			} else if ( 'history' === currentView ) {
				renderHistoryTable( historyData );
			} else if ( 'cron' === currentView ) {
				renderCronView( cronData );
			}
		} );

		// Detail view tabs.
		$( document ).on( 'click', '.scrutinizer-tab', function() {
			var tab = $( this ).data( 'tab' );
			$( '.scrutinizer-tab' ).removeClass( 'active' );
			$( this ).addClass( 'active' );
			$( '.scrutinizer-tab-content' ).hide();
			$( '#scrutinizer-tab-' + tab ).show();
			applyTabRoles();

			// Lazy-load trace data on first click.
			if ( 'trace' === tab && ! traceLoaded && currentProfileId ) {
				loadTraceData( currentProfileId );
			}
			// Lazy-load timeline data on first click.
			if ( 'timeline' === tab && ! timelineLoaded && currentProfileId ) {
				loadTimelineData( currentProfileId );
			}
		} );

		// Info bubble toggle (mobile-friendly tooltip).
		$( document ).on( 'click', '.scrutinizer-info-toggle', function( e ) {
			e.stopPropagation();
			$( this ).next( '.scrutinizer-info-bubble' ).toggleClass( 'visible' );
		} );
		$( document ).on( 'click', function() {
			$( '.scrutinizer-info-bubble' ).removeClass( 'visible' );
		} );

		// --- Trace Explorer event handlers ---

		// Trace search input.
		$( document ).on( 'input', '#scrutinizer-trace-search', function() {
			refreshTraceTable();
		} );

		// Trace pill click.
		$( document ).on( 'click', '.scrutinizer-trace-pill', function() {
			$( this ).toggleClass( 'active' );
			refreshTraceTable();
		} );

		// Trace source filter.
		$( document ).on( 'change', '#scrutinizer-trace-source', function() {
			refreshTraceTable();
		} );

		// Trace duration threshold.
		$( document ).on( 'input', '#scrutinizer-trace-min-duration', function() {
			refreshTraceTable();
		} );

		// Trace query threshold.
		$( document ).on( 'input', '#scrutinizer-trace-min-queries', function() {
			refreshTraceTable();
		} );

		// Trace table column sort.
		$( document ).on( 'click', '.scrutinizer-trace-sortable', function() {
			var key = $( this ).data( 'sort-key' );
			if ( traceSortKey === key ) {
				traceSortDir = 'asc' === traceSortDir ? 'desc' : 'asc';
			} else {
				traceSortKey = key;
				traceSortDir = 'desc';
			}
			// Update header indicators.
			$( '.scrutinizer-trace-sortable' ).removeClass( 'sort-asc sort-desc' );
			$( this ).addClass( 'asc' === traceSortDir ? 'sort-asc' : 'sort-desc' );
			refreshTraceTable();
		} );

		// Trace "Show more" button.
		$( document ).on( 'click', '#scrutinizer-trace-show-more', function() {
			traceShown += tracePageSize;
			var rows = renderTraceRows( traceFiltered, traceShown - tracePageSize, tracePageSize );
			$( '#scrutinizer-trace-tbody' ).append( rows );
			updateTraceStatus();
		} );

		// Trace clear filters.
		$( document ).on( 'click', '#scrutinizer-trace-clear', function() {
			$( '#scrutinizer-trace-search' ).val( '' );
			$( '#scrutinizer-trace-source' ).val( '' );
			$( '#scrutinizer-trace-min-duration' ).val( '' );
			$( '#scrutinizer-trace-min-queries' ).val( '' );
			$( '.scrutinizer-trace-pill' ).removeClass( 'active' );
			refreshTraceTable();
		} );

		// Save search button.
		$( document ).on( 'click', '#scrutinizer-trace-save-search', function() {
			var search = $( '#scrutinizer-trace-search' ).val() || '';
			var source = $( '#scrutinizer-trace-source' ).val() || '';
			var minDur = $( '#scrutinizer-trace-min-duration' ).val() || '';
			var minQ   = $( '#scrutinizer-trace-min-queries' ).val() || '';
			var pills  = [];
			$( '.scrutinizer-trace-pill.active:not(.saved-search)' ).each( function() {
				pills.push( $( this ).data( 'pill' ) );
			} );

			if ( ! search && ! source && ! minDur && ! minQ && 0 === pills.length ) {
				return;
			}

			var name = window.prompt( __( 'Name this saved search:', 'scrutinizer' ) );
			if ( ! name ) { return; }

			var saved = loadSavedSearches();
			saved.push( { name: name, search: search, source: source, minDur: minDur, minQ: minQ, pills: pills } );
			localStorage.setItem( 'scrutinizer_saved_searches', JSON.stringify( saved ) );
			renderSavedSearchPills();
		} );

		// Click a saved search pill.
		$( document ).on( 'click', '.scrutinizer-saved-pill', function( e ) {
			if ( $( e.target ).hasClass( 'scrutinizer-pill-remove' ) ) { return; }
			var idx = parseInt( $( this ).data( 'saved-idx' ), 10 );
			var saved = loadSavedSearches();
			if ( ! saved[ idx ] ) { return; }
			var s = saved[ idx ];

			// Apply saved filters.
			$( '#scrutinizer-trace-search' ).val( s.search || '' );
			$( '#scrutinizer-trace-source' ).val( s.source || '' );
			$( '#scrutinizer-trace-min-duration' ).val( s.minDur || '' );
			$( '#scrutinizer-trace-min-queries' ).val( s.minQ || '' );
			$( '.scrutinizer-trace-pill' ).removeClass( 'active' );
			( s.pills || [] ).forEach( function( p ) {
				$( '.scrutinizer-trace-pill[data-pill="' + p + '"]' ).addClass( 'active' );
			} );
			refreshTraceTable();
		} );

		// Remove a saved search.
		$( document ).on( 'click', '.scrutinizer-pill-remove', function( e ) {
			e.stopPropagation();
			var idx = parseInt( $( this ).closest( '.scrutinizer-saved-pill' ).data( 'saved-idx' ), 10 );
			var saved = loadSavedSearches();
			saved.splice( idx, 1 );
			localStorage.setItem( 'scrutinizer_saved_searches', JSON.stringify( saved ) );
			renderSavedSearchPills();
		} );

		// Background profiling toggle.
		$( document ).on( 'change', '#scrutinizer-bg-toggle', toggleBackground );

		// Sample rate snap buttons.
		$( document ).on( 'click', '.scrutinizer-rate-snap', function() {
			var rate = parseFloat( $( this ).data( 'rate' ) );
			$( '.scrutinizer-rate-snap' ).removeClass( 'is-active' );
			$( this ).addClass( 'is-active' );
			$( '#scrutinizer-custom-rate' ).val( rate );
			saveBackgroundRate( rate );
		} );

		// Custom rate input.
		$( document ).on( 'change', '#scrutinizer-custom-rate', function() {
			var rate = parseFloat( $( this ).val() );
			if ( isNaN( rate ) || rate < 0 || rate > 100 ) {
				return;
			}
			rate = Math.round( rate * 10 ) / 10;
			$( this ).val( rate );
			$( '.scrutinizer-rate-snap' ).removeClass( 'is-active' );
			$( '.scrutinizer-rate-snap[data-rate="' + rate + '"]' ).addClass( 'is-active' );
			saveBackgroundRate( rate );
		} );

		// Only-successful toggle.
		$( document ).on( 'change', '#scrutinizer-only-success', function() {
			var on = $( this ).is( ':checked' ) ? 1 : 0;
			$.post( scrutinizerAdmin.ajaxUrl, {
				action: 'scrutinizer_toggle_only_successful',
				nonce:  scrutinizerAdmin.nonce,
				enabled: on
			}, function( response ) {
				if ( response.success ) {
					showNotice( response.data.message, 'success' );
				}
			} );
		} );

		// Background profiling filters.
		$( document ).on( 'click', '#scrutinizer-save-filters', function() {
			var $btn = $( this );
			$btn.prop( 'disabled', true ).text( __( 'Saving\u2026', 'scrutinizer' ) );
			$.post( scrutinizerAdmin.ajaxUrl, {
				action:        'scrutinizer_save_background_filters',
				nonce:         scrutinizerAdmin.nonce,
				user_scope:    $( 'input[name="scrutinizer-user-scope"]:checked' ).val(),
				exclude_paths: $( '#scrutinizer-exclude-paths' ).val()
			}, function( response ) {
				$btn.prop( 'disabled', false ).text( __( 'Save filters', 'scrutinizer' ) );
				if ( response.success ) {
					showNotice( response.data.message, 'success' );
					scrutinizerAdmin.userScope = response.data.user_scope;
					scrutinizerAdmin.excludePaths = response.data.exclude_paths;
				}
			} ).fail( function() {
				$btn.prop( 'disabled', false ).text( __( 'Save filters', 'scrutinizer' ) );
			} );
		} );

		// Route filter dropdown.
		$( document ).on( 'change', '#scrutinizer-route-filter', function() {
			routeFilter = $( this ).val();
			renderGroupedTable( groupedData );
		} );

		// Route search input.
		$( document ).on( 'input', '#scrutinizer-route-search', function() {
			routeSearch = $( this ).val().toLowerCase();
			renderGroupedTable( groupedData );
		} );

		// Query profiling toggle.
		$( document ).on( 'change', '#scrutinizer-qp-toggle', toggleQueryProfiling );
		$( document ).on( 'click', '.scrutinizer-qp-more', function( e ) {
			e.preventDefault();
			var $content = $( '.scrutinizer-qp-detail-content' );
			if ( $content.is( ':visible' ) ) {
				$content.slideUp( 150 );
				$( this ).text( __( 'Details', 'scrutinizer' ) );
			} else {
				$content.slideDown( 150 );
				$( this ).text( __( 'Less', 'scrutinizer' ) );
			}
		} );

		// Top-level tab switcher (Routes | History | Cron | API).
		$( document ).on( 'click', '.scrutinizer-top-tab', function() {
			var tab = $( this ).data( 'top-tab' );
			$( '.scrutinizer-top-tab' ).removeClass( 'active' );
			$( this ).addClass( 'active' );
			activeTopTab = tab;
			if ( 'routes' === tab ) {
				showGroupedView();
			} else if ( 'history' === tab ) {
				showHistoryView();
			} else if ( 'cron' === tab ) {
				showCronView();
			} else if ( 'api' === tab ) {
				showApiView();
			}
			applyTabRoles();
		} );

		// Arrow-key roving for both tab groups (WAI-ARIA tab pattern).
		$( document ).on( 'keydown', '.scrutinizer-tab', function( e ) {
			tabKeydown( e, '.scrutinizer-tab' );
		} );
		$( document ).on( 'keydown', '.scrutinizer-top-tab', function( e ) {
			tabKeydown( e, '.scrutinizer-top-tab' );
		} );

		// Pin toggle on detail view.
		$( document ).on( 'click', '#scrutinizer-pin-toggle', function() {
			var pinned = $( this ).data( 'pinned' );
			if ( pinned ) {
				unpinProfile( currentProfileId );
			} else {
				pinProfile( currentProfileId );
			}
		} );

		// Share button on detail view.
		$( document ).on( 'click', '#scrutinizer-share-btn', function() {
			if ( currentProfileId ) {
				showSharePanel( currentProfileId );
			}
		} );

		// Export JSON button on detail view.
		$( document ).on( 'click', '#scrutinizer-export-btn', function() {
			if ( currentProfileData && currentProfileData.profile_data ) {
				exportProfileJSON( currentProfileData );
			}
		} );

		// Compare picker button on detail view.
		$( document ).on( 'click', '#scrutinizer-compare-pick-btn', function() {
			if ( currentProfileId ) {
				toggleComparePicker( currentProfileId );
			}
		} );

		// Compare picker: select a target.
		$( document ).on( 'click', '.scrutinizer-compare-target', function() {
			var targetId = parseInt( $( this ).data( 'id' ), 10 );
			if ( currentProfileId && targetId ) {
				loadInlineComparison( currentProfileId, targetId );
			}
		} );

		// Keyboard support for compare target picker (a11y).
		$( document ).on( 'keydown', '.scrutinizer-compare-target', function( e ) {
			if ( 13 === e.which || 32 === e.which ) {
				e.preventDefault();
				$( this ).trigger( 'click' );
			}
		} );

		// Dismiss inline comparison.
		$( document ).on( 'click', '#scrutinizer-inline-compare-close', function() {
			$( '#scrutinizer-inline-compare' ).slideUp( 200, function() {
				$( this ).remove();
			} );
		} );

		// Save annotation on blur.
		$( document ).on( 'blur', '#scrutinizer-note-input', saveAnnotation );
		$( document ).on( 'blur', '#scrutinizer-tags-input', saveAnnotation );
		$( document ).on( 'keydown', '#scrutinizer-note-input, #scrutinizer-tags-input', function( e ) {
			if ( 13 === e.keyCode ) {
				e.preventDefault();
				$( this ).trigger( 'blur' );
			}
		} );

		// History filters — reset to page 1 on any filter change.
		$( document ).on( 'change', '#scrutinizer-history-route', function() { historyPage = 1; fetchHistory(); } );
		$( document ).on( 'change', '#scrutinizer-history-type', function() { historyPage = 1; fetchHistory(); } );
		$( document ).on( 'input', '#scrutinizer-history-tag', function() { historyPage = 1; debounceHistory(); } );
		$( document ).on( 'change', '#scrutinizer-history-pinned', function() { historyPage = 1; fetchHistory(); } );
		$( document ).on( 'change', '#scrutinizer-history-from, #scrutinizer-history-to', function() { historyPage = 1; fetchHistory(); } );

		// History pagination.
		$( document ).on( 'click', '#scrutinizer-page-prev', function( e ) {
			e.preventDefault();
			if ( historyPage > 1 ) {
				historyPage--;
				fetchHistory();
			}
		} );
		$( document ).on( 'click', '#scrutinizer-page-next', function( e ) {
			e.preventDefault();
			if ( historyPage < historyPages ) {
				historyPage++;
				fetchHistory();
			}
		} );

		// Compare checkboxes.
		$( document ).on( 'change', '.scrutinizer-compare-check', function() {
			var id = $( this ).data( 'profile-id' );
			if ( $( this ).is( ':checked' ) ) {
				compareChecked[ id ] = true;
			} else {
				delete compareChecked[ id ];
			}
			updateCompareButton();
			// Sync select-all state.
			var total = $( '.scrutinizer-compare-check' ).length;
			var checked = $( '.scrutinizer-compare-check:checked' ).length;
			$( '#scrutinizer-select-all' ).prop( 'checked', total > 0 && checked === total );
		} );

		// Select all checkbox.
		$( document ).on( 'change', '#scrutinizer-select-all', function() {
			var isChecked = $( this ).is( ':checked' );
			$( '.scrutinizer-compare-check' ).each( function() {
				var id = $( this ).data( 'profile-id' );
				$( this ).prop( 'checked', isChecked );
				if ( isChecked ) {
					compareChecked[ id ] = true;
				} else {
					delete compareChecked[ id ];
				}
			} );
			updateCompareButton();
		} );

		// Bulk delete.
		$( document ).on( 'click', '#scrutinizer-bulk-delete', function() {
			var ids = Object.keys( compareChecked );
			if ( ! ids.length ) {
				return;
			}
			// translators: %d is the number of selected profiles to delete.
			if ( ! confirm( sprintf( __( 'Delete %d profile(s)?', 'scrutinizer' ), ids.length ) ) ) {
				return;
			}
			$.post( scrutinizerAdmin.ajaxUrl, {
				action:      'scrutinizer_delete_profiles_bulk',
				nonce:       scrutinizerAdmin.nonce,
				profile_ids: ids
			}, function( resp ) {
				compareChecked = {};
				updateCompareButton();
				fetchHistory();
				if ( resp && resp.success ) {
					showNotice( resp.data.message );
				} else {
					showNotice( __( 'Failed to delete profiles.', 'scrutinizer' ), 'error' );
				}
			} );
		} );

		// Bulk pin.
		$( document ).on( 'click', '#scrutinizer-bulk-pin', function() {
			var ids = Object.keys( compareChecked );
			if ( ! ids.length ) {
				return;
			}
			$.post( scrutinizerAdmin.ajaxUrl, {
				action:      'scrutinizer_pin_profiles_bulk',
				nonce:       scrutinizerAdmin.nonce,
				profile_ids: ids
			}, function( resp ) {
				compareChecked = {};
				updateCompareButton();
				fetchHistory();
				if ( resp && resp.success ) {
					showNotice( resp.data.message );
				} else {
					showNotice( __( 'Failed to pin profiles.', 'scrutinizer' ), 'error' );
				}
			} );
		} );

		// Bulk unpin.
		$( document ).on( 'click', '#scrutinizer-bulk-unpin', function() {
			var ids = Object.keys( compareChecked );
			if ( ! ids.length ) {
				return;
			}
			$.post( scrutinizerAdmin.ajaxUrl, {
				action:      'scrutinizer_unpin_profiles_bulk',
				nonce:       scrutinizerAdmin.nonce,
				profile_ids: ids
			}, function( resp ) {
				compareChecked = {};
				updateCompareButton();
				fetchHistory();
				if ( resp && resp.success ) {
					showNotice( resp.data.message );
				} else {
					showNotice( __( 'Failed to unpin profiles.', 'scrutinizer' ), 'error' );
				}
			} );
		} );

		// Compare button.
		$( document ).on( 'click', '#scrutinizer-compare-btn', function() {
			var ids = Object.keys( compareChecked );
			if ( 2 === ids.length ) {
				loadComparison( parseInt( ids[0], 10 ), parseInt( ids[1], 10 ) );
			}
		} );

		// Back from compare.
		$( document ).on( 'click', '#scrutinizer-back-to-history', function() {
			showHistoryView();
		} );

		// Trace: expand all phases.
		$( document ).on( 'click', '#scrutinizer-trace-expand-all', function() {
			$( '.scrutinizer-trace-phase, .scrutinizer-trace-hook' ).attr( 'open', '' );
		} );

		// Trace: collapse all phases.
		$( document ).on( 'click', '#scrutinizer-trace-collapse-all', function() {
			$( '.scrutinizer-trace-phase, .scrutinizer-trace-hook' ).removeAttr( 'open' );
		} );

		// Trace: filter callbacks.
		$( document ).on( 'input', '#scrutinizer-trace-filter', function() {
			var q = $( this ).val().toLowerCase();
			if ( ! q ) {
				// Reset: close all phases, show everything.
				$( '.scrutinizer-trace-phase, .scrutinizer-trace-hook, .scrutinizer-trace-leaf' ).show();
				$( '.scrutinizer-trace-phase, .scrutinizer-trace-hook' ).removeAttr( 'open' );
				return;
			}
			// Search through all leaf callbacks and hook names.
			$( '.scrutinizer-trace-phase' ).each( function() {
				var $phase = $( this );
				var phaseMatch = false;

				$phase.find( '.scrutinizer-trace-hook' ).each( function() {
					var $hook = $( this );
					var hookMatch = false;

					$hook.find( '.scrutinizer-trace-leaf' ).each( function() {
						var text = $( this ).text().toLowerCase();
						if ( text.indexOf( q ) >= 0 ) {
							$( this ).show();
							hookMatch = true;
						} else {
							$( this ).hide();
						}
					} );

					// Also check hook summary text.
					var hookText = $hook.children( 'summary' ).text().toLowerCase();
					if ( hookText.indexOf( q ) >= 0 ) {
						hookMatch = true;
						$hook.find( '.scrutinizer-trace-leaf' ).show();
					}

					if ( hookMatch ) {
						$hook.show().attr( 'open', '' );
						phaseMatch = true;
					} else {
						$hook.hide();
					}
				} );

				// Also check standalone leaves (single-callback hooks rendered without <details>).
				$phase.find( '.scrutinizer-trace-phase-children > .scrutinizer-trace-leaf' ).each( function() {
					var text = $( this ).text().toLowerCase();
					if ( text.indexOf( q ) >= 0 ) {
						$( this ).show();
						phaseMatch = true;
					} else {
						$( this ).hide();
					}
				} );

				if ( phaseMatch ) {
					$phase.show().attr( 'open', '' );
				} else {
					$phase.hide();
				}
			} );
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  Background profiling controls                                      */
	/* ------------------------------------------------------------------ */

	function initBackgroundControls() {
		var currentRate = parseFloat( scrutinizerAdmin.backgroundSampleRate ) || 10;
		var snaps = [
			{ value: 0.1, label: __( 'light', 'scrutinizer' ) },
			{ value: 1, label: __( 'moderate', 'scrutinizer' ) },
			{ value: 10, label: __( 'detailed', 'scrutinizer' ) },
			{ value: 100, label: __( 'every request', 'scrutinizer' ) }
		];

		var html = '<div class="scrutinizer-bg-controls">';
		html += '<h3>' + __( 'Background Measurement', 'scrutinizer' ) + '</h3>';
		html += '<label class="scrutinizer-toggle-label">';
		html += '<input type="checkbox" id="scrutinizer-bg-toggle"' + ( scrutinizerAdmin.backgroundEnabled ? ' checked' : '' ) + '> ';
		html += __( 'Automatically measure requests in the background', 'scrutinizer' ) + '</label>';
		html += '<div class="scrutinizer-rate-control' + ( scrutinizerAdmin.backgroundEnabled ? '' : ' hidden' ) + '" id="scrutinizer-rate-group">';
		html += '<label>' + __( 'Capture rate', 'scrutinizer' ) + '</label>';
		html += '<div class="scrutinizer-rate-snaps">';
		for ( var i = 0; i < snaps.length; i++ ) {
			var snap = snaps[ i ];
			var active = ( currentRate === snap.value ) ? ' is-active' : '';
			html += '<button type="button" class="scrutinizer-rate-snap' + active + '" data-rate="' + snap.value + '">';
			html += snap.value + '%<span class="scrutinizer-rate-snap-label">' + esc( snap.label ) + '</span></button>';
		}
		html += '<span class="scrutinizer-rate-custom">' + __( 'or', 'scrutinizer' ) + ' <input type="number" id="scrutinizer-custom-rate" min="0" max="100" step="0.1" value="' + currentRate + '">%</span>';
		html += '</div>';
		html += '</div>';

		// User scope filter.
		var scopeVal = scrutinizerAdmin.userScope || 'all';
		html += '<div class="scrutinizer-filter-controls' + ( scrutinizerAdmin.backgroundEnabled ? '' : ' hidden' ) + '" id="scrutinizer-filter-group">';
		html += '<label>' + __( 'Measure requests from', 'scrutinizer' ) + '</label>';
		html += '<div class="scrutinizer-scope-options">';
		html += '<label class="scrutinizer-radio-label"><input type="radio" name="scrutinizer-user-scope" value="all"' + ( scopeVal === 'all' ? ' checked' : '' ) + '> ' + __( 'All users', 'scrutinizer' ) + '</label>';
		html += '<label class="scrutinizer-radio-label"><input type="radio" name="scrutinizer-user-scope" value="anonymous"' + ( scopeVal === 'anonymous' ? ' checked' : '' ) + '> ' + __( 'Anonymous visitors only', 'scrutinizer' ) + '</label>';
		html += '<label class="scrutinizer-radio-label"><input type="radio" name="scrutinizer-user-scope" value="logged_in"' + ( scopeVal === 'logged_in' ? ' checked' : '' ) + '> ' + __( 'Logged-in users only', 'scrutinizer' ) + '</label>';
		html += '</div>';

		// Exclude paths.
		var excludeVal = scrutinizerAdmin.excludePaths || '';
		html += '<label style="margin-top:12px;">' + __( 'Exclude paths', 'scrutinizer' ) + ' <span class="scrutinizer-label-hint">' + __( '(one per line, * wildcard)', 'scrutinizer' ) + '</span></label>';
		html += '<textarea id="scrutinizer-exclude-paths" rows="3" class="scrutinizer-exclude-textarea" placeholder="/wp-admin/*&#10;/wp-json/*">' + esc( excludeVal ) + '</textarea>';
		html += '<button type="button" class="button scrutinizer-save-filters" id="scrutinizer-save-filters">' + __( 'Save filters', 'scrutinizer' ) + '</button>';

		html += '<label class="scrutinizer-toggle-label" style="margin-top:16px;">';
		html += '<input type="checkbox" id="scrutinizer-only-success"' + ( scrutinizerAdmin.onlySuccessful ? ' checked' : '' ) + '> ';
		html += __( 'Only capture successful requests (HTTP 200)', 'scrutinizer' ) + '</label>';
		html += '</div>';

		html += '<p class="scrutinizer-overhead-note">' + __( 'Non-profiled requests add about 2 ms or less. A profiled request brings up full hook instrumentation and trace storage — around 250 ms in our benchmarks, though it varies widely with your plugins, hardware, and load. Unattributed time in each profile includes this cost.', 'scrutinizer' ) + '</p>';
		if ( currentRate >= 50 ) {
			html += '<p class="scrutinizer-overhead-note" style="color:#d63638;font-weight:500;">' + __( '\u26a0 High capture rate. Each profile generates 2\u201310 MB of trace data. Not recommended for production sites or servers with limited disk/memory.', 'scrutinizer' ) + '</p>';
		}
		html += '</div>';

		$( '#scrutinizer-controls' ).after( html );
	}

	function toggleBackground() {
		var enabled = $( '#scrutinizer-bg-toggle' ).is( ':checked' );
		var rate    = parseFloat( $( '#scrutinizer-custom-rate' ).val() ) || 10;

		if ( enabled ) {
			$( '#scrutinizer-rate-group' ).removeClass( 'hidden' );
			$( '#scrutinizer-filter-group' ).removeClass( 'hidden' );
		} else {
			$( '#scrutinizer-rate-group' ).addClass( 'hidden' );
			$( '#scrutinizer-filter-group' ).addClass( 'hidden' );
		}

		$.post( scrutinizerAdmin.ajaxUrl, {
			action:  'scrutinizer_toggle_background',
			nonce:   scrutinizerAdmin.nonce,
			enabled: enabled ? 1 : 0,
			rate:    rate
		}, function( response ) {
			if ( response.success ) {
				showNotice( response.data.message, 'success' );
			}
		} );
	}

	function saveBackgroundRate( rate ) {
		rate = parseFloat( rate ) || 10;
		$.post( scrutinizerAdmin.ajaxUrl, {
			action:  'scrutinizer_toggle_background',
			nonce:   scrutinizerAdmin.nonce,
			enabled: $( '#scrutinizer-bg-toggle' ).is( ':checked' ) ? 1 : 0,
			rate:    rate
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  Query profiling controls                                           */
	/* ------------------------------------------------------------------ */

	function initQueryProfilingControls() {
		var qp        = scrutinizerAdmin.queryProfiling;
		var isOn      = qp.active;
		var canToggle = qp.managed;

		var html = '<div class="scrutinizer-qp-controls">';
		html += '<div class="scrutinizer-qp-header">';
		html += '<h3>' + __( 'Query Profiling', 'scrutinizer' ) + '</h3>';

		// Toggle switch.
		html += '<label class="scrutinizer-switch' + ( canToggle ? '' : ' disabled' ) + '">';
		html += '<input type="checkbox" id="scrutinizer-qp-toggle" aria-label="' + esc( __( 'Enable query profiling', 'scrutinizer' ) ) + '"';
		html += ( isOn ? ' checked' : '' );
		html += ( canToggle ? '' : ' disabled' );
		html += '>';
		html += '<span class="scrutinizer-switch-slider"></span>';
		html += '</label>';
		html += '</div>';

		// Status description — adapts to all three states.
		html += '<p class="scrutinizer-qp-desc">';
		if ( canToggle ) {
			html += __( 'Record individual SQL query timing for the density heatmap and Queries tab.', 'scrutinizer' );
		} else if ( isOn ) {
			html += '<span class="scrutinizer-qp-badge">wp-config.php</span> ';
			html += __( 'SAVEQUERIES is enabled in your configuration. Full query coverage from boot.', 'scrutinizer' );
		} else {
			html += '<span class="scrutinizer-qp-badge blocked">wp-config.php</span> ';
			// translators: %s is the SAVEQUERIES constant value (e.g. false).
			html += sprintf( __( 'SAVEQUERIES is set to %s — Scrutineer can\'t override a defined constant.', 'scrutinizer' ), '<code>false</code>' );
		}
		html += '</p>';

		// Progressive detail — technical users click through, everyone else ignores it.
		html += '<div class="scrutinizer-qp-detail">';
		html += '<a href="#" class="scrutinizer-qp-more">' + __( 'Details', 'scrutinizer' ) + '</a>';
		html += '<div class="scrutinizer-qp-detail-content" style="display:none;">';

		if ( canToggle ) {
			html += '<p>Sets PHP\'s <code>SAVEQUERIES</code> constant so WordPress logs every query ';
			html += 'with its execution time. Typical overhead is 1\u20132% per request.</p>';
			html += '<p>Queries that run before plugin load (options autoload, core bootstrap) aren\'t captured \u2014 ';
			html += 'usually &lt;10% of total. For full coverage from boot, add to wp-config.php:</p>';
			html += '<code class="scrutinizer-qp-code">define( \'SAVEQUERIES\', true );</code>';
		} else if ( isOn ) {
			html += '<p><code>SAVEQUERIES</code> is defined as <code>true</code> before plugins load, ';
			html += 'so every query from boot is captured. To let Scrutineer manage this toggle instead, ';
			html += 'remove the <code>define()</code> line from wp-config.php.</p>';
		} else {
			html += '<p><code>define( \'SAVEQUERIES\', false )</code> in wp-config.php prevents redefinition \u2014 ';
			html += 'PHP constants are immutable once set.</p>';
			html += '<p>To enable: change <code>false</code> to <code>true</code>, or remove the line entirely ';
			html += 'to let Scrutineer manage it via this toggle.</p>';
		}

		html += '</div></div>';
		html += '</div>';

		$( '.scrutinizer-bg-controls' ).after( html );
	}

	function toggleQueryProfiling() {
		var enabled = $( '#scrutinizer-qp-toggle' ).is( ':checked' );

		$.post( scrutinizerAdmin.ajaxUrl, {
			action:  'scrutinizer_toggle_query_profiling',
			nonce:   scrutinizerAdmin.nonce,
			enabled: enabled ? 1 : 0
		}, function( response ) {
			if ( response.success ) {
				showNotice( response.data.message, 'success' );
			}
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  Retention / TTL controls                                           */
	/* ------------------------------------------------------------------ */

	function initRetentionControls() {
		var current = parseInt( scrutinizerAdmin.retentionDays, 10 ) || 7;
		var options = [
			{ value: 7, label: __( '7 days', 'scrutinizer' ) },
			{ value: 14, label: __( '14 days', 'scrutinizer' ) },
			{ value: 30, label: __( '30 days', 'scrutinizer' ) },
			{ value: 0, label: __( 'Never (keep all)', 'scrutinizer' ) }
		];

		var html = '<div class="scrutinizer-retention-controls">';
		html += '<h3>' + __( 'Profile Retention', 'scrutinizer' ) + '</h3>';
		html += '<p class="description">' + __( 'Unpinned profiles older than this are automatically deleted. Pinned and shared profiles are kept regardless.', 'scrutinizer' ) + '</p>';
		html += '<div class="scrutinizer-retention-row">';
		html += '<label for="scrutinizer-retention-select">' + __( 'Auto-expire after', 'scrutinizer' ) + ' </label>';
		html += '<select id="scrutinizer-retention-select">';
		for ( var i = 0; i < options.length; i++ ) {
			var opt = options[ i ];
			var selected = ( opt.value === current ) ? ' selected' : '';
			html += '<option value="' + opt.value + '"' + selected + '>' + esc( opt.label ) + '</option>';
		}
		html += '</select>';
		html += '<span id="scrutinizer-retention-saved" class="scrutinizer-saved-notice" style="display:none;">\u2713 ' + __( 'Saved', 'scrutinizer' ) + '</span>';
		html += '</div>';
		html += '</div>';

		$( '#scrutinizer-settings-storage' ).append( html );

		$( '#scrutinizer-retention-select' ).on( 'change', function() {
			var days = parseInt( $( this ).val(), 10 );
			$.post( scrutinizerAdmin.ajaxUrl, {
				action:         'scrutinizer_save_retention',
				nonce:          scrutinizerAdmin.nonce,
				retention_days: days
			}, function( response ) {
				if ( response.success ) {
					scrutinizerAdmin.retentionDays = response.data.retention_days;
					var $saved = $( '#scrutinizer-retention-saved' );
					$saved.show();
					setTimeout( function() {
						$saved.fadeOut( 300 );
					}, 2000 );
				}
			} );
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  Proxy header trust settings                                        */
	/* ------------------------------------------------------------------ */

	function initProxySettings() {
		var trusted  = !! scrutinizerAdmin.trustProxyHeaders;
		var detected = scrutinizerAdmin.detectedProxyHeaders || [];

		var html = '<div class="scrutinizer-proxy-controls">';
		html += '<h3>' + __( 'Client IP Detection', 'scrutinizer' ) + '</h3>';
		html += '<label class="scrutinizer-toggle-label">';
		html += '<input type="checkbox" id="scrutinizer-proxy-toggle"' + ( trusted ? ' checked' : '' ) + '> ';
		html += __( 'Trust proxy headers for client IP', 'scrutinizer' ) + '</label>';
		html += '<p class="description">When enabled, Scrutineer reads headers like <code>X-Forwarded-For</code> or <code>CF-Connecting-IP</code> to identify the real client IP. Enable this only if your site is behind a reverse proxy or CDN (e.g. Cloudflare, Nginx, a load balancer). Otherwise, these headers can be spoofed by visitors.</p>';

		// Auto-detect recommendation.
		if ( detected.length > 0 ) {
			html += '<p class="scrutinizer-proxy-recommendation scrutinizer-proxy-detected">';
			html += '<span class="dashicons dashicons-yes-alt"></span> ';
			// translators: %s is the list of detected proxy headers or services.
			html += sprintf( __( 'Detected: %s.', 'scrutinizer' ), '<strong>' + esc( detected.join( ', ' ) ) + '</strong>' ) + ' ';
			html += __( 'Your site appears to be behind a proxy.', 'scrutinizer' ) + ' <strong>' + __( 'Recommended: enable.', 'scrutinizer' ) + '</strong>';
			html += '</p>';
		} else {
			html += '<p class="scrutinizer-proxy-recommendation scrutinizer-proxy-none">';
			html += '<span class="dashicons dashicons-info-outline"></span> ';
			html += __( 'No proxy headers detected on this request.', 'scrutinizer' ) + ' ';
			html += __( 'If you are not behind a proxy or CDN,', 'scrutinizer' ) + ' <strong>' + __( 'leave this disabled.', 'scrutinizer' ) + '</strong>';
			html += '</p>';
		}

		html += '<span id="scrutinizer-proxy-saved" class="scrutinizer-saved-notice" style="display:none;">\u2713 ' + __( 'Saved', 'scrutinizer' ) + '</span>';
		html += '</div>';

		$( '#scrutinizer-settings-network' ).append( html );

		$( '#scrutinizer-proxy-toggle' ).on( 'change', function() {
			var enabled = $( this ).is( ':checked' );
			$.post( scrutinizerAdmin.ajaxUrl, {
				action:  'scrutinizer_save_proxy_trust',
				nonce:   scrutinizerAdmin.nonce,
				enabled: enabled ? 1 : 0
			}, function( response ) {
				if ( response.success ) {
					scrutinizerAdmin.trustProxyHeaders = response.data.enabled;
					var $saved = $( '#scrutinizer-proxy-saved' );
					$saved.show();
					setTimeout( function() {
						$saved.fadeOut( 300 );
					}, 2000 );
				}
			} );
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  View management                                                    */
	/* ------------------------------------------------------------------ */

	var profilesLoaded = false;

	function showHomeView() {
		$( '.wrap > h1' ).first().show();
		$( '#scrutinizer-home' ).show();
		$( '#scrutinizer-capture-flow' ).hide();
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-top-tabs' ).hide();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-route-detail' ).hide();
		$( '#scrutinizer-history-view' ).hide();
		$( '#scrutinizer-compare-view' ).hide();
		$( '#scrutinizer-activation' ).hide();
		$( '#scrutinizer-api-view' ).hide();
		$( '#scrutinizer-settings-view' ).hide();
		currentView = 'home';
	}

	function showCaptureFlow() {
		$( '#scrutinizer-home' ).hide();
		$( '#scrutinizer-capture-flow' ).show();
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-top-tabs' ).hide();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-settings-view' ).hide();
	}

	function showProfilesView() {
		$( '#scrutinizer-home' ).hide();
		$( '#scrutinizer-capture-flow' ).hide();
		$( '#scrutinizer-results' ).show();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-settings-view' ).hide();

		// Lazy-load: only fetch routes + render tabs on first visit.
		if ( ! profilesLoaded ) {
			profilesLoaded = true;
			renderTopTabs();
			fetchGrouped();
		}
	}

	function showSettingsView() {
		$( '#scrutinizer-home' ).hide();
		$( '#scrutinizer-capture-flow' ).hide();
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-top-tabs' ).hide();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-route-detail' ).hide();
		$( '#scrutinizer-history-view' ).hide();
		$( '#scrutinizer-compare-view' ).hide();
		$( '#scrutinizer-activation' ).hide();
		$( '#scrutinizer-api-view' ).hide();
		$( '.wrap > h1' ).first().hide();
		$( '#scrutinizer-settings-view' ).show();
		currentView = 'settings';
		moveFocus( '#scrutinizer-settings-view h2, #scrutinizer-settings-view' );
	}

	/* ------------------------------------------------------------------ */
	/*  Session start / stop                                               */
	/* ------------------------------------------------------------------ */

	function startProfiling( target, mode ) {
		var isVisitor = ( mode === 'visitor' );
		$.post( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_start_profiling',
			nonce:  scrutinizerAdmin.nonce,
			target: target
		}, function( response ) {
			if ( response.success ) {
				$( '#scrutinizer-activation-url' ).val( response.data.activation_url );
				$( '#scrutinizer-activation' ).show();
				if ( isVisitor ) {
					// Show incognito guidance instead of navigating.
					showVisitorGuidance( response.data.activation_url );
				} else {
					// Open in new tab so the dashboard stays visible.
					window.open( response.data.activation_url, '_blank' );
					showNotice( __( 'Profiling started — measuring in the new tab. Results will appear here.', 'scrutinizer' ), 'success' );
				}
				// Start polling for results.
				showStopButton();
				startPolling();
			} else {
				showNotice( response.data.message || scrutinizerAdmin.i18n.error, 'error' );
			}
		} ).fail( function() {
			showNotice( scrutinizerAdmin.i18n.error, 'error' );
		} );
	}

	function showVisitorGuidance( url ) {
		// If settings view is showing, go back to home first.
		if ( currentView === 'settings' ) {
			showHomeView();
		}

		// Auto-copy URL to clipboard.
		if ( navigator.clipboard ) {
			navigator.clipboard.writeText( url );
		}

		var isMac = /Mac|iPhone|iPad/.test( navigator.userAgent );
		var shortcut = isMac ? '<kbd>⌘ Shift N</kbd>' : '<kbd>Ctrl+Shift+N</kbd>';

		var html = '<div class="scrutinizer-visitor-guidance">';
		html += '<div class="scrutinizer-visitor-copied">';
		html += '<span class="dashicons dashicons-yes-alt"></span>';
		html += '<strong>' + __( 'URL copied to clipboard', 'scrutinizer' ) + '</strong>';
		html += '</div>';
		// translators: 1: the "incognito window" label, 2: a keyboard shortcut, 3: the "Stop Profiling" button label.
		html += '<p>' + sprintf( __( 'Open an %1$s (%2$s), paste the URL, and browse your site. Come back here and click %3$s when done.', 'scrutinizer' ), '<strong>' + __( 'incognito window', 'scrutinizer' ) + '</strong>', shortcut, '<strong>' + __( 'Stop Profiling', 'scrutinizer' ) + '</strong>' ) + '</p>';
		html += '<div class="scrutinizer-url-box">';
		html += '<input type="text" readonly class="widefat" id="scrutinizer-visitor-url" value="' + esc( url ) + '" />';
		html += '<button type="button" class="button" id="scrutinizer-visitor-copy">' + __( 'Copy again', 'scrutinizer' ) + '</button>';
		html += '</div>';
		html += '</div>';
		$( '#scrutinizer-capture-status' ).html( html );
	}

	function stopProfiling() {
		stopPolling();
		$.post( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_stop_profiling',
			nonce:  scrutinizerAdmin.nonce
		}, function( response ) {
			if ( response.success ) {
				showNotice( response.data.message, 'success' );
				// Navigate to profiles view instead of reloading.
				$( '#scrutinizer-capture-status' ).empty();
				showProfilesView();
			} else {
				showNotice( response.data.message || scrutinizerAdmin.i18n.error, 'error' );
			}
		} ).fail( function() {
			showNotice( scrutinizerAdmin.i18n.error, 'error' );
		} );
	}

	function copyActivationUrl() {
		var input = document.getElementById( 'scrutinizer-activation-url' ) || document.getElementById( 'scrutinizer-visitor-url' );
		if ( input ) {
			input.select();
			if ( navigator.clipboard ) {
				navigator.clipboard.writeText( input.value );
			} else {
				document.execCommand( 'copy' );
			}
			showNotice( scrutinizerAdmin.i18n.copied, 'success' );
		}
	}

	function showStopButton() {
		// Show in the capture flow status area.
		var $captureStatus = $( '#scrutinizer-capture-status' );
		$captureStatus.html(
			'<div class="scrutinizer-capture-active">' +
			'<div class="scrutinizer-polling">' +
				'<span class="spinner is-active"></span>' +
				'<strong>' + __( 'Profiling active', 'scrutinizer' ) + '</strong>' +
			'</div>' +
			'<p>' + __( 'Browse pages in the other tab. When done, click Stop Profiling below.', 'scrutinizer' ) + '</p>' +
			'<button type="button" class="button button-secondary button-large" id="scrutinizer-stop">' +
				scrutinizerAdmin.i18n.stopProfiling +
			'</button>' +
			'</div>'
		);
		// Also update the settings modal status.
		$( '.scrutinizer-status-card' ).addClass( 'is-active' );
		$( '.scrutinizer-dot' ).addClass( 'active' ).removeClass( 'inactive' );
		$( '#scrutinizer-status-text' ).text( scrutinizerAdmin.i18n.profiling );
	}

	/* ------------------------------------------------------------------ */
	/*  Polling                                                            */
	/* ------------------------------------------------------------------ */

	function startPolling() {
		if ( pollingTimer ) {
			return;
		}
		pollingTimer = setInterval( fetchGrouped, 15000 );
	}

	function stopPolling() {
		if ( pollingTimer ) {
			clearInterval( pollingTimer );
			pollingTimer = null;
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Top-level tabs (Routes | History)                                  */
	/* ------------------------------------------------------------------ */

	function renderTopTabs() {
		var html = '<div class="scrutinizer-top-tabs" id="scrutinizer-top-tabs">';
		html += '<button class="scrutinizer-top-tab active" data-top-tab="routes">' + esc( scrutinizerAdmin.i18n.routes || 'Routes' ) + '</button>';
		html += '<button class="scrutinizer-top-tab" data-top-tab="history">' + esc( scrutinizerAdmin.i18n.history || 'History' ) + '</button>';
		html += '<button class="scrutinizer-top-tab" data-top-tab="cron">' + esc( scrutinizerAdmin.i18n.cron || 'Cron' ) + '</button>';
		html += '<button class="scrutinizer-top-tab" data-top-tab="api">' + esc( scrutinizerAdmin.i18n.api || 'API' ) + '</button>';
		html += '</div>';

		// Insert tabs BEFORE #scrutinizer-results so they stay visible
		// when individual content containers are hidden/shown.
		$( '#scrutinizer-results h2' ).remove();
		$( '#scrutinizer-results' ).before( html );
		applyTabRoles();
	}

	/**
	 * Decorate both tab groups with the WAI-ARIA tab pattern + roving tabindex.
	 * Idempotent — safe to call after any tab render or switch.
	 */
	function applyTabRoles() {
		$( '.scrutinizer-tabs' ).attr( 'role', 'tablist' );
		$( '.scrutinizer-tab' ).each( function() {
			var tab    = $( this ).data( 'tab' );
			var active = $( this ).hasClass( 'active' );
			this.setAttribute( 'role', 'tab' );
			this.setAttribute( 'id', 'scrutinizer-tabbtn-' + tab );
			this.setAttribute( 'aria-controls', 'scrutinizer-tab-' + tab );
			this.setAttribute( 'aria-selected', active ? 'true' : 'false' );
			this.setAttribute( 'tabindex', active ? '0' : '-1' );
		} );
		$( '.scrutinizer-tab-content' ).each( function() {
			var id = this.id.replace( 'scrutinizer-tab-', '' );
			this.setAttribute( 'role', 'tabpanel' );
			this.setAttribute( 'aria-labelledby', 'scrutinizer-tabbtn-' + id );
		} );
		$( '.scrutinizer-top-tabs' ).attr( 'role', 'tablist' );
		$( '.scrutinizer-top-tab' ).each( function() {
			var active = $( this ).hasClass( 'active' );
			this.setAttribute( 'role', 'tab' );
			this.setAttribute( 'aria-selected', active ? 'true' : 'false' );
			this.setAttribute( 'tabindex', active ? '0' : '-1' );
		} );
	}

	/**
	 * Arrow-key roving within a tab group (Left/Right/Home/End), per WAI-ARIA.
	 *
	 * @param {Event}  e        Keydown event (currentTarget is the focused tab).
	 * @param {string} selector Tab-group selector.
	 */
	function tabKeydown( e, selector ) {
		if ( [ 'ArrowRight', 'ArrowLeft', 'Home', 'End' ].indexOf( e.key ) === -1 ) {
			return;
		}
		e.preventDefault();
		var tabs = $( selector ).filter( ':visible' );
		var idx  = tabs.index( e.currentTarget );
		if ( idx < 0 ) {
			return;
		}
		var next;
		if ( 'Home' === e.key ) {
			next = 0;
		} else if ( 'End' === e.key ) {
			next = tabs.length - 1;
		} else if ( 'ArrowRight' === e.key ) {
			next = ( idx + 1 ) % tabs.length;
		} else {
			next = ( idx - 1 + tabs.length ) % tabs.length;
		}
		tabs.eq( next ).trigger( 'click' ).trigger( 'focus' );
	}

	/* ------------------------------------------------------------------ */
	/*  Level 1: Grouped routes                                            */
	/* ------------------------------------------------------------------ */

	function fetchGrouped() {
		if ( fetchingGrouped ) {
			return; // Don't pile up requests.
		}
		fetchingGrouped = true;
		$.get( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_get_profiles_grouped',
			nonce:  scrutinizerAdmin.nonce
		} ).done( function( response ) {
			if ( response.success ) {
				groupedData = response.data.groups || [];
				if ( 'grouped' === currentView ) {
					renderGroupedTable( groupedData );
				}
			} else {
				$( '#scrutinizer-profile-list' ).html(
					'<p class="scrutinizer-empty">' + __( 'Failed to load routes. Try refreshing the page.', 'scrutinizer' ) + '</p>'
				);
			}
		} ).fail( function( xhr ) {
			var msg = __( 'Could not load routes.', 'scrutinizer' );
			if ( xhr.status === 403 || xhr.responseText === '-1' || xhr.responseText === '0' ) {
				// translators: 1: opening link tag, 2: closing link tag.
				msg = sprintf( __( 'Session expired. Please %1$sreload the page%2$s.', 'scrutinizer' ), '<a href="' + window.location.href + '">', '</a>' );
			}
			$( '#scrutinizer-profile-list' ).html(
				'<p class="scrutinizer-empty">' + msg + '</p>'
			);
		} ).always( function() {
			fetchingGrouped = false;
		} );
	}

	function renderGroupedTable( groups ) {
		var $list = $( '#scrutinizer-profile-list' );

		if ( ! groups || 0 === groups.length ) {
			$list.html(
				'<div class="scrutinizer-empty-state">' +
				'<h3>' + __( 'No measurements yet', 'scrutinizer' ) + '</h3>' +
				'<p>' + __( 'Start a profiling session to see where your server time goes, or turn on background measurement to capture requests automatically.', 'scrutinizer' ) + '</p>' +
				'<div class="scrutinizer-empty-actions">' +
				'<button type="button" class="button button-primary" id="scrutinizer-empty-capture">' + __( 'Capture Profile', 'scrutinizer' ) + '</button>' +
				'</div>' +
				'</div>'
			);
			return;
		}

		// Client-side filtering by response status.
		var filtered = [];
		for ( var f = 0; f < groups.length; f++ ) {
			var g = groups[ f ];
			var count2xx   = parseInt( g.count_2xx, 10 ) || 0;
			var countTotal = parseInt( g.count_total, 10 ) || 0;
			var countNon2xx = countTotal - count2xx;

			if ( '2xx' === routeFilter && 0 === count2xx ) {
				continue;
			}
			if ( 'non2xx' === routeFilter && 0 === countNon2xx ) {
				continue;
			}

			// Text search filter.
			if ( routeSearch ) {
				var searchText = ( g.route_key || '' ).toLowerCase();
				var labelText  = ( g.route_label || '' ).toLowerCase();
				if ( searchText.indexOf( routeSearch ) < 0 && labelText.indexOf( routeSearch ) < 0 ) {
					continue;
				}
			}

			filtered.push( g );
		}

		filtered = sortRows( filtered );

		// Filter bar.
		var html = '<div class="scrutinizer-filter-bar">';
		html += '<label>' + __( 'Showing:', 'scrutinizer' ) + ' <select id="scrutinizer-route-filter">';
		html += '<option value="2xx"' + ( '2xx' === routeFilter ? ' selected' : '' ) + '>' + __( 'Pages that loaded', 'scrutinizer' ) + '</option>';
		html += '<option value="non2xx"' + ( 'non2xx' === routeFilter ? ' selected' : '' ) + '>' + __( 'Other responses', 'scrutinizer' ) + '</option>';
		html += '<option value=""' + ( '' === routeFilter ? ' selected' : '' ) + '>' + __( 'All requests', 'scrutinizer' ) + '</option>';
		html += '</select></label>';
		html += '<input type="search" id="scrutinizer-route-search" placeholder="' + esc( __( 'Search routes\u2026', 'scrutinizer' ) ) + '" value="' + esc( routeSearch ) + '" />';
		html += '</div>';

		if ( 0 === filtered.length ) {
			html += '<p class="scrutinizer-empty">' + __( 'No routes match the current filter.', 'scrutinizer' ) + '</p>';
			$list.html( html );
			return;
		}

		html += '<table class="scrutinizer-profile-table widefat">';
		html += '<thead><tr>';
		html += sortHeader( __( 'Route', 'scrutinizer' ), 'route_key' );
		html += sortHeader( __( 'Method', 'scrutinizer' ), 'request_method' );
		html += sortHeader( __( 'Requests', 'scrutinizer' ), 'request_count' );
		html += sortHeader( __( 'Avg Duration', 'scrutinizer' ), 'avg_duration_ns' );
		html += sortHeader( __( 'Min', 'scrutinizer' ), 'min_duration_ns' );
		html += sortHeader( __( 'Max', 'scrutinizer' ), 'max_duration_ns' );
		html += sortHeader( __( 'Last Captured', 'scrutinizer' ), 'last_captured' );
		html += '<th>' + __( 'Type', 'scrutinizer' ) + '</th>';
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < filtered.length; i++ ) {
			var r = filtered[ i ];
			var avgMs = ( parseFloat( r.avg_duration_ns ) / 1e6 ).toFixed( 1 );
			var minMs = ( parseInt( r.min_duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var maxMs = ( parseInt( r.max_duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var types = typeBadges( r.profile_types || '' );
			var route = r.route_key || __( '(unknown)', 'scrutinizer' );

			// Two-line route label (F9).
			var routeCell = '';
			if ( r.route_label ) {
				routeCell = '<div class="scrutinizer-route-name">' +
					'<span class="scrutinizer-route-label">' + esc( r.route_label ) + '</span>' +
					'<span class="scrutinizer-route-key">' + esc( route ) + '</span>' +
					'</div>';
			} else {
				routeCell = '<span class="scrutinizer-route-key">' + esc( truncate( route, 50 ) ) + '</span>';
			}

			html += '<tr class="scrutinizer-route-row" data-route-key="' + esc( r.route_key ) + '">';
			html += '<td class="scrutinizer-route-cell">' + routeCell + '</td>';
			html += '<td>' + esc( r.request_method ) + '</td>';
			html += '<td class="numeric">' + parseInt( r.request_count, 10 ) + '</td>';
			html += '<td class="scrutinizer-duration numeric">' + esc( avgMs ) + ' ms</td>';
			html += '<td class="numeric">' + esc( minMs ) + ' ms</td>';
			html += '<td class="numeric">' + esc( maxMs ) + ' ms</td>';
			html += '<td>' + esc( r.last_captured ) + '</td>';
			html += '<td>' + types + '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		$list.html( html );
	}

	function showGroupedView() {
		currentView  = 'grouped';
		currentRoute = '';
		sortField    = 'avg_duration_ns';
		sortDir      = 'desc';
		$( '#scrutinizer-results' ).show();
		$( '#scrutinizer-route-detail' ).remove();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-history-view' ).remove();
		$( '#scrutinizer-compare-view' ).remove();
		$( '#scrutinizer-api-view' ).hide();
		$( '.scrutinizer-top-tab' ).removeClass( 'active' );
		$( '.scrutinizer-top-tab[data-top-tab="routes"]' ).addClass( 'active' );
		fetchGrouped();
	}

	/* ------------------------------------------------------------------ */
	/*  Level 2: Route drill-down                                          */
	/* ------------------------------------------------------------------ */

	function drillIntoRoute( routeKey ) {
		currentRoute = routeKey;
		sortField    = '';
		sortDir      = 'desc';

		$.get( scrutinizerAdmin.ajaxUrl, {
			action:    'scrutinizer_get_route_profiles',
			nonce:     scrutinizerAdmin.nonce,
			route_key: routeKey
		}, function( response ) {
			if ( response.success ) {
				routeData = response.data.profiles || [];
				showRouteView();
			}
		} );
	}

	function showRouteView() {
		currentView = 'route';
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-route-detail' ).remove();

		var html = '<div id="scrutinizer-route-detail">';
		html += '<button type="button" class="button button-link" id="scrutinizer-back-to-list">' + __( '← Back to routes', 'scrutinizer' ) + '</button>';
		html += '<h2>' + esc( currentRoute ) + '</h2>';
		html += '<div id="scrutinizer-route-regression" class="scrutinizer-regression-banner" style="display:none"></div>';

		// Trend sparkline.
		if ( routeData && routeData.length >= 2 ) {
			html += renderSparkline( routeData );
		}

		html += '<div id="scrutinizer-route-profiles"></div>';
		html += '</div>';

		$( '#scrutinizer-results' ).after( html );
		renderRouteTable( routeData );
		loadRouteRegression( currentRoute );
		moveFocus( '#scrutinizer-route-detail h2' );
	}

	/* ------------------------------------------------------------------ */
	/*  Route regression verdict (recent window vs older baseline)         */
	/* ------------------------------------------------------------------ */

	function loadRouteRegression( routeKey ) {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action:    'scrutinizer_get_route_regression',
			nonce:     scrutinizerAdmin.nonce,
			route_key: routeKey
		}, function( response ) {
			// Only render if we're still on the same route (async guard).
			if ( response && response.success && currentRoute === routeKey ) {
				renderRegressionBanner( response.data );
			}
		} );
	}

	function renderRegressionBanner( data ) {
		var el = $( '#scrutinizer-route-regression' );
		if ( ! el.length || ! data ) {
			return;
		}

		var verdict = data.verdict || 'insufficient_data';
		var labels  = {
			likely_regression:   __( 'Likely Regression', 'scrutinizer' ),
			difference_observed: __( 'Difference observed', 'scrutinizer' ),
			within_noise:        __( 'Within noise', 'scrutinizer' ),
			insufficient_data:   ''
		};

		el.attr( 'class', 'scrutinizer-regression-banner verdict-' + verdict );

		var html = '';
		if ( labels[ verdict ] ) {
			html += '<span class="scrutinizer-verdict-badge">' + esc( labels[ verdict ] ) + '</span>';
		}
		html += '<span class="scrutinizer-verdict-message">' + esc( data.message || '' ) + '</span>';

		el.html( html ).show();
	}

	/* ------------------------------------------------------------------ */
	/*  Trend Sparkline (F10)                                              */
	/* ------------------------------------------------------------------ */

	function renderSparkline( profiles ) {
		// Sort by captured_at ascending (oldest first).
		var sorted = profiles.slice().sort( function( a, b ) {
			return ( a.captured_at || '' ).localeCompare( b.captured_at || '' );
		} );

		// Limit to last 50 points.
		if ( sorted.length > 50 ) {
			sorted = sorted.slice( sorted.length - 50 );
		}

		var points = [];
		for ( var i = 0; i < sorted.length; i++ ) {
			var ms = parseInt( sorted[ i ].duration_ns, 10 ) / 1e6;
			points.push( ms );
		}

		if ( points.length < 2 ) {
			return '';
		}

		var minVal = Math.min.apply( null, points );
		var maxVal = Math.max.apply( null, points );
		var range  = maxVal - minVal || 1;

		// SVG dimensions.
		var w = 360;
		var h = 60;
		var pad = 4;
		var plotW = w - pad * 2;
		var plotH = h - pad * 2;

		// Build polyline points.
		var svgPoints = [];
		for ( var j = 0; j < points.length; j++ ) {
			var x = pad + ( j / ( points.length - 1 ) ) * plotW;
			var y = pad + plotH - ( ( points[ j ] - minVal ) / range ) * plotH;
			svgPoints.push( x.toFixed( 1 ) + ',' + y.toFixed( 1 ) );
		}

		// Fill area under curve.
		var areaPoints = svgPoints.slice();
		areaPoints.push( ( pad + plotW ).toFixed( 1 ) + ',' + ( pad + plotH ).toFixed( 1 ) );
		areaPoints.push( pad.toFixed( 1 ) + ',' + ( pad + plotH ).toFixed( 1 ) );

		// Stats.
		var avg   = 0;
		for ( var si = 0; si < points.length; si++ ) { avg += points[ si ]; }
		avg = avg / points.length;
		var latest = points[ points.length - 1 ];
		var trend  = latest - points[ 0 ];
		var trendLabel = trend > 0 ? '+' + trend.toFixed( 0 ) + ' ms' : trend.toFixed( 0 ) + ' ms';
		var trendCls   = trend > 20 ? 'trend-slower' : ( trend < -20 ? 'trend-faster' : 'trend-stable' );

		var html = '<div class="scrutinizer-sparkline-row">';
		html += '<div class="scrutinizer-sparkline-chart">';
		html += '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">';
		html += '<polygon points="' + areaPoints.join( ' ' ) + '" fill="#2271b1" opacity="0.08"/>';
		html += '<polyline points="' + svgPoints.join( ' ' ) + '" fill="none" stroke="#2271b1" stroke-width="1.5" stroke-linejoin="round"/>';
		// Dot on latest point.
		var lastPt = svgPoints[ svgPoints.length - 1 ].split( ',' );
		html += '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="3" fill="#2271b1"/>';
		html += '</svg>';
		html += '</div>';
		html += '<div class="scrutinizer-sparkline-stats">';
		html += '<span class="sparkline-stat"><span class="sparkline-stat-label">' + __( 'Latest', 'scrutinizer' ) + '</span> ' + latest.toFixed( 0 ) + ' ms</span>';
		html += '<span class="sparkline-stat"><span class="sparkline-stat-label">' + __( 'Average', 'scrutinizer' ) + '</span> ' + avg.toFixed( 0 ) + ' ms</span>';
		html += '<span class="sparkline-stat"><span class="sparkline-stat-label">' + __( 'Min', 'scrutinizer' ) + '</span> ' + minVal.toFixed( 0 ) + ' ms</span>';
		html += '<span class="sparkline-stat"><span class="sparkline-stat-label">' + __( 'Max', 'scrutinizer' ) + '</span> ' + maxVal.toFixed( 0 ) + ' ms</span>';
		html += '<span class="sparkline-stat ' + trendCls + '"><span class="sparkline-stat-label">' + __( 'Trend', 'scrutinizer' ) + '</span> ' + trendLabel + '</span>';
		html += '</div>';
		html += '</div>';

		return html;
	}

	function renderRouteTable( profiles ) {
		var $container = $( '#scrutinizer-route-profiles' );

		if ( ! profiles || 0 === profiles.length ) {
			$container.html( '<p class="scrutinizer-empty">' + __( 'No profiles for this route.', 'scrutinizer' ) + '</p>' );
			return;
		}

		profiles = sortRows( profiles );

		var html = '<table class="scrutinizer-profile-table widefat">';
		html += '<thead><tr>';
		html += sortHeader( scrutinizerAdmin.i18n.serverDuration, 'duration_ns' );
		html += sortHeader( __( 'URL', 'scrutinizer' ), 'request_url' );
		html += sortHeader( __( 'Method', 'scrutinizer' ), 'request_method' );
		html += sortHeader( __( 'Route', 'scrutinizer' ), 'route_class' );
		html += '<th>' + __( 'Role', 'scrutinizer' ) + '</th>';
		html += sortHeader( __( 'Captured', 'scrutinizer' ), 'captured_at' );
		html += '<th>' + __( 'Type', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'Actions', 'scrutinizer' ) + '</th>';
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < profiles.length; i++ ) {
			var p     = profiles[ i ];
			var durMs = ( parseInt( p.duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var url   = p.request_url || '—';
			var badge = typeBadge( p.profile_type || 'session' );

			html += '<tr>';
			html += '<td class="scrutinizer-duration numeric">' + esc( durMs ) + ' ms</td>';
			html += '<td title="' + esc( p.request_url ) + '">' + esc( truncate( url, 60 ) ) + '</td>';
			html += '<td>' + esc( p.request_method ) + '</td>';
			html += '<td>' + esc( p.route_class || '—' ) + '</td>';
			html += '<td>' + rolePill( p.user_role || 'anonymous' ) + '</td>';
			html += '<td>' + esc( p.captured_at ) + '</td>';
			html += '<td>' + badge + '</td>';
			html += '<td class="scrutinizer-actions">';
			html += '<a href="#" class="scrutinizer-view-profile" data-profile-id="' + parseInt( p.id, 10 ) + '">' + __( 'View', 'scrutinizer' ) + '</a>';
			html += ' | ';
			html += '<a href="#" class="scrutinizer-delete-profile" data-profile-id="' + parseInt( p.id, 10 ) + '">' + __( 'Delete', 'scrutinizer' ) + '</a>';
			html += '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';

		// Pagination.
		if ( historyPages > 1 ) {
			html += '<div class="scrutinizer-pagination">';
			html += '<a href="#" id="scrutinizer-page-prev" class="button' + ( historyPage <= 1 ? ' disabled' : '' ) + '">' + __( '&laquo; Previous', 'scrutinizer' ) + '</a>';
			// translators: 1: current page number, 2: total number of pages, 3: total profile count.
			html += '<span class="scrutinizer-page-info">' + sprintf( __( 'Page %1$d of %2$d (%3$d profiles)', 'scrutinizer' ), historyPage, historyPages, historyTotal ) + '</span>';
			html += '<a href="#" id="scrutinizer-page-next" class="button' + ( historyPage >= historyPages ? ' disabled' : '' ) + '">' + __( 'Next &raquo;', 'scrutinizer' ) + '</a>';
			html += '</div>';
		} else if ( historyTotal > 0 ) {
			html += '<div class="scrutinizer-pagination">';
			// translators: %d is the total number of profiles.
			html += '<span class="scrutinizer-page-info">' + sprintf( __( '%d profiles', 'scrutinizer' ), historyTotal ) + '</span>';
			html += '</div>';
		}

		$container.html( html );
	}

	/* ------------------------------------------------------------------ */
	/*  Level 3: Profile detail                                            */
	/* ------------------------------------------------------------------ */

	function loadProfileDetail( profileId ) {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_get_profile_detail',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: profileId,
			lightweight: '1'
		}, function( response ) {
			if ( response.success ) {
				// Reset color map for each profile view.
				pluginColorMap = {};
				colorIndex     = 0;
				// Reset trace state.
				traceLoaded   = false;
				traceRawData  = null;
				traceEntries  = [];
				traceFiltered = [];
				traceShown    = 0;
				// Reset timeline state.
				timelineLoaded = false;
				renderProfileDetail( response.data.profile );
				showDetailView();
			} else {
				showNotice( response.data.message || scrutinizerAdmin.i18n.error, 'error' );
			}
		} ).fail( function() {
			showNotice( scrutinizerAdmin.i18n.error, 'error' );
		} );
	}

	// Render the Timeline tab via the shared, framework-agnostic module
	// (the same scrutinizer-timeline.js the relay viewer uses, so both viewing
	// surfaces stay identical).
	function renderTimelineModule( profileData ) {
		var mount = document.getElementById( 'scrutinizer-tab-timeline' );
		if ( ! mount || ! window.ScrutinizerTimeline ) {
			return;
		}
		window.ScrutinizerTimeline.render( mount, profileData || {} );
		timelineLoaded = true;
	}

	function renderProfileDetail( profile ) {
		var data         = profile.profile_data || {};
		var summary      = data.summary || {};
		var sources      = data.sources || [];
		var request      = data.request || {};
		var phaseMarkers = data.phase_markers || [];
		var queries      = data.queries || [];
		var httpCalls    = data.http_calls || [];
		var autoloadOpts = data.autoloaded_options || {};
		var assets       = data.enqueued_assets || {};
		var timeline     = data.timeline || [];
		var traceData    = data.trace || [];
		var traceCount   = profile.trace_count || traceData.length || 0;
		var timelineCount = profile.timeline_count || timeline.length || 0;
		var durMs        = ( summary.duration_ms || 0 ).toFixed( 1 );
		var queryCount   = summary.query_count || 0;
		var httpCount    = summary.http_call_count || 0;
		var isPinned     = parseInt( profile.is_pinned, 10 ) === 1;
		var profileNote  = profile.note || '';
		var profileTags  = profile.tags || '';

		currentProfileId = parseInt( profile.id, 10 );
		currentProfileData = profile;

		var html = '';

		// Pin/annotate toolbar.
		html += '<div class="scrutinizer-pin-toolbar">';
		html += '<button type="button" class="button ' + ( isPinned ? 'button-primary' : '' ) + '" id="scrutinizer-pin-toggle" data-pinned="' + ( isPinned ? '1' : '' ) + '">';
		html += isPinned ? '<span class="dashicons dashicons-sticky"></span> ' + esc( scrutinizerAdmin.i18n.unpin || 'Unpin' ) : '<span class="dashicons dashicons-sticky"></span> ' + esc( scrutinizerAdmin.i18n.pin || 'Pin' );
		html += '</button>';
		html += '<label class="scrutinizer-pin-field"><span>' + esc( scrutinizerAdmin.i18n.note || 'Note' ) + ':</span>';
		html += '<input type="text" id="scrutinizer-note-input" value="' + esc( profileNote ) + '" placeholder="' + esc( __( 'Why did you take this measurement?', 'scrutinizer' ) ) + '" /></label>';
		html += '<label class="scrutinizer-pin-field"><span>' + esc( scrutinizerAdmin.i18n.tags || 'Tags' ) + ':</span>';
		html += '<input type="text" id="scrutinizer-tags-input" value="' + esc( profileTags ) + '" placeholder="before-update, opcache, v2.1" /></label>';
		html += '<button type="button" class="button" id="scrutinizer-share-btn" title="' + esc( __( 'Share this report', 'scrutinizer' ) ) + '"><span class="dashicons dashicons-share-alt2"></span> ' + __( 'Share', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="button" id="scrutinizer-export-btn" title="' + esc( __( 'Download raw profile as JSON', 'scrutinizer' ) ) + '"><span class="dashicons dashicons-download"></span> ' + __( 'Export', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="button" id="scrutinizer-compare-pick-btn" title="' + esc( __( 'Compare with another profile', 'scrutinizer' ) ) + '"><span class="dashicons dashicons-randomize"></span> ' + __( 'Compare', 'scrutinizer' ) + '</button>';
		html += '</div>';

		// Header with role pill.
		var headerLabel = esc( request.method ) + ' ' + esc( request.url );
		if ( request.ajax_action ) {
			headerLabel = esc( request.method ) + ' ajax:' + esc( request.ajax_action ) + ' ' + rolePill( request.user_role );
		} else {
			headerLabel += ' ' + rolePill( request.user_role );
		}
		html += '<div class="scrutinizer-detail-header">';
		html += '<h3>' + headerLabel + '</h3>';
		if ( request.referer ) {
			// translators: %s is the referring URL (referer).
			html += '<div class="scrutinizer-referer">' + sprintf( __( '↩ triggered from %s', 'scrutinizer' ), '<code>' + esc( request.referer ) + '</code>' ) + '</div>';
		}
		html += '</div>';

		// Metric cards row.
		html += '<div class="scrutinizer-metric-cards">';
		html += renderMetricCard( durMs + ' ms', scrutinizerAdmin.i18n.serverDuration, 'primary' );
		html += renderMetricCard( formatBytes( summary.memory_peak || request.memory_peak || 0 ), __( 'Peak Memory', 'scrutinizer' ), 'default' );
		html += renderMetricCard( formatBytes( summary.memory_allocated || 0 ), __( 'Memory Used', 'scrutinizer' ), summary.memory_allocated > 10485760 ? 'warning' : 'default' );
		html += renderMetricCard( String( queryCount ), __( 'DB Queries', 'scrutinizer' ), queryCount > 100 ? 'warning' : 'default' );
		html += renderMetricCard( String( httpCount ), __( 'HTTP Calls', 'scrutinizer' ), httpCount > 0 ? 'warning' : 'default' );
		html += renderMetricCard( String( summary.callback_count || 0 ), __( 'Callbacks', 'scrutinizer' ), 'default' );
		html += '</div>';

		// Tab navigation.
		html += '<div class="scrutinizer-tabs">';
		html += '<button class="scrutinizer-tab active" data-tab="timeline">' + __( 'Timeline', 'scrutinizer' ) + '</button>';
		html += '<button class="scrutinizer-tab" data-tab="sources">' + __( 'Sources', 'scrutinizer' ) + '</button>';
		if ( queries.length > 0 ) {
			// translators: %d is the number of database queries.
			html += '<button class="scrutinizer-tab" data-tab="queries">' + sprintf( __( 'Queries (%d)', 'scrutinizer' ), queries.length ) + '</button>';
		}
		if ( httpCalls.length > 0 ) {
			// translators: %d is the number of HTTP calls.
			html += '<button class="scrutinizer-tab" data-tab="http">' + sprintf( __( 'HTTP Calls (%d)', 'scrutinizer' ), httpCalls.length ) + '</button>';
		}
		if ( ( assets.counts && ( assets.counts.scripts + assets.counts.styles ) > 0 ) ) {
			// translators: %d is the number of assets (scripts and styles).
			html += '<button class="scrutinizer-tab" data-tab="assets">' + sprintf( __( 'Assets (%d)', 'scrutinizer' ), ( assets.counts.scripts + assets.counts.styles ) ) + '</button>';
		}
		if ( autoloadOpts.count > 0 ) {
			// translators: %d is the number of autoloaded options.
			html += '<button class="scrutinizer-tab" data-tab="options">' + sprintf( __( 'Options (%d)', 'scrutinizer' ), autoloadOpts.count ) + '</button>';
		}
		if ( traceCount > 0 ) {
			// translators: %s is the number of trace callbacks.
			html += '<button class="scrutinizer-tab" data-tab="trace">' + sprintf( __( 'Trace (%s)', 'scrutinizer' ), traceCount.toLocaleString() ) + '</button>';
		}
		html += '<button class="scrutinizer-tab" data-tab="metadata">' + __( 'Metadata', 'scrutinizer' ) + '</button>';
		html += '</div>';

		// Tab: Timeline. Rendered by the shared ScrutinizerTimeline module after
		// the detail markup is inserted (see the post-render block below).
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-timeline">';
		if ( timeline.length > 0 || timelineCount > 0 ) {
			html += '<p class="scrutinizer-empty"><span class="spinner is-active" style="float:none;margin:0 8px 0 0;"></span>' + esc( __( 'Loading timeline…', 'scrutinizer' ) ) + '</p>';
		} else {
			html += '<p class="scrutinizer-empty">' + esc( __( 'No timeline data available.', 'scrutinizer' ) ) + '</p>';
		}
		html += '</div>';

		// Tab: Sources.
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-sources" style="display:none">';
		html += renderSourceTable( sources, summary );
		html += renderCoreSubsystems( data.core_subsystems || [] );
		html += '</div>';

		// Tab: Queries.
		if ( queries.length > 0 ) {
			html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-queries" style="display:none">';
			html += renderQueriesTable( queries );
			html += '</div>';
		}

		// Tab: HTTP Calls.
		if ( httpCalls.length > 0 ) {
			html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-http" style="display:none">';
			html += renderHttpCallsTable( httpCalls );
			html += '</div>';
		}

		// Tab: Enqueued Assets.
		if ( assets.counts && ( assets.counts.scripts + assets.counts.styles ) > 0 ) {
			html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-assets" style="display:none">';
			html += renderAssetsTab( assets );
			html += '</div>';
		}

		// Tab: Options.
		if ( autoloadOpts.count > 0 ) {
			html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-options" style="display:none">';
			html += renderOptionsTab( autoloadOpts );
			html += '</div>';
		}

		// Tab: Hook Execution Trace (lazy-loaded).
		if ( traceCount > 0 ) {
			html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-trace" style="display:none">';
			if ( traceData.length > 0 ) {
				// Trace was included (non-lightweight), render immediately.
				traceLoaded  = true;
				traceRawData = traceData;
				html += renderTraceExplorerShell( traceCount );
			} else {
				// Trace not loaded yet — show placeholder.
				html += '<div class="scrutinizer-trace-loading">';
				html += '<span class="spinner is-active" style="float:none;margin:0 8px 0 0;"></span>';
				// translators: %s is the number of callbacks being loaded.
				html += sprintf( __( 'Loading %s callbacks\u2026', 'scrutinizer' ), traceCount.toLocaleString() );
				html += '</div>';
			}
			html += '</div>';
		}

		// Tab: Metadata.
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-metadata" style="display:none">';
		html += renderMetadata( request, summary );
		html += renderDevSignals( data.dev_signals || [] );
		html += renderTextdomainJit( data.textdomain_jit || [] );
		html += renderBootPhases( data.boot_phases || [] );
		html += '</div>';

		$( '#scrutinizer-detail-content' ).html( html );

		// Render the timeline (the default visible tab) via the shared module.
		// If the timeline data came inline (small profile) render now; otherwise
		// lazy-load it, then render.
		if ( data.timeline && data.timeline.length ) {
			renderTimelineModule( data );
		} else if ( currentProfileId ) {
			loadTimelineData( currentProfileId );
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Metric cards                                                       */
	/* ------------------------------------------------------------------ */

	function renderMetricCard( value, label, variant ) {
		var cls = 'scrutinizer-metric-card';
		if ( 'primary' === variant ) {
			cls += ' metric-primary';
		} else if ( 'warning' === variant ) {
			cls += ' metric-warning';
		}
		return '<div class="' + cls + '">' +
			'<div class="metric-value">' + esc( value ) + '</div>' +
			'<div class="metric-label">' + esc( label ) + '</div>' +
			'</div>';
	}

	/* ------------------------------------------------------------------ */
	/*  Source table with weight glyphs                                     */
	/* ------------------------------------------------------------------ */

	function renderSourceTable( sources, summary ) {
		if ( ! sources || 0 === sources.length ) {
			return '<p class="scrutinizer-empty">' + __( 'No source data.', 'scrutinizer' ) + '</p>';
		}

		var totalExclNs = summary.total_exclusive_ns || 1;
		var durationNs  = summary.duration_ns || totalExclNs;

		// Thin proportional breakdown bar.
		var html = '<div class="scrutinizer-source-bar">';
		for ( var sb = 0; sb < sources.length; sb++ ) {
			var barSrc = sources[ sb ];
			var barPct = ( ( barSrc.exclusive_ns || 0 ) / durationNs ) * 100;
			if ( barPct < 0.1 ) { continue; }
			var barCol = getSourceColor( barSrc.slug, barSrc.type );
			html += '<div class="segment" style="width:' + barPct.toFixed( 2 ) + '%;background:' + barCol + '" title="' + esc( barSrc.name || barSrc.slug ) + ': ' + ( barSrc.exclusive_ns / 1e6 ).toFixed( 1 ) + ' ms (' + barPct.toFixed( 1 ) + '%)"></div>';
		}
		// Unattributed time as its own segment.
		var unattribNs = summary.unattributed_ns || 0;
		var bootstrapNs = summary.bootstrap_ns || 0;
		var accountedNs = unattribNs + bootstrapNs;
		if ( accountedNs > 0 ) {
			var unPct = ( accountedNs / durationNs ) * 100;
			if ( unPct >= 0.1 ) {
				html += '<div class="segment" style="width:' + unPct.toFixed( 2 ) + '%;background:#dcdcde" title="' + esc( __( 'Unattributed + Bootstrap', 'scrutinizer' ) ) + ': ' + ( accountedNs / 1e6 ).toFixed( 1 ) + ' ms (' + unPct.toFixed( 1 ) + '%)"></div>';
			}
		}
		html += '</div>';

		html += '<p class="scrutinizer-tab-subtitle">' + __( 'Each plugin and theme\u2019s contribution to server request duration, sorted by the time spent in their own callbacks.', 'scrutinizer' ) + '</p>';
		html += '<table class="scrutinizer-source-table widefat">';
		html += '<thead><tr>';
		html += '<th>' + __( 'Source', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'Type', 'scrutinizer' ) + '</th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.exclusiveTime + ' <button type="button" class="scrutinizer-info-toggle" aria-label="' + esc( __( 'What is exclusive time?', 'scrutinizer' ) ) + '">ⓘ</button><span class="scrutinizer-info-bubble">' + __( 'Time spent directly in this source\u2019s own callbacks, excluding time in callbacks it triggers from other sources. This is the most useful number for identifying what\u2019s slow.', 'scrutinizer' ) + '</span></th>';
		html += '<th class="numeric">' + __( 'Weight', 'scrutinizer' ) + '</th>';
		html += '<th class="numeric">' + __( 'Memory', 'scrutinizer' ) + ' <button type="button" class="scrutinizer-info-toggle" aria-label="' + esc( __( 'What is memory?', 'scrutinizer' ) ) + '">ⓘ</button><span class="scrutinizer-info-bubble">' + __( 'Net heap change measured during this source\u2019s callbacks (memory_get_usage delta). Positive = allocated, negative = freed. Reflects what happened during execution, not total responsibility.', 'scrutinizer' ) + '</span></th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.inclusiveTime + ' <button type="button" class="scrutinizer-info-toggle" aria-label="' + esc( __( 'What is inclusive time?', 'scrutinizer' ) ) + '">ⓘ</button><span class="scrutinizer-info-bubble">' + __( 'Total time spent in this source\u2019s callbacks including any nested callbacks from other sources that it triggers.', 'scrutinizer' ) + '</span></th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.callCount + '</th>';
		html += '</tr></thead><tbody>';

		for ( var s = 0; s < sources.length; s++ ) {
			var src     = sources[ s ];
			var exclMs  = ( src.exclusive_ns / 1e6 ).toFixed( 2 );
			var pct     = ( ( src.exclusive_ns / totalExclNs ) * 100 ).toFixed( 1 );
			var barColor = getSourceColor( src.slug, src.type );
			var memDelta = src.memory_delta || 0;
			var memClass = memDelta > 1048576 ? ' scrutinizer-mem-high' : ( memDelta < 0 ? ' scrutinizer-mem-freed' : '' );

			// Expandable Unknown source row — shows individual callbacks since the source is unidentified.
			if ( 'unknown' === src.type && src.callbacks && src.callbacks.length > 0 ) {
				html += '<tr class="scrutinizer-unknown-row">';
				html += '<td>';
				html += '<details class="scrutinizer-unknown-expand">';
				// translators: %d is the number of callbacks.
				html += '<summary>' + esc( src.name || src.slug ) + ' <span class="scrutinizer-muted">' + sprintf( __( '(%d callbacks)', 'scrutinizer' ), src.callbacks.length ) + '</span></summary>';
				html += '<div class="scrutinizer-unknown-detail">';
				for ( var u = 0; u < src.callbacks.length; u++ ) {
					var cb = src.callbacks[ u ];
					var cbMs = cb.exclusive_ns ? ( cb.exclusive_ns / 1e6 ).toFixed( 2 ) + ' ms' : '';
					// translators: %d is the number of times the callback was called.
					var cbCalls = cb.call_count ? sprintf( __( '%d calls', 'scrutinizer' ), cb.call_count ) : '';
					html += '<div class="scrutinizer-unknown-callback">';
					html += '<code>' + esc( cb.callback || cb.id || 'anonymous' ) + '</code>';
					if ( cbMs || cbCalls ) {
						html += ' <span class="scrutinizer-muted">' + cbMs + ( cbMs && cbCalls ? ', ' : '' ) + cbCalls + '</span>';
					}
					html += '</div>';
				}
				html += '</div>';
				html += '</details>';
				html += '</td>';
			} else {
				html += '<tr>';
				html += '<td>' + esc( src.name || src.slug ) + '</td>';
			}

			html += '<td>' + esc( src.type ) + '</td>';
			html += '<td class="numeric">' + exclMs + ' ms</td>';
			html += '<td class="scrutinizer-weight-cell">';
			html += '<div class="scrutinizer-weight-bar-wrap">';
			html += '<span class="scrutinizer-weight-pct">' + pct + '%</span>';
			html += '<div class="scrutinizer-weight-bar" style="width:' + pct + '%;background:' + barColor + '"></div>';
			html += '</div>';
			html += '</td>';
			html += '<td class="numeric' + memClass + '">' + formatMemoryDelta( memDelta ) + '</td>';
			html += '<td class="numeric">' + ( src.inclusive_ns / 1e6 ).toFixed( 2 ) + ' ms</td>';
			html += '<td class="numeric">' + src.call_count + '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Core subsystem breakdown (core-dev troubleshooting)                */
	/* ------------------------------------------------------------------ */

	// Break the single "WordPress Core" source open into subsystems
	// (Query / Blocks / REST API / Assets / i18n...), so a core developer can
	// see where core time actually goes. Aggregate only — labels + totals.
	function renderCoreSubsystems( subsystems ) {
		if ( ! subsystems || 0 === subsystems.length ) {
			return '';
		}
		var totalNs = 0;
		var i;
		for ( i = 0; i < subsystems.length; i++ ) {
			totalNs += subsystems[ i ].exclusive_ns || 0;
		}
		if ( totalNs <= 0 ) {
			return '';
		}

		var html = '<div class="scrutinizer-core-subsystems">';
		html += '<h4>' + esc( __( 'WordPress Core — subsystem breakdown', 'scrutinizer' ) ) + '</h4>';
		html += '<p class="description">' + esc( __( 'Where the time inside the single "core" bucket goes. Aggregate only — labels and totals, never file paths.', 'scrutinizer' ) ) + '</p>';

		html += '<div class="scrutinizer-source-bar">';
		for ( i = 0; i < subsystems.length; i++ ) {
			var seg    = subsystems[ i ];
			var segPct = ( ( seg.exclusive_ns || 0 ) / totalNs ) * 100;
			if ( segPct < 0.5 ) {
				continue;
			}
			html += '<div class="segment" style="width:' + segPct.toFixed( 2 ) + '%;background:' + coreSubsystemColor( i ) + '" title="' + esc( seg.subsystem ) + ': ' + ( seg.exclusive_ns / 1e6 ).toFixed( 2 ) + ' ms"></div>';
		}
		html += '</div>';

		html += '<table class="scrutinizer-subsystem-table"><thead><tr>' +
			'<th>' + esc( __( 'Subsystem', 'scrutinizer' ) ) + '</th>' +
			'<th class="num">' + esc( __( 'Exclusive', 'scrutinizer' ) ) + '</th>' +
			'<th class="num">' + esc( __( 'Calls', 'scrutinizer' ) ) + '</th>' +
			'<th class="num">%</th></tr></thead><tbody>';
		for ( i = 0; i < subsystems.length; i++ ) {
			var sub    = subsystems[ i ];
			var subPct = ( ( sub.exclusive_ns || 0 ) / totalNs ) * 100;
			html += '<tr>' +
				'<td><span class="scrutinizer-subsystem-swatch" style="background:' + coreSubsystemColor( i ) + '"></span>' + esc( sub.subsystem ) + '</td>' +
				'<td class="num">' + ( sub.exclusive_ns / 1e6 ).toFixed( 2 ) + ' ms</td>' +
				'<td class="num">' + ( sub.call_count || 0 ).toLocaleString() + '</td>' +
				'<td class="num">' + subPct.toFixed( 1 ) + '%</td>' +
				'</tr>';
		}
		html += '</tbody></table></div>';
		return html;
	}

	// Stable palette for core subsystem segments (cycles for the long tail).
	function coreSubsystemColor( index ) {
		var palette = [ '#2271b1', '#e69f00', '#56b4e9', '#009e73', '#cc79a7', '#d55e00', '#0072b2', '#7c3aed', '#b45309', '#0f9d77', '#9a4708', '#646970' ];
		return palette[ index % palette.length ];
	}

	/* ------------------------------------------------------------------ */
	/*  Queries table                                                      */
	/* ------------------------------------------------------------------ */

	function renderQueriesTable( queries ) {
		if ( ! queries || 0 === queries.length ) {
			var qp = scrutinizerAdmin.queryProfiling;
			var msg = __( 'No query data captured for this profile.', 'scrutinizer' );
			if ( qp.managed && ! qp.active ) {
				msg = __( 'Query profiling is off. Enable the toggle above, then capture a new profile.', 'scrutinizer' );
			} else if ( ! qp.managed && ! qp.active ) {
				msg = __( 'SAVEQUERIES is disabled in wp-config.php. Enable it to capture query timing.', 'scrutinizer' );
			} else {
				msg = __( 'No query data — this profile was captured before query profiling was enabled.', 'scrutinizer' );
			}
			return '<p class="scrutinizer-empty">' + msg + '</p>';
		}

		// Ensure attribution is resolved for every query.
		for ( var qi = 0; qi < queries.length; qi++ ) {
			var qItem = queries[ qi ];
			if ( ! qItem.source_name ) {
				if ( qItem.attribution ) {
					qItem.source_name = qItem.attribution.name || qItem.attribution.slug || qItem.attribution.type || '';
					qItem.source_type = qItem.attribution.type || 'unknown';
				} else if ( qItem.caller ) {
					var inf = inferSourceFromCaller( qItem.caller );
					if ( inf ) {
						qItem.source_name = inf.name;
						qItem.source_type = inf.type;
					}
				}
			}
		}

		// Per-source summary.
		var bySrc = {};
		var totalQueryMs = 0;
		for ( var q = 0; q < queries.length; q++ ) {
			totalQueryMs += queries[ q ].time_ms || 0;
			var sn = queries[ q ].source_name || '\u2014';
			var st = queries[ q ].source_type || 'unknown';
			if ( ! bySrc[ sn ] ) {
				bySrc[ sn ] = { name: sn, type: st, count: 0, time: 0 };
			}
			bySrc[ sn ].count++;
			bySrc[ sn ].time += queries[ q ].time_ms || 0;
		}
		var srcList = Object.keys( bySrc ).map( function( k ) { return bySrc[ k ]; } );
		srcList.sort( function( a, b ) { return b.time - a.time; } );

		// Duplicate grouping.
		var groups = {};
		var groupOrder = [];
		for ( var gq = 0; gq < queries.length; gq++ ) {
			var sqlKey = queries[ gq ].sql || '';
			if ( ! groups[ sqlKey ] ) {
				groups[ sqlKey ] = { sql: sqlKey, items: [], totalMs: 0 };
				groupOrder.push( sqlKey );
			}
			groups[ sqlKey ].items.push( queries[ gq ] );
			groups[ sqlKey ].totalMs += queries[ gq ].time_ms || 0;
		}
		var duplicateCount = 0;
		for ( var dk = 0; dk < groupOrder.length; dk++ ) {
			if ( groups[ groupOrder[ dk ] ].items.length > 1 ) {
				duplicateCount++;
			}
		}

		var html = '<div class="scrutinizer-queries-header">';

		// Total summary line.
		html += '<div class="scrutinizer-queries-summary">';
		// translators: %d is the number of queries.
		var queryCountLabel = '<strong>' + sprintf( __( '%d queries', 'scrutinizer' ), queries.length ) + '</strong>';
		// translators: 1: a count label, 2: a total (time or size).
		html += sprintf( __( '%1$s totaling %2$s', 'scrutinizer' ), queryCountLabel, '<strong>' + totalQueryMs.toFixed( 1 ) + ' ms</strong>' );
		if ( duplicateCount > 0 ) {
			// translators: %d is the number of duplicate query patterns.
			html += ' \u00b7 <span class="scrutinizer-duplicate-flag">' + sprintf( __( '%d duplicate patterns', 'scrutinizer' ), duplicateCount ) + '</span>';
		}
		html += '</div>';

		// Per-source summary pills.
		html += '<div class="scrutinizer-queries-sources">';
		for ( var ps = 0; ps < srcList.length; ps++ ) {
			var pSrc = srcList[ ps ];
			var pillColor = sourceColors[ pSrc.type ] || '#888';
			html += '<button type="button" class="scrutinizer-query-source-pill" data-source="' + esc( pSrc.name ) + '" style="background:' + pillColor + '">';
			html += esc( pSrc.name ) + ': ' + pSrc.count + ' (' + pSrc.time.toFixed( 1 ) + ' ms)';
			html += '</button> ';
		}
		html += '</div>';

		// View toggle: Grouped vs Individual.
		html += '<div class="scrutinizer-queries-toggle">';
		html += '<button type="button" class="scrutinizer-toggle-btn active" data-view="grouped">' + __( 'Grouped', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="scrutinizer-toggle-btn" data-view="individual">' + __( 'Individual', 'scrutinizer' ) + '</button>';
		html += '</div>';

		html += '</div>'; // queries-header

		// Active filter indicator (hidden by default).
		html += '<div class="scrutinizer-query-filter-bar" style="display:none">';
		html += __( 'Showing queries from', 'scrutinizer' ) + ' <strong class="scrutinizer-filter-source-name"></strong> ';
		html += '<button type="button" class="scrutinizer-clear-filter">\u2715 ' + __( 'Clear', 'scrutinizer' ) + '</button>';
		html += '</div>';

		// Grouped view (default).
		html += '<div class="scrutinizer-queries-view" id="scrutinizer-queries-grouped">';
		html += renderQueriesGrouped( groups, groupOrder );
		html += '</div>';

		// Individual view (hidden).
		html += '<div class="scrutinizer-queries-view" id="scrutinizer-queries-individual" style="display:none">';
		html += renderQueriesTableBody( queries );
		html += '</div>';

		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Grouped queries view (N+1 detection)                               */
	/* ------------------------------------------------------------------ */

	function renderQueriesGrouped( groups, groupOrder ) {
		// Sort by total time descending.
		var sorted = groupOrder.slice().sort( function( a, b ) {
			return groups[ b ].totalMs - groups[ a ].totalMs;
		} );

		var html = '<table class="scrutinizer-source-table scrutinizer-queries-table scrutinizer-queries-grouped-table widefat">';
		html += '<thead><tr>';
		html += '<th>' + __( 'SQL Pattern', 'scrutinizer' ) + '</th>';
		html += '<th class="numeric">' + __( 'Count', 'scrutinizer' ) + '</th>';
		html += '<th class="numeric">' + __( 'Total Time', 'scrutinizer' ) + '</th>';
		html += '<th class="numeric">' + __( 'Avg', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'Sources', 'scrutinizer' ) + '</th>';
		html += '</tr></thead><tbody>';

		for ( var gi = 0; gi < sorted.length; gi++ ) {
			var grp = groups[ sorted[ gi ] ];
			var avgMs = grp.totalMs / grp.items.length;
			var isSlow = grp.totalMs > 50;
			var isDuplicate = grp.items.length > 1;

			// Collect unique sources for this group.
			var grpSources = {};
			for ( var gs = 0; gs < grp.items.length; gs++ ) {
				var gsn = grp.items[ gs ].source_name || '\u2014';
				var gst = grp.items[ gs ].source_type || 'unknown';
				grpSources[ gsn ] = gst;
			}

			var rowClass = '';
			if ( isSlow ) { rowClass = ' scrutinizer-slow-query'; }

			html += '<tr class="scrutinizer-query-group-row' + rowClass + '" data-sql="' + esc( grp.sql ) + '">';

			// SQL with count badge.
			html += '<td class="scrutinizer-sql-cell">';
			html += '<code class="scrutinizer-sql-expandable" title="' + esc( __( 'Click to expand', 'scrutinizer' ) ) + '">' + esc( truncate( grp.sql, 200 ) ) + '</code>';
			if ( grp.sql.length > 200 ) {
				html += '<code class="scrutinizer-sql-full" style="display:none">' + esc( grp.sql ) + '</code>';
			}
			html += '</td>';

			// Count with N+1 badge.
			html += '<td class="numeric">';
			if ( isDuplicate ) {
				html += '<span class="scrutinizer-duplicate-badge">\u00d7' + grp.items.length + '</span>';
			} else {
				html += '1';
			}
			html += '</td>';

			html += '<td class="numeric">' + grp.totalMs.toFixed( 2 ) + ' ms</td>';
			html += '<td class="numeric">' + avgMs.toFixed( 2 ) + ' ms</td>';

			// Source pills.
			html += '<td>';
			for ( var gsKey in grpSources ) {
				if ( grpSources.hasOwnProperty( gsKey ) ) {
					var gsColor = sourceColors[ grpSources[ gsKey ] ] || '#888';
					html += '<span class="scrutinizer-asset-source-pill" style="background:' + gsColor + '">' + esc( gsKey ) + '</span> ';
				}
			}
			html += '</td>';

			html += '</tr>';

			// Expandable detail rows (hidden by default) for duplicates.
			if ( isDuplicate ) {
				html += '<tr class="scrutinizer-group-detail" data-sql="' + esc( grp.sql ) + '" style="display:none"><td colspan="5">';
				html += '<table class="scrutinizer-group-detail-table"><thead><tr><th class="numeric">#</th><th>' + __( 'Source', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Time', 'scrutinizer' ) + '</th><th>' + __( 'Caller', 'scrutinizer' ) + '</th></tr></thead><tbody>';
				for ( var di = 0; di < grp.items.length; di++ ) {
					var dq = grp.items[ di ];
					var dSrcName = dq.source_name || '\u2014';
					var dSrcType = dq.source_type || 'unknown';
					var dColor = sourceColors[ dSrcType ] || '#888';
					html += '<tr>';
					html += '<td class="numeric">' + ( di + 1 ) + '</td>';
					html += '<td><span class="scrutinizer-asset-source-pill" style="background:' + dColor + '">' + esc( dSrcName ) + '</span></td>';
					html += '<td class="numeric">' + ( dq.time_ms || 0 ).toFixed( 2 ) + ' ms</td>';
					html += '<td class="scrutinizer-caller-cell"><span class="caller-short">' + esc( truncate( dq.caller || '', 80 ) ) + '</span></td>';
					html += '</tr>';
				}
				html += '</tbody></table></td></tr>';
			}
		}

		html += '</tbody></table>';
		return html;
	}

	function renderQueriesTableBody( queries ) {
		var html = '<table class="scrutinizer-source-table scrutinizer-queries-table widefat">';
		html += '<thead><tr>';
		html += '<th class="numeric">#</th>';
		html += sortableHeader( 'queries', 'source_name', __( 'Source', 'scrutinizer' ), 'string' );
		html += sortableHeader( 'queries', 'sql', __( 'SQL', 'scrutinizer' ), 'string' );
		html += sortableHeader( 'queries', 'time_ms', __( 'Time', 'scrutinizer' ), 'number' );
		html += sortableHeader( 'queries', 'caller', __( 'Caller', 'scrutinizer' ), 'string' );
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < queries.length; i++ ) {
			var qr    = queries[ i ];
			var qTime = ( qr.time_ms || 0 ).toFixed( 2 );
			var rowClass = qr.time_ms > 50 ? ' scrutinizer-slow-query' : ( qr.time_ms > 10 ? ' scrutinizer-warn-query' : '' );

			// Source badge.
			var qSource = '';
			var srcName = qr.source_name || '';
			var srcType = qr.source_type || 'unknown';
			if ( srcName ) {
				var qColor = sourceColors[ srcType ] || '#888';
				qSource = '<span class="scrutinizer-asset-source-pill scrutinizer-query-filter-pill" data-source="' + esc( srcName ) + '" style="background:' + qColor + '">' + esc( srcName ) + '</span>';
			}

			html += '<tr class="scrutinizer-query-row' + rowClass + '" data-source="' + esc( srcName ) + '">';
			html += '<td class="numeric">' + ( i + 1 ) + '</td>';
			html += '<td>' + ( qSource || '<span class="scrutinizer-asset-source-pill" style="background:#50575e;color:#fff">' + __( 'Core', 'scrutinizer' ) + '</span>' ) + '</td>';

			// Click-to-expand SQL.
			html += '<td class="scrutinizer-sql-cell">';
			html += '<code class="scrutinizer-sql-expandable" title="' + esc( __( 'Click to expand', 'scrutinizer' ) ) + '">' + esc( truncate( qr.sql || '', 200 ) ) + '</code>';
			if ( ( qr.sql || '' ).length > 200 ) {
				html += '<code class="scrutinizer-sql-full" style="display:none">' + esc( qr.sql ) + '</code>';
			}
			html += '</td>';

			html += '<td class="numeric">' + qTime + ' ms</td>';
			var callerRaw = qr.caller || '';
			var callerFrames = callerRaw.split( ', ' );
			var callerShort = truncate( callerRaw, 80 );
			html += '<td class="scrutinizer-caller-cell">';
			html += '<span class="caller-short">' + esc( callerShort ) + '</span>';
			if ( callerRaw.length > 80 ) {
				html += '<div class="caller-full">';
				for ( var cf = 0; cf < callerFrames.length; cf++ ) {
					html += '<div class="caller-frame">' + esc( callerFrames[ cf ].trim() ) + '</div>';
				}
				html += '</div>';
			}
			html += '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  HTTP Calls table                                                   */
	/* ------------------------------------------------------------------ */

	function renderHttpCallsTable( httpCalls ) {
		if ( ! httpCalls || 0 === httpCalls.length ) {
			return '<p class="scrutinizer-empty">' + __( 'No external HTTP calls detected.', 'scrutinizer' ) + '</p>';
		}

		// Compute total HTTP time.
		var totalHttpMs = 0;
		for ( var h = 0; h < httpCalls.length; h++ ) {
			totalHttpMs += httpCalls[ h ].duration_ms || 0;
		}

		var html = '<div class="scrutinizer-queries-summary">';
		// translators: %d is the number of external HTTP calls.
		var httpCountLabel = '<strong>' + sprintf( __( '%d external HTTP calls', 'scrutinizer' ), httpCalls.length ) + '</strong>';
		// translators: 1: a count label, 2: a total (time or size).
		html += sprintf( __( '%1$s totaling %2$s', 'scrutinizer' ), httpCountLabel, '<strong>' + totalHttpMs.toFixed( 1 ) + ' ms</strong>' );
		html += '</div>';

		html += renderHttpCallsTableBody( httpCalls );
		return html;
	}

	function renderHttpCallsTableBody( httpCalls ) {
		var html = '<table class="scrutinizer-source-table scrutinizer-http-table widefat">';
		html += '<thead><tr>';
		html += '<th class="numeric">#</th>';
		html += sortableHeader( 'httpcalls', 'method', __( 'Method', 'scrutinizer' ), 'string' );
		html += sortableHeader( 'httpcalls', 'url', __( 'URL', 'scrutinizer' ), 'string' );
		html += sortableHeader( 'httpcalls', 'status', __( 'Status', 'scrutinizer' ), 'number' );
		html += sortableHeader( 'httpcalls', 'duration_ms', __( 'Duration', 'scrutinizer' ), 'number' );
		html += sortableHeader( 'httpcalls', 'source_name', __( 'Source', 'scrutinizer' ), 'string' );
		html += sortableHeader( 'httpcalls', 'caller_str', __( 'Caller', 'scrutinizer' ), 'string' );
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < httpCalls.length; i++ ) {
			var hc   = httpCalls[ i ];
			var hMs  = ( hc.duration_ms || 0 ).toFixed( 1 );
			var slow = hc.duration_ms > 500 ? ' class="scrutinizer-slow-query"' : '';
			var statusLabel = hc.is_error ? __( 'Error', 'scrutinizer' ) : String( hc.status || '—' );
			var sourceName  = '';
			if ( hc.caller && hc.caller.attribution ) {
				sourceName = hc.caller.attribution.name || hc.caller.attribution.slug || hc.caller.attribution.type || '';
			}
			var callerStr = ( hc.caller && hc.caller.caller ) ? hc.caller.caller : '';
			hc.source_name = sourceName;
			hc.caller_str  = callerStr;

			html += '<tr' + slow + '>';
			html += '<td class="numeric">' + ( i + 1 ) + '</td>';
			html += '<td>' + esc( hc.method || 'GET' ) + '</td>';
			html += '<td class="scrutinizer-sql-cell" title="' + esc( hc.url ) + '"><code>' + esc( truncate( hc.url || '', 80 ) ) + '</code></td>';
			html += '<td class="numeric">' + esc( statusLabel ) + '</td>';
			html += '<td class="numeric">' + hMs + ' ms</td>';
			html += '<td>' + esc( sourceName ) + '</td>';
			var hcFrames = callerStr.split( ', ' );
			var hcShort = truncate( callerStr, 60 );
			html += '<td class="scrutinizer-caller-cell">';
			html += '<span class="caller-short">' + esc( hcShort ) + '</span>';
			if ( callerStr.length > 60 ) {
				html += '<div class="caller-full">';
				for ( var hcf = 0; hcf < hcFrames.length; hcf++ ) {
					html += '<div class="caller-frame">' + esc( hcFrames[ hcf ].trim() ) + '</div>';
				}
				html += '</div>';
			}
			html += '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Enqueued Assets tab                                                */
	/* ------------------------------------------------------------------ */

	function renderAssetsTab( assets ) {
		var scripts   = assets.scripts || [];
		var styles    = assets.styles || [];
		var totalSize = assets.total_size || 0;
		var counts    = assets.counts || {};

		var html = '<div class="scrutinizer-queries-summary">';
		// translators: %d is the number of scripts.
		html += '<strong>' + sprintf( __( '%d scripts', 'scrutinizer' ), ( counts.scripts || 0 ) ) + '</strong>';
		// translators: %d is the number of stylesheets.
		html += ' + <strong>' + sprintf( __( '%d stylesheets', 'scrutinizer' ), ( counts.styles || 0 ) ) + '</strong>';
		if ( totalSize > 0 ) {
			// translators: %s is the total asset size on disk.
			html += ' ' + sprintf( __( 'totaling %s on disk', 'scrutinizer' ), '<strong>' + formatBytes( totalSize ) + '</strong>' );
		}
		html += '</div>';

		if ( scripts.length > 0 ) {
			html += '<h4 class="scrutinizer-asset-section-label">' + __( 'Scripts', 'scrutinizer' ) + '</h4>';
			html += renderAssetTableBody( scripts, 'scripts' );
		}
		if ( styles.length > 0 ) {
			html += '<h4 class="scrutinizer-asset-section-label">' + __( 'Stylesheets', 'scrutinizer' ) + '</h4>';
			html += renderAssetTableBody( styles, 'styles' );
		}

		return html;
	}

	function renderAssetTableBody( assetList, assetType ) {
		var tableId = 'assets-' + assetType;
		var html = '<table class="scrutinizer-source-table scrutinizer-asset-table scrutinizer-asset-table-' + assetType + ' widefat">';
		html += '<thead><tr>';
		html += sortableHeader( tableId, 'handle', __( 'Handle', 'scrutinizer' ), 'string' );
		html += sortableHeader( tableId, 'src', __( 'Source', 'scrutinizer' ), 'string' );
		html += sortableHeader( tableId, 'size', __( 'Size', 'scrutinizer' ), 'number' );
		html += sortableHeader( tableId, 'location', __( 'Location', 'scrutinizer' ), 'string' );
		html += '<th>' + __( 'Dependencies', 'scrutinizer' ) + '</th>';
		html += sortableHeader( tableId, 'version', __( 'Version', 'scrutinizer' ), 'string' );
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < assetList.length; i++ ) {
			var a      = assetList[ i ];
			var attr   = a.attribution || {};
			// A registered asset's src can be a non-string (e.g. boolean true for
			// bundle-only handles); only treat an actual string as a URL.
			var srcUrl = ( typeof a.src === 'string' ) ? a.src : '';
			// Show just the path portion, truncated.
			var srcDisplay = srcUrl.replace( /^https?:\/\/[^\/]+/, '' );

			var sourcePill = '';
			if ( attr.type && 'unknown' !== attr.type ) {
				var pillColor = sourceColors[ attr.type ] || '#888';
				sourcePill = '<span class="scrutinizer-asset-source-pill" style="background:' + pillColor + '">'
					+ esc( attr.name || attr.slug ) + '</span> ';
			}

			var sizeCell = a.size > 0 ? formatBytes( a.size ) : '<span class="scrutinizer-muted">' + __( 'external', 'scrutinizer' ) + '</span>';
			var sizeClass = a.size > 102400 ? ' scrutinizer-asset-large' : ''; // >100KB

			html += '<tr>';
			html += '<td>' + sourcePill + '<code>' + esc( a.handle ) + '</code></td>';
			html += '<td class="scrutinizer-src-cell" title="' + esc( srcUrl ) + '">' + esc( truncate( srcDisplay, 60 ) ) + '</td>';
			html += '<td class="numeric' + sizeClass + '">' + sizeCell + '</td>';
			html += '<td>' + esc( a.location || '' ) + '</td>';
			html += '<td>' + ( a.deps && a.deps.length > 0 ? '<code>' + esc( a.deps.join( ', ' ) ) + '</code>' : '—' ) + '</td>';
			html += '<td>' + ( a.version ? '<code>' + esc( a.version ) + '</code>' : '—' ) + '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Options (autoloaded) tab                                           */
	/* ------------------------------------------------------------------ */

	function renderOptionsTab( autoloadOpts ) {
		var options   = autoloadOpts.options || [];
		var totalSize = autoloadOpts.total_size || 0;
		var count     = autoloadOpts.count || 0;

		if ( 0 === count ) {
			return '<p class="scrutinizer-empty">' + __( 'No autoloaded options data.', 'scrutinizer' ) + '</p>';
		}

		var html = '<div class="scrutinizer-queries-summary">';
		// translators: %d is the number of autoloaded options.
		var optionCountLabel = '<strong>' + sprintf( __( '%d autoloaded options', 'scrutinizer' ), count ) + '</strong>';
		// translators: 1: a count label, 2: a total (time or size).
		html += sprintf( __( '%1$s totaling %2$s', 'scrutinizer' ), optionCountLabel, '<strong>' + formatBytes( totalSize ) + '</strong>' );
		if ( totalSize > 1048576 ) { // > 1 MB.
			html += ' <span class="scrutinizer-options-warning">' + __( '⚠ Over 1 MB — this adds latency to every request', 'scrutinizer' ) + '</span>';
		} else if ( totalSize > 524288 ) { // > 512 KB.
			html += ' <span class="scrutinizer-options-caution">' + __( '⚡ Over 512 KB — worth reviewing', 'scrutinizer' ) + '</span>';
		}
		html += '</div>';

		html += '<table class="scrutinizer-source-table scrutinizer-options-table widefat">';
		html += '<thead><tr>';
		html += '<th class="numeric">#</th>';
		html += '<th>' + __( 'Option Name', 'scrutinizer' ) + '</th>';
		html += '<th class="numeric">' + __( 'Size', 'scrutinizer' ) + '</th>';
		html += '<th class="numeric">' + __( '% of Total', 'scrutinizer' ) + '</th>';
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < options.length; i++ ) {
			var opt = options[ i ];
			var pct = totalSize > 0 ? ( ( opt.size / totalSize ) * 100 ).toFixed( 1 ) : '0.0';
			var sizeStr = formatBytes( opt.size );
			var large = opt.size > 102400 ? ' class="scrutinizer-slow-query"' : ''; // > 100 KB highlight.

			html += '<tr' + large + '>';
			html += '<td class="numeric">' + ( i + 1 ) + '</td>';
			html += '<td><code>' + esc( opt.name ) + '</code></td>';
			html += '<td class="numeric">' + esc( sizeStr ) + '</td>';
			html += '<td class="scrutinizer-weight-cell">';
			html += '<div class="scrutinizer-weight-bar-wrap">';
			html += '<span class="scrutinizer-weight-pct">' + pct + '%</span>';
			html += '<div class="scrutinizer-weight-bar" style="width:' + pct + '%;background:#e67e22"></div>';
			html += '</div>';
			html += '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Metadata table                                                     */
	/* ------------------------------------------------------------------ */

	function renderMetadata( request, summary ) {
		var memPeak = summary.memory_peak || request.memory_peak || 0;
		var memAlloc = summary.memory_allocated || 0;
		var html = '<table class="scrutinizer-source-table widefat">';
		html += '<tbody>';
		html += '<tr><td>' + __( 'Route', 'scrutinizer' ) + '</td><td>' + esc( request.route_class || '—' ) + '</td></tr>';
		if ( request.ajax_action ) {
			html += '<tr><td>' + __( 'AJAX Action', 'scrutinizer' ) + '</td><td><code>' + esc( request.ajax_action ) + '</code></td></tr>';
		}
		if ( request.referer ) {
			html += '<tr><td>' + __( 'Referer', 'scrutinizer' ) + '</td><td><code>' + esc( request.referer ) + '</code></td></tr>';
		}
		html += '<tr><td>' + __( 'User Role', 'scrutinizer' ) + '</td><td>' + rolePill( request.user_role ) + '</td></tr>';
		html += '<tr><td>' + __( 'PHP', 'scrutinizer' ) + '</td><td>' + esc( request.php_version || '—' ) + '</td></tr>';
		html += '<tr><td>' + __( 'WordPress', 'scrutinizer' ) + '</td><td>' + esc( request.wp_version || '—' ) + '</td></tr>';
		html += '<tr><td>' + __( 'Scrutinizer', 'scrutinizer' ) + '</td><td>' + esc( scrutinizerAdmin.version || '—' ) + '</td></tr>';
		html += '<tr><td>' + __( 'Peak Memory', 'scrutinizer' ) + '</td><td>' + formatBytes( memPeak ) + '</td></tr>';
		html += '<tr><td>' + __( 'Memory Used', 'scrutinizer' ) + '</td><td>' + formatBytes( memAlloc ) + '</td></tr>';
		html += '<tr><td>' + __( 'DB Queries', 'scrutinizer' ) + '</td><td>' + ( summary.query_count || 0 ) + '</td></tr>';
		html += '<tr><td>' + __( 'HTTP Calls', 'scrutinizer' ) + '</td><td>' + ( summary.http_call_count || 0 ) + ( summary.http_total_ms > 0 ? ' (' + summary.http_total_ms + ' ms total)' : '' ) + '</td></tr>';
		html += '<tr><td>' + __( 'Callbacks Observed', 'scrutinizer' ) + '</td><td>' + ( summary.callback_count || 0 ) + '</td></tr>';
		html += '<tr><td>' + __( 'Sources Identified', 'scrutinizer' ) + '</td><td>' + ( summary.source_count || 0 ) + '</td></tr>';
		if ( summary.asset_count ) {
			html += '<tr><td>' + __( 'Enqueued Assets', 'scrutinizer' ) + '</td><td>' + summary.asset_count + ( summary.asset_total_size ? ' (' + formatBytes( summary.asset_total_size ) + ')' : '' ) + '</td></tr>';
		}
		html += '</tbody></table>';
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Developer signals (deprecations + doing_it_wrong)                  */
	/* ------------------------------------------------------------------ */

	// Surface deprecations and _doing_it_wrong() notices triggered during the
	// request, attributed to the source that triggered them. Counts only.
	function renderDevSignals( signals ) {
		if ( ! signals || 0 === signals.length ) {
			return '';
		}
		var typeLabels = {
			deprecated_function: __( 'Deprecated function', 'scrutinizer' ),
			deprecated_hook: __( 'Deprecated hook', 'scrutinizer' ),
			deprecated_argument: __( 'Deprecated argument', 'scrutinizer' ),
			deprecated_file: __( 'Deprecated file', 'scrutinizer' ),
			doing_it_wrong: __( 'Doing it wrong', 'scrutinizer' )
		};
		var html = '<div class="scrutinizer-dev-signals">';
		html += '<h4>' + esc( __( 'Developer signals', 'scrutinizer' ) ) + '</h4>';
		html += '<p class="description">' + esc( __( 'Deprecations and _doing_it_wrong() notices triggered during this request, and which source triggered each. Counts only — no argument values.', 'scrutinizer' ) ) + '</p>';
		html += '<table class="scrutinizer-subsystem-table"><thead><tr>' +
			'<th>' + esc( __( 'Signal', 'scrutinizer' ) ) + '</th>' +
			'<th>' + esc( __( 'API', 'scrutinizer' ) ) + '</th>' +
			'<th>' + esc( __( 'Since', 'scrutinizer' ) ) + '</th>' +
			'<th>' + esc( __( 'Triggered by', 'scrutinizer' ) ) + '</th>' +
			'<th class="num">' + esc( __( 'Count', 'scrutinizer' ) ) + '</th></tr></thead><tbody>';
		for ( var i = 0; i < signals.length; i++ ) {
			var s   = signals[ i ];
			var lbl = typeLabels[ s.type ] || s.type;
			html += '<tr>' +
				'<td>' + esc( lbl ) + '</td>' +
				'<td><code>' + esc( s.name ) + '</code></td>' +
				'<td>' + esc( s.version || '—' ) + '</td>' +
				'<td>' + esc( s.source || '—' ) + '</td>' +
				'<td class="num">' + ( s.count || 0 ).toLocaleString() + '</td>' +
				'</tr>';
		}
		html += '</tbody></table></div>';
		return html;
	}

	// Surface textdomains WordPress had to load just-in-time (a translation ran
	// before the textdomain was registered), and the hook each fired on.
	function renderTextdomainJit( loads ) {
		if ( ! loads || 0 === loads.length ) {
			return '';
		}
		var html = '<div class="scrutinizer-dev-signals">';
		html += '<h4>' + esc( __( 'Just-in-time translations', 'scrutinizer' ) ) + '</h4>';
		html += '<p class="description">' + esc( __( 'Textdomains WordPress loaded on demand because a translation function ran before the textdomain was registered. Loading translations on the right hook avoids this.', 'scrutinizer' ) ) + '</p>';
		html += '<table class="scrutinizer-subsystem-table"><thead><tr>' +
			'<th>' + esc( __( 'Textdomain', 'scrutinizer' ) ) + '</th>' +
			'<th>' + esc( __( 'Loaded on hook', 'scrutinizer' ) ) + '</th>' +
			'<th class="num">' + esc( __( 'Count', 'scrutinizer' ) ) + '</th></tr></thead><tbody>';
		for ( var i = 0; i < loads.length; i++ ) {
			var l = loads[ i ];
			html += '<tr>' +
				'<td><code>' + esc( l.domain ) + '</code></td>' +
				'<td><code>' + esc( l.hook || '—' ) + '</code></td>' +
				'<td class="num">' + ( l.count || 0 ).toLocaleString() + '</td>' +
				'</tr>';
		}
		html += '</tbody></table></div>';
		return html;
	}

	// Split the pre-plugin bootstrap into the phases we can hook (must-use vs.
	// active-plugin loading). Time before the early boot timer isn't measurable.
	function renderBootPhases( phases ) {
		if ( ! phases || 0 === phases.length ) {
			return '';
		}
		var totalNs = 0;
		var i;
		for ( i = 0; i < phases.length; i++ ) {
			totalNs += phases[ i ].ns || 0;
		}
		if ( totalNs <= 0 ) {
			return '';
		}
		var html = '<div class="scrutinizer-dev-signals">';
		html += '<h4>' + esc( __( 'Boot sequence', 'scrutinizer' ) ) + '</h4>';
		html += '<p class="description">' + esc( __( 'The pre-plugin bootstrap, split at the points we can hook. Time before the early boot timer (SAPI start, drop-ins) is not measurable.', 'scrutinizer' ) ) + '</p>';
		html += '<table class="scrutinizer-subsystem-table"><thead><tr>' +
			'<th>' + esc( __( 'Phase', 'scrutinizer' ) ) + '</th>' +
			'<th class="num">' + esc( __( 'Time', 'scrutinizer' ) ) + '</th>' +
			'<th class="num">%</th></tr></thead><tbody>';
		for ( i = 0; i < phases.length; i++ ) {
			var p   = phases[ i ];
			var pct = ( ( p.ns || 0 ) / totalNs ) * 100;
			html += '<tr>' +
				'<td>' + esc( p.phase ) + '</td>' +
				'<td class="num">' + ( ( p.ns || 0 ) / 1e6 ).toFixed( 2 ) + ' ms</td>' +
				'<td class="num">' + pct.toFixed( 1 ) + '%</td>' +
				'</tr>';
		}
		html += '</tbody></table></div>';
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Hook Execution Trace                                               */
	/* ------------------------------------------------------------------ */

	/**
	 * Parse a trace entry ID into callback, hook, and priority components.
	 * ID format: "callback_name@hook_tag:priority"
	 */
	function parseTraceId( entry ) {
		var id   = entry.id || '';
		var atIdx = id.lastIndexOf( '@' );
		var callback = id;
		var hookTag  = '';
		var priority = '';

		if ( atIdx > 0 ) {
			callback = id.substring( 0, atIdx );
			var rest = id.substring( atIdx + 1 );
			var colonIdx = rest.lastIndexOf( ':' );
			if ( colonIdx > 0 ) {
				hookTag  = rest.substring( 0, colonIdx );
				priority = rest.substring( colonIdx + 1 );
			} else {
				hookTag = rest;
			}
		}

		entry._callback = callback;
		entry._hook     = hookTag;
		entry._priority = priority;

		// Strip spl_object_id hashes (e.g. "ClassName#12345::method" → "ClassName::method").
		entry._callbackDisplay = callback.replace( /#\d+/g, '' );

		return entry;
	}

	/* ================================================================== */
	/*  Trace Explorer — Splunk-style log explorer for hook traces        */
	/* ================================================================== */

	/**
	 * Lazy-load trace data via AJAX and render the explorer.
	 */
	function loadTraceData( profileId ) {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_get_profile_trace',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: profileId
		}, function( response ) {
			if ( response.success && response.data && response.data.trace ) {
				traceRawData = response.data.trace;
				traceLoaded  = true;

				// Store on profile object so export works.
				if ( currentProfileData && currentProfileData.profile_data ) {
					currentProfileData.profile_data.trace = traceRawData;
				}

				// Enrich with source/query/HTTP cross-references.
				var profileData = ( currentProfileData && currentProfileData.profile_data ) || {};
				traceEntries = enrichTraceEntries(
					traceRawData,
					profileData.sources || [],
					profileData.queries || [],
					profileData.http_calls || []
				);

				$( '#scrutinizer-tab-trace' ).html( renderTraceExplorerShell( traceEntries.length ) );
				refreshTraceTable();
				renderSavedSearchPills();
			} else {
				$( '#scrutinizer-tab-trace' ).html(
					'<p class="scrutinizer-empty">' + __( 'Failed to load trace data.', 'scrutinizer' ) + '</p>'
				);
			}
		} ).fail( function() {
			$( '#scrutinizer-tab-trace' ).html(
				'<p class="scrutinizer-empty">' + __( 'Failed to load trace data.', 'scrutinizer' ) + '</p>'
			);
		} );
	}

	/**
	 * Lazy-load timeline data for the current profile.
	 */
	function loadTimelineData( profileId ) {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_get_profile_timeline',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: profileId
		}, function( response ) {
			if ( response.success && response.data ) {
				timelineLoaded = true;

				var timelineData  = response.data.timeline || [];
				var phaseMarkers  = response.data.phase_markers || [];

				// Store on profile object so export/share works.
				if ( currentProfileData && currentProfileData.profile_data ) {
					currentProfileData.profile_data.timeline      = timelineData;
					currentProfileData.profile_data.phase_markers = phaseMarkers;
				}

				var profileData = ( currentProfileData && currentProfileData.profile_data ) || {};
				renderTimelineModule( profileData );
			} else {
				$( '#scrutinizer-tab-timeline' ).html(
					'<p class="scrutinizer-empty">' + __( 'Failed to load timeline data.', 'scrutinizer' ) + '</p>'
				);
			}
		} ).fail( function() {
			$( '#scrutinizer-tab-timeline' ).html(
				'<p class="scrutinizer-empty">' + __( 'Failed to load timeline data.', 'scrutinizer' ) + '</p>'
			);
		} );
	}

	/**
	 * Enrich flat trace entries with source type, query count, and HTTP count.
	 */
	function enrichTraceEntries( rawTrace, sources, queries, httpCalls ) {
		var srcMap   = buildSourceMap( sources );
		var queryMap = buildQueryCountMap( queries );
		var httpMap  = buildHttpCountMap( httpCalls );
		var memMap   = buildMemoryDeltaMap( sources );
		var entries  = [];

		for ( var i = 0; i < rawTrace.length; i++ ) {
			var entry = parseTraceId( $.extend( {}, rawTrace[ i ] ) );
			entry.exclusive_ms = ( entry.exclusive_ns || 0 ) / 1e6;
			entry.inclusive_ms = ( entry.inclusive_ns || 0 ) / 1e6;

			var srcInfo = srcMap[ entry._callback ] || { type: 'unknown', name: 'unknown' };
			entry.source_type = srcInfo.type;
			entry.source_name = srcInfo.name;

			entry.query_count = queryMap[ entry._callback ] || 0;

			// HTTP count: try direct callback match first, then fall back to source slug.
			entry.http_count  = httpMap.byCallback[ entry._callback ] || 0;
			if ( 0 === entry.http_count && srcInfo.slug ) {
				entry.http_count = httpMap.bySource[ srcInfo.slug ] || 0;
			}

			// Memory delta from sources per-callback data.
			entry.mem_delta = memMap[ entry._callback ] || 0;

			entries.push( entry );
		}

		return entries;
	}

	/** Build a map: callback_name to { type, name, slug } from sources array. */
	function buildSourceMap( sources ) {
		var map = {};
		for ( var i = 0; i < sources.length; i++ ) {
			var src = sources[ i ];
			var cbs = src.callbacks || [];
			for ( var j = 0; j < cbs.length; j++ ) {
				map[ cbs[ j ].callback ] = {
					type: src.type || 'unknown',
					name: src.name || src.slug || 'unknown',
					slug: src.slug || ''
				};
			}
		}
		return map;
	}

	/** Build a map: callback_name to memory_delta (bytes) from sources per-callback data. */
	function buildMemoryDeltaMap( sources ) {
		var map = {};
		for ( var i = 0; i < sources.length; i++ ) {
			var cbs = sources[ i ].callbacks || [];
			for ( var j = 0; j < cbs.length; j++ ) {
				var cb = cbs[ j ];
				map[ cb.callback ] = ( map[ cb.callback ] || 0 ) + ( cb.memory_delta || 0 );
			}
		}
		return map;
	}

	/** Build a map: callback_name to query count from queries array. */
	function buildQueryCountMap( queries ) {
		var map = {};
		for ( var i = 0; i < queries.length; i++ ) {
			var callerStr = queries[ i ].caller || '';
			var callers   = callerStr.split( ', ' );
			var credited  = {};
			for ( var j = 0; j < callers.length; j++ ) {
				var c = callers[ j ].trim();
				if ( c && ! credited[ c ] ) {
					credited[ c ] = true;
					map[ c ] = ( map[ c ] || 0 ) + 1;
				}
			}
		}
		return map;
	}

	/** Build a map: callback_name to HTTP call count from http_calls array. */
	function buildHttpCountMap( httpCalls ) {
		// Two maps: direct callback match + source-based fallback.
		var map = { byCallback: {}, bySource: {} };
		for ( var i = 0; i < httpCalls.length; i++ ) {
			var raw = httpCalls[ i ].caller || '';
			// caller can be a string or an object with .caller string + .attribution.
			var caller = 'string' === typeof raw ? raw : ( raw.caller || '' );
			var slug   = ( 'object' === typeof raw && raw.attribution ) ? ( raw.attribution.slug || '' ) : '';
			caller = caller.trim();

			// Direct callback match: each function in the caller stack.
			if ( caller ) {
				var parts = caller.split( /,\s*/ );
				for ( var p = 0; p < parts.length; p++ ) {
					var fn = parts[ p ].trim();
					if ( fn ) {
						map.byCallback[ fn ] = ( map.byCallback[ fn ] || 0 ) + 1;
					}
				}
			}

			// Source-based fallback: count HTTP calls per source slug.
			if ( slug ) {
				map.bySource[ slug ] = ( map.bySource[ slug ] || 0 ) + 1;
			}
		}
		return map;
	}

	/**
	 * Render the trace explorer shell: search, pills, filters, table container.
	 */
	function renderTraceExplorerShell( totalCount ) {
		var html = '';

		// Search bar.
		html += '<div class="scrutinizer-trace-explorer">';
		html += '<div class="scrutinizer-trace-search-bar">';
		html += '<input type="search" id="scrutinizer-trace-search" placeholder="' + esc( __( 'Search callbacks, hooks, sources\u2026', 'scrutinizer' ) ) + '" class="scrutinizer-trace-search-input" />';
		html += '</div>';

		// Built-in pills.
		html += '<div class="scrutinizer-trace-pills">';
		html += '<button type="button" class="scrutinizer-trace-pill" data-pill="top-10">' + __( 'Top 10 Slowest', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="scrutinizer-trace-pill" data-pill="db-heavy">' + __( 'DB Heavy (&gt;10)', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="scrutinizer-trace-pill" data-pill="http-calls">' + __( 'HTTP Calls', 'scrutinizer' ) + '</button>';

		// Show context-aware pills only if matching data exists.
		var hasAjax = false;
		var hasCheckout = false;
		var hasAuth = false;
		var hasMemHeavy = false;
		for ( var i = 0; i < traceEntries.length && ( ! hasAjax || ! hasCheckout || ! hasAuth || ! hasMemHeavy ); i++ ) {
			var h = traceEntries[ i ]._hook;
			if ( ! hasAjax && ( h.indexOf( 'wp_ajax_' ) === 0 || h.indexOf( 'wp_ajax_nopriv_' ) === 0 ) ) { hasAjax = true; }
			if ( ! hasCheckout && h.indexOf( 'woocommerce_checkout' ) !== -1 ) { hasCheckout = true; }
			if ( ! hasAuth && ( h.indexOf( 'wp_authenticate' ) !== -1 || h.indexOf( 'login_' ) === 0 || h.indexOf( 'auth_cookie' ) !== -1 ) ) { hasAuth = true; }
			if ( ! hasMemHeavy && Math.abs( traceEntries[ i ].mem_delta || 0 ) > 102400 ) { hasMemHeavy = true; }
		}
		if ( hasAjax ) {
			html += '<button type="button" class="scrutinizer-trace-pill" data-pill="ajax">' + __( 'AJAX', 'scrutinizer' ) + '</button>';
		}
		if ( hasCheckout ) {
			html += '<button type="button" class="scrutinizer-trace-pill" data-pill="checkout">' + __( 'Checkout', 'scrutinizer' ) + '</button>';
		}
		if ( hasAuth ) {
			html += '<button type="button" class="scrutinizer-trace-pill" data-pill="login">' + __( 'Login/Auth', 'scrutinizer' ) + '</button>';
		}
		if ( hasMemHeavy ) {
			html += '<button type="button" class="scrutinizer-trace-pill" data-pill="mem-heavy">' + __( 'Memory Heavy', 'scrutinizer' ) + '</button>';
		}

		// Saved searches placeholder.
		html += '<span id="scrutinizer-trace-saved-pills"></span>';
		html += '<button type="button" class="scrutinizer-trace-pill scrutinizer-trace-save" id="scrutinizer-trace-save-search" title="' + esc( __( 'Save current filters as a pill', 'scrutinizer' ) ) + '">' + __( '+ Save', 'scrutinizer' ) + '</button>';
		html += '</div>';

		// Filter controls.
		html += '<div class="scrutinizer-trace-filters">';
		html += '<label>' + __( 'Source', 'scrutinizer' ) + ' <select id="scrutinizer-trace-source">';
		html += '<option value="">' + __( 'All', 'scrutinizer' ) + '</option>';
		html += '<option value="plugin">' + __( 'Plugin', 'scrutinizer' ) + '</option>';
		html += '<option value="theme">' + __( 'Theme', 'scrutinizer' ) + '</option>';
		html += '<option value="core">' + __( 'Core', 'scrutinizer' ) + '</option>';
		html += '<option value="mu-plugin">' + __( 'MU-Plugin', 'scrutinizer' ) + '</option>';
		html += '<option value="unknown">' + __( 'Unknown', 'scrutinizer' ) + '</option>';
		html += '</select></label>';
		html += '<label>' + __( 'Duration', 'scrutinizer' ) + ' &gt; <input type="number" id="scrutinizer-trace-min-duration" min="0" step="0.1" style="width:70px" /> ms</label>';
		html += '<label>' + __( 'Queries', 'scrutinizer' ) + ' &gt; <input type="number" id="scrutinizer-trace-min-queries" min="0" step="1" style="width:60px" /></label>';
		html += '<button type="button" class="button-link" id="scrutinizer-trace-clear">' + __( 'Clear filters', 'scrutinizer' ) + '</button>';
		html += '</div>';

		// Status bar.
		html += '<div class="scrutinizer-trace-status" id="scrutinizer-trace-status"></div>';

		// Table.
		html += '<table class="scrutinizer-trace-table widefat striped">';
		html += '<thead><tr>';
		html += '<th class="scrutinizer-trace-sortable' + ( 'exclusive_ns' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="exclusive_ns" style="width:90px">' + __( 'Duration', 'scrutinizer' ) + '</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( '_callback' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="_callback">' + __( 'Callback', 'scrutinizer' ) + '</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( '_hook' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="_hook">' + __( 'Hook', 'scrutinizer' ) + '</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( 'source_name' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="source_name" style="width:120px">' + __( 'Source', 'scrutinizer' ) + '</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( 'query_count' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="query_count" style="width:60px">' + __( 'Qry', 'scrutinizer' ) + '</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( 'http_count' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="http_count" style="width:60px">' + __( 'HTTP', 'scrutinizer' ) + '</th>';
		html += '</tr></thead>';
		html += '<tbody id="scrutinizer-trace-tbody"></tbody>';
		html += '</table>';

		// Show more button.
		html += '<div class="scrutinizer-trace-more" id="scrutinizer-trace-more-wrap" style="display:none">';
		// translators: %d is the number of additional rows to show.
		html += '<button type="button" class="button" id="scrutinizer-trace-show-more">' + sprintf( __( 'Show %d more', 'scrutinizer' ), tracePageSize ) + '</button>';
		html += '</div>';

		html += '</div>';
		return html;
	}

	/**
	 * Apply current filters, sort, and re-render the trace table.
	 */
	function refreshTraceTable() {
		var search     = ( $( '#scrutinizer-trace-search' ).val() || '' ).toLowerCase();
		var source     = $( '#scrutinizer-trace-source' ).val() || '';
		var minDur     = parseFloat( $( '#scrutinizer-trace-min-duration' ).val() ) || 0;
		var minQueries = parseInt( $( '#scrutinizer-trace-min-queries' ).val(), 10 ) || 0;

		// Gather active pills.
		var activePills = {};
		$( '.scrutinizer-trace-pill.active' ).each( function() {
			activePills[ $( this ).data( 'pill' ) ] = true;
		} );

		// Filter.
		traceFiltered = applyTraceFilters( traceEntries, search, source, minDur, minQueries, activePills );

		// Sort.
		var sk = traceSortKey;
		var sd = 'asc' === traceSortDir ? 1 : -1;
		traceFiltered.sort( function( a, b ) {
			var va = a[ sk ];
			var vb = b[ sk ];
			if ( 'string' === typeof va ) { va = va.toLowerCase(); vb = ( vb || '' ).toLowerCase(); }
			if ( va < vb ) { return -1 * sd; }
			if ( va > vb ) { return sd; }
			return 0;
		} );

		// Render first page.
		traceShown = Math.min( tracePageSize, traceFiltered.length );
		$( '#scrutinizer-trace-tbody' ).html( renderTraceRows( traceFiltered, 0, traceShown ) );
		updateTraceStatus();
	}

	/**
	 * Apply all filters to trace entries. Pills are AND-combined.
	 */
	function applyTraceFilters( entries, search, source, minDur, minQueries, activePills ) {
		var result = entries;

		// Text search.
		if ( search ) {
			result = result.filter( function( e ) {
				return e._callback.toLowerCase().indexOf( search ) !== -1 ||
					e._hook.toLowerCase().indexOf( search ) !== -1 ||
					e.source_name.toLowerCase().indexOf( search ) !== -1;
			} );
		}

		// Source type.
		if ( source ) {
			result = result.filter( function( e ) {
				return e.source_type === source;
			} );
		}

		// Duration threshold.
		if ( minDur > 0 ) {
			result = result.filter( function( e ) {
				return e.exclusive_ms >= minDur;
			} );
		}

		// Query count threshold.
		if ( minQueries > 0 ) {
			result = result.filter( function( e ) {
				return e.query_count >= minQueries;
			} );
		}

		// Pills (AND).
		if ( activePills[ 'top-10' ] ) {
			var sorted = result.slice().sort( function( a, b ) { return b.exclusive_ns - a.exclusive_ns; } );
			result = sorted.slice( 0, 10 );
		}
		if ( activePills[ 'db-heavy' ] ) {
			result = result.filter( function( e ) { return e.query_count > 10; } );
		}
		if ( activePills[ 'http-calls' ] ) {
			result = result.filter( function( e ) { return e.http_count > 0; } );
		}
		if ( activePills.ajax ) {
			result = result.filter( function( e ) { return e._hook.indexOf( 'wp_ajax_' ) === 0; } );
		}
		if ( activePills.checkout ) {
			result = result.filter( function( e ) {
				return e._hook.indexOf( 'woocommerce_checkout' ) !== -1 ||
					e._hook.indexOf( 'woocommerce_before_checkout' ) !== -1 ||
					e._hook.indexOf( 'woocommerce_after_checkout' ) !== -1;
			} );
		}
		if ( activePills.login ) {
			result = result.filter( function( e ) {
				return e._hook.indexOf( 'wp_authenticate' ) !== -1 ||
					e._hook.indexOf( 'login_' ) === 0 ||
					e._hook.indexOf( 'auth_cookie' ) !== -1;
			} );
		}
		if ( activePills[ 'mem-heavy' ] ) {
			var sorted = result.slice().sort( function( a, b ) { return Math.abs( b.mem_delta || 0 ) - Math.abs( a.mem_delta || 0 ); } );
			result = sorted.slice( 0, 10 );
		}

		return result;
	}

	/**
	 * Render trace table rows for a range of entries.
	 */
	function renderTraceRows( entries, start, count ) {
		var html = '';
		var end = Math.min( start + count, entries.length );

		for ( var i = start; i < end; i++ ) {
			var e = entries[ i ];
			var durMs  = e.exclusive_ms.toFixed( 2 );
			var color  = sourceColors[ e.source_type ] || sourceColors.unknown || '#999';
			var durCls = e.exclusive_ms >= 10 ? ' scrutinizer-trace-slow' : '';

			html += '<tr>';
			html += '<td class="scrutinizer-trace-dur' + durCls + '">' + esc( durMs ) + ' ms</td>';
			html += '<td class="scrutinizer-trace-cb"><code>' + esc( e._callbackDisplay || e._callback ) + '</code>';
			if ( e._priority ) {
				html += ' <span class="scrutinizer-muted">:' + esc( e._priority ) + '</span>';
			}
			html += '</td>';
			html += '<td class="scrutinizer-trace-hook"><code>' + esc( e._hook ) + '</code></td>';
			html += '<td><span class="scrutinizer-source-dot" style="background:' + color + '"></span>' + esc( e.source_name ) + '</td>';
			html += '<td class="scrutinizer-trace-num">' + ( e.query_count > 0 ? e.query_count : '<span class="scrutinizer-muted">\u2014</span>' ) + '</td>';
			html += '<td class="scrutinizer-trace-num">' + ( e.http_count > 0 ? e.http_count : '<span class="scrutinizer-muted">\u2014</span>' ) + '</td>';
			html += '</tr>';
		}

		return html;
	}

	/** Update the trace status bar and show/hide the "Show more" button. */
	function updateTraceStatus() {
		var filterCount = 0;
		if ( $( '#scrutinizer-trace-search' ).val() ) { filterCount++; }
		if ( $( '#scrutinizer-trace-source' ).val() ) { filterCount++; }
		if ( parseFloat( $( '#scrutinizer-trace-min-duration' ).val() ) > 0 ) { filterCount++; }
		if ( parseInt( $( '#scrutinizer-trace-min-queries' ).val(), 10 ) > 0 ) { filterCount++; }
		$( '.scrutinizer-trace-pill.active' ).each( function() { filterCount++; } );

		var showing = Math.min( traceShown, traceFiltered.length );
		// translators: 1: number of callbacks shown, 2: total number of callbacks.
		var statusText = sprintf( __( 'Showing %1$s of %2$s callbacks', 'scrutinizer' ), showing.toLocaleString(), traceFiltered.length.toLocaleString() );
		if ( traceFiltered.length !== traceEntries.length ) {
			// translators: %s is the total number of callbacks before filtering.
			statusText += ' ' + sprintf( __( '(filtered from %s)', 'scrutinizer' ), traceEntries.length.toLocaleString() );
		}
		if ( filterCount > 0 ) {
			// translators: %d is the number of active filters.
			statusText += ' \u00b7 ' + sprintf( __( '%d filters active', 'scrutinizer' ), filterCount );
		}

		$( '#scrutinizer-trace-status' ).text( statusText );
		$( '#scrutinizer-trace-more-wrap' ).toggle( traceShown < traceFiltered.length );
	}

	/** Load saved searches from localStorage. */
	function loadSavedSearches() {
		try {
			return JSON.parse( localStorage.getItem( 'scrutinizer_saved_searches' ) || '[]' );
		} catch ( e ) {
			return [];
		}
	}

	/** Render saved search pills into the placeholder span. */
	function renderSavedSearchPills() {
		var saved = loadSavedSearches();
		var html = '';
		for ( var i = 0; i < saved.length; i++ ) {
			html += '<button type="button" class="scrutinizer-trace-pill saved-search scrutinizer-saved-pill" data-saved-idx="' + i + '">';
			html += esc( saved[ i ].name );
			html += ' <span class="scrutinizer-pill-remove" title="' + esc( __( 'Remove', 'scrutinizer' ) ) + '">\u00d7</span>';
			html += '</button>';
		}
		$( '#scrutinizer-trace-saved-pills' ).html( html );
	}

	/* ------------------------------------------------------------------ */
	/*  Source inference from caller strings                                */
	/* ------------------------------------------------------------------ */

	/**
	 * Try to infer a source (plugin/theme/core) from a caller stack string.
	 * Looks for common path patterns like /plugins/slug/ or /themes/slug/.
	 */
	function inferSourceFromCaller( callerStr ) {
		if ( ! callerStr ) {
			return null;
		}

		// Plugin: look for /plugins/slug/ pattern.
		var pluginMatch = callerStr.match( /\/plugins\/([^\/]+)\// );
		if ( pluginMatch ) {
			return { type: 'plugin', name: pluginMatch[ 1 ] };
		}

		// Theme: look for /themes/slug/ pattern.
		var themeMatch = callerStr.match( /\/themes\/([^\/]+)\// );
		if ( themeMatch ) {
			return { type: 'theme', name: themeMatch[ 1 ] };
		}

		// MU-plugin: look for /mu-plugins/ pattern.
		if ( callerStr.indexOf( '/mu-plugins/' ) >= 0 ) {
			return { type: 'mu-plugin', name: 'mu-plugin' };
		}

		// Core: look for /wp-includes/ or /wp-admin/ pattern.
		if ( callerStr.indexOf( '/wp-includes/' ) >= 0 || callerStr.indexOf( '/wp-admin/includes/' ) >= 0 ) {
			return { type: 'core', name: 'WordPress' };
		}

		return null;
	}

	/* ------------------------------------------------------------------ */
	/*  Detail view nav                                                    */
	/* ------------------------------------------------------------------ */

	function showDetailView() {
		currentView = 'detail';
		$( '#scrutinizer-home' ).hide();
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-route-detail' ).hide();
		$( '#scrutinizer-history-view' ).hide();
		$( '#scrutinizer-compare-view' ).remove();
		$( '#scrutinizer-activation' ).hide();
		$( '#scrutinizer-api-view' ).hide();
		$( '#scrutinizer-detail' ).show();

		// Adjust back button based on where we came from.
		var $back = $( '#scrutinizer-detail .button-link' ).first();
		if ( 'history' === activeTopTab ) {
			$back.attr( 'id', 'scrutinizer-back-to-history' ).text( scrutinizerAdmin.i18n.backToHistory || '← Back to history' );
		} else if ( currentRoute ) {
			// translators: %s is the route name.
			$back.attr( 'id', 'scrutinizer-back-to-route' ).text( sprintf( __( '← Back to %s', 'scrutinizer' ), truncate( currentRoute, 40 ) ) );
		} else {
			$back.attr( 'id', 'scrutinizer-back-to-list' ).text( __( '← Back to routes', 'scrutinizer' ) );
		}

		// Decorate the detail tabs (ARIA roles + roving tabindex) on open.
		applyTabRoles();
		moveFocus( '#scrutinizer-detail .scrutinizer-tabs, #scrutinizer-detail' );
	}

	/* ------------------------------------------------------------------ */
	/*  Delete profile                                                     */
	/* ------------------------------------------------------------------ */

	function deleteProfile( profileId ) {
		$.post( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_delete_profile',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: profileId
		}, function( response ) {
			if ( response.success ) {
				// Refresh whichever view we're in.
				if ( 'route' === currentView && currentRoute ) {
					drillIntoRoute( currentRoute );
				} else {
					fetchGrouped();
				}
			} else {
				showNotice( response.data.message || scrutinizerAdmin.i18n.error, 'error' );
			}
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  Sorting                                                            */
	/* ------------------------------------------------------------------ */

	function sortHeader( label, field, extraClass ) {
		var cls   = 'scrutinizer-sortable';
		if ( extraClass ) {
			cls += ' ' + extraClass;
		}
		var arrow = '';
		if ( sortField === field ) {
			cls  += ' sorted';
			arrow = ( 'asc' === sortDir ) ? ' ▲' : ' ▼';
		}
		return '<th class="' + cls + '" data-sort="' + esc( field ) + '">' + esc( label ) + arrow + '</th>';
	}

	function sortRows( rows ) {
		if ( ! sortField || 0 === rows.length ) {
			return rows;
		}

		var copy = rows.slice();
		copy.sort( function( a, b ) {
			var va = a[ sortField ];
			var vb = b[ sortField ];

			// Numeric comparison only when BOTH values are fully numeric.
			// parseFloat() is too lenient: it reads 2026 out of a
			// "2026-06-27 14:30:00" datetime, so every same-year capture compared
			// as equal and the Last Captured column wouldn't sort. Number() is
			// strict (whole string), so datetimes fall through to the string
			// comparison below — MySQL datetime sorts chronologically as text.
			var na = ( '' === String( va ).trim() ) ? NaN : Number( va );
			var nb = ( '' === String( vb ).trim() ) ? NaN : Number( vb );
			if ( ! isNaN( na ) && ! isNaN( nb ) ) {
				return ( 'asc' === sortDir ) ? na - nb : nb - na;
			}

			// String comparison.
			va = String( va || '' ).toLowerCase();
			vb = String( vb || '' ).toLowerCase();
			if ( va < vb ) {
				return ( 'asc' === sortDir ) ? -1 : 1;
			}
			if ( va > vb ) {
				return ( 'asc' === sortDir ) ? 1 : -1;
			}
			return 0;
		} );

		return copy;
	}

	/* ------------------------------------------------------------------ */
	/*  Type badges                                                        */
	/* ------------------------------------------------------------------ */

	function typeBadge( type ) {
		var cls = ( 'background' === type ) ? 'badge-background' : 'badge-session';
		return '<span class="scrutinizer-badge ' + cls + '">' + esc( type ) + '</span>';
	}

	function typeBadges( typeStr ) {
		if ( ! typeStr ) {
			return '';
		}
		var types = typeStr.split( ',' );
		var html  = '';
		for ( var i = 0; i < types.length; i++ ) {
			html += typeBadge( types[ i ].trim() );
		}
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Pin / Annotate                                                     */
	/* ------------------------------------------------------------------ */

	function pinProfile( profileId ) {
		$.post( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_pin_profile',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: profileId
		}, function( response ) {
			if ( response.success ) {
				$( '#scrutinizer-pin-toggle' )
					.addClass( 'button-primary' )
					.data( 'pinned', '1' )
					.html( '<span class="dashicons dashicons-sticky"></span> ' + esc( scrutinizerAdmin.i18n.unpin || 'Unpin' ) );
				showNotice( response.data.message, 'success' );
			}
		} );
	}

	function unpinProfile( profileId ) {
		$.post( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_unpin_profile',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: profileId
		}, function( response ) {
			if ( response.success ) {
				$( '#scrutinizer-pin-toggle' )
					.removeClass( 'button-primary' )
					.data( 'pinned', '' )
					.html( '<span class="dashicons dashicons-sticky"></span> ' + esc( scrutinizerAdmin.i18n.pin || 'Pin' ) );
				showNotice( response.data.message, 'success' );
			}
		} );
	}

	function saveAnnotation() {
		var note = $( '#scrutinizer-note-input' ).val() || '';
		var tags = $( '#scrutinizer-tags-input' ).val() || '';

		if ( ! currentProfileId ) {
			return;
		}

		$.post( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_update_annotation',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: currentProfileId,
			note:       note,
			tags:       tags
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  History view                                                       */
	/* ------------------------------------------------------------------ */

	var historyDebounce = null;
	function debounceHistory() {
		clearTimeout( historyDebounce );
		historyDebounce = setTimeout( fetchHistory, 400 );
	}

	function showHistoryView() {
		currentView = 'history';
		if ( ! sortField ) {
			sortField = 'captured_at';
			sortDir   = 'desc';
		}
		compareChecked = {};
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-route-detail' ).remove();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-compare-view' ).remove();
		$( '#scrutinizer-api-view' ).hide();
		$( '.scrutinizer-top-tab' ).removeClass( 'active' );
		$( '.scrutinizer-top-tab[data-top-tab="history"]' ).addClass( 'active' );

		var $existing = $( '#scrutinizer-history-view' );
		if ( 0 === $existing.length ) {
			var html = '<div id="scrutinizer-history-view">';
			html += renderHistoryFilters();
			html += '<div id="scrutinizer-history-results"></div>';
			html += '</div>';
			$( '#scrutinizer-results' ).after( html );
		} else {
			$existing.show();
		}

		fetchHistory();
	}

	function renderHistoryFilters() {
		var html = '<div class="scrutinizer-history-filters">';

		// Route dropdown — populated from grouped data.
		html += '<select id="scrutinizer-history-route">';
		html += '<option value="">' + esc( scrutinizerAdmin.i18n.filterByRoute || 'All routes' ) + '</option>';
		for ( var i = 0; i < groupedData.length; i++ ) {
			html += '<option value="' + esc( groupedData[ i ].route_key ) + '">' + esc( truncate( groupedData[ i ].route_key, 60 ) ) + '</option>';
		}
		html += '</select>';

		// Request type dropdown (route_class).
		html += '<select id="scrutinizer-history-type">';
		html += '<option value="">' + esc( scrutinizerAdmin.i18n.allTypes || 'All types' ) + '</option>';
		html += '<option value="frontend">' + __( 'Frontend', 'scrutinizer' ) + '</option>';
		html += '<option value="wp-admin">' + __( 'Admin', 'scrutinizer' ) + '</option>';
		html += '<option value="admin-ajax">' + __( 'AJAX', 'scrutinizer' ) + '</option>';
		html += '<option value="rest-api">' + __( 'REST API', 'scrutinizer' ) + '</option>';
		html += '<option value="cron">' + __( 'Cron', 'scrutinizer' ) + '</option>';
		html += '</select>';

		// Tag filter.
		html += '<input type="text" id="scrutinizer-history-tag" placeholder="' + esc( scrutinizerAdmin.i18n.filterByTag || 'Filter by tag…' ) + '" />';

		// Pinned only.
		html += '<label class="scrutinizer-history-check-label">';
		html += '<input type="checkbox" id="scrutinizer-history-pinned" /> ';
		html += '<span class="dashicons dashicons-sticky"></span> ' + esc( scrutinizerAdmin.i18n.pinned || 'Pinned' );
		html += '</label>';

		// Date range.
		html += '<input type="date" id="scrutinizer-history-from" title="' + esc( __( 'From date', 'scrutinizer' ) ) + '" />';
		html += '<span class="scrutinizer-history-dash">–</span>';
		html += '<input type="date" id="scrutinizer-history-to" title="' + esc( __( 'To date', 'scrutinizer' ) ) + '" />';

		// Bulk action bar (hidden until selections made).
		html += '<div class="scrutinizer-bulk-bar" id="scrutinizer-bulk-bar" style="display:none">';
		html += '<span id="scrutinizer-bulk-count">0 selected</span>';
		html += '<button type="button" class="button" id="scrutinizer-bulk-pin" title="' + esc( __( 'Pin selected profiles', 'scrutinizer' ) ) + '"><span class="dashicons dashicons-sticky"></span> ' + __( 'Pin', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="button" id="scrutinizer-bulk-unpin" title="' + esc( __( 'Unpin selected profiles', 'scrutinizer' ) ) + '">' + __( 'Unpin', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="button" id="scrutinizer-bulk-delete" title="' + esc( __( 'Delete selected profiles', 'scrutinizer' ) ) + '">🗑 ' + __( 'Delete', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="button" id="scrutinizer-compare-btn" style="display:none">' + esc( scrutinizerAdmin.i18n.compareSelected || 'Compare Selected' ) + '</button>';
		html += '</div>';

		html += '</div>';
		return html;
	}

	function fetchHistory() {
		var params = {
			action:   'scrutinizer_get_history',
			nonce:    scrutinizerAdmin.nonce,
			paged:    historyPage,
			per_page: 50
		};

		var route = $( '#scrutinizer-history-route' ).val();
		var type  = $( '#scrutinizer-history-type' ).val();
		var tag   = $( '#scrutinizer-history-tag' ).val();
		var pinned = $( '#scrutinizer-history-pinned' ).is( ':checked' );
		var from  = $( '#scrutinizer-history-from' ).val();
		var to    = $( '#scrutinizer-history-to' ).val();

		if ( route ) {
			params.route_key = route;
		}
		if ( type ) {
			params.route_class = type;
		}
		if ( tag ) {
			params.tag = tag;
		}
		if ( pinned ) {
			params.pinned_only = 1;
		}
		if ( from ) {
			params.date_from = from;
		}
		if ( to ) {
			params.date_to = to;
		}

		$.get( scrutinizerAdmin.ajaxUrl, params, function( response ) {
			if ( response.success ) {
				historyData  = response.data.profiles || [];
				historyTotal = response.data.total || historyData.length;
				historyPages = response.data.pages || 1;
				historyPage  = response.data.page || 1;
				renderHistoryTable( historyData );
			}
		} );
	}

	function renderHistoryTable( profiles ) {
		var $container = $( '#scrutinizer-history-results' );

		if ( ! profiles || 0 === profiles.length ) {
			$container.html( '<p class="scrutinizer-empty">' + esc( scrutinizerAdmin.i18n.noResults || 'No profiles match the current filters.' ) + '</p>' );
			return;
		}

		var sorted = sortRows( profiles.slice() );
		var html = '<table class="scrutinizer-profile-table scrutinizer-history-table widefat">';
		html += '<thead><tr>';
		html += '<th class="scrutinizer-check-col"><input type="checkbox" id="scrutinizer-select-all" title="' + esc( __( 'Select all', 'scrutinizer' ) ) + '" /></th>';
		html += sortHeader( __( 'Captured', 'scrutinizer' ), 'captured_at' );
		html += sortHeader( __( 'Route', 'scrutinizer' ), 'route_key' );
		html += sortHeader( __( 'Duration', 'scrutinizer' ), 'duration_ns', 'numeric' );
		html += '<th><span class="dashicons dashicons-sticky" title="' + esc( __( 'Pinned', 'scrutinizer' ) ) + '"></span></th>';
		html += '<th>' + __( 'Note', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'Tags', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'Actions', 'scrutinizer' ) + '</th>';
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < sorted.length; i++ ) {
			var p     = sorted[ i ];
			var durMs = ( parseInt( p.duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var pinIcon = parseInt( p.is_pinned, 10 ) === 1 ? '<span class="dashicons dashicons-sticky"></span>' : '';
			var notePrev = truncate( p.note || '', 40 );
			var tagPills = renderTagPills( p.tags || '' );
			var checked  = compareChecked[ p.id ] ? ' checked' : '';

			// TTL badge for unpinned profiles.
			var ttlBadge = '';
			var retDays  = parseInt( scrutinizerAdmin.retentionDays, 10 ) || 0;
			if ( retDays > 0 && parseInt( p.is_pinned, 10 ) !== 1 && p.captured_at ) {
				var capturedMs = new Date( p.captured_at + ' UTC' ).getTime();
				var expiresMs  = capturedMs + ( retDays * 86400000 );
				var remainMs   = expiresMs - Date.now();
				if ( remainMs <= 0 ) {
					ttlBadge = ' <span class="scrutinizer-ttl-badge scrutinizer-ttl-expired">' + __( 'expired', 'scrutinizer' ) + '</span>';
				} else {
					var remDays = Math.ceil( remainMs / 86400000 );
					if ( remDays <= 1 ) {
						var remHours = Math.ceil( remainMs / 3600000 );
						ttlBadge = ' <span class="scrutinizer-ttl-badge scrutinizer-ttl-soon">' + remHours + 'h</span>';
					} else if ( remDays <= 3 ) {
						ttlBadge = ' <span class="scrutinizer-ttl-badge scrutinizer-ttl-soon">' + remDays + 'd</span>';
					} else {
						ttlBadge = ' <span class="scrutinizer-ttl-badge">' + remDays + 'd</span>';
					}
				}
			}

			html += '<tr>';
			html += '<td><input type="checkbox" class="scrutinizer-compare-check" data-profile-id="' + parseInt( p.id, 10 ) + '"' + checked + ' /></td>';
			html += '<td>' + esc( p.captured_at ) + ttlBadge + '</td>';
			html += '<td class="scrutinizer-route-cell" title="' + esc( p.route_key ) + '">' + esc( truncate( p.route_key || '', 40 ) ) + '</td>';
			html += '<td class="scrutinizer-duration numeric">' + esc( durMs ) + ' ms</td>';
			html += '<td>' + pinIcon + '</td>';
			html += '<td title="' + esc( p.note || '' ) + '">' + esc( notePrev ) + '</td>';
			html += '<td>' + tagPills + '</td>';
			html += '<td class="scrutinizer-actions">';
			html += '<a href="#" class="scrutinizer-view-profile" data-profile-id="' + parseInt( p.id, 10 ) + '">' + __( 'View', 'scrutinizer' ) + '</a>';
			html += '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		$container.html( html );
	}

	function renderTagPills( tagStr ) {
		if ( ! tagStr ) {
			return '';
		}
		var tags = tagStr.split( ',' );
		var html = '';
		for ( var i = 0; i < tags.length; i++ ) {
			var t = tags[ i ].trim();
			if ( t ) {
				html += '<span class="scrutinizer-tag-pill">' + esc( t ) + '</span>';
			}
		}
		return html;
	}

	function updateCompareButton() {
		var count = Object.keys( compareChecked ).length;
		if ( count > 0 ) {
			$( '#scrutinizer-bulk-bar' ).show();
			// translators: %d is the number of selected profiles.
			$( '#scrutinizer-bulk-count' ).text( sprintf( __( '%d selected', 'scrutinizer' ), count ) );
			if ( 2 === count ) {
				$( '#scrutinizer-compare-btn' ).show();
			} else {
				$( '#scrutinizer-compare-btn' ).hide();
			}
		} else {
			$( '#scrutinizer-bulk-bar' ).hide();
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Cron inventory view                                                */
	/* ------------------------------------------------------------------ */

	var cronData = null; // cached cron inventory

	function showCronView() {
		currentView = 'cron';
		if ( ! sortField ) {
			sortField = 'timestamp';
			sortDir   = 'asc';
		}
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-compare-view' ).remove();
		$( '#scrutinizer-api-view' ).hide();

		var $history = $( '#scrutinizer-history-view' );
		if ( ! $history.length ) {
			$( '#scrutinizer-results' ).after( '<div id="scrutinizer-history-view"></div>' );
			$history = $( '#scrutinizer-history-view' );
		}
		$history.show();

		$( '.scrutinizer-top-tab' ).removeClass( 'active' );
		$( '.scrutinizer-top-tab[data-top-tab="cron"]' ).addClass( 'active' );

		if ( cronData ) {
			renderCronView( cronData );
		} else {
			$history.html( '<p class="scrutinizer-empty">' + __( 'Loading cron inventory…', 'scrutinizer' ) + '</p>' );
			fetchCronInventory();
		}
	}

	function fetchCronInventory() {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_get_cron_inventory',
			nonce:  scrutinizerAdmin.nonce
		}, function( response ) {
			if ( response.success ) {
				cronData = response.data;
				if ( 'cron' === currentView ) {
					renderCronView( cronData );
				}
			} else {
				$( '#scrutinizer-history-view' ).html(
					'<p class="scrutinizer-empty">' + esc( response.data.message || __( 'Failed to load cron data.', 'scrutinizer' ) ) + '</p>'
				);
			}
		} );
	}

	function renderCronView( data ) {
		var events    = data.events || [];
		var summary   = data.summary || {};
		var schedules = data.schedules || [];
		var warnings  = data.warnings || [];

		var html = '<div class="scrutinizer-cron-view">';

		// Summary cards.
		html += '<div class="scrutinizer-metric-cards">';
		html += renderMetricCard( String( summary.total || 0 ), __( 'Events', 'scrutinizer' ), 'default' );
		html += renderMetricCard( String( summary.recurring || 0 ), __( 'Recurring', 'scrutinizer' ), 'default' );
		html += renderMetricCard( String( summary.one_shot || 0 ), __( 'One-Shot', 'scrutinizer' ), 'default' );
		html += renderMetricCard( String( summary.overdue || 0 ), __( 'Overdue', 'scrutinizer' ), summary.overdue > 0 ? 'warning' : 'default' );
		html += '</div>';

		// Warnings.
		if ( warnings.length > 0 ) {
			html += '<div class="scrutinizer-cron-warnings">';
			for ( var w = 0; w < warnings.length; w++ ) {
				var warnClass = 'overdue_recurring' === warnings[w].type ? 'scrutinizer-warn-overdue' : 'scrutinizer-warn-duplicate';
				html += '<div class="scrutinizer-cron-warning ' + warnClass + '">';
				html += '<span class="scrutinizer-warn-icon">' + ( 'overdue_recurring' === warnings[w].type ? '⏰' : '⚠️' ) + '</span> ';
				html += esc( warnings[w].message );
				html += '</div>';
			}
			html += '</div>';
		}

		// By-source breakdown.
		if ( summary.by_source && summary.by_source.length > 0 ) {
			html += '<div class="scrutinizer-cron-sources">';
			html += '<h4>' + __( 'By Source', 'scrutinizer' ) + '</h4>';
			html += '<div class="scrutinizer-cron-source-pills">';
			for ( var s = 0; s < summary.by_source.length; s++ ) {
				var src  = summary.by_source[s];
				var type = src.attribution.type || 'unknown';
				html += '<span class="scrutinizer-source-pill" style="background:' + ( sourceColors[ type ] || '#888' ) + '">';
				html += esc( src.attribution.name || src.attribution.slug || type );
				html += ' <strong>' + src.count + '</strong>';
				html += '</span> ';
			}
			html += '</div>';
			html += '</div>';
		}

		// Events table.
		html += '<table class="scrutinizer-profile-table scrutinizer-cron-table widefat">';
		html += '<thead><tr>';
		html += sortHeader( __( 'Hook', 'scrutinizer' ), 'hook' );
		html += sortHeader( __( 'Next Run', 'scrutinizer' ), 'timestamp' );
		html += '<th>' + __( 'Schedule', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'Source', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'Status', 'scrutinizer' ) + '</th>';
		html += '</tr></thead>';
		html += '<tbody>';

		var sortedEvents = sortRows( events );
		for ( var i = 0; i < sortedEvents.length; i++ ) {
			var ev = sortedEvents[i];
			var rowClass = ev.overdue ? 'scrutinizer-cron-overdue' : '';
			var attrType = ev.attribution.type || 'unknown';

			html += '<tr class="' + rowClass + '">';

			// Hook name.
			html += '<td class="scrutinizer-cron-hook"><code>' + esc( ev.hook ) + '</code>';
			if ( ev.args && ev.args.length > 0 ) {
				// translators: %d is the number of cron event arguments.
				html += ' <span class="scrutinizer-muted">' + sprintf( __( '(%d args)', 'scrutinizer' ), ev.args.length ) + '</span>';
			}
			html += '</td>';

			// Next run.
			html += '<td>' + formatCronTime( ev.timestamp, ev.overdue, ev.overdue_by ) + '</td>';

			// Schedule.
			html += '<td>';
			if ( 'once' === ev.schedule ) {
				html += '<span class="scrutinizer-muted">' + __( 'one-shot', 'scrutinizer' ) + '</span>';
			} else {
				html += esc( ev.schedule );
				if ( ev.interval ) {
					html += ' <span class="scrutinizer-muted">(' + humanInterval( ev.interval ) + ')</span>';
				}
			}
			html += '</td>';

			// Source.
			html += '<td><span class="scrutinizer-source-pill" style="background:' + ( sourceColors[ attrType ] || '#888' ) + '">';
			html += esc( ev.attribution.name || ev.attribution.slug || attrType );
			html += '</span></td>';

			// Status.
			html += '<td>';
			if ( ev.overdue ) {
				html += '<span class="scrutinizer-cron-status-overdue">' + __( 'overdue', 'scrutinizer' ) + '</span>';
			} else {
				html += '<span class="scrutinizer-cron-status-ok">' + __( 'scheduled', 'scrutinizer' ) + '</span>';
			}
			html += '</td>';

			html += '</tr>';
		}

		html += '</tbody></table>';

		// Available schedules.
		if ( schedules.length > 0 ) {
			html += '<details class="scrutinizer-cron-schedules">';
			// translators: %d is the number of registered cron schedules.
			html += '<summary>' + sprintf( __( 'Registered Schedules (%d)', 'scrutinizer' ), schedules.length ) + '</summary>';
			html += '<table class="scrutinizer-profile-table scrutinizer-cron-schedule-table widefat"><thead><tr><th>' + __( 'Name', 'scrutinizer' ) + '</th><th>' + __( 'Interval', 'scrutinizer' ) + '</th><th>' + __( 'Display', 'scrutinizer' ) + '</th></tr></thead><tbody>';
			for ( var j = 0; j < schedules.length; j++ ) {
				html += '<tr>';
				html += '<td><code>' + esc( schedules[j].name ) + '</code></td>';
				html += '<td>' + humanInterval( schedules[j].interval ) + '</td>';
				html += '<td>' + esc( schedules[j].display ) + '</td>';
				html += '</tr>';
			}
			html += '</tbody></table></details>';
		}

		// Refresh button.
		html += '<div class="scrutinizer-cron-actions">';
		html += '<button class="button" id="scrutinizer-cron-refresh">↻ ' + __( 'Refresh', 'scrutinizer' ) + '</button>';
		html += '</div>';

		html += '</div>';

		$( '#scrutinizer-history-view' ).html( html );

		// Bind refresh.
		$( '#scrutinizer-cron-refresh' ).on( 'click', function() {
			cronData = null;
			fetchCronInventory();
		} );
	}

	function formatCronTime( timestamp, overdue, overdueBy ) {
		var d = new Date( timestamp * 1000 );
		var now = Date.now() / 1000;
		var diff = timestamp - now;
		var html = '';

		// Relative time.
		if ( overdue ) {
			// translators: %s is a human-readable time interval (e.g. "5 minutes").
			html += '<span class="scrutinizer-cron-status-overdue">' + sprintf( __( '%s ago', 'scrutinizer' ), humanInterval( overdueBy ) ) + '</span>';
		} else {
			// translators: %s is a human-readable time interval (e.g. "5 minutes").
			html += sprintf( __( 'in %s', 'scrutinizer' ), humanInterval( Math.abs( diff ) ) );
		}

		// Absolute time underneath.
		html += '<br><span class="scrutinizer-muted">' + d.toLocaleString() + '</span>';
		return html;
	}

	function humanInterval( seconds ) {
		seconds = Math.abs( Math.round( seconds ) );
		if ( seconds < 60 ) { return seconds + 's'; }
		if ( seconds < 3600 ) { return Math.round( seconds / 60 ) + 'm'; }
		if ( seconds < 86400 ) { return Math.round( seconds / 3600 * 10 ) / 10 + 'h'; }
		return Math.round( seconds / 86400 * 10 ) / 10 + 'd';
	}

	/* ------------------------------------------------------------------ */
	/*  Compare view                                                       */
	/* ------------------------------------------------------------------ */

	/**
	 * Toggle the compare picker panel on profile detail view.
	 */
	function toggleComparePicker( profileId ) {
		var $existing = $( '#scrutinizer-compare-picker' );
		if ( $existing.length ) {
			$existing.slideUp( 200, function() { $existing.remove(); } );
			return;
		}

		var routeKey = currentProfileData ? ( currentProfileData.route_key || '' ) : '';

		var html = '<div id="scrutinizer-compare-picker" style="display:none">';
		html += '<div class="scrutinizer-picker-header">';
		html += '<h4>' + __( 'Compare with&hellip;', 'scrutinizer' ) + '</h4>';
		html += '<button type="button" class="button button-link scrutinizer-picker-close" title="' + esc( __( 'Close', 'scrutinizer' ) ) + '">&times;</button>';
		html += '</div>';
		html += '<div class="scrutinizer-picker-body"><p class="description">' + __( 'Loading pinned profiles&hellip;', 'scrutinizer' ) + '</p></div>';
		html += '</div>';

		$( '.scrutinizer-pin-toolbar' ).after( html );
		$( '#scrutinizer-compare-picker' ).slideDown( 200 );

		// Close button inside picker header.
		$( '.scrutinizer-picker-close' ).on( 'click', function() {
			$( '#scrutinizer-compare-picker' ).slideUp( 200, function() { $( this ).remove(); } );
		} );

		// Fetch compare targets.
		$.get( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_compare_targets',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: profileId,
			route_key:  routeKey
		}, function( response ) {
			if ( ! response.success ) {
				$( '.scrutinizer-picker-body' ).html( '<p class="description">' + __( 'No targets found.', 'scrutinizer' ) + '</p>' );
				return;
			}

			var routeMatches = response.data.route_matches || [];
			var otherPinned  = response.data.other_pinned || [];
			var body = '';

			if ( 0 === routeMatches.length && 0 === otherPinned.length ) {
				body = '<p class="description">' + __( 'No pinned profiles to compare with. Pin some profiles first.', 'scrutinizer' ) + '</p>';
			} else {
				if ( routeMatches.length > 0 ) {
					body += '<div class="scrutinizer-picker-section">';
					body += '<h5>' + __( 'Same route', 'scrutinizer' ) + '</h5>';
					body += renderPickerList( routeMatches );
					body += '</div>';
				}
				if ( otherPinned.length > 0 ) {
					body += '<div class="scrutinizer-picker-section">';
					body += '<h5>' + __( 'Other pinned profiles', 'scrutinizer' ) + '</h5>';
					body += renderPickerList( otherPinned );
					body += '</div>';
				}
			}

			$( '.scrutinizer-picker-body' ).html( body );
		} );
	}

	/**
	 * Render a list of compare target profiles.
	 */
	function renderPickerList( profiles ) {
		var html = '<ul class="scrutinizer-picker-list">';
		for ( var i = 0; i < profiles.length; i++ ) {
			var p = profiles[ i ];
			var durMs = p.duration_ns ? ( p.duration_ns / 1e6 ).toFixed( 1 ) + ' ms' : '?';
			var label = ( p.request_method || 'GET' ) + ' ' + truncate( p.request_url || p.route_key || '', 50 );
			html += '<li class="scrutinizer-compare-target" data-id="' + parseInt( p.id, 10 ) + '" tabindex="0" role="button">';
			html += '<span class="picker-route">' + esc( label ) + '</span>';
			html += '<span class="picker-meta">' + esc( durMs ) + ' · ' + esc( p.captured_at || '' ) + '</span>';
			if ( p.note ) {
				html += '<span class="picker-note">' + esc( p.note ) + '</span>';
			}
			html += '</li>';
		}
		html += '</ul>';
		return html;
	}

	/**
	 * Load comparison inline within the profile detail view.
	 */
	function loadInlineComparison( profileIdA, profileIdB ) {
		// Close picker.
		$( '#scrutinizer-compare-picker' ).slideUp( 200, function() { $( this ).remove(); } );

		// Show loading state.
		$( '#scrutinizer-inline-compare' ).remove();
		var loadHtml = '<div id="scrutinizer-inline-compare">';
		loadHtml += '<p class="description"><span class="dashicons dashicons-update spin"></span> ' + __( 'Loading comparison&hellip;', 'scrutinizer' ) + '</p>';
		loadHtml += '</div>';
		$( '.scrutinizer-metric-cards' ).after( loadHtml );

		$.get( scrutinizerAdmin.ajaxUrl, {
			action:    'scrutinizer_compare_profiles',
			nonce:     scrutinizerAdmin.nonce,
			profile_a: profileIdA,
			profile_b: profileIdB
		}, function( response ) {
			if ( response.success ) {
				renderInlineComparison( response.data.comparison );
			} else {
				$( '#scrutinizer-inline-compare' ).html(
					'<p class="scrutinizer-share-error">' + esc( response.data.message || __( 'Compare failed.', 'scrutinizer' ) ) + '</p>'
				);
			}
		} );
	}

	/**
	 * Render comparison inline below the metric cards.
	 */
	function renderInlineComparison( comparison ) {
		var delta = comparison.delta;
		var b     = comparison.b;
		var reqB  = ( b.profile_data && b.profile_data.request ) ? b.profile_data.request : {};

		// Build verdict.
		var durDelta   = delta.duration_ns;
		var durBase    = delta.duration_a_ns || 1;
		var durPct     = ( ( durDelta / durBase ) * 100 );
		var durDeltaMs = durDelta / 1e6;
		var verdict    = classifyDelta( durDeltaMs, durPct );

		var html = '<div id="scrutinizer-inline-compare">';
		html += '<div class="scrutinizer-inline-compare-header">';
		html += '<span class="scrutinizer-verdict-badge ' + verdict.cls + '">' + verdict.label + '</span>';
		html += '<span class="scrutinizer-compare-summary">';
		// translators: %s is the method and URL of the profile being compared against.
		html += sprintf( __( 'Compared to %s', 'scrutinizer' ), '<strong>' + esc( ( reqB.method || '' ) + ' ' + truncate( reqB.url || b.request_url || '', 40 ) ) + '</strong>' );
		html += ' <small>(' + esc( b.captured_at || '' ) + ')</small>';
		html += '</span>';
		html += '<button type="button" class="button button-link" id="scrutinizer-inline-compare-close" title="' + esc( __( 'Dismiss', 'scrutinizer' ) ) + '">✕</button>';
		html += '</div>';

		// Summary table.
		html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
		html += '<thead><tr><th>' + __( 'Metric', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'This Profile', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Reference', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Change', 'scrutinizer' ) + '</th></tr></thead>';
		html += '<tbody>';

		html += compareRow( __( 'Server Request Duration', 'scrutinizer' ),
			( delta.duration_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.duration_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.duration_ns, delta.duration_a_ns, 'time'
		);

		html += compareRow( __( 'Unattributed Time', 'scrutinizer' ),
			( delta.unattributed_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.unattributed_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.unattributed_delta_ns, delta.unattributed_a_ns, 'time'
		);

		html += compareRow( __( 'DB Queries', 'scrutinizer' ),
			String( delta.query_count_a ),
			String( delta.query_count_b ),
			delta.query_count_delta, delta.query_count_a || 1, 'count'
		);

		if ( delta.query_time_a_ms !== undefined ) {
			html += compareRow( __( 'Query Time', 'scrutinizer' ),
				delta.query_time_a_ms.toFixed( 1 ) + ' ms',
				delta.query_time_b_ms.toFixed( 1 ) + ' ms',
				( delta.query_time_delta_ms || 0 ) * 1e6, ( delta.query_time_a_ms || 1 ) * 1e6, 'time'
			);
		}

		if ( delta.memory_peak_a || delta.memory_peak_b ) {
			html += compareRow( __( 'Peak Memory', 'scrutinizer' ),
				formatBytes( delta.memory_peak_a ),
				formatBytes( delta.memory_peak_b ),
				delta.memory_peak_delta, delta.memory_peak_a || 1, 'memory'
			);
		}

		if ( delta.memory_alloc_a || delta.memory_alloc_b ) {
			html += compareRow( __( 'Memory Used by Hooks', 'scrutinizer' ),
				formatBytes( delta.memory_alloc_a ),
				formatBytes( delta.memory_alloc_b ),
				delta.memory_alloc_delta, delta.memory_alloc_a || 1, 'memory'
			);
		}

		if ( delta.callback_count_a !== undefined ) {
			html += compareRow( __( 'Callbacks', 'scrutinizer' ),
				String( delta.callback_count_a ),
				String( delta.callback_count_b ),
				delta.callback_count_delta, delta.callback_count_a || 1, 'count'
			);
		}

		if ( delta.http_count_a !== undefined ) {
			html += compareRow( __( 'HTTP Calls', 'scrutinizer' ),
				String( delta.http_count_a ),
				String( delta.http_count_b ),
				delta.http_count_delta, delta.http_count_a || 1, 'count'
			);
		}

		html += '</tbody></table>';

		// Per-source breakdown.
		var sources = delta.sources || {};
		var sourceKeys = Object.keys( sources );
		if ( sourceKeys.length > 0 ) {
			html += '<h4>' + __( 'Per-Source Changes', 'scrutinizer' ) + '</h4>';
			html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
			html += '<thead><tr><th>' + __( 'Source', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'This Profile', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Reference', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Change', 'scrutinizer' ) + '</th></tr></thead>';
			html += '<tbody>';

			sourceKeys.sort( function( x, y ) {
				return Math.abs( sources[ y ].delta_ns ) - Math.abs( sources[ x ].delta_ns );
			} );

			for ( var si = 0; si < sourceKeys.length; si++ ) {
				var sk = sourceKeys[ si ];
				var sd = sources[ sk ];

				// Format source label: strip type prefix for display.
				var sourceLabel = sk.indexOf( ':' ) !== -1 ? sk.split( ':' ).slice( 1 ).join( ':' ) : sk;

				html += compareRow( sourceLabel,
					( sd.a_ns / 1e6 ).toFixed( 2 ) + ' ms',
					( sd.b_ns / 1e6 ).toFixed( 2 ) + ' ms',
					sd.delta_ns, sd.a_ns || 1, 'time'
				);
			}

			html += '</tbody></table>';
		}

		html += '</div>';

		$( '#scrutinizer-inline-compare' ).replaceWith( html );
	}

	/**
	 * Classify a single A/B delta into a direction label.
	 *
	 * A lone comparison is ONE observation, so it can never satisfy the
	 * "Likely Regression" gate (>=5 matched requests, >=20% + 100ms median
	 * increase, consistent direction in >=3/5 comparisons — see INVARIANTS /
	 * D7). The strongest claim a single pair supports is "Difference observed"
	 * with a direction; it must never say "Regression". When the statistical
	 * gate exists server-side, the stronger verdict can be surfaced from there.
	 *
	 * Thresholds here are purely for emphasis/styling, not for a verdict:
	 * >20% AND >100ms is a notable difference; <10ms AND <5% is within noise.
	 */
	function classifyDelta( deltaMs, pctChange ) {
		if ( Math.abs( deltaMs ) < 10 && Math.abs( pctChange ) < 5 ) {
			return { cls: 'verdict-noise', label: __( '≈ Within noise', 'scrutinizer' ) };
		}
		if ( deltaMs > 100 && pctChange > 20 ) {
			return { cls: 'verdict-slower', label: __( '↑ Difference observed (slower)', 'scrutinizer' ) };
		}
		if ( deltaMs < -100 && pctChange < -20 ) {
			return { cls: 'verdict-faster', label: __( '↓ Difference observed (faster)', 'scrutinizer' ) };
		}
		if ( deltaMs > 0 ) {
			return { cls: 'verdict-slower', label: __( '↑ Slower', 'scrutinizer' ) };
		}
		if ( deltaMs < 0 ) {
			return { cls: 'verdict-faster', label: __( '↓ Faster', 'scrutinizer' ) };
		}
		return { cls: 'verdict-noise', label: __( '≈ No change', 'scrutinizer' ) };
	}

	/**
	 * Load comparison from history view checkboxes (legacy flow).
	 */
	function loadComparison( idA, idB ) {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action:    'scrutinizer_compare_profiles',
			nonce:     scrutinizerAdmin.nonce,
			profile_a: idA,
			profile_b: idB
		}, function( response ) {
			if ( response.success ) {
				renderCompareView( response.data.comparison );
			} else {
				showNotice( response.data.message || scrutinizerAdmin.i18n.error, 'error' );
			}
		} );
	}

	function renderCompareView( comparison ) {
		currentView = 'compare';
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-history-view' ).hide();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-compare-view' ).remove();

		var delta  = comparison.delta;
		var a      = comparison.a;
		var b      = comparison.b;
		var reqA   = ( a.profile_data && a.profile_data.request ) ? a.profile_data.request : {};
		var reqB   = ( b.profile_data && b.profile_data.request ) ? b.profile_data.request : {};

		// Overall verdict.
		var durDeltaMs = delta.duration_ns / 1e6;
		var durPct     = delta.duration_a_ns ? ( ( delta.duration_ns / delta.duration_a_ns ) * 100 ) : 0;
		var verdict    = classifyDelta( durDeltaMs, durPct );

		var html = '<div id="scrutinizer-compare-view">';
		html += '<button type="button" class="button button-link" id="scrutinizer-back-to-history">' + esc( scrutinizerAdmin.i18n.backToHistory || '← Back to history' ) + '</button>';
		html += '<h2>' + esc( scrutinizerAdmin.i18n.compare || 'Compare' ) + ' <span class="scrutinizer-verdict-badge ' + verdict.cls + '">' + verdict.label + '</span></h2>';

		// Header: Profile A vs Profile B.
		html += '<div class="scrutinizer-compare-header">';
		html += '<div class="compare-profile-label"><strong>A:</strong> ' + esc( reqA.method || '' ) + ' ' + esc( truncate( reqA.url || a.request_url || '', 60 ) ) + '<br><small>' + esc( a.captured_at ) + '</small></div>';
		html += '<div class="compare-vs">' + __( 'vs', 'scrutinizer' ) + '</div>';
		html += '<div class="compare-profile-label"><strong>B:</strong> ' + esc( reqB.method || '' ) + ' ' + esc( truncate( reqB.url || b.request_url || '', 60 ) ) + '<br><small>' + esc( b.captured_at ) + '</small></div>';
		html += '</div>';

		// Summary comparison.
		html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
		html += '<thead><tr><th>' + __( 'Metric', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Profile A', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Profile B', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Change', 'scrutinizer' ) + '</th></tr></thead>';
		html += '<tbody>';

		html += compareRow( __( 'Server Request Duration', 'scrutinizer' ),
			( delta.duration_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.duration_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.duration_ns, delta.duration_a_ns, 'time'
		);

		html += compareRow( __( 'Unattributed Time', 'scrutinizer' ),
			( delta.unattributed_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.unattributed_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.unattributed_delta_ns, delta.unattributed_a_ns, 'time'
		);

		html += compareRow( __( 'DB Queries', 'scrutinizer' ),
			String( delta.query_count_a ),
			String( delta.query_count_b ),
			delta.query_count_delta, delta.query_count_a || 1, 'count'
		);

		if ( delta.query_time_a_ms !== undefined ) {
			html += compareRow( __( 'Query Time', 'scrutinizer' ),
				delta.query_time_a_ms.toFixed( 1 ) + ' ms',
				delta.query_time_b_ms.toFixed( 1 ) + ' ms',
				( delta.query_time_delta_ms || 0 ) * 1e6, ( delta.query_time_a_ms || 1 ) * 1e6, 'time'
			);
		}

		if ( delta.memory_peak_a || delta.memory_peak_b ) {
			html += compareRow( __( 'Peak Memory', 'scrutinizer' ),
				formatBytes( delta.memory_peak_a ),
				formatBytes( delta.memory_peak_b ),
				delta.memory_peak_delta, delta.memory_peak_a || 1, 'memory'
			);
		}

		if ( delta.memory_alloc_a || delta.memory_alloc_b ) {
			html += compareRow( __( 'Memory Used by Hooks', 'scrutinizer' ),
				formatBytes( delta.memory_alloc_a ),
				formatBytes( delta.memory_alloc_b ),
				delta.memory_alloc_delta, delta.memory_alloc_a || 1, 'memory'
			);
		}

		if ( delta.callback_count_a !== undefined ) {
			html += compareRow( __( 'Callbacks', 'scrutinizer' ),
				String( delta.callback_count_a ),
				String( delta.callback_count_b ),
				delta.callback_count_delta, delta.callback_count_a || 1, 'count'
			);
		}

		html += '</tbody></table>';

		// Per-source breakdown.
		var sources = delta.sources || {};
		var sourceKeys = Object.keys( sources );
		if ( sourceKeys.length > 0 ) {
			html += '<h3>' + __( 'Per-Source Changes', 'scrutinizer' ) + '</h3>';
			html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
			html += '<thead><tr><th>' + __( 'Source', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Profile A', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Profile B', 'scrutinizer' ) + '</th><th class="numeric">' + __( 'Change', 'scrutinizer' ) + '</th></tr></thead>';
			html += '<tbody>';

			sourceKeys.sort( function( x, y ) {
				return Math.abs( sources[ y ].delta_ns ) - Math.abs( sources[ x ].delta_ns );
			} );

			for ( var si = 0; si < sourceKeys.length; si++ ) {
				var sk  = sourceKeys[ si ];
				var sd  = sources[ sk ];
				var sourceLabel = sk.indexOf( ':' ) !== -1 ? sk.split( ':' ).slice( 1 ).join( ':' ) : sk;

				html += compareRow( sourceLabel,
					( sd.a_ns / 1e6 ).toFixed( 2 ) + ' ms',
					( sd.b_ns / 1e6 ).toFixed( 2 ) + ' ms',
					sd.delta_ns, sd.a_ns || 1, 'time'
				);
			}

			html += '</tbody></table>';
		}

		html += '</div>';

		$( '#scrutinizer-results' ).after( html );
	}

	/**
	 * Render a single comparison row with threshold-aware language.
	 *
	 * @param {string} label    Row label.
	 * @param {string} valA     Formatted value for profile A.
	 * @param {string} valB     Formatted value for profile B.
	 * @param {number} deltaNs  Delta in nanoseconds (or raw delta for counts).
	 * @param {number} baseNs   Base value in nanoseconds (or raw for counts).
	 * @param {string} kind     'time' | 'memory' | 'count' — controls formatting.
	 */
	function compareRow( label, valA, valB, deltaNs, baseNs, kind ) {
		kind = kind || 'time';
		var pctChange = baseNs ? ( ( deltaNs / baseNs ) * 100 ) : 0;
		var cls = '';
		var deltaStr = '';

		if ( 'count' === kind ) {
			// For counts, show raw delta.
			var rawDelta = deltaNs;
			var rawPct   = pctChange;
			if ( 0 === rawDelta ) {
				deltaStr = __( 'no change', 'scrutinizer' );
				cls = 'scrutinizer-delta-neutral';
			} else {
				cls = rawDelta < 0 ? 'scrutinizer-delta-negative' : 'scrutinizer-delta-positive';
				deltaStr = ( rawDelta > 0 ? '+' : '' ) + rawDelta;
				if ( Math.abs( rawPct ) > 0.5 ) {
					deltaStr += ' (' + ( rawPct > 0 ? '+' : '' ) + rawPct.toFixed( 0 ) + '%)';
				}
			}
		} else if ( 'memory' === kind ) {
			// For memory, show formatted bytes delta.
			if ( 0 === deltaNs ) {
				deltaStr = __( 'no change', 'scrutinizer' );
				cls = 'scrutinizer-delta-neutral';
			} else {
				cls = deltaNs < 0 ? 'scrutinizer-delta-negative' : 'scrutinizer-delta-positive';
				deltaStr = formatMemoryDelta( deltaNs );
				if ( Math.abs( pctChange ) > 0.5 ) {
					deltaStr += ' (' + ( pctChange > 0 ? '+' : '' ) + pctChange.toFixed( 1 ) + '%)';
				}
			}
		} else {
			// Time-based delta.
			var deltaMs = deltaNs / 1e6;
			if ( 0 === deltaNs ) {
				deltaStr = __( 'no change', 'scrutinizer' );
				cls = 'scrutinizer-delta-neutral';
			} else if ( Math.abs( deltaMs ) < 10 && Math.abs( pctChange ) < 5 ) {
				// Within noise threshold.
				deltaStr = ( deltaMs > 0 ? '+' : '' ) + deltaMs.toFixed( 1 ) + ' ms';
				deltaStr += ' (' + ( pctChange > 0 ? '+' : '' ) + pctChange.toFixed( 1 ) + '%)';
				deltaStr += ' · ' + __( 'within noise', 'scrutinizer' );
				cls = 'scrutinizer-delta-neutral';
			} else {
				cls = deltaNs < 0 ? 'scrutinizer-delta-negative' : 'scrutinizer-delta-positive';
				deltaStr = ( deltaMs > 0 ? '+' : '' ) + deltaMs.toFixed( 1 ) + ' ms';
				deltaStr += ' (' + ( pctChange > 0 ? '+' : '' ) + pctChange.toFixed( 1 ) + '%)';
				if ( ( deltaMs > 100 && pctChange > 20 ) || ( deltaMs < -100 && pctChange < -20 ) ) {
					// A single comparison never supports a "regression" verdict
					// (see classifyDelta / INVARIANTS). The signed delta already
					// shows direction; label it only as a difference observed.
					deltaStr += ' · ' + __( 'difference observed', 'scrutinizer' );
				} else {
					deltaStr += deltaNs > 0 ? ' ' + __( 'slower', 'scrutinizer' ) : ' ' + __( 'faster', 'scrutinizer' );
				}
			}
		}

		var html = '<tr>';
		html += '<td>' + esc( label ) + '</td>';
		html += '<td class="numeric">' + esc( valA ) + '</td>';
		html += '<td class="numeric">' + esc( valB ) + '</td>';
		html += '<td class="numeric ' + cls + '">' + deltaStr + '</td>';
		html += '</tr>';
		return html;
	}

	/*  Utilities                                                          */
	/* ------------------------------------------------------------------ */

	function showNotice( message, type ) {
		// role=alert (assertive) for errors, role=status (polite) otherwise, so
		// screen readers announce the notice.
		var role    = ( 'error' === type ) ? 'alert' : 'status';
		var $notice = $( '<div class="scrutinizer-notice ' + type + '" role="' + role + '">' + esc( message ) + '</div>' );
		$( '#scrutinizer-dashboard h1' ).after( $notice );
		setTimeout( function() {
			$notice.fadeOut( 300, function() {
				$notice.remove();
			} );
		}, 4000 );
	}

	/**
	 * Move keyboard focus to a freshly-rendered view heading/region so screen-
	 * reader and keyboard users land in the new content after a view change.
	 *
	 * @param {string} selector Target element selector.
	 */
	function moveFocus( selector ) {
		var $el = $( selector ).first();
		if ( ! $el.length ) {
			return;
		}
		$el.attr( 'tabindex', '-1' ).trigger( 'focus' );
	}

	function esc( str ) {
		if ( null === str || undefined === str ) {
			return '';
		}
		var div = document.createElement( 'div' );
		div.appendChild( document.createTextNode( String( str ) ) );
		return div.innerHTML;
	}

	function truncate( str, max ) {
		if ( ! str || str.length <= max ) {
			return str;
		}
		return str.substring( 0, max - 1 ) + '…';
	}

	function formatBytes( bytes ) {
		if ( 0 === bytes ) {
			return '0 B';
		}
		var units = [ 'B', 'KB', 'MB', 'GB' ];
		var i     = Math.floor( Math.log( bytes ) / Math.log( 1024 ) );
		return ( bytes / Math.pow( 1024, i ) ).toFixed( 1 ) + ' ' + units[ i ];
	}

	/**
	 * Format a memory delta (can be negative for freed memory).
	 */
	function formatMemoryDelta( delta ) {
		if ( 0 === delta ) {
			return '0 B';
		}
		var sign  = delta < 0 ? '−' : '+';
		var abs   = Math.abs( delta );
		var units = [ 'B', 'KB', 'MB', 'GB' ];
		var i     = Math.floor( Math.log( abs ) / Math.log( 1024 ) );
		return sign + ( abs / Math.pow( 1024, i ) ).toFixed( 1 ) + ' ' + units[ i ];
	}

	/* ------------------------------------------------------------------ */
	/*  API Tab: Diagnostics Checkboxes + Send to Agent                     */
	/* ------------------------------------------------------------------ */

	function showApiView() {
		currentView = 'api';
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-compare-view' ).remove();

		var $container = $( '#scrutinizer-api-view' );
		if ( ! $container.length ) {
			$( '#scrutinizer-results' ).after( '<div id="scrutinizer-api-view"></div>' );
			$container = $( '#scrutinizer-api-view' );
		}
		$container.show();

		// Hide cron/history if visible.
		$( '#scrutinizer-history-view' ).hide();

		$( '.scrutinizer-top-tab' ).removeClass( 'active' );
		$( '.scrutinizer-top-tab[data-top-tab="api"]' ).addClass( 'active' );

		renderApiView( $container );
	}

	function renderApiView( $container ) {
		var optInFields = scrutinizerAdmin.diagnosticsOptIn || {};
		var enabledFields = scrutinizerAdmin.diagnosticsFields || [];
		var apiBase = scrutinizerAdmin.apiBase || '';

		var html = '';

		// --- Send to Agent section ---
		html += '<div class="scrutinizer-api-section scrutinizer-api-section--agent">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-share-alt2"></span> ' + __( 'Send to Agent', 'scrutinizer' ) + '</h3>';
		html += '<p class="scrutinizer-api-desc">' + __( 'Generate a one-time prompt that gives an AI agent read-only access to your profiling data.', 'scrutinizer' ) + ' ';
		html += __( 'The credential auto-expires and is scoped to Scrutineer endpoints only.', 'scrutinizer' ) + '</p>';
		html += '<div class="scrutinizer-send-agent-controls">';
		html += '<button type="button" class="button button-primary" id="scrutinizer-create-api-key">';
		html += '<span class="dashicons dashicons-clipboard"></span> ' + __( 'Copy Prompt to Clipboard', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="button scrutinizer-btn-danger" id="scrutinizer-revoke-api-key" style="display:none;">';
		html += '<span class="dashicons dashicons-dismiss"></span> ' + __( 'Revoke Access', 'scrutinizer' ) + '</button>';
		html += '</div>';
		html += '<p class="scrutinizer-privacy-advisory">' + __( 'This prompt includes your site URL and a short-lived credential. Paste it into a private AI conversation \u2014 not a public or shared chat.', 'scrutinizer' ) + '</p>';
		html += '<div id="scrutinizer-api-key-result" class="scrutinizer-api-result" style="display:none;"></div>';
		html += '</div>';

		// --- Diagnostics sharing fields ---
		html += '<div class="scrutinizer-api-section">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-admin-tools"></span> ' + __( 'Diagnostics Sharing', 'scrutinizer' ) + '</h3>';
		// translators: %s is the diagnostics endpoint path.
		html += '<p class="scrutinizer-api-desc">' + sprintf( __( 'Choose which server environment details to include when an agent reads %s.', 'scrutinizer' ), '<code>/v1/diagnostics</code>' ) + ' ';
		html += __( 'These fields are opt-in — nothing is shared unless you check it.', 'scrutinizer' ) + '</p>';
		html += '<div class="scrutinizer-diagnostics-checkboxes">';

		var fieldKeys = Object.keys( optInFields );
		for ( var i = 0; i < fieldKeys.length; i++ ) {
			var key = fieldKeys[ i ];
			var label = optInFields[ key ];
			var checked = enabledFields.indexOf( key ) !== -1 ? ' checked' : '';
			html += '<label class="scrutinizer-diag-checkbox">';
			html += '<input type="checkbox" name="diag_field" value="' + esc( key ) + '"' + checked + '>';
			html += ' <span>' + esc( label ) + '</span>';
			html += '</label>';
		}

		html += '</div>';
		html += '<div class="scrutinizer-diag-actions">';
		html += '<button type="button" class="button" id="scrutinizer-save-diag-fields">' + __( 'Save Preferences', 'scrutinizer' ) + '</button>';
		html += '<span id="scrutinizer-diag-saved" class="scrutinizer-saved-notice" style="display:none;">✓ ' + __( 'Saved', 'scrutinizer' ) + '</span>';
		html += '</div>';
		html += '</div>';

		// --- Endpoints reference ---
		html += '<div class="scrutinizer-api-section">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-rest-api"></span> ' + __( 'Endpoints', 'scrutinizer' ) + '</h3>';
		html += '<table class="scrutinizer-profile-table scrutinizer-api-endpoints widefat">';
		html += '<thead><tr><th>' + __( 'Method', 'scrutinizer' ) + '</th><th>' + __( 'Endpoint', 'scrutinizer' ) + '</th><th>' + __( 'Description', 'scrutinizer' ) + '</th></tr></thead>';
		html += '<tbody>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/prompt</code></td><td>' + __( 'System prompt (text/plain) \u2014 the API contract', 'scrutinizer' ) + '</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/diagnostics</code></td><td>' + __( 'Server environment details (opt-in fields only)', 'scrutinizer' ) + '</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/routes</code></td><td>' + __( 'All profiled routes with summary statistics', 'scrutinizer' ) + '</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/profile/{id}</code></td><td>' + __( 'Full profile detail for one request', 'scrutinizer' ) + '</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/compare/{a}/{b}</code></td><td>' + __( 'Side-by-side comparison of two profiles', 'scrutinizer' ) + '</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/manifest</code></td><td>' + __( 'Machine-readable API manifest for AI agent discovery (public)', 'scrutinizer' ) + '</td></tr>';
		html += '</tbody></table>';
		if ( apiBase ) {
			// translators: %s is the API base URL.
			html += '<p class="scrutinizer-api-base">' + sprintf( __( 'Base URL: %s', 'scrutinizer' ), '<code>' + esc( apiBase ) + '</code>' ) + '</p>';
		}
		html += '</div>';

		// --- Shared Reports section ---
		html += '<div class="scrutinizer-api-section">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-lock"></span> ' + __( 'Shared Reports', 'scrutinizer' ) + '</h3>';
		html += '<p class="scrutinizer-api-desc">' + __( 'Encrypted, self-destructing links you\u2019ve shared. Data is encrypted in your browser before upload &mdash; the relay server never sees your report contents.', 'scrutinizer' ) + '</p>';
		// translators: 1: the "History" tab label, 2: the "Share" button label.
		html += '<p class="scrutinizer-api-desc">' + sprintf( __( 'To share: open a profile from the %1$s tab, then click %2$s in the toolbar.', 'scrutinizer' ), '<strong>' + __( 'History', 'scrutinizer' ) + '</strong>', '<strong>' + __( 'Share', 'scrutinizer' ) + '</strong>' ) + '</p>';
		html += '<div id="scrutinizer-shared-reports-content"><p class="scrutinizer-empty">' + __( 'Loading\u2026', 'scrutinizer' ) + '</p></div>';
		// translators: %s is the relay service name.
		html += '<p class="scrutinizer-api-desc" style="color:#50575e;font-size:12px;">' + sprintf( __( 'Powered by %s &mdash; zero-knowledge encrypted relay.', 'scrutinizer' ), '<code>scrutinizer.dev</code>' ) + '</p>';
		html += '</div>';

		// --- Audit Log section ---
		html += '<div class="scrutinizer-api-section">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-list-view"></span> ' + __( 'Access Log', 'scrutinizer' ) + '</h3>';
		html += '<p class="scrutinizer-api-desc">' + __( 'Recent API credential usage. Shows when endpoints were accessed, from which IP, and by which user agent.', 'scrutinizer' ) + '</p>';
		html += '<div id="scrutinizer-api-log-content"><p class="scrutinizer-empty">' + __( 'Loading...', 'scrutinizer' ) + '</p></div>';
		html += '<div class="scrutinizer-diag-actions">';
		html += '<button type="button" class="button" id="scrutinizer-refresh-api-log"><span class="dashicons dashicons-update"></span> ' + __( 'Refresh', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="button scrutinizer-btn-danger" id="scrutinizer-clear-api-log">' + __( 'Clear Log', 'scrutinizer' ) + '</button>';
		html += '</div>';
		html += '</div>';

		$container.html( html );

		bindApiEvents( $container );

		// Load shared reports and audit log on render.
		loadSharedReports();
		loadApiAuditLog();
	}

	function bindApiEvents( $container ) {
		// Save diagnostics field preferences.
		$container.find( '#scrutinizer-save-diag-fields' ).off( 'click' ).on( 'click', function() {
			var $btn = $( this );
			var fields = [];
			$container.find( 'input[name="diag_field"]:checked' ).each( function() {
				fields.push( $( this ).val() );
			} );

			$btn.prop( 'disabled', true ).text( __( 'Saving…', 'scrutinizer' ) );

			$.post( scrutinizerAdmin.ajaxUrl, {
				action: 'scrutinizer_save_diagnostics_fields',
				nonce:  scrutinizerAdmin.nonce,
				fields: fields
			}, function( response ) {
				$btn.prop( 'disabled', false ).text( __( 'Save Preferences', 'scrutinizer' ) );
				if ( response.success ) {
					scrutinizerAdmin.diagnosticsFields = response.data.fields;
					$( '#scrutinizer-diag-saved' ).fadeIn( 200 ).delay( 2000 ).fadeOut( 400 );
				}
			} ).fail( function() {
				$btn.prop( 'disabled', false ).text( __( 'Save Preferences', 'scrutinizer' ) );
			} );
		} );

		// Create API password and copy prompt.
		$container.find( '#scrutinizer-create-api-key' ).off( 'click' ).on( 'click', function() {
			var $btn = $( this );
			$btn.prop( 'disabled', true ).html( '<span class="dashicons dashicons-update spin"></span> ' + __( 'Generating…', 'scrutinizer' ) );

			$.post( scrutinizerAdmin.ajaxUrl, {
				action: 'scrutinizer_create_api_password',
				nonce:  scrutinizerAdmin.nonce
			}, function( response ) {
				if ( response.success ) {
					var d = response.data;

					// Copy prompt to clipboard.
					copyToClipboard( d.prompt );

					// Show success.
					var ttlLabel;
					if ( d.ttl_hours <= 1 ) {
						ttlLabel = __( '1 hour', 'scrutinizer' );
					} else {
						// translators: %d is the number of hours until access expires.
						ttlLabel = sprintf( __( '%d hours', 'scrutinizer' ), d.ttl_hours );
					}
					$( '#scrutinizer-api-key-result' )
						.html(
							'<div class="scrutinizer-api-success">' +
							'<span class="dashicons dashicons-yes-alt"></span> ' +
							'<strong>' + __( 'Prompt copied to clipboard.', 'scrutinizer' ) + '</strong> ' +
							// translators: %s is the time until access expires (e.g. "2 hours").
							sprintf( __( 'Paste it into your AI agent. Access expires in %s.', 'scrutinizer' ), esc( ttlLabel ) ) +
							'</div>'
						)
						.slideDown( 200 );

					$btn.prop( 'disabled', false )
						.html( '<span class="dashicons dashicons-clipboard"></span> ' + __( 'Regenerate &amp; Copy', 'scrutinizer' ) );
					$( '#scrutinizer-revoke-api-key' ).show();
				} else {
					$( '#scrutinizer-api-key-result' )
						.html(
							'<div class="scrutinizer-api-error">' +
							'<span class="dashicons dashicons-warning"></span> ' +
							esc( response.data.message || __( 'Failed to create access key.', 'scrutinizer' ) ) +
							'</div>'
						)
						.slideDown( 200 );
					$btn.prop( 'disabled', false )
						.html( '<span class="dashicons dashicons-clipboard"></span> ' + __( 'Copy Prompt to Clipboard', 'scrutinizer' ) );
				}
			} ).fail( function() {
				$btn.prop( 'disabled', false )
					.html( '<span class="dashicons dashicons-clipboard"></span> ' + __( 'Copy Prompt to Clipboard', 'scrutinizer' ) );
			} );
		} );

		// Revoke API password.
		$container.find( '#scrutinizer-revoke-api-key' ).off( 'click' ).on( 'click', function() {
			var $btn = $( this );
			$btn.prop( 'disabled', true );

			$.post( scrutinizerAdmin.ajaxUrl, {
				action: 'scrutinizer_revoke_api_password',
				nonce:  scrutinizerAdmin.nonce
			}, function( response ) {
				$btn.prop( 'disabled', false );
				if ( response.success ) {
					$( '#scrutinizer-api-key-result' )
						.html(
							'<div class="scrutinizer-api-revoked">' +
							'<span class="dashicons dashicons-yes-alt"></span> ' +
							__( 'Access revoked.', 'scrutinizer' ) +
							'</div>'
						)
						.slideDown( 200 )
						.delay( 3000 )
						.slideUp( 400 );

					$( '#scrutinizer-create-api-key' )
						.html( '<span class="dashicons dashicons-clipboard"></span> ' + __( 'Copy Prompt to Clipboard', 'scrutinizer' ) );
					$btn.hide();
				}
			} ).fail( function() {
				$btn.prop( 'disabled', false );
			} );
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  API Audit Log (F17)                                                */
	/* ------------------------------------------------------------------ */

	/**
	 * Load and render shared reports from the ledger.
	 */
	function loadSharedReports() {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_get_shares',
			nonce:  scrutinizerAdmin.nonce
		}, function( response ) {
			if ( response.success ) {
				renderSharedReports( response.data.shares || [] );
			} else {
				$( '#scrutinizer-shared-reports-content' ).html(
					'<p class="scrutinizer-empty">' + __( 'Failed to load shared reports.', 'scrutinizer' ) + '</p>'
				);
			}
		} );
	}

	function renderSharedReports( shares ) {
		var $container = $( '#scrutinizer-shared-reports-content' );

		if ( ! shares.length ) {
			$container.html( '<p class="scrutinizer-empty">' + __( 'No shared reports yet. Share a profile to see it here.', 'scrutinizer' ) + '</p>' );
			return;
		}

		var now = Date.now();
		var html = '<table class="scrutinizer-profile-table scrutinizer-shared-table widefat">';
		html += '<thead><tr><th>' + __( 'Route', 'scrutinizer' ) + '</th><th>' + __( 'Shared', 'scrutinizer' ) + '</th><th>' + __( 'Expires', 'scrutinizer' ) + '</th><th>' + __( 'Actions', 'scrutinizer' ) + '</th></tr></thead>';
		html += '<tbody>';

		for ( var i = 0; i < shares.length; i++ ) {
			var s = shares[ i ];
			var route = s.profile_route || '\u2014';
			var created = s.created_at || '';
			var expiresAt = s.expires_at ? new Date( s.expires_at ) : null;
			var expiryLabel = '';

			if ( expiresAt ) {
				var diff = expiresAt.getTime() - now;
				if ( diff <= 0 ) {
					expiryLabel = '<span style="color:#d63638;">' + __( 'Expired', 'scrutinizer' ) + '</span>';
				} else {
					var days = Math.ceil( diff / 86400000 );
					if ( days <= 1 ) {
						var hours = Math.ceil( diff / 3600000 );
						// translators: %d is the number of hours remaining.
						expiryLabel = '<span style="color:#dba617;">' + sprintf( __( '%dh remaining', 'scrutinizer' ), hours ) + '</span>';
					} else {
						// translators: %d is the number of days remaining.
						expiryLabel = sprintf( __( '%dd remaining', 'scrutinizer' ), days );
					}
				}
			} else {
				expiryLabel = '\u2014';
			}

			var isExpired = expiresAt && expiresAt.getTime() <= now;

			html += '<tr>';
			html += '<td class="scrutinizer-route-cell" title="' + esc( route ) + '">' + esc( truncate( route, 40 ) ) + '</td>';
			html += '<td>' + esc( created ) + '</td>';
			html += '<td>' + expiryLabel + '</td>';
			html += '<td class="scrutinizer-actions">';
			if ( ! isExpired ) {
				html += '<button type="button" class="button button-small scrutinizer-copy-share-link" data-url="' + esc( s.url || '' ) + '">' + __( 'Copy Link', 'scrutinizer' ) + '</button> ';
				html += '<button type="button" class="button button-small scrutinizer-btn-danger scrutinizer-revoke-share" data-id="' + esc( s.id ) + '" data-token="' + esc( s.revoke_token || '' ) + '">' + __( 'Revoke', 'scrutinizer' ) + '</button>';
			} else {
				html += '<button type="button" class="button button-small scrutinizer-remove-share" data-id="' + esc( s.id ) + '">' + __( 'Remove', 'scrutinizer' ) + '</button>';
			}
			html += '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		$container.html( html );

		// Bind copy-link buttons.
		$container.find( '.scrutinizer-copy-share-link' ).on( 'click', function() {
			var url = $( this ).data( 'url' );
			var $btn = $( this );
			copyToClipboard( url );
			$btn.html( '\u2713 ' + __( 'Copied', 'scrutinizer' ) );
			setTimeout( function() {
				$btn.html( __( 'Copy Link', 'scrutinizer' ) );
			}, 2000 );
		} );

		// Bind revoke buttons.
		$container.find( '.scrutinizer-revoke-share' ).on( 'click', function() {
			var id = $( this ).data( 'id' );
			var token = $( this ).data( 'token' );
			var $btn = $( this );
			$btn.prop( 'disabled', true ).text( __( 'Revoking\u2026', 'scrutinizer' ) );

			fetch( RELAY_URL + '/r/' + id, {
				method: 'DELETE',
				headers: { 'X-Revoke-Token': token }
			} )
			.then( function( resp ) { return resp.json(); } )
			.then( function( data ) {
				// Remove from ledger regardless — the relay may have already expired it.
				$.post( scrutinizerAdmin.ajaxUrl, {
					action:   'scrutinizer_delete_share',
					nonce:    scrutinizerAdmin.nonce,
					share_id: id
				}, function() {
					loadSharedReports();
				} );
			} )
			.catch( function() {
				// Remove from ledger anyway on network error.
				$.post( scrutinizerAdmin.ajaxUrl, {
					action:   'scrutinizer_delete_share',
					nonce:    scrutinizerAdmin.nonce,
					share_id: id
				}, function() {
					loadSharedReports();
				} );
			} );
		} );

		// Bind remove buttons (for expired shares).
		$container.find( '.scrutinizer-remove-share' ).on( 'click', function() {
			var id = $( this ).data( 'id' );
			$.post( scrutinizerAdmin.ajaxUrl, {
				action:   'scrutinizer_delete_share',
				nonce:    scrutinizerAdmin.nonce,
				share_id: id
			}, function() {
				loadSharedReports();
			} );
		} );
	}

	function loadApiAuditLog() {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_get_api_log',
			nonce:  scrutinizerAdmin.nonce
		}, function( response ) {
			if ( response.success ) {
				renderApiAuditLog( response.data.log || [] );
			} else {
				$( '#scrutinizer-api-log-content' ).html(
					'<p class="scrutinizer-empty">' + __( 'Failed to load access log.', 'scrutinizer' ) + '</p>'
				);
			}
		} ).fail( function() {
			$( '#scrutinizer-api-log-content' ).html(
				'<p class="scrutinizer-empty">' + __( 'Failed to load access log.', 'scrutinizer' ) + '</p>'
			);
		} );
	}

	function renderApiAuditLog( entries ) {
		var $container = $( '#scrutinizer-api-log-content' );

		if ( ! entries || 0 === entries.length ) {
			$container.html( '<p class="scrutinizer-empty">' + __( 'No API access recorded yet.', 'scrutinizer' ) + '</p>' );
			return;
		}

		var html = '<table class="scrutinizer-api-log-table widefat">';
		html += '<thead><tr>';
		html += '<th>' + __( 'Endpoint', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'IP', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'User Agent', 'scrutinizer' ) + '</th>';
		html += '<th>' + __( 'When', 'scrutinizer' ) + '</th>';
		html += '</tr></thead><tbody>';

		var limit = Math.min( entries.length, 50 );
		for ( var i = 0; i < limit; i++ ) {
			var e = entries[ i ];
			var ua = e.user_agent || '';
			if ( ua.length > 60 ) {
				ua = ua.substring( 0, 57 ) + '...';
			}
			html += '<tr>';
			html += '<td><code>' + esc( e.endpoint ) + '</code></td>';
			html += '<td class="scrutinizer-mono">' + esc( e.ip ) + '</td>';
			html += '<td title="' + esc( e.user_agent ) + '">' + esc( ua ) + '</td>';
			html += '<td>' + esc( e.timestamp ) + '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		if ( entries.length > 50 ) {
			// translators: %d is the total number of log entries.
			html += '<p class="scrutinizer-api-desc" style="margin-top:8px">' + sprintf( __( 'Showing 50 of %d entries.', 'scrutinizer' ), entries.length ) + '</p>';
		}
		$container.html( html );
	}

	// Bind audit log buttons (outside bindApiEvents to avoid duplicate binding).
	$( document ).on( 'click', '#scrutinizer-refresh-api-log', function() {
		$( '#scrutinizer-api-log-content' ).html( '<p class="scrutinizer-empty">' + __( 'Loading...', 'scrutinizer' ) + '</p>' );
		loadApiAuditLog();
	} );

	$( document ).on( 'click', '#scrutinizer-clear-api-log', function() {
		if ( ! confirm( __( 'Clear the entire API access log?', 'scrutinizer' ) ) ) {
			return;
		}
		$.post( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_clear_api_log',
			nonce:  scrutinizerAdmin.nonce
		}, function( response ) {
			if ( response.success ) {
				$( '#scrutinizer-api-log-content' ).html(
					'<p class="scrutinizer-empty">' + __( 'No API access recorded yet.', 'scrutinizer' ) + '</p>'
				);
			}
		} );
	} );

	/* ================================================================== */
	/*  Export JSON — Download raw profile data                           */
	/* ================================================================== */

	/**
	 * Export a profile as a downloadable JSON file.
	 */
	function exportProfileJSON( profile ) {
		var data = profile.profile_data || {};
		var id   = profile.id || 'unknown';

		// Build a clean export object with metadata.
		var exportObj = {
			_scrutinizer: {
				version: scrutinizerAdmin.version || '1.0.0',
				viewer: 'https://scrutinizer.dev/view',
				exported_at: new Date().toISOString()
			},
			id:          parseInt( id, 10 ),
			route_key:   profile.route_key || '',
			captured_at: profile.captured_at || '',
			duration_ns: parseInt( profile.duration_ns, 10 ) || 0,
			user_role:   profile.user_role || '',
			is_pinned:   parseInt( profile.is_pinned, 10 ) === 1,
			note:        profile.note || '',
			tags:        profile.tags || '',
			profile_data: data
		};

		var json     = JSON.stringify( exportObj, null, 2 );
		var blob     = new Blob( [ json ], { type: 'application/json' } );
		var filename = 'scrutinizer-profile-' + id + '.json';

		// Trigger download.
		var a   = document.createElement( 'a' );
		a.href  = URL.createObjectURL( blob );
		a.download = filename;
		document.body.appendChild( a );
		a.click();
		document.body.removeChild( a );
		URL.revokeObjectURL( a.href );
	}

	/* ================================================================== */
	/*  Share Report — Zero-Knowledge Encrypted Sharing via Relay         */
	/* ================================================================== */

	var RELAY_URL = 'https://scrutinizer.dev';

	/**
	 * Show the share panel for a given profile.
	 */
	function showSharePanel( profileId ) {
		// Check if panel already open
		if ( $( '#scrutinizer-share-panel' ).length ) {
			$( '#scrutinizer-share-panel' ).remove();
			return;
		}

		var html = '<div id="scrutinizer-share-panel" class="scrutinizer-share-panel">';
		html += '<h4><span class="dashicons dashicons-share-alt2"></span> ' + __( 'Share Report', 'scrutinizer' ) + '</h4>';
		html += '<p class="description">' + __( 'Create an encrypted, self-destructing link. The relay server never sees your data.', 'scrutinizer' ) + '</p>';

		// Options
		html += '<div class="scrutinizer-share-options">';
		html += '<label class="scrutinizer-share-option">';
		html += '<span>' + __( 'Expires after', 'scrutinizer' ) + '</span>';
		html += '<select id="scrutinizer-share-ttl">';
		html += '<option value="1">' + __( '1 day', 'scrutinizer' ) + '</option>';
		html += '<option value="7" selected>' + __( '7 days', 'scrutinizer' ) + '</option>';
		html += '<option value="14">' + __( '14 days', 'scrutinizer' ) + '</option>';
		html += '<option value="30">' + __( '30 days', 'scrutinizer' ) + '</option>';
		html += '</select></label>';

		html += '<label class="scrutinizer-share-option">';
		html += '<input type="checkbox" id="scrutinizer-share-burn">';
		html += ' <span>' + __( 'Expire after first view', 'scrutinizer' ) + '</span></label>';

		html += '<label class="scrutinizer-share-option">';
		html += '<input type="checkbox" id="scrutinizer-share-passphrase-toggle">';
		html += ' <span>' + __( 'Add passphrase', 'scrutinizer' ) + '</span></label>';

		html += '<div id="scrutinizer-share-passphrase-field" style="display:none;">';
		html += '<input type="text" id="scrutinizer-share-passphrase" placeholder="' + esc( __( 'Passphrase (share separately)', 'scrutinizer' ) ) + '" />';
		html += '</div>';

		html += '</div>';

		// Include sections
		html += '<details class="scrutinizer-share-sections">';
		html += '<summary>' + __( 'Sections to include', 'scrutinizer' ) + '</summary>';
		html += '<div class="scrutinizer-share-section-list">';
		html += '<label><input type="checkbox" name="share_section" value="summary" checked disabled> ' + __( 'Summary', 'scrutinizer' ) + '</label>';
		html += '<label><input type="checkbox" name="share_section" value="sources" checked> ' + __( 'Sources', 'scrutinizer' ) + '</label>';
		html += '<label><input type="checkbox" name="share_section" value="queries" checked> ' + __( 'Queries', 'scrutinizer' ) + '</label>';
		html += '<label><input type="checkbox" name="share_section" value="timeline" checked> ' + __( 'Timeline', 'scrutinizer' ) + '</label>';
		html += '<label><input type="checkbox" name="share_section" value="trace" checked> ' + __( 'Trace', 'scrutinizer' ) + '</label>';
		html += '<label><input type="checkbox" name="share_section" value="http_calls" checked> ' + __( 'HTTP Calls', 'scrutinizer' ) + '</label>';
		html += '<label><input type="checkbox" name="share_section" value="autoloaded_options" checked> ' + __( 'Options', 'scrutinizer' ) + '</label>';
		html += '<label><input type="checkbox" name="share_section" value="enqueued_assets" checked> ' + __( 'Assets', 'scrutinizer' ) + '</label>';
		html += '<label><input type="checkbox" name="share_section" value="diagnostics"> ' + __( 'Diagnostics', 'scrutinizer' ) + '</label>';
		html += '</div></details>';

		html += '<div class="scrutinizer-share-actions">';
		html += '<button type="button" class="button button-primary" id="scrutinizer-share-go">';
		html += '<span class="dashicons dashicons-lock"></span> ' + __( 'Encrypt &amp; Share', 'scrutinizer' ) + '</button>';
		html += '<button type="button" class="button button-link" id="scrutinizer-share-cancel">' + __( 'Cancel', 'scrutinizer' ) + '</button>';
		html += '</div>';

		html += '<div id="scrutinizer-share-result" style="display:none;"></div>';
		html += '</div>';

		// Insert after the pin toolbar
		$( '.scrutinizer-pin-toolbar' ).after( html );

		// Toggle passphrase field
		$( '#scrutinizer-share-passphrase-toggle' ).on( 'change', function() {
			$( '#scrutinizer-share-passphrase-field' ).toggle( this.checked );
		} );

		// Cancel
		$( '#scrutinizer-share-cancel' ).on( 'click', function() {
			$( '#scrutinizer-share-panel' ).remove();
		} );

		// Share
		$( '#scrutinizer-share-go' ).on( 'click', function() {
			executeShare( profileId );
		} );
	}

	/**
	 * Execute the share: compile, encrypt, upload.
	 */
	function executeShare( profileId ) {
		var $btn = $( '#scrutinizer-share-go' );
		var $result = $( '#scrutinizer-share-result' );
		$btn.prop( 'disabled', true ).html( '<span class="dashicons dashicons-update spin"></span> ' + __( 'Encrypting…', 'scrutinizer' ) );

		// Gather options
		var ttlDays = parseInt( $( '#scrutinizer-share-ttl' ).val(), 10 );
		var burnAfterReading = $( '#scrutinizer-share-burn' ).is( ':checked' );
		var usePassphrase = $( '#scrutinizer-share-passphrase-toggle' ).is( ':checked' );
		var passphrase = usePassphrase ? $( '#scrutinizer-share-passphrase' ).val() : null;

		// Gather included sections
		var sections = [];
		$( 'input[name="share_section"]:checked' ).each( function() {
			sections.push( $( this ).val() );
		} );

		// Fetch compiled profile via AJAX
		$.get( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_get_profile_detail',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: profileId
		}, function( response ) {
			if ( ! response.success || ! response.data || ! response.data.profile ) {
				$btn.prop( 'disabled', false ).html( '<span class="dashicons dashicons-lock"></span> ' + __( 'Encrypt &amp; Share', 'scrutinizer' ) );
				$result.html( '<p class="scrutinizer-share-error">' + __( 'Failed to load profile data.', 'scrutinizer' ) + '</p>' ).show();
				return;
			}

			var profile = response.data.profile;
			var profileData = profile.profile_data || {};

			// Build share payload — only included sections
			var shareData = {
				summary: profileData.summary || {},
				request: {
					method: ( profileData.request || {} ).method || 'GET',
					url: ( profileData.request || {} ).url || '',
					route_key: profile.route_key || '',
					label: ( profileData.request || {} ).label || '',
					role: ( profileData.request || {} ).user_role || '',
					status: profile.response_status || null
				},
				captured_at: profile.captured_at
			};

			// Add selected sections
			if ( sections.indexOf( 'sources' ) !== -1 && profileData.sources ) {
				shareData.sources = profileData.sources.map( function( src ) {
					return {
						source: src.slug || 'unknown',
						name: src.name || src.slug || 'unknown',
						type: src.type || 'unknown',
						exclusive_ms: ( src.exclusive_ns || 0 ) / 1e6,
						inclusive_ms: ( src.inclusive_ns || 0 ) / 1e6,
						callback_count: src.callback_count || 0
					};
				} );
			}
			if ( sections.indexOf( 'queries' ) !== -1 && profileData.queries ) {
				shareData.queries = profileData.queries.map( function( q ) {
					var qSrc = '';
					var qSrcType = '';
					if ( q.attribution ) {
						qSrc = q.attribution.name || q.attribution.slug || '';
						qSrcType = q.attribution.type || 'unknown';
					} else if ( q.caller ) {
						var inferred = inferSourceFromCaller( q.caller );
						if ( inferred ) {
							qSrc = inferred.name;
							qSrcType = inferred.type;
						}
					}
					return {
						sql: q.sql || '',
						time_ms: q.time_ms || 0,
						source: qSrc,
						source_type: qSrcType,
						caller: q.caller || '',
						offset_ms: ( q.offset_ns || 0 ) / 1e6
					};
				} );
			}
			if ( sections.indexOf( 'timeline' ) !== -1 && profileData.timeline ) {
				shareData.timeline = profileData.timeline.map( function( t ) {
					return {
						callback: t.callback || '',
						tag: t.tag || '',
						source: t.source || '',
						source_type: t.type || 'unknown',
						offset_ms: ( t.offset_ns || 0 ) / 1e6,
						duration_ms: ( t.wall_ns || t.excl_ns || 0 ) / 1e6,
						pct_start: t.pct_start || 0,
						pct_width: t.pct_width || 0,
						mem_after: t.mem_after || 0
					};
				} );
			}
			if ( sections.indexOf( 'timeline' ) !== -1 && profileData.phase_markers ) {
				shareData.phase_markers = profileData.phase_markers.map( function( m ) {
					var markerName = m.name || m.hook || '';
					return {
						hook: markerName,
						label: m.label || markerName,
						offset_ms: ( m.offset_ns || 0 ) / 1e6
					};
				} );
			}
			if ( sections.indexOf( 'trace' ) !== -1 && profileData.trace ) {
				// Build source lookup from sources data.
				var shareSrcMap = {};
				if ( profileData.sources ) {
					for ( var si = 0; si < profileData.sources.length; si++ ) {
						var shareSrc = profileData.sources[ si ];
						var shareCbs = shareSrc.callbacks || [];
						for ( var ci = 0; ci < shareCbs.length; ci++ ) {
							shareSrcMap[ shareCbs[ ci ].callback ] = {
								type: shareSrc.type || 'unknown',
								name: shareSrc.name || shareSrc.slug || 'unknown'
							};
						}
					}
				}
				shareData.trace = profileData.trace.map( function( t ) {
					var tid      = t.id || '';
					var atIdx    = tid.lastIndexOf( '@' );
					var cbName   = atIdx > 0 ? tid.substring( 0, atIdx ) : tid;
					var hookPart = atIdx > 0 ? tid.substring( atIdx + 1 ) : '';
					var colonIdx = hookPart.lastIndexOf( ':' );
					var hook     = colonIdx > 0 ? hookPart.substring( 0, colonIdx ) : hookPart;
					var srcInfo  = shareSrcMap[ cbName ] || { type: 'unknown', name: 'unknown' };
					return {
						callback: cbName,
						phase: hook,
						source: srcInfo.name,
						source_type: srcInfo.type,
						exclusive_ms: ( t.exclusive_ns || 0 ) / 1e6,
						inclusive_ms: ( t.inclusive_ns || 0 ) / 1e6
					};
				} );
			}
			if ( sections.indexOf( 'http_calls' ) !== -1 && profileData.http_calls ) {
				shareData.http_calls = profileData.http_calls.map( function( h ) {
					var callerStr = '';
					var sourceType = 'unknown';
					var sourceName = '';
					if ( typeof h.caller === 'object' && h.caller ) {
						callerStr = h.caller.caller || '';
						if ( h.caller.attribution ) {
							sourceType = h.caller.attribution.type || 'unknown';
							sourceName = h.caller.attribution.slug || h.caller.attribution.name || '';
						}
					} else if ( typeof h.caller === 'string' ) {
						callerStr = h.caller;
					}
					return {
						url: h.url || '',
						method: h.method || 'GET',
						status: h.status || 0,
						duration_ms: h.duration_ms || ( ( h.duration_ns || 0 ) / 1e6 ),
						caller: callerStr,
						source_type: sourceType,
						source_name: sourceName,
						is_error: h.is_error || false,
						offset_ms: ( h.offset_ns || 0 ) / 1e6
					};
				} );
			}
			if ( sections.indexOf( 'autoloaded_options' ) !== -1 && profileData.autoloaded_options ) {
				shareData.autoloaded_options = profileData.autoloaded_options;
			}
			if ( sections.indexOf( 'enqueued_assets' ) !== -1 && profileData.enqueued_assets ) {
				shareData.enqueued_assets = profileData.enqueued_assets;
			}

			if ( sections.indexOf( 'diagnostics' ) !== -1 ) {
				$.ajax( {
					url: scrutinizerAdmin.apiBase + 'diagnostics',
					method: 'GET',
					beforeSend: function( xhr ) {
						xhr.setRequestHeader( 'X-WP-Nonce', scrutinizerAdmin.restNonce );
					}
				} ).done( function( diag ) {
					shareData.diagnostics = diag;
					encryptAndUpload( shareData, ttlDays, burnAfterReading, passphrase, profileId, profile.route_key || '' );
				} ).fail( function() {
					// Continue without diagnostics
					encryptAndUpload( shareData, ttlDays, burnAfterReading, passphrase, profileId, profile.route_key || '' );
				} );
			} else {
				encryptAndUpload( shareData, ttlDays, burnAfterReading, passphrase, profileId, profile.route_key || '' );
			}

		} ).fail( function() {
			$btn.prop( 'disabled', false ).html( '<span class="dashicons dashicons-lock"></span> ' + __( 'Encrypt &amp; Share', 'scrutinizer' ) );
			$result.html( '<p class="scrutinizer-share-error">' + __( 'Request failed. Please try again.', 'scrutinizer' ) + '</p>' ).show();
		} );
	}

	/**
	 * Encrypt a report payload and upload to the relay.
	 */
	function encryptAndUpload( data, ttlDays, burnAfterReading, passphrase, profileId, profileRoute ) {
		var $btn = $( '#scrutinizer-share-go' );
		var $result = $( '#scrutinizer-share-result' );

		$btn.html( '<span class="dashicons dashicons-update spin"></span> ' + __( 'Compressing…', 'scrutinizer' ) );

		// Gzip the JSON before encryption for smaller payloads
		var jsonBytes = new TextEncoder().encode( JSON.stringify( data ) );

		compressGzip( jsonBytes ).then( function( compressed ) {
			$btn.html( '<span class="dashicons dashicons-update spin"></span> ' + __( 'Encrypting…', 'scrutinizer' ) );

			var plaintext = compressed;

			// Generate random AES-256 key and IV
			var keyBytes = crypto.getRandomValues( new Uint8Array( 32 ) );
			var iv = crypto.getRandomValues( new Uint8Array( 12 ) );

			// The key fragment for the share URL. For plain shares this is the raw key;
			// for passphrase shares it becomes the wrapped key material.
			var urlFragment = base64urlEncode( keyBytes );

			return crypto.subtle.importKey( 'raw', keyBytes, { name: 'AES-GCM' }, true, [ 'encrypt' ] )
				.then( function( key ) {
					return crypto.subtle.encrypt( { name: 'AES-GCM', iv: iv }, key, plaintext );
				} )
				.then( function( ciphertext ) {
					var ciphertextB64 = base64urlEncode( new Uint8Array( ciphertext ) );
					var ivB64 = base64urlEncode( iv );
					var hasPassphrase = false;

					// If passphrase, wrap the key and use wrapped material in URL fragment
					if ( passphrase ) {
						hasPassphrase = true;
						return wrapKeyWithPassphrase( keyBytes, passphrase ).then( function( w ) {
							urlFragment = base64urlEncode( w.wrapped );
							return uploadToRelay( ciphertextB64, ivB64, ttlDays, burnAfterReading, hasPassphrase, {
								salt: base64urlEncode( w.salt ),
								iterations: w.iterations
							} );
						} );
					}

					return uploadToRelay( ciphertextB64, ivB64, ttlDays, burnAfterReading, hasPassphrase, null );
				} )
				.then( function( resp ) {
					$btn.hide();
					$( '.scrutinizer-share-options, .scrutinizer-share-sections, #scrutinizer-share-cancel' ).hide();

					var shareUrl = resp.url + '#' + urlFragment;

					var html = '<div class="scrutinizer-share-success">';
					html += '<p><span class="dashicons dashicons-yes-alt" style="color:#4ab866;"></span> ' + __( 'Report encrypted and shared.', 'scrutinizer' ) + '</p>';
					html += '<div class="scrutinizer-share-url-row">';
					html += '<input type="text" readonly value="' + esc( shareUrl ) + '" id="scrutinizer-share-url" />';
					html += '<button type="button" class="button" id="scrutinizer-share-copy">' + __( 'Copy', 'scrutinizer' ) + '</button>';
					html += '</div>';
					// translators: %s is the expiration date and time.
					html += '<p class="description">' + sprintf( __( 'Expires: %s', 'scrutinizer' ), esc( new Date( resp.expires_at ).toLocaleString() ) ) + '</p>';
					html += '<button type="button" class="button scrutinizer-btn-danger" id="scrutinizer-share-revoke" data-id="' + esc( resp.id ) + '" data-token="' + esc( resp.revoke_token ) + '">';
					html += '<span class="dashicons dashicons-dismiss"></span> ' + __( 'Revoke', 'scrutinizer' ) + '</button>';
					html += '</div>';

					$result.html( html ).show();

					// Copy handler
					$( '#scrutinizer-share-copy' ).on( 'click', function() {
						$( '#scrutinizer-share-url' ).select();
						copyToClipboard( shareUrl );
						$( this ).html( '✓ ' + __( 'Copied', 'scrutinizer' ) );
						setTimeout( function() {
							$( '#scrutinizer-share-copy' ).html( __( 'Copy', 'scrutinizer' ) );
						}, 2000 );
					} );

					// Revoke handler
					$( '#scrutinizer-share-revoke' ).on( 'click', function() {
						var id = $( this ).data( 'id' );
						var token = $( this ).data( 'token' );
						revokeSharedReport( id, token );
					} );

					// Persist share record in the ledger.
					$.post( scrutinizerAdmin.ajaxUrl, {
						action:        'scrutinizer_save_share',
						nonce:         scrutinizerAdmin.nonce,
						share_id:      resp.id,
						url:           shareUrl,
						revoke_token:  resp.revoke_token,
						expires_at:    resp.expires_at,
						profile_id:    profileId,
						profile_route: profileRoute
					} );
				} );
		} )
		.catch( function( err ) {
			console.error( 'Share error:', err );
			$btn.prop( 'disabled', false ).html( '<span class="dashicons dashicons-lock"></span> ' + __( 'Encrypt &amp; Share', 'scrutinizer' ) );
			// translators: %s is the error message.
			$result.html( '<p class="scrutinizer-share-error">' + sprintf( __( 'Encryption failed: %s', 'scrutinizer' ), esc( err.message || __( 'Unknown error', 'scrutinizer' ) ) ) + '</p>' ).show();
		} );
	}

	/**
	 * Upload encrypted payload to the relay.
	 */
	function uploadToRelay( ciphertext, iv, ttlDays, burnAfterReading, hasPassphrase, kdf ) {
		return new Promise( function( resolve, reject ) {
			var payload = {
				ciphertext: ciphertext,
				iv: iv,
				ttl_days: ttlDays,
				expire_after_reading: burnAfterReading,
				has_passphrase: hasPassphrase,
				compressed: true
			};
			// Non-secret PBKDF2 parameters for passphrase shares (the viewer
			// needs them to reproduce the key derivation). Absent for legacy /
			// non-passphrase shares.
			if ( kdf ) {
				payload.kdf_salt = kdf.salt;
				payload.kdf_iterations = kdf.iterations;
			}

			// Use fetch to avoid jQuery AJAX CORS defaults
			var bodyStr = JSON.stringify( payload );

			// Guard against relay's 10 MB limit.
			if ( bodyStr.length > 10000000 ) {
				// translators: %s is the report size in megabytes.
				reject( new Error( sprintf( __( 'Report too large (%s MB). Try unchecking Trace and Timeline.', 'scrutinizer' ), ( bodyStr.length / 1048576 ).toFixed( 1 ) ) ) );
				return;
			}

			fetch( RELAY_URL + '/r/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: bodyStr
			} )
			.then( function( resp ) {
				if ( ! resp.ok ) {
					return resp.json().then( function( data ) {
						throw new Error( data.error || __( 'Upload failed', 'scrutinizer' ) );
					} );
				}
				return resp.json();
			} )
			.then( resolve )
			.catch( reject );
		} );
	}

	/**
	 * Wrap a key with a passphrase using PBKDF2 + AES-GCM.
	 */
	function wrapKeyWithPassphrase( keyBytes, passphrase ) {
		var enc = new TextEncoder();
		// Dedicated random PBKDF2 salt (not the content IV) and 600k iterations
		// per OWASP 2023. The salt + iteration count travel as non-secret KDF
		// metadata so the viewer can reproduce the derivation; the passphrase
		// and wrapped key never reach the server.
		var salt = crypto.getRandomValues( new Uint8Array( 16 ) );
		var iterations = 600000;
		return crypto.subtle.importKey( 'raw', enc.encode( passphrase ), 'PBKDF2', false, [ 'deriveBits', 'deriveKey' ] )
			.then( function( passphraseKey ) {
				return crypto.subtle.deriveKey(
					{ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
					passphraseKey,
					{ name: 'AES-GCM', length: 256 },
					false,
					[ 'encrypt' ]
				);
			} )
			.then( function( wrappingKey ) {
				var wrapIv = crypto.getRandomValues( new Uint8Array( 12 ) );
				return crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv: wrapIv },
					wrappingKey,
					keyBytes
				).then( function( wrapped ) {
					// Prepend the wrap IV to the wrapped data
					var result = new Uint8Array( wrapIv.length + new Uint8Array( wrapped ).length );
					result.set( wrapIv );
					result.set( new Uint8Array( wrapped ), wrapIv.length );
					return { wrapped: result, salt: salt, iterations: iterations };
				} );
			} );
	}

	/**
	 * Revoke a shared report via the relay.
	 */
	function revokeSharedReport( id, token ) {
		var $btn = $( '#scrutinizer-share-revoke, .scrutinizer-revoke-share[data-id="' + id + '"]' );
		$btn.prop( 'disabled', true );

		fetch( RELAY_URL + '/r/' + id, {
			method: 'DELETE',
			headers: { 'X-Revoke-Token': token }
		} )
		.then( function( resp ) {
			return resp.json();
		} )
		.then( function( data ) {
			if ( data.success ) {
				// Remove from local ledger.
				$.post( scrutinizerAdmin.ajaxUrl, {
					action:   'scrutinizer_delete_share',
					nonce:    scrutinizerAdmin.nonce,
					share_id: id
				}, function() {
					// Refresh shared reports section if visible.
					if ( $( '#scrutinizer-shared-reports-content' ).length ) {
						loadSharedReports();
					}
				} );
				$( '#scrutinizer-share-result' ).html(
					'<div class="scrutinizer-share-revoked"><span class="dashicons dashicons-yes-alt"></span> ' + __( 'Report revoked. The link will no longer work.', 'scrutinizer' ) + '</div>'
				);
			} else {
				$btn.prop( 'disabled', false );
				$( '#scrutinizer-share-result' ).append(
					// translators: %s is the error message.
					'<p class="scrutinizer-share-error">' + sprintf( __( 'Revocation failed: %s', 'scrutinizer' ), esc( data.error || __( 'Unknown error', 'scrutinizer' ) ) ) + '</p>'
				);
			}
		} )
		.catch( function() {
			$btn.prop( 'disabled', false );
		} );
	}

	/**
	 * Base64url encode a Uint8Array.
	 */
	function base64urlEncode( bytes ) {
		// Process in chunks to avoid O(n²) string concatenation OOM on large buffers.
		var CHUNK = 32768;
		var parts = [];
		for ( var i = 0; i < bytes.length; i += CHUNK ) {
			parts.push( String.fromCharCode.apply( null, bytes.subarray( i, Math.min( i + CHUNK, bytes.length ) ) ) );
		}
		return btoa( parts.join( '' ) ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );
	}

	/**
	 * Gzip compress a Uint8Array using the CompressionStream API.
	 */
	function compressGzip( data ) {
		var cs = new CompressionStream( 'gzip' );
		var writer = cs.writable.getWriter();
		writer.write( data );
		writer.close();

		var reader = cs.readable.getReader();
		var chunks = [];

		function pump() {
			return reader.read().then( function( result ) {
				if ( result.done ) {
					var totalLen = 0;
					var i;
					for ( i = 0; i < chunks.length; i++ ) {
						totalLen += chunks[ i ].length;
					}
					var out = new Uint8Array( totalLen );
					var offset = 0;
					for ( i = 0; i < chunks.length; i++ ) {
						out.set( chunks[ i ], offset );
						offset += chunks[ i ].length;
					}
					return out;
				}
				chunks.push( result.value );
				return pump();
			} );
		}
		return pump();
	}

	/**
	 * Copy text to clipboard, with fallback for older browsers.
	 */
	function copyToClipboard( text ) {
		if ( navigator.clipboard && navigator.clipboard.writeText ) {
			navigator.clipboard.writeText( text );
			return;
		}
		// Fallback: hidden textarea + execCommand.
		var $ta = $( '<textarea>' ).val( text ).css( {
			position: 'fixed',
			left: '-9999px',
			opacity: 0
		} ).appendTo( 'body' );
		$ta[0].select();
		try { document.execCommand( 'copy' ); } catch ( e ) { /* noop */ }
		$ta.remove();
	}

	// Initialize on DOM ready.
	$( init );
}( jQuery ) );
