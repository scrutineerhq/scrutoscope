/**
 * Scrutinizer Dashboard JavaScript
 *
 * Three-level drill-down: grouped routes → route profiles → single profile detail.
 * Profile detail includes: timeline visualization, breakdown bar, source table
 * with weight glyphs, query tab, role pills, and unattributed tooltip.
 *
 * @package Scrutinizer
 */

/* global jQuery, scrutinizerAdmin */
( function( $ ) {
	'use strict';

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
		administrator: { label: '🔒 admin', cls: 'role-admin' },
		editor:        { label: 'editor', cls: 'role-editor' },
		author:        { label: 'author', cls: 'role-editor' },
		contributor:   { label: 'contributor', cls: 'role-subscriber' },
		subscriber:    { label: 'subscriber', cls: 'role-subscriber' },
		customer:      { label: 'customer', cls: 'role-subscriber' },
		authenticated: { label: 'authenticated', cls: 'role-subscriber' },
		anonymous:     { label: '👤 anonymous', cls: 'role-anonymous' }
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

		$( document ).on( 'click', '#scrutinizer-home-profiles', function() {
			showProfilesView();
		} );

		$( document ).on( 'click', '#scrutinizer-home-settings', function() {
			$( '#scrutinizer-settings-modal' ).fadeIn( 150 );
			$( '.scrutinizer-gear-toggle' ).attr( 'aria-expanded', 'true' );
		} );

		// Back buttons.
		$( document ).on( 'click', '#scrutinizer-capture-back', function() {
			showHomeView();
		} );

		// Decision cards — start profiling.
		$( document ).on( 'click', '.scrutinizer-decision-card', function() {
			startProfiling( $( this ).data( 'target' ) || '', $( this ).data( 'mode' ) || '' );
		} );

		// Settings gear — open modal.
		$( document ).on( 'click', '.scrutinizer-gear-toggle', function() {
			$( '#scrutinizer-settings-modal' ).fadeIn( 150 );
			$( this ).attr( 'aria-expanded', 'true' );
		} );

		// Close settings modal.
		$( document ).on( 'click', '#scrutinizer-settings-modal-close, .scrutinizer-modal-overlay', function() {
			$( '#scrutinizer-settings-modal' ).fadeOut( 150 );
			$( '.scrutinizer-gear-toggle' ).attr( 'aria-expanded', 'false' );
		} );
		$( document ).on( 'keydown', function( e ) {
			if ( 27 === e.keyCode && $( '#scrutinizer-settings-modal' ).is( ':visible' ) ) {
				$( '#scrutinizer-settings-modal' ).fadeOut( 150 );
				$( '.scrutinizer-gear-toggle' ).attr( 'aria-expanded', 'false' );
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

			var name = window.prompt( 'Name this saved search:' );
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
				$( this ).text( 'Details' );
			} else {
				$content.slideDown( 150 );
				$( this ).text( 'Less' );
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
			if ( ! confirm( 'Delete ' + ids.length + ' profile' + ( ids.length > 1 ? 's' : '' ) + '?' ) ) {
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
					showNotice( 'Failed to delete profiles.', 'error' );
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
					showNotice( 'Failed to pin profiles.', 'error' );
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
					showNotice( 'Failed to unpin profiles.', 'error' );
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
			{ value: 0.1, label: 'light' },
			{ value: 1, label: 'moderate' },
			{ value: 10, label: 'detailed' },
			{ value: 100, label: 'every request' }
		];

		var html = '<div class="scrutinizer-bg-controls">';
		html += '<h3>Background Measurement</h3>';
		html += '<label class="scrutinizer-toggle-label">';
		html += '<input type="checkbox" id="scrutinizer-bg-toggle"' + ( scrutinizerAdmin.backgroundEnabled ? ' checked' : '' ) + '> ';
		html += 'Automatically measure requests in the background</label>';
		html += '<div class="scrutinizer-rate-control' + ( scrutinizerAdmin.backgroundEnabled ? '' : ' hidden' ) + '" id="scrutinizer-rate-group">';
		html += '<label>Capture rate</label>';
		html += '<div class="scrutinizer-rate-snaps">';
		for ( var i = 0; i < snaps.length; i++ ) {
			var snap = snaps[ i ];
			var active = ( currentRate === snap.value ) ? ' is-active' : '';
			html += '<button type="button" class="scrutinizer-rate-snap' + active + '" data-rate="' + snap.value + '">';
			html += snap.value + '%<span class="scrutinizer-rate-snap-label">' + esc( snap.label ) + '</span></button>';
		}
		html += '<span class="scrutinizer-rate-custom">or <input type="number" id="scrutinizer-custom-rate" min="0" max="100" step="0.1" value="' + currentRate + '">%</span>';
		html += '</div>';
		html += '</div>';
		html += '<p class="scrutinizer-overhead-note">Instrumentation overhead is typically 2\u20135 ms per request. Unattributed time in each profile includes this cost.</p>';
		if ( currentRate >= 50 ) {
			html += '<p class="scrutinizer-overhead-note" style="color:#d63638;font-weight:500;">\u26a0 High capture rate. Each profile generates 2\u201310 MB of trace data. Not recommended for production sites or servers with limited disk/memory.</p>';
		}
		html += '<label class="scrutinizer-toggle-label" style="margin-top:16px;">';
		html += '<input type="checkbox" id="scrutinizer-only-success"' + ( scrutinizerAdmin.onlySuccessful ? ' checked' : '' ) + '> ';
		html += 'Only capture successful requests (HTTP 200)</label>';
		html += '</div>';

		$( '#scrutinizer-controls' ).after( html );
	}

	function toggleBackground() {
		var enabled = $( '#scrutinizer-bg-toggle' ).is( ':checked' );
		var rate    = parseFloat( $( '#scrutinizer-custom-rate' ).val() ) || 10;

		if ( enabled ) {
			$( '#scrutinizer-rate-group' ).removeClass( 'hidden' );
		} else {
			$( '#scrutinizer-rate-group' ).addClass( 'hidden' );
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
		html += '<h3>Query Profiling</h3>';

		// Toggle switch.
		html += '<label class="scrutinizer-switch' + ( canToggle ? '' : ' disabled' ) + '">';
		html += '<input type="checkbox" id="scrutinizer-qp-toggle"';
		html += ( isOn ? ' checked' : '' );
		html += ( canToggle ? '' : ' disabled' );
		html += '>';
		html += '<span class="scrutinizer-switch-slider"></span>';
		html += '</label>';
		html += '</div>';

		// Status description — adapts to all three states.
		html += '<p class="scrutinizer-qp-desc">';
		if ( canToggle ) {
			html += 'Record individual SQL query timing for the density heatmap and Queries tab.';
		} else if ( isOn ) {
			html += '<span class="scrutinizer-qp-badge">wp-config.php</span> ';
			html += 'SAVEQUERIES is enabled in your configuration. Full query coverage from boot.';
		} else {
			html += '<span class="scrutinizer-qp-badge blocked">wp-config.php</span> ';
			html += 'SAVEQUERIES is set to <code>false</code> — Scrutineer can\'t override a defined constant.';
		}
		html += '</p>';

		// Progressive detail — technical users click through, everyone else ignores it.
		html += '<div class="scrutinizer-qp-detail">';
		html += '<a href="#" class="scrutinizer-qp-more">Details</a>';
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
	/*  View management                                                    */
	/* ------------------------------------------------------------------ */

	var profilesLoaded = false;

	function showHomeView() {
		$( '#scrutinizer-home' ).show();
		$( '#scrutinizer-capture-flow' ).hide();
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-top-tabs' ).hide();
		$( '#scrutinizer-detail' ).hide();
	}

	function showCaptureFlow() {
		$( '#scrutinizer-home' ).hide();
		$( '#scrutinizer-capture-flow' ).show();
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-top-tabs' ).hide();
		$( '#scrutinizer-detail' ).hide();
	}

	function showProfilesView() {
		$( '#scrutinizer-home' ).hide();
		$( '#scrutinizer-capture-flow' ).hide();
		$( '#scrutinizer-results' ).show();
		$( '#scrutinizer-detail' ).hide();

		// Lazy-load: only fetch routes + render tabs on first visit.
		if ( ! profilesLoaded ) {
			profilesLoaded = true;
			renderTopTabs();
			fetchGrouped();
		}
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
					showNotice( 'Profiling started — measuring in the new tab. Results will appear here.', 'success' );
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
		var $modal = $( '#scrutinizer-settings-modal' );
		if ( $modal.is( ':visible' ) ) {
			$modal.fadeOut( 150 );
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
		html += '<strong>URL copied to clipboard</strong>';
		html += '</div>';
		html += '<p>Open an <strong>incognito window</strong> (' + shortcut + '), paste the URL, and browse your site. Come back here and click <strong>Stop Profiling</strong> when done.</p>';
		html += '<div class="scrutinizer-url-box">';
		html += '<input type="text" readonly class="widefat" id="scrutinizer-visitor-url" value="' + esc( url ) + '" />';
		html += '<button type="button" class="button" id="scrutinizer-visitor-copy">Copy again</button>';
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
				'<strong>Profiling active</strong>' +
			'</div>' +
			'<p>Browse pages in the other tab. When done, click Stop Profiling below.</p>' +
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
					'<p class="scrutinizer-empty">Failed to load routes. Try refreshing the page.</p>'
				);
			}
		} ).fail( function( xhr ) {
			var msg = 'Could not load routes.';
			if ( xhr.status === 403 || xhr.responseText === '-1' || xhr.responseText === '0' ) {
				msg = 'Session expired. Please <a href="' + window.location.href + '">reload the page</a>.';
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
				'<h3>No measurements yet</h3>' +
				'<p>Start a profiling session to see where your server time goes, or turn on background measurement to capture requests automatically.</p>' +
				'<div class="scrutinizer-empty-actions">' +
				'<button type="button" class="button button-primary" id="scrutinizer-empty-capture">Capture Profile</button>' +
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
		html += '<label>Showing: <select id="scrutinizer-route-filter">';
		html += '<option value="2xx"' + ( '2xx' === routeFilter ? ' selected' : '' ) + '>Pages that loaded</option>';
		html += '<option value="non2xx"' + ( 'non2xx' === routeFilter ? ' selected' : '' ) + '>Other responses</option>';
		html += '<option value=""' + ( '' === routeFilter ? ' selected' : '' ) + '>All requests</option>';
		html += '</select></label>';
		html += '<input type="search" id="scrutinizer-route-search" placeholder="Search routes\u2026" value="' + esc( routeSearch ) + '" />';
		html += '</div>';

		if ( 0 === filtered.length ) {
			html += '<p class="scrutinizer-empty">No routes match the current filter.</p>';
			$list.html( html );
			return;
		}

		html += '<table class="scrutinizer-profile-table widefat">';
		html += '<thead><tr>';
		html += sortHeader( 'Route', 'route_key' );
		html += sortHeader( 'Method', 'request_method' );
		html += sortHeader( 'Requests', 'request_count' );
		html += sortHeader( 'Avg Duration', 'avg_duration_ns' );
		html += sortHeader( 'Min', 'min_duration_ns' );
		html += sortHeader( 'Max', 'max_duration_ns' );
		html += sortHeader( 'Last Captured', 'last_captured' );
		html += '<th>Type</th>';
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < filtered.length; i++ ) {
			var r = filtered[ i ];
			var avgMs = ( parseFloat( r.avg_duration_ns ) / 1e6 ).toFixed( 1 );
			var minMs = ( parseInt( r.min_duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var maxMs = ( parseInt( r.max_duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var types = typeBadges( r.profile_types || '' );
			var route = r.route_key || '(unknown)';

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
		renderGroupedTable( groupedData );
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
		html += '<button type="button" class="button button-link" id="scrutinizer-back-to-list">← Back to routes</button>';
		html += '<h2>' + esc( currentRoute ) + '</h2>';

		// Trend sparkline.
		if ( routeData && routeData.length >= 2 ) {
			html += renderSparkline( routeData );
		}

		html += '<div id="scrutinizer-route-profiles"></div>';
		html += '</div>';

		$( '#scrutinizer-results' ).after( html );
		renderRouteTable( routeData );
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
		html += '<span class="sparkline-stat"><span class="sparkline-stat-label">Latest</span> ' + latest.toFixed( 0 ) + ' ms</span>';
		html += '<span class="sparkline-stat"><span class="sparkline-stat-label">Average</span> ' + avg.toFixed( 0 ) + ' ms</span>';
		html += '<span class="sparkline-stat"><span class="sparkline-stat-label">Min</span> ' + minVal.toFixed( 0 ) + ' ms</span>';
		html += '<span class="sparkline-stat"><span class="sparkline-stat-label">Max</span> ' + maxVal.toFixed( 0 ) + ' ms</span>';
		html += '<span class="sparkline-stat ' + trendCls + '"><span class="sparkline-stat-label">Trend</span> ' + trendLabel + '</span>';
		html += '</div>';
		html += '</div>';

		return html;
	}

	function renderRouteTable( profiles ) {
		var $container = $( '#scrutinizer-route-profiles' );

		if ( ! profiles || 0 === profiles.length ) {
			$container.html( '<p class="scrutinizer-empty">No profiles for this route.</p>' );
			return;
		}

		profiles = sortRows( profiles );

		var html = '<table class="scrutinizer-profile-table widefat">';
		html += '<thead><tr>';
		html += sortHeader( scrutinizerAdmin.i18n.serverDuration, 'duration_ns' );
		html += sortHeader( 'URL', 'request_url' );
		html += sortHeader( 'Method', 'request_method' );
		html += sortHeader( 'Route', 'route_class' );
		html += '<th>Role</th>';
		html += sortHeader( 'Captured', 'captured_at' );
		html += '<th>Type</th>';
		html += '<th>Actions</th>';
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
			html += '<a href="#" class="scrutinizer-view-profile" data-profile-id="' + parseInt( p.id, 10 ) + '">View</a>';
			html += ' | ';
			html += '<a href="#" class="scrutinizer-delete-profile" data-profile-id="' + parseInt( p.id, 10 ) + '">Delete</a>';
			html += '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';

		// Pagination.
		if ( historyPages > 1 ) {
			html += '<div class="scrutinizer-pagination">';
			html += '<a href="#" id="scrutinizer-page-prev" class="button' + ( historyPage <= 1 ? ' disabled' : '' ) + '">&laquo; Previous</a>';
			html += '<span class="scrutinizer-page-info">Page ' + historyPage + ' of ' + historyPages + ' (' + historyTotal + ' profiles)</span>';
			html += '<a href="#" id="scrutinizer-page-next" class="button' + ( historyPage >= historyPages ? ' disabled' : '' ) + '">Next &raquo;</a>';
			html += '</div>';
		} else if ( historyTotal > 0 ) {
			html += '<div class="scrutinizer-pagination">';
			html += '<span class="scrutinizer-page-info">' + historyTotal + ' profile' + ( historyTotal !== 1 ? 's' : '' ) + '</span>';
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
		html += '<input type="text" id="scrutinizer-note-input" value="' + esc( profileNote ) + '" placeholder="Why did you take this measurement?" /></label>';
		html += '<label class="scrutinizer-pin-field"><span>' + esc( scrutinizerAdmin.i18n.tags || 'Tags' ) + ':</span>';
		html += '<input type="text" id="scrutinizer-tags-input" value="' + esc( profileTags ) + '" placeholder="before-update, opcache, v2.1" /></label>';
		html += '<button type="button" class="button" id="scrutinizer-share-btn" title="Share this report"><span class="dashicons dashicons-share-alt2"></span> Share</button>';
		html += '<button type="button" class="button" id="scrutinizer-export-btn" title="Download raw profile as JSON"><span class="dashicons dashicons-download"></span> Export</button>';
		html += '<button type="button" class="button" id="scrutinizer-compare-pick-btn" title="Compare with another profile"><span class="dashicons dashicons-randomize"></span> Compare</button>';
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
			html += '<div class="scrutinizer-referer">↩ triggered from <code>' + esc( request.referer ) + '</code></div>';
		}
		html += '</div>';

		// Metric cards row.
		html += '<div class="scrutinizer-metric-cards">';
		html += renderMetricCard( durMs + ' ms', scrutinizerAdmin.i18n.serverDuration, 'primary' );
		html += renderMetricCard( formatBytes( summary.memory_peak || request.memory_peak || 0 ), 'Peak Memory', 'default' );
		html += renderMetricCard( formatBytes( summary.memory_allocated || 0 ), 'Memory Used', summary.memory_allocated > 10485760 ? 'warning' : 'default' );
		html += renderMetricCard( String( queryCount ), 'DB Queries', queryCount > 100 ? 'warning' : 'default' );
		html += renderMetricCard( String( httpCount ), 'HTTP Calls', httpCount > 0 ? 'warning' : 'default' );
		html += renderMetricCard( String( summary.callback_count || 0 ), 'Callbacks', 'default' );
		html += '</div>';

		// Tab navigation.
		html += '<div class="scrutinizer-tabs">';
		html += '<button class="scrutinizer-tab active" data-tab="timeline">Timeline</button>';
		html += '<button class="scrutinizer-tab" data-tab="sources">Sources</button>';
		if ( queries.length > 0 ) {
			html += '<button class="scrutinizer-tab" data-tab="queries">Queries (' + queries.length + ')</button>';
		}
		if ( httpCalls.length > 0 ) {
			html += '<button class="scrutinizer-tab" data-tab="http">HTTP Calls (' + httpCalls.length + ')</button>';
		}
		if ( ( assets.counts && ( assets.counts.scripts + assets.counts.styles ) > 0 ) ) {
			html += '<button class="scrutinizer-tab" data-tab="assets">Assets (' + ( assets.counts.scripts + assets.counts.styles ) + ')</button>';
		}
		if ( autoloadOpts.count > 0 ) {
			html += '<button class="scrutinizer-tab" data-tab="options">Options (' + autoloadOpts.count + ')</button>';
		}
		if ( traceCount > 0 ) {
			html += '<button class="scrutinizer-tab" data-tab="trace">Trace (' + traceCount.toLocaleString() + ')</button>';
		}
		html += '<button class="scrutinizer-tab" data-tab="metadata">Metadata</button>';
		html += '</div>';

		// Tab: Timeline (lazy-loaded).
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-timeline">';
		if ( timeline.length > 0 ) {
			// Timeline was included in response (small profile or non-lightweight).
			html += renderTimeline( timeline, phaseMarkers, summary, sources, httpCalls, queries );
			timelineLoaded = true;
		} else if ( timelineCount > 0 ) {
			html += '<p class="scrutinizer-empty"><span class="spinner is-active" style="float:none;margin:0 8px 0 0;"></span>Loading timeline data...</p>';
			// Will be loaded after render — see bottom of this function.
		} else {
			html += '<p class="scrutinizer-empty">No timeline data available.</p>';
		}
		html += '</div>';

		// Tab: Sources.
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-sources" style="display:none">';
		html += renderSourceTable( sources, summary );
		html += '</div>';

		// Tab: Queries.
		if ( queries.length > 0 ) {
			html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-queries" style="display:none">';
			html += renderQueriesTable( queries );
			html += '</div>'; // query-density
			html += '</div>'; // density-wrap
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
				html += 'Loading ' + traceCount.toLocaleString() + ' callbacks\u2026';
				html += '</div>';
			}
			html += '</div>';
		}

		// Tab: Metadata.
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-metadata" style="display:none">';
		html += renderMetadata( request, summary );
		html += '</div>';

		$( '#scrutinizer-detail-content' ).html( html );

		// Init timeline interactivity if timeline was rendered inline.
		if ( timelineLoaded ) {
			initTimelineInteractivity();
		} else if ( ! timelineLoaded && currentProfileId ) {
			// Timeline is the default visible tab but wasn't included in
			// the lightweight response — load it immediately.
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
	/*  Timeline visualization                                             */
	/* ------------------------------------------------------------------ */

	function renderTimeline( timeline, phaseMarkers, summary, sources, httpCalls, queries ) {
		var durationNs = summary.duration_ns || 0;
		if ( 0 === durationNs ) {
			return '<p class="scrutinizer-empty">No timeline data available.</p>';
		}

		var html = '<div class="scrutinizer-timeline-container" data-duration-ns="' + durationNs + '">';

		// Zoom controls.
		html += '<div class="scrutinizer-zoom-controls">';
		html += '<button type="button" class="zoom-out-btn" title="Zoom out">−</button>';
		html += '<span class="zoom-level">1×</span>';
		html += '<button type="button" class="zoom-in-btn" title="Zoom in">+</button>';
		html += '<button type="button" class="zoom-reset-btn" title="Reset zoom">Reset</button>';
		html += '<span class="zoom-hint">Scroll to zoom · Drag to pan</span>';
		html += '</div>';

		// Zoomable viewport.
		html += '<div class="scrutinizer-timeline-viewport">';
		html += '<div class="scrutinizer-timeline-zoom-wrapper">';

		// Phase milestones — lollipop stems above the bar.
		var labelPositions = [];
		for ( var m = 0; m < phaseMarkers.length; m++ ) {
			var marker   = phaseMarkers[ m ];
			var markerPct = ( marker.offset_ns / durationNs ) * 100;
			if ( markerPct > 100 ) {
				markerPct = 100;
			}
			labelPositions.push( { pct: markerPct, name: marker.name } );
		}
		// Assign tiers to prevent horizontal label overlap.
		var labelTiers = [];
		for ( var li = 0; li < labelPositions.length; li++ ) {
			var tier = 0;
			for ( var lj = 0; lj < li; lj++ ) {
				if ( Math.abs( labelPositions[ li ].pct - labelPositions[ lj ].pct ) < 8 && labelTiers[ lj ] >= tier ) {
					tier = labelTiers[ lj ] + 1;
				}
			}
			labelTiers.push( tier );
		}
		var maxTier = 0;
		for ( var lt = 0; lt < labelTiers.length; lt++ ) {
			if ( labelTiers[ lt ] > maxTier ) {
				maxTier = labelTiers[ lt ];
			}
		}
		// Each tier is 32px. Base offset 20px so lowest pop clears the bar.
		var tierPx = 32;
		var baseOffset = 20;
		var milestoneHeight = ( maxTier + 1 ) * tierPx + baseOffset + 16;
		html += '<div class="scrutinizer-milestones" style="height:' + milestoneHeight + 'px">';
		for ( var lk = 0; lk < labelPositions.length; lk++ ) {
			var stemHeight = ( labelTiers[ lk ] + 1 ) * tierPx + baseOffset;
			var leftPct    = labelPositions[ lk ].pct.toFixed( 2 );
			var pctVal     = labelPositions[ lk ].pct;
			// Edge alignment: right-align near right edge, left-align near left edge.
			var edgeCls = '';
			if ( pctVal > 85 ) {
				edgeCls = ' milestone-right';
			} else if ( pctVal < 15 ) {
				edgeCls = ' milestone-left';
			}
			// Vertical stem from bottom, with dot at top and label above dot.
			html += '<div class="milestone' + edgeCls + '" style="left:' + leftPct + '%;height:' + stemHeight + 'px">';
			html += '<span class="milestone-label">' + esc( formatPhaseName( labelPositions[ lk ].name ) ) + '</span>';
			html += '<span class="milestone-dot"></span>';
			html += '<span class="milestone-stem"></span>';
			html += '</div>';
		}
		html += '</div>';

		// Timeline bar.
		html += '<div class="scrutinizer-timeline-bar">';

				// Group timeline entries by source for a cleaner view.
		var bySource = {};
		for ( var t = 0; t < timeline.length; t++ ) {
			var entry = timeline[ t ];
			var skey  = entry.type + ':' + entry.source;
			if ( ! bySource[ skey ] ) {
				bySource[ skey ] = {
					source:   entry.source,
					type:     entry.type,
					entries:  [],
					totalPct: 0
				};
			}
			bySource[ skey ].entries.push( entry );
			bySource[ skey ].totalPct += entry.pct_width;
		}

		// Render segments — each callback as an individual bar segment.
		for ( var i = 0; i < timeline.length; i++ ) {
			var seg   = timeline[ i ];
			var color = getSourceColor( seg.source, seg.type );
			// Only render segments wider than 0.05% for visibility.
			if ( seg.pct_width < 0.05 ) {
				continue;
			}
			html += '<div class="timeline-segment" style="left:' + seg.pct_start.toFixed( 3 ) + '%;width:' + Math.max( seg.pct_width, 0.15 ).toFixed( 3 ) + '%;background:' + color + '" data-callback="' + esc( seg.callback ) + '" data-source="' + esc( seg.source ) + '" data-type="' + esc( seg.type ) + '" data-wall-ns="' + seg.wall_ns + '" data-pct="' + seg.pct_width.toFixed( 2 ) + '"></div>';
		}

		// Memory usage sparkline — overlay on the timeline bar.
		var memPoints = [];
		for ( var mi = 0; mi < timeline.length; mi++ ) {
			var memVal = timeline[ mi ].mem_after || 0;
			if ( memVal > 0 ) {
				memPoints.push( { pct: timeline[ mi ].pct_start + ( timeline[ mi ].pct_width || 0 ), mem: memVal } );
			}
		}
		if ( memPoints.length >= 2 ) {
			var memMin = memPoints[ 0 ].mem;
			var memMax = memPoints[ 0 ].mem;
			for ( var mm = 1; mm < memPoints.length; mm++ ) {
				if ( memPoints[ mm ].mem < memMin ) { memMin = memPoints[ mm ].mem; }
				if ( memPoints[ mm ].mem > memMax ) { memMax = memPoints[ mm ].mem; }
			}
			var memRange = memMax - memMin;
			if ( memRange > memMax * 0.01 ) {
				var pathD = '';
				for ( var mp = 0; mp < memPoints.length; mp++ ) {
					var sx = memPoints[ mp ].pct;
					var sy = 100 - ( ( memPoints[ mp ].mem - memMin ) / memRange ) * 80 - 10;
					pathD += ( mp === 0 ? 'M' : 'L' ) + sx.toFixed( 2 ) + ',' + sy.toFixed( 1 ) + ' ';
				}
				var memLabel = formatBytes( memMax ) + ' peak';
				var memMinLabel = formatBytes( memMin );
				var memTitle = 'Memory: ' + memMinLabel + ' → ' + memLabel;
				html += '<div class="memory-overlay-wrap" data-tip="' + esc( memTitle ) + '">';
				html += '<svg class="memory-overlay-svg" viewBox="0 0 100 100" preserveAspectRatio="none">';
				// Wide invisible hit area for hover.
				html += '<path d="' + pathD + '" fill="none" stroke="transparent" stroke-width="10" vector-effect="non-scaling-stroke" class="memory-hit-area"/>';
				html += '<path d="' + pathD + '" fill="none" stroke="rgba(230,126,34,0.7)" stroke-width="2" vector-effect="non-scaling-stroke" class="memory-line"/>';
				html += '</svg>';
				html += '</div>';
				html += '<span class="memory-overlay-label">' + esc( memLabel ) + '</span>';
			}
		}

		html += '</div>'; // timeline-bar

		// Time axis.
		html += '<div class="scrutinizer-timeline-axis">';
		var tickCount = 5;
		for ( var k = 0; k <= tickCount; k++ ) {
			var tickMs  = ( ( durationNs / 1e6 ) * k / tickCount ).toFixed( 0 );
			var tickPct = ( k / tickCount ) * 100;
			var tickAlign = '';
			if ( k === 0 ) {
				tickAlign = ' style="left:0;transform:none;text-align:left"';
			} else if ( k === tickCount ) {
				tickAlign = ' style="left:100%;transform:translateX(-100%);text-align:right"';
			} else {
				tickAlign = ' style="left:' + tickPct + '%"';
			}
			html += '<span class="axis-tick"' + tickAlign + '>' + tickMs + ' ms</span>';
		}
		html += '</div>'; // timeline-axis

		// HTTP call lollipops — below the bar (inverted stems).
		if ( httpCalls && httpCalls.length > 0 ) {
			// Assign tiers to prevent horizontal overlap.
			var httpPositions = [];
			for ( var hi = 0; hi < httpCalls.length; hi++ ) {
				var hc = httpCalls[ hi ];
				var hPct = ( hc.offset_ns / durationNs ) * 100;
				if ( hPct > 100 ) {
					hPct = 100;
				}
				httpPositions.push( { pct: hPct, call: hc } );
			}
			var httpTiers = [];
			for ( var hti = 0; hti < httpPositions.length; hti++ ) {
				var hTier = 0;
				for ( var htj = 0; htj < hti; htj++ ) {
					if ( Math.abs( httpPositions[ hti ].pct - httpPositions[ htj ].pct ) < 8 && httpTiers[ htj ] >= hTier ) {
						hTier = httpTiers[ htj ] + 1;
					}
				}
				httpTiers.push( hTier );
			}
			var httpMaxTier = 0;
			for ( var hmt = 0; hmt < httpTiers.length; hmt++ ) {
				if ( httpTiers[ hmt ] > httpMaxTier ) {
					httpMaxTier = httpTiers[ hmt ];
				}
			}
			var httpTierPx = 32;
			var httpBaseOffset = 20;
			var httpHeight = ( httpMaxTier + 1 ) * httpTierPx + httpBaseOffset + 16;
			html += '<div class="scrutinizer-http-lollipops" style="height:' + httpHeight + 'px">';
			for ( var hlk = 0; hlk < httpPositions.length; hlk++ ) {
				var hStemHeight = ( httpTiers[ hlk ] + 1 ) * httpTierPx + httpBaseOffset;
				var hLeftPct    = httpPositions[ hlk ].pct.toFixed( 2 );
				var hCall       = httpPositions[ hlk ].call;
				var hDurMs      = ( hCall.duration_ms || 0 ).toFixed( 0 );
				var hHost       = '';
				try { hHost = new URL( hCall.url ).hostname; } catch( e ) { hHost = hCall.url; }
				var hStatusCls = '';
				if ( hCall.is_error ) {
					hStatusCls = ' http-error';
				} else if ( hCall.status >= 400 ) {
					hStatusCls = ' http-error';
				} else if ( hCall.status >= 300 ) {
					hStatusCls = ' http-redirect';
				}
				// Source-attributed dot color via getSourceColor, with error/redirect override.
				var hDotColor = '';
				if ( hCall.is_error || hCall.status >= 400 ) {
					hDotColor = '#c44337';
				} else if ( hCall.status >= 300 ) {
					hDotColor = '#dba617';
				} else if ( hCall.caller && hCall.caller.attribution ) {
					hDotColor = getSourceColor( hCall.caller.attribution.slug || 'unknown', hCall.caller.attribution.type || 'unknown' );
				} else {
					hDotColor = '#50575e';
				}
				var hTitle = hCall.method + ' ' + hCall.url + '\n' + hDurMs + ' ms';
				if ( hCall.status ) {
					hTitle += ' — HTTP ' + hCall.status;
				}
				if ( hCall.caller && hCall.caller.caller ) {
					hTitle += '\n' + hCall.caller.caller;
				}
				html += '<div class="http-lollipop' + hStatusCls + '" style="left:' + hLeftPct + '%;height:' + hStemHeight + 'px" title="' + esc( hTitle ) + '">';
				html += '<span class="http-stem"></span>';
				html += '<span class="http-dot" style="background:' + hDotColor + '"></span>';
				html += '<span class="http-label">' + esc( truncate( hHost, 24 ) ) + ' <em>' + hDurMs + 'ms</em></span>';
				html += '</div>';
			}
			html += '</div>';
		}

		// Query density strip — thin heatmap showing where queries cluster.
		var timelineQueries = [];
		if ( queries && queries.length > 0 ) {
			for ( var qi = 0; qi < queries.length; qi++ ) {
				if ( typeof queries[ qi ].offset_ns !== 'undefined' ) {
					timelineQueries.push( queries[ qi ] );
				}
			}
		}
		if ( timelineQueries.length > 0 ) {
			var bucketCount = 60;
			var buckets = [];
			var bucketMaxMs = [];
			for ( var bi = 0; bi < bucketCount; bi++ ) {
				buckets.push( 0 );
				bucketMaxMs.push( 0 );
			}
			for ( var tqi = 0; tqi < timelineQueries.length; tqi++ ) {
				var bIdx = Math.floor( ( timelineQueries[ tqi ].offset_ns / durationNs ) * bucketCount );
				if ( bIdx >= bucketCount ) { bIdx = bucketCount - 1; }
				if ( bIdx < 0 ) { bIdx = 0; }
				buckets[ bIdx ]++;
				var tqMs = timelineQueries[ tqi ].time_ms || 0;
				if ( tqMs > bucketMaxMs[ bIdx ] ) { bucketMaxMs[ bIdx ] = tqMs; }
			}
			var maxCount = 1;
			for ( var mc = 0; mc < buckets.length; mc++ ) {
				if ( buckets[ mc ] > maxCount ) { maxCount = buckets[ mc ]; }
			}
			html += '<div class="scrutinizer-query-density-wrap">';
			html += '<span class="scrutinizer-density-label">Queries</span>';
			html += '<div class="scrutinizer-query-density">';
			for ( var db = 0; db < bucketCount; db++ ) {
				var fillPct = ( buckets[ db ] / maxCount ) * 100;
				var barCls = 'density-none';
				if ( buckets[ db ] > 0 ) {
					barCls = 'density-normal';
					if ( bucketMaxMs[ db ] >= 5 ) { barCls = 'density-slow'; }
					else if ( bucketMaxMs[ db ] >= 1 ) { barCls = 'density-medium'; }
				}
				var dTitle = buckets[ db ] > 0 ? buckets[ db ] + ' quer' + ( buckets[ db ] === 1 ? 'y' : 'ies' ) + ', slowest ' + bucketMaxMs[ db ].toFixed( 1 ) + ' ms' : '';
				html += '<div class="density-bar ' + barCls + '" style="height:' + Math.max( fillPct, buckets[ db ] > 0 ? 20 : 0 ) + '%" title="' + esc( dTitle ) + '"></div>';
			}
			html += '</div>';
		}


		html += '</div>'; // zoom-wrapper
		html += '</div>'; // viewport

		// I/O summary counts below timeline.
		var queryCount = summary.query_count || 0;
		var httpCount  = ( httpCalls && httpCalls.length ) || 0;
		if ( queryCount > 0 || httpCount > 0 ) {
			var parts = [];
			if ( queryCount > 0 ) { parts.push( queryCount + ' quer' + ( queryCount === 1 ? 'y' : 'ies' ) ); }
			if ( httpCount > 0 )  { parts.push( httpCount + ' HTTP call' + ( httpCount === 1 ? '' : 's' ) ); }
			html += '<div class="scrutinizer-io-summary">' + parts.join( ' \u00b7 ' ) + '</div>';
		}

		// Source legend for timeline.
		html += '<div class="scrutinizer-timeline-legend">';
		var legendSources = [];
		for ( var sk in bySource ) {
			if ( bySource.hasOwnProperty( sk ) ) {
				legendSources.push( bySource[ sk ] );
			}
		}
		legendSources.sort( function( a, b ) {
			return b.totalPct - a.totalPct;
		} );
		for ( var ls = 0; ls < legendSources.length && ls < 10; ls++ ) {
			var lsrc  = legendSources[ ls ];
			var lclr  = getSourceColor( lsrc.source, lsrc.type );
			html += '<span class="legend-item">';
			html += '<span class="legend-swatch" style="background:' + lclr + '"></span>';
			html += esc( lsrc.source || lsrc.type ) + ' (' + lsrc.totalPct.toFixed( 1 ) + '%)';
			html += '</span>';
		}
		html += '</div>';

		html += '</div>'; // timeline-container

		return html;
	}

	/* ================================================================== */
	/*  Timeline Interactivity: Tooltip, Zoom, Pan                        */
	/* ================================================================== */

	var timelineZoom = 1;
	var timelinePanX = 0; // px offset
	var timelineDragging = false;
	var timelineDragStartX = 0;
	var timelineDragStartPan = 0;
	var $timelineTooltip = null;
	var rubberBanding = false;
	var rubberBandStartX = 0;
	var $rubberBand = null;

	function initTimelineInteractivity() {
		// Create persistent tooltip element if not exists.
		if ( ! $timelineTooltip || ! $timelineTooltip.length ) {
			$timelineTooltip = $( '<div class="scrutinizer-timeline-tooltip"></div>' );
			$( 'body' ).append( $timelineTooltip );
		}

		var $container = $( '.scrutinizer-timeline-container' );
		if ( ! $container.length ) {
			return;
		}

		var $viewport = $container.find( '.scrutinizer-timeline-viewport' );
		var $wrapper  = $container.find( '.scrutinizer-timeline-zoom-wrapper' );

		if ( ! $viewport.length || ! $wrapper.length ) {
			return;
		}

		// Reset state on re-init.
		timelineZoom = 1;
		timelinePanX = 0;
		applyTimelineZoom( $container, $wrapper );

		// Add rubber band element if not present.
		$rubberBand = $viewport.find( '.scrutinizer-rubber-band' );
		if ( ! $rubberBand.length ) {
			$rubberBand = $( '<div class="scrutinizer-rubber-band"></div>' );
			$viewport.append( $rubberBand );
		}

		// --- Tooltip on segment hover ---
		$viewport.off( 'mouseenter.scrtl' ).on( 'mouseenter.scrtl', '.timeline-segment', function( e ) {
			if ( rubberBanding ) { return; }
			var $seg = $( this );
			var callback = $seg.data( 'callback' ) || '';
			var source   = $seg.data( 'source' )   || 'unknown';
			var type     = $seg.data( 'type' )      || '';
			var wallNs   = parseFloat( $seg.data( 'wall-ns' ) ) || 0;
			var pct      = $seg.data( 'pct' )       || '0';
			var ms       = ( wallNs / 1e6 ).toFixed( 2 );
			var color    = getSourceColor( source, type );

			var ttHtml = '<div class="tt-callback">' + esc( callback ) + '</div>';
			ttHtml += '<div class="tt-source" style="background:' + color + ';color:#fff">' + esc( source ) + ' (' + esc( type ) + ')</div>';
			ttHtml += '<div class="tt-stats">';
			ttHtml += '<div><span class="tt-stat-label">Duration</span><br><span class="tt-stat-value">' + ms + ' ms</span></div>';
			ttHtml += '<div><span class="tt-stat-label">Share</span><br><span class="tt-stat-value">' + pct + '%</span></div>';
			ttHtml += '</div>';
			$timelineTooltip.html( ttHtml ).show();
			positionTooltip( e );
		} );

		$viewport.off( 'mousemove.scrtl' ).on( 'mousemove.scrtl', '.timeline-segment', function( e ) {
			if ( rubberBanding ) { return; }
			positionTooltip( e );
		} );

		$viewport.off( 'mouseleave.scrtl' ).on( 'mouseleave.scrtl', '.timeline-segment', function() {
			$timelineTooltip.hide();
		} );

		// --- Tooltip on density bar hover ---
		$viewport.off( 'mouseenter.scrtld' ).on( 'mouseenter.scrtld', '.density-bar', function( e ) {
			var title = $( this ).attr( 'title' );
			if ( ! title ) { return; }
			$timelineTooltip.html( '<div class="tt-callback">' + esc( title ) + '</div>' ).show();
			positionTooltip( e );
		} );

		$viewport.off( 'mousemove.scrtld' ).on( 'mousemove.scrtld', '.density-bar', function( e ) {
			positionTooltip( e );
		} );

		$viewport.off( 'mouseleave.scrtld' ).on( 'mouseleave.scrtld', '.density-bar', function() {
			$timelineTooltip.hide();
		} );

		// --- Scroll to zoom (cursor-anchored) ---
		$viewport[0].addEventListener( 'wheel', function( e ) {
			e.preventDefault();
			var rect = $viewport[0].getBoundingClientRect();
			var mouseXRatio = ( e.clientX - rect.left ) / rect.width;

			var oldZoom = timelineZoom;
			if ( e.deltaY < 0 ) {
				timelineZoom = Math.min( timelineZoom * 1.3, 40 );
			} else {
				timelineZoom = Math.max( timelineZoom / 1.3, 1 );
			}

			// Adjust pan so the point under the cursor stays fixed.
			var viewportW = rect.width;
			var oldTotalW = viewportW * oldZoom;
			var newTotalW = viewportW * timelineZoom;
			var cursorOldAbs = -timelinePanX + mouseXRatio * viewportW;
			var cursorNewAbs = ( cursorOldAbs / oldTotalW ) * newTotalW;
			timelinePanX = -( cursorNewAbs - mouseXRatio * viewportW );

			clampPan( viewportW );
			applyTimelineZoom( $container, $wrapper );
			$viewport.toggleClass( 'is-zoomed', timelineZoom > 1 );
		}, { passive: false } );

		// --- Mouse interactions: rubber band select (zoom=1) or drag to pan (zoomed) ---
		$viewport.off( 'mousedown.scrtlpan' ).on( 'mousedown.scrtlpan', function( e ) {
			if ( e.button !== 0 ) { return; }
			// Don't start rubber band if clicking on a segment (let tooltip work).
			if ( $( e.target ).hasClass( 'timeline-segment' ) ) { return; }

			e.preventDefault();
			var rect = $viewport[0].getBoundingClientRect();

			if ( timelineZoom <= 1 ) {
				// Rubber band selection.
				rubberBanding = true;
				rubberBandStartX = e.clientX - rect.left;
				$rubberBand.css( { left: rubberBandStartX + 'px', width: '0px' } ).show();
				$timelineTooltip.hide();
				$viewport.addClass( 'is-dragging' );
			} else {
				// Drag to pan when zoomed.
				timelineDragging = true;
				timelineDragStartX = e.clientX;
				timelineDragStartPan = timelinePanX;
				$viewport.addClass( 'is-dragging' );
			}
		} );

		$( document ).off( 'mousemove.scrtlpan' ).on( 'mousemove.scrtlpan', function( e ) {
			if ( rubberBanding ) {
				var rect = $viewport[0].getBoundingClientRect();
				var currentX = Math.max( 0, Math.min( e.clientX - rect.left, rect.width ) );
				var left  = Math.min( rubberBandStartX, currentX );
				var width = Math.abs( currentX - rubberBandStartX );
				$rubberBand.css( { left: left + 'px', width: width + 'px' } );
				return;
			}
			if ( ! timelineDragging ) { return; }
			var dx = e.clientX - timelineDragStartX;
			timelinePanX = timelineDragStartPan + dx;
			var viewportW = $viewport[0].getBoundingClientRect().width;
			clampPan( viewportW );
			applyTimelineZoom( $container, $wrapper );
		} );

		$( document ).off( 'mouseup.scrtlpan' ).on( 'mouseup.scrtlpan', function( e ) {
			if ( rubberBanding ) {
				rubberBanding = false;
				$rubberBand.hide();
				$viewport.removeClass( 'is-dragging' );

				var rect  = $viewport[0].getBoundingClientRect();
				var endX  = Math.max( 0, Math.min( e.clientX - rect.left, rect.width ) );
				var left  = Math.min( rubberBandStartX, endX );
				var width = Math.abs( endX - rubberBandStartX );

				// Minimum drag of 10px to avoid accidental micro-selections.
				if ( width < 10 ) { return; }

				var viewportW = rect.width;
				var selStartPct = left / viewportW;
				var selEndPct   = ( left + width ) / viewportW;
				var selWidthPct = selEndPct - selStartPct;

				// Calculate zoom to fill viewport with selection.
				timelineZoom = Math.min( 1 / selWidthPct, 40 );
				// Pan so the selection's left edge aligns with viewport left.
				timelinePanX = -selStartPct * viewportW * timelineZoom;

				clampPan( viewportW );
				applyTimelineZoom( $container, $wrapper );
				$viewport.toggleClass( 'is-zoomed', timelineZoom > 1 );
				return;
			}
			if ( timelineDragging ) {
				timelineDragging = false;
				$viewport.removeClass( 'is-dragging' );
			}
		} );

		// --- Zoom control buttons ---
		$container.find( '.zoom-in-btn' ).off( 'click' ).on( 'click', function() {
			timelineZoom = Math.min( timelineZoom * 1.5, 40 );
			var viewportW = $viewport[0].getBoundingClientRect().width;
			clampPan( viewportW );
			applyTimelineZoom( $container, $wrapper );
			$viewport.toggleClass( 'is-zoomed', timelineZoom > 1 );
		} );

		$container.find( '.zoom-out-btn' ).off( 'click' ).on( 'click', function() {
			timelineZoom = Math.max( timelineZoom / 1.5, 1 );
			var viewportW = $viewport[0].getBoundingClientRect().width;
			clampPan( viewportW );
			applyTimelineZoom( $container, $wrapper );
			$viewport.toggleClass( 'is-zoomed', timelineZoom > 1 );
		} );

		$container.find( '.zoom-reset-btn' ).off( 'click' ).on( 'click', function() {
			timelineZoom = 1;
			timelinePanX = 0;
			applyTimelineZoom( $container, $wrapper );
			$viewport.removeClass( 'is-zoomed' );
		} );

		// Double-click to reset zoom.
		$viewport.off( 'dblclick.scrtl' ).on( 'dblclick.scrtl', function() {
			if ( timelineZoom > 1 ) {
				timelineZoom = 1;
				timelinePanX = 0;
				applyTimelineZoom( $container, $wrapper );
				$viewport.removeClass( 'is-zoomed' );
			}
		} );
	}

	function clampPan( viewportW ) {
		var totalW = viewportW * timelineZoom;
		var maxPan = 0;
		var minPan = -( totalW - viewportW );
		if ( timelinePanX > maxPan ) { timelinePanX = maxPan; }
		if ( timelinePanX < minPan ) { timelinePanX = minPan; }
		if ( timelineZoom <= 1 ) { timelinePanX = 0; }
	}

	function applyTimelineZoom( $container, $wrapper ) {
		$wrapper.css( 'transform', 'scaleX(' + timelineZoom + ') translateX(' + ( timelinePanX / timelineZoom ) + 'px)' );

		// Counter-scale text inside the wrapper so it stays readable.
		var invScale = 1 / timelineZoom;
		$wrapper.find( '.milestone' ).not( '.milestone-left, .milestone-right' ).css( 'transform', 'translateX(-50%) scaleX(' + invScale + ')' );
		$wrapper.find( '.milestone.milestone-left, .milestone.milestone-right' ).css( 'transform', 'scaleX(' + invScale + ')' );
		$wrapper.find( '.http-lollipop' ).css( 'transform', 'translateX(-50%) scaleX(' + invScale + ')' );

		// Counter-scale query density strip so bars don't stretch.
		$wrapper.find( '.scrutinizer-query-density' ).css( 'transform', 'scaleX(' + invScale + ')' );
		$wrapper.find( '.scrutinizer-density-label' ).css( 'transform', 'scaleX(' + invScale + ')' );

		// Counter-scale memory sparkline.
		$wrapper.find( '.scrutinizer-memory-sparkline' ).css( 'transform', 'scaleX(' + invScale + ')' );

		// Update zoom label.
		var label = timelineZoom <= 1 ? '1\u00d7' : timelineZoom.toFixed( 1 ) + '\u00d7';
		$container.find( '.zoom-level' ).text( label );

		// Toggle cursor.
		var $viewport = $container.find( '.scrutinizer-timeline-viewport' );
		if ( ! timelineDragging ) {
			$viewport.css( 'cursor', timelineZoom > 1 ? 'grab' : '' );
		}

		// Show/hide zoom hint vs reset.
		if ( timelineZoom > 1 ) {
			$container.find( '.zoom-hint' ).text( 'Drag to pan \u00b7 Scroll to zoom' );
		} else {
			$container.find( '.zoom-hint' ).text( 'Scroll to zoom \u00b7 Drag to pan' );
		}

		// Regenerate axis ticks for visible range.
		updateTimelineAxis( $container, $wrapper );
	}

	function updateTimelineAxis( $container, $wrapper ) {
		var $axis = $wrapper.find( '.scrutinizer-timeline-axis' );
		if ( ! $axis.length ) {
			return;
		}
		var durationNs = parseInt( $container.data( 'duration-ns' ), 10 ) || 0;
		if ( ! durationNs ) {
			return;
		}
		var durationMs = durationNs / 1e6;

		// When zoomed, the scaleX transform stretches everything.
		// Axis ticks at original %positions are correct in the scaled coordinate space.
		// But we want more tick density when zoomed.
		var tickCount = Math.min( Math.max( Math.round( 5 * timelineZoom ), 5 ), 20 );
		var tickHtml = '';
		for ( var k = 0; k <= tickCount; k++ ) {
			var tickMs  = ( durationMs * k / tickCount ).toFixed( 0 );
			var tickPct = ( k / tickCount ) * 100;
			// Counter-scale the text so it stays readable when parent is scaleX-ed.
			var tickTransform;
			if ( k === 0 ) {
				tickTransform = 'scaleX(' + ( 1 / timelineZoom ) + ')';
			} else if ( k === tickCount ) {
				tickTransform = 'translateX(-100%) scaleX(' + ( 1 / timelineZoom ) + ')';
			} else {
				tickTransform = 'translateX(-50%) scaleX(' + ( 1 / timelineZoom ) + ')';
			}
			tickHtml += '<span class="axis-tick" style="left:' + tickPct + '%;transform:' + tickTransform + '">' + tickMs + ' ms</span>';
		}
		$axis.html( tickHtml );
	}

	function positionTooltip( e ) {
		if ( ! $timelineTooltip ) {
			return;
		}
		var ttW = $timelineTooltip.outerWidth();
		var ttH = $timelineTooltip.outerHeight();
		var x = e.clientX + 12;
		var y = e.clientY - ttH - 8;

		// Keep on screen.
		if ( x + ttW > window.innerWidth - 8 ) {
			x = e.clientX - ttW - 12;
		}
		if ( y < 8 ) {
			y = e.clientY + 16;
		}
		$timelineTooltip.css( { left: x + 'px', top: y + 'px' } );
	}

	function formatPhaseName( name ) {
		var short = {
			muplugins_loaded:      'mu-plugins',
			plugins_loaded:        'plugins loaded',
			setup_theme:           'theme setup',
			after_setup_theme:     'after theme',
			init:                  'init',
			widgets_init:          'widgets',
			wp_loaded:             'wp_loaded',
			parse_request:         'parse request',
			wp:                    'main query',
			template_redirect:     'template',
			get_header:            'header',
			wp_head:               'wp_head',
			wp_enqueue_scripts:    'enqueue',
			the_post:              'the_post',
			loop_start:            'loop start',
			loop_end:              'loop end',
			get_footer:            'footer',
			wp_footer:             'wp_footer',
			wp_print_footer_scripts: 'footer scripts',
			admin_init:            'admin init',
			admin_menu:            'admin menu',
			admin_enqueue_scripts: 'admin enqueue',
			shutdown:              'shutdown'
		};
		return short[ name ] || name.replace( /_/g, ' ' );
	}

	/* ------------------------------------------------------------------ */
	/*  Source table with weight glyphs                                     */
	/* ------------------------------------------------------------------ */

	function renderSourceTable( sources, summary ) {
		if ( ! sources || 0 === sources.length ) {
			return '<p class="scrutinizer-empty">No source data.</p>';
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
				html += '<div class="segment" style="width:' + unPct.toFixed( 2 ) + '%;background:#dcdcde" title="Unattributed + Bootstrap: ' + ( accountedNs / 1e6 ).toFixed( 1 ) + ' ms (' + unPct.toFixed( 1 ) + '%)"></div>';
			}
		}
		html += '</div>';

		html += '<p class="scrutinizer-tab-subtitle">Each plugin and theme\u2019s contribution to server request duration, sorted by the time spent in their own callbacks.</p>';
		html += '<table class="scrutinizer-source-table widefat">';
		html += '<thead><tr>';
		html += '<th>Source</th>';
		html += '<th>Type</th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.exclusiveTime + ' <button type="button" class="scrutinizer-info-toggle" aria-label="What is exclusive time?">ⓘ</button><span class="scrutinizer-info-bubble">Time spent directly in this source\u2019s own callbacks, excluding time in callbacks it triggers from other sources. This is the most useful number for identifying what\u2019s slow.</span></th>';
		html += '<th class="numeric">Weight</th>';
		html += '<th class="numeric">Memory <button type="button" class="scrutinizer-info-toggle" aria-label="What is memory?">ⓘ</button><span class="scrutinizer-info-bubble">Net heap change measured during this source\u2019s callbacks (memory_get_usage delta). Positive = allocated, negative = freed. Reflects what happened during execution, not total responsibility.</span></th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.inclusiveTime + ' <button type="button" class="scrutinizer-info-toggle" aria-label="What is inclusive time?">ⓘ</button><span class="scrutinizer-info-bubble">Total time spent in this source\u2019s callbacks including any nested callbacks from other sources that it triggers.</span></th>';
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
				html += '<summary>' + esc( src.name || src.slug ) + ' <span class="scrutinizer-muted">(' + src.callbacks.length + ' callback' + ( src.callbacks.length !== 1 ? 's' : '' ) + ')</span></summary>';
				html += '<div class="scrutinizer-unknown-detail">';
				for ( var u = 0; u < src.callbacks.length; u++ ) {
					var cb = src.callbacks[ u ];
					var cbMs = cb.exclusive_ns ? ( cb.exclusive_ns / 1e6 ).toFixed( 2 ) + ' ms' : '';
					var cbCalls = cb.call_count ? cb.call_count + ' call' + ( cb.call_count !== 1 ? 's' : '' ) : '';
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
	/*  Queries table                                                      */
	/* ------------------------------------------------------------------ */

	function renderQueriesTable( queries ) {
		if ( ! queries || 0 === queries.length ) {
			var qp = scrutinizerAdmin.queryProfiling;
			var msg = 'No query data captured for this profile.';
			if ( qp.managed && ! qp.active ) {
				msg = 'Query profiling is off. Enable the toggle above, then capture a new profile.';
			} else if ( ! qp.managed && ! qp.active ) {
				msg = 'SAVEQUERIES is disabled in wp-config.php. Enable it to capture query timing.';
			} else {
				msg = 'No query data — this profile was captured before query profiling was enabled.';
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
		html += '<strong>' + queries.length + ' queries</strong> totaling <strong>' + totalQueryMs.toFixed( 1 ) + ' ms</strong>';
		if ( duplicateCount > 0 ) {
			html += ' \u00b7 <span class="scrutinizer-duplicate-flag">' + duplicateCount + ' duplicate pattern' + ( duplicateCount !== 1 ? 's' : '' ) + '</span>';
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
		html += '<button type="button" class="scrutinizer-toggle-btn active" data-view="grouped">Grouped</button>';
		html += '<button type="button" class="scrutinizer-toggle-btn" data-view="individual">Individual</button>';
		html += '</div>';

		html += '</div>'; // queries-header

		// Active filter indicator (hidden by default).
		html += '<div class="scrutinizer-query-filter-bar" style="display:none">';
		html += 'Showing queries from <strong class="scrutinizer-filter-source-name"></strong> ';
		html += '<button type="button" class="scrutinizer-clear-filter">\u2715 Clear</button>';
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
		html += '<th>SQL Pattern</th>';
		html += '<th class="numeric">Count</th>';
		html += '<th class="numeric">Total Time</th>';
		html += '<th class="numeric">Avg</th>';
		html += '<th>Sources</th>';
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
			html += '<code class="scrutinizer-sql-expandable" title="Click to expand">' + esc( truncate( grp.sql, 200 ) ) + '</code>';
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
				html += '<table class="scrutinizer-group-detail-table"><thead><tr><th class="numeric">#</th><th>Source</th><th class="numeric">Time</th><th>Caller</th></tr></thead><tbody>';
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
		html += sortableHeader( 'queries', 'source_name', 'Source', 'string' );
		html += sortableHeader( 'queries', 'sql', 'SQL', 'string' );
		html += sortableHeader( 'queries', 'time_ms', 'Time', 'number' );
		html += sortableHeader( 'queries', 'caller', 'Caller', 'string' );
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
			html += '<td>' + ( qSource || '<span class="scrutinizer-muted">\u2014</span>' ) + '</td>';

			// Click-to-expand SQL.
			html += '<td class="scrutinizer-sql-cell">';
			html += '<code class="scrutinizer-sql-expandable" title="Click to expand">' + esc( truncate( qr.sql || '', 200 ) ) + '</code>';
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
			return '<p class="scrutinizer-empty">No external HTTP calls detected.</p>';
		}

		// Compute total HTTP time.
		var totalHttpMs = 0;
		for ( var h = 0; h < httpCalls.length; h++ ) {
			totalHttpMs += httpCalls[ h ].duration_ms || 0;
		}

		var html = '<div class="scrutinizer-queries-summary">';
		html += '<strong>' + httpCalls.length + ' external HTTP call' + ( httpCalls.length !== 1 ? 's' : '' ) + '</strong>';
		html += ' totaling <strong>' + totalHttpMs.toFixed( 1 ) + ' ms</strong>';
		html += '</div>';

		html += renderHttpCallsTableBody( httpCalls );
		return html;
	}

	function renderHttpCallsTableBody( httpCalls ) {
		var html = '<table class="scrutinizer-source-table scrutinizer-http-table widefat">';
		html += '<thead><tr>';
		html += '<th class="numeric">#</th>';
		html += sortableHeader( 'httpcalls', 'method', 'Method', 'string' );
		html += sortableHeader( 'httpcalls', 'url', 'URL', 'string' );
		html += sortableHeader( 'httpcalls', 'status', 'Status', 'number' );
		html += sortableHeader( 'httpcalls', 'duration_ms', 'Duration', 'number' );
		html += sortableHeader( 'httpcalls', 'source_name', 'Source', 'string' );
		html += sortableHeader( 'httpcalls', 'caller_str', 'Caller', 'string' );
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < httpCalls.length; i++ ) {
			var hc   = httpCalls[ i ];
			var hMs  = ( hc.duration_ms || 0 ).toFixed( 1 );
			var slow = hc.duration_ms > 500 ? ' class="scrutinizer-slow-query"' : '';
			var statusLabel = hc.is_error ? 'Error' : String( hc.status || '—' );
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
		html += '<strong>' + ( counts.scripts || 0 ) + ' scripts</strong>';
		html += ' + <strong>' + ( counts.styles || 0 ) + ' stylesheets</strong>';
		if ( totalSize > 0 ) {
			html += ' totaling <strong>' + formatBytes( totalSize ) + '</strong> on disk';
		}
		html += '</div>';

		if ( scripts.length > 0 ) {
			html += '<h4 class="scrutinizer-asset-section-label">Scripts</h4>';
			html += renderAssetTableBody( scripts, 'scripts' );
		}
		if ( styles.length > 0 ) {
			html += '<h4 class="scrutinizer-asset-section-label">Stylesheets</h4>';
			html += renderAssetTableBody( styles, 'styles' );
		}

		return html;
	}

	function renderAssetTableBody( assetList, assetType ) {
		var tableId = 'assets-' + assetType;
		var html = '<table class="scrutinizer-source-table scrutinizer-asset-table scrutinizer-asset-table-' + assetType + ' widefat">';
		html += '<thead><tr>';
		html += sortableHeader( tableId, 'handle', 'Handle', 'string' );
		html += sortableHeader( tableId, 'src', 'Source', 'string' );
		html += sortableHeader( tableId, 'size', 'Size', 'number' );
		html += sortableHeader( tableId, 'location', 'Location', 'string' );
		html += '<th>Dependencies</th>';
		html += sortableHeader( tableId, 'version', 'Version', 'string' );
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < assetList.length; i++ ) {
			var a      = assetList[ i ];
			var attr   = a.attribution || {};
			var srcUrl = a.src || '';
			// Show just the path portion, truncated.
			var srcDisplay = srcUrl.replace( /^https?:\/\/[^\/]+/, '' );

			var sourcePill = '';
			if ( attr.type && 'unknown' !== attr.type ) {
				var pillColor = sourceColors[ attr.type ] || '#888';
				sourcePill = '<span class="scrutinizer-asset-source-pill" style="background:' + pillColor + '">'
					+ esc( attr.name || attr.slug ) + '</span> ';
			}

			var sizeCell = a.size > 0 ? formatBytes( a.size ) : '<span class="scrutinizer-muted">external</span>';
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
			return '<p class="scrutinizer-empty">No autoloaded options data.</p>';
		}

		var html = '<div class="scrutinizer-queries-summary">';
		html += '<strong>' + count + ' autoloaded option' + ( count !== 1 ? 's' : '' ) + '</strong>';
		html += ' totaling <strong>' + formatBytes( totalSize ) + '</strong>';
		if ( totalSize > 1048576 ) { // > 1 MB.
			html += ' <span class="scrutinizer-options-warning">⚠ Over 1 MB — this adds latency to every request</span>';
		} else if ( totalSize > 524288 ) { // > 512 KB.
			html += ' <span class="scrutinizer-options-caution">⚡ Over 512 KB — worth reviewing</span>';
		}
		html += '</div>';

		html += '<table class="scrutinizer-source-table scrutinizer-options-table widefat">';
		html += '<thead><tr>';
		html += '<th class="numeric">#</th>';
		html += '<th>Option Name</th>';
		html += '<th class="numeric">Size</th>';
		html += '<th class="numeric">% of Total</th>';
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
		html += '<tr><td>Route</td><td>' + esc( request.route_class || '—' ) + '</td></tr>';
		if ( request.ajax_action ) {
			html += '<tr><td>AJAX Action</td><td><code>' + esc( request.ajax_action ) + '</code></td></tr>';
		}
		if ( request.referer ) {
			html += '<tr><td>Referer</td><td><code>' + esc( request.referer ) + '</code></td></tr>';
		}
		html += '<tr><td>User Role</td><td>' + rolePill( request.user_role ) + '</td></tr>';
		html += '<tr><td>PHP</td><td>' + esc( request.php_version || '—' ) + '</td></tr>';
		html += '<tr><td>WordPress</td><td>' + esc( request.wp_version || '—' ) + '</td></tr>';
		html += '<tr><td>Scrutinizer</td><td>' + esc( scrutinizerAdmin.version || '—' ) + '</td></tr>';
		html += '<tr><td>Peak Memory</td><td>' + formatBytes( memPeak ) + '</td></tr>';
		html += '<tr><td>Memory Used</td><td>' + formatBytes( memAlloc ) + '</td></tr>';
		html += '<tr><td>DB Queries</td><td>' + ( summary.query_count || 0 ) + '</td></tr>';
		html += '<tr><td>HTTP Calls</td><td>' + ( summary.http_call_count || 0 ) + ( summary.http_total_ms > 0 ? ' (' + summary.http_total_ms + ' ms total)' : '' ) + '</td></tr>';
		html += '<tr><td>Callbacks Observed</td><td>' + ( summary.callback_count || 0 ) + '</td></tr>';
		html += '<tr><td>Sources Identified</td><td>' + ( summary.source_count || 0 ) + '</td></tr>';
		if ( summary.asset_count ) {
			html += '<tr><td>Enqueued Assets</td><td>' + summary.asset_count + ( summary.asset_total_size ? ' (' + formatBytes( summary.asset_total_size ) + ')' : '' ) + '</td></tr>';
		}
		html += '</tbody></table>';
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
					'<p class="scrutinizer-empty">Failed to load trace data.</p>'
				);
			}
		} ).fail( function() {
			$( '#scrutinizer-tab-trace' ).html(
				'<p class="scrutinizer-empty">Failed to load trace data.</p>'
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
				$( '#scrutinizer-tab-timeline' ).html(
					renderTimeline(
						timelineData,
						phaseMarkers,
						profileData.summary || {},
						profileData.sources || [],
						profileData.http_calls || [],
						profileData.queries || []
					)
				);
				initTimelineInteractivity();
			} else {
				$( '#scrutinizer-tab-timeline' ).html(
					'<p class="scrutinizer-empty">Failed to load timeline data.</p>'
				);
			}
		} ).fail( function() {
			$( '#scrutinizer-tab-timeline' ).html(
				'<p class="scrutinizer-empty">Failed to load timeline data.</p>'
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
		html += '<input type="search" id="scrutinizer-trace-search" placeholder="Search callbacks, hooks, sources\u2026" class="scrutinizer-trace-search-input" />';
		html += '</div>';

		// Built-in pills.
		html += '<div class="scrutinizer-trace-pills">';
		html += '<button type="button" class="scrutinizer-trace-pill" data-pill="top-10">Top 10 Slowest</button>';
		html += '<button type="button" class="scrutinizer-trace-pill" data-pill="db-heavy">DB Heavy (&gt;10)</button>';
		html += '<button type="button" class="scrutinizer-trace-pill" data-pill="http-calls">HTTP Calls</button>';

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
			html += '<button type="button" class="scrutinizer-trace-pill" data-pill="ajax">AJAX</button>';
		}
		if ( hasCheckout ) {
			html += '<button type="button" class="scrutinizer-trace-pill" data-pill="checkout">Checkout</button>';
		}
		if ( hasAuth ) {
			html += '<button type="button" class="scrutinizer-trace-pill" data-pill="login">Login/Auth</button>';
		}
		if ( hasMemHeavy ) {
			html += '<button type="button" class="scrutinizer-trace-pill" data-pill="mem-heavy">Memory Heavy</button>';
		}

		// Saved searches placeholder.
		html += '<span id="scrutinizer-trace-saved-pills"></span>';
		html += '<button type="button" class="scrutinizer-trace-pill scrutinizer-trace-save" id="scrutinizer-trace-save-search" title="Save current filters as a pill">+ Save</button>';
		html += '</div>';

		// Filter controls.
		html += '<div class="scrutinizer-trace-filters">';
		html += '<label>Source <select id="scrutinizer-trace-source">';
		html += '<option value="">All</option>';
		html += '<option value="plugin">Plugin</option>';
		html += '<option value="theme">Theme</option>';
		html += '<option value="core">Core</option>';
		html += '<option value="mu-plugin">MU-Plugin</option>';
		html += '<option value="unknown">Unknown</option>';
		html += '</select></label>';
		html += '<label>Duration &gt; <input type="number" id="scrutinizer-trace-min-duration" min="0" step="0.1" style="width:70px" /> ms</label>';
		html += '<label>Queries &gt; <input type="number" id="scrutinizer-trace-min-queries" min="0" step="1" style="width:60px" /></label>';
		html += '<button type="button" class="button-link" id="scrutinizer-trace-clear">Clear filters</button>';
		html += '</div>';

		// Status bar.
		html += '<div class="scrutinizer-trace-status" id="scrutinizer-trace-status"></div>';

		// Table.
		html += '<table class="scrutinizer-trace-table widefat striped">';
		html += '<thead><tr>';
		html += '<th class="scrutinizer-trace-sortable' + ( 'exclusive_ns' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="exclusive_ns" style="width:90px">Duration</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( '_callback' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="_callback">Callback</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( '_hook' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="_hook">Hook</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( 'source_name' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="source_name" style="width:120px">Source</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( 'query_count' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="query_count" style="width:60px">Qry</th>';
		html += '<th class="scrutinizer-trace-sortable' + ( 'http_count' === traceSortKey ? ( ' sort-' + traceSortDir ) : '' ) + '" data-sort-key="http_count" style="width:60px">HTTP</th>';
		html += '</tr></thead>';
		html += '<tbody id="scrutinizer-trace-tbody"></tbody>';
		html += '</table>';

		// Show more button.
		html += '<div class="scrutinizer-trace-more" id="scrutinizer-trace-more-wrap" style="display:none">';
		html += '<button type="button" class="button" id="scrutinizer-trace-show-more">Show 200 more</button>';
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
		var statusText = 'Showing ' + showing.toLocaleString() + ' of ' + traceFiltered.length.toLocaleString() + ' callbacks';
		if ( traceFiltered.length !== traceEntries.length ) {
			statusText += ' (filtered from ' + traceEntries.length.toLocaleString() + ')';
		}
		if ( filterCount > 0 ) {
			statusText += ' \u00b7 ' + filterCount + ' filter' + ( filterCount !== 1 ? 's' : '' ) + ' active';
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
			html += ' <span class="scrutinizer-pill-remove" title="Remove">\u00d7</span>';
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
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-route-detail' ).hide();
		$( '#scrutinizer-history-view' ).hide();
		$( '#scrutinizer-compare-view' ).remove();
		$( '#scrutinizer-activation' ).hide();
		$( '#scrutinizer-detail' ).show();

		// Adjust back button based on where we came from.
		var $back = $( '#scrutinizer-detail .button-link' ).first();
		if ( 'history' === activeTopTab ) {
			$back.attr( 'id', 'scrutinizer-back-to-history' ).text( scrutinizerAdmin.i18n.backToHistory || '← Back to history' );
		} else if ( currentRoute ) {
			$back.attr( 'id', 'scrutinizer-back-to-route' ).text( '← Back to ' + truncate( currentRoute, 40 ) );
		} else {
			$back.attr( 'id', 'scrutinizer-back-to-list' ).text( '← Back to routes' );
		}
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

			// Numeric comparison for anything that looks like a number.
			var na = parseFloat( va );
			var nb = parseFloat( vb );
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
		html += '<option value="frontend">Frontend</option>';
		html += '<option value="wp-admin">Admin</option>';
		html += '<option value="admin-ajax">AJAX</option>';
		html += '<option value="rest-api">REST API</option>';
		html += '<option value="cron">Cron</option>';
		html += '</select>';

		// Tag filter.
		html += '<input type="text" id="scrutinizer-history-tag" placeholder="' + esc( scrutinizerAdmin.i18n.filterByTag || 'Filter by tag…' ) + '" />';

		// Pinned only.
		html += '<label class="scrutinizer-history-check-label">';
		html += '<input type="checkbox" id="scrutinizer-history-pinned" /> ';
		html += '<span class="dashicons dashicons-sticky"></span> ' + esc( scrutinizerAdmin.i18n.pinned || 'Pinned' );
		html += '</label>';

		// Date range.
		html += '<input type="date" id="scrutinizer-history-from" title="From date" />';
		html += '<span class="scrutinizer-history-dash">–</span>';
		html += '<input type="date" id="scrutinizer-history-to" title="To date" />';

		// Bulk action bar (hidden until selections made).
		html += '<div class="scrutinizer-bulk-bar" id="scrutinizer-bulk-bar" style="display:none">';
		html += '<span id="scrutinizer-bulk-count">0 selected</span>';
		html += '<button type="button" class="button" id="scrutinizer-bulk-pin" title="Pin selected profiles"><span class="dashicons dashicons-sticky"></span> Pin</button>';
		html += '<button type="button" class="button" id="scrutinizer-bulk-unpin" title="Unpin selected profiles">Unpin</button>';
		html += '<button type="button" class="button" id="scrutinizer-bulk-delete" title="Delete selected profiles">🗑 Delete</button>';
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
		html += '<th class="scrutinizer-check-col"><input type="checkbox" id="scrutinizer-select-all" title="Select all" /></th>';
		html += sortHeader( 'Captured', 'captured_at' );
		html += sortHeader( 'Route', 'route_key' );
		html += sortHeader( 'Duration', 'duration_ns', 'numeric' );
		html += '<th><span class="dashicons dashicons-sticky" title="Pinned"></span></th>';
		html += '<th>Note</th>';
		html += '<th>Tags</th>';
		html += '<th>Actions</th>';
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < sorted.length; i++ ) {
			var p     = sorted[ i ];
			var durMs = ( parseInt( p.duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var pinIcon = parseInt( p.is_pinned, 10 ) === 1 ? '<span class="dashicons dashicons-sticky"></span>' : '';
			var notePrev = truncate( p.note || '', 40 );
			var tagPills = renderTagPills( p.tags || '' );
			var checked  = compareChecked[ p.id ] ? ' checked' : '';

			html += '<tr>';
			html += '<td><input type="checkbox" class="scrutinizer-compare-check" data-profile-id="' + parseInt( p.id, 10 ) + '"' + checked + ' /></td>';
			html += '<td>' + esc( p.captured_at ) + '</td>';
			html += '<td class="scrutinizer-route-cell" title="' + esc( p.route_key ) + '">' + esc( truncate( p.route_key || '', 40 ) ) + '</td>';
			html += '<td class="scrutinizer-duration numeric">' + esc( durMs ) + ' ms</td>';
			html += '<td>' + pinIcon + '</td>';
			html += '<td title="' + esc( p.note || '' ) + '">' + esc( notePrev ) + '</td>';
			html += '<td>' + tagPills + '</td>';
			html += '<td class="scrutinizer-actions">';
			html += '<a href="#" class="scrutinizer-view-profile" data-profile-id="' + parseInt( p.id, 10 ) + '">View</a>';
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
			$( '#scrutinizer-bulk-count' ).text( count + ' selected' );
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
			$history.html( '<p class="scrutinizer-empty">Loading cron inventory…</p>' );
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
					'<p class="scrutinizer-empty">' + esc( response.data.message || 'Failed to load cron data.' ) + '</p>'
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
		html += renderMetricCard( String( summary.total || 0 ), 'Events', 'default' );
		html += renderMetricCard( String( summary.recurring || 0 ), 'Recurring', 'default' );
		html += renderMetricCard( String( summary.one_shot || 0 ), 'One-Shot', 'default' );
		html += renderMetricCard( String( summary.overdue || 0 ), 'Overdue', summary.overdue > 0 ? 'warning' : 'default' );
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
			html += '<h4>By Source</h4>';
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
		html += sortHeader( 'Hook', 'hook' );
		html += sortHeader( 'Next Run', 'timestamp' );
		html += '<th>Schedule</th>';
		html += '<th>Source</th>';
		html += '<th>Status</th>';
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
				html += ' <span class="scrutinizer-muted">(' + ev.args.length + ' arg' + ( ev.args.length > 1 ? 's' : '' ) + ')</span>';
			}
			html += '</td>';

			// Next run.
			html += '<td>' + formatCronTime( ev.timestamp, ev.overdue, ev.overdue_by ) + '</td>';

			// Schedule.
			html += '<td>';
			if ( 'once' === ev.schedule ) {
				html += '<span class="scrutinizer-muted">one-shot</span>';
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
				html += '<span class="scrutinizer-cron-status-overdue">overdue</span>';
			} else {
				html += '<span class="scrutinizer-cron-status-ok">scheduled</span>';
			}
			html += '</td>';

			html += '</tr>';
		}

		html += '</tbody></table>';

		// Available schedules.
		if ( schedules.length > 0 ) {
			html += '<details class="scrutinizer-cron-schedules">';
			html += '<summary>Registered Schedules (' + schedules.length + ')</summary>';
			html += '<table class="scrutinizer-profile-table scrutinizer-cron-schedule-table widefat"><thead><tr><th>Name</th><th>Interval</th><th>Display</th></tr></thead><tbody>';
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
		html += '<button class="button" id="scrutinizer-cron-refresh">↻ Refresh</button>';
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
			html += '<span class="scrutinizer-cron-status-overdue">' + humanInterval( overdueBy ) + ' ago</span>';
		} else {
			html += 'in ' + humanInterval( Math.abs( diff ) );
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
		html += '<h4>Compare with&hellip;</h4>';
		html += '<button type="button" class="button button-link scrutinizer-picker-close" title="Close">&times;</button>';
		html += '</div>';
		html += '<div class="scrutinizer-picker-body"><p class="description">Loading pinned profiles&hellip;</p></div>';
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
				$( '.scrutinizer-picker-body' ).html( '<p class="description">No targets found.</p>' );
				return;
			}

			var routeMatches = response.data.route_matches || [];
			var otherPinned  = response.data.other_pinned || [];
			var body = '';

			if ( 0 === routeMatches.length && 0 === otherPinned.length ) {
				body = '<p class="description">No pinned profiles to compare with. Pin some profiles first.</p>';
			} else {
				if ( routeMatches.length > 0 ) {
					body += '<div class="scrutinizer-picker-section">';
					body += '<h5>Same route</h5>';
					body += renderPickerList( routeMatches );
					body += '</div>';
				}
				if ( otherPinned.length > 0 ) {
					body += '<div class="scrutinizer-picker-section">';
					body += '<h5>Other pinned profiles</h5>';
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
		loadHtml += '<p class="description"><span class="dashicons dashicons-update spin"></span> Loading comparison&hellip;</p>';
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
					'<p class="scrutinizer-share-error">' + esc( response.data.message || 'Compare failed.' ) + '</p>'
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
		html += 'Compared to <strong>' + esc( ( reqB.method || '' ) + ' ' + truncate( reqB.url || b.request_url || '', 40 ) ) + '</strong>';
		html += ' <small>(' + esc( b.captured_at || '' ) + ')</small>';
		html += '</span>';
		html += '<button type="button" class="button button-link" id="scrutinizer-inline-compare-close" title="Dismiss">✕</button>';
		html += '</div>';

		// Summary table.
		html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
		html += '<thead><tr><th>Metric</th><th class="numeric">This Profile</th><th class="numeric">Reference</th><th class="numeric">Change</th></tr></thead>';
		html += '<tbody>';

		html += compareRow( 'Server Request Duration',
			( delta.duration_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.duration_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.duration_ns, delta.duration_a_ns, 'time'
		);

		html += compareRow( 'Unattributed Time',
			( delta.unattributed_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.unattributed_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.unattributed_delta_ns, delta.unattributed_a_ns, 'time'
		);

		html += compareRow( 'DB Queries',
			String( delta.query_count_a ),
			String( delta.query_count_b ),
			delta.query_count_delta, delta.query_count_a || 1, 'count'
		);

		if ( delta.query_time_a_ms !== undefined ) {
			html += compareRow( 'Query Time',
				delta.query_time_a_ms.toFixed( 1 ) + ' ms',
				delta.query_time_b_ms.toFixed( 1 ) + ' ms',
				( delta.query_time_delta_ms || 0 ) * 1e6, ( delta.query_time_a_ms || 1 ) * 1e6, 'time'
			);
		}

		if ( delta.memory_peak_a || delta.memory_peak_b ) {
			html += compareRow( 'Peak Memory',
				formatBytes( delta.memory_peak_a ),
				formatBytes( delta.memory_peak_b ),
				delta.memory_peak_delta, delta.memory_peak_a || 1, 'memory'
			);
		}

		if ( delta.memory_alloc_a || delta.memory_alloc_b ) {
			html += compareRow( 'Memory Used by Hooks',
				formatBytes( delta.memory_alloc_a ),
				formatBytes( delta.memory_alloc_b ),
				delta.memory_alloc_delta, delta.memory_alloc_a || 1, 'memory'
			);
		}

		if ( delta.callback_count_a !== undefined ) {
			html += compareRow( 'Callbacks',
				String( delta.callback_count_a ),
				String( delta.callback_count_b ),
				delta.callback_count_delta, delta.callback_count_a || 1, 'count'
			);
		}

		if ( delta.http_count_a !== undefined ) {
			html += compareRow( 'HTTP Calls',
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
			html += '<h4>Per-Source Changes</h4>';
			html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
			html += '<thead><tr><th>Source</th><th class="numeric">This Profile</th><th class="numeric">Reference</th><th class="numeric">Change</th></tr></thead>';
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
	 * Classify a delta into regression / improvement / noise.
	 *
	 * Thresholds: >20% AND >100ms = regression. <-20% AND <-100ms = improvement.
	 * Everything else is within noise.
	 */
	function classifyDelta( deltaMs, pctChange ) {
		if ( deltaMs > 100 && pctChange > 20 ) {
			return { cls: 'verdict-regression', label: '⚠ Regression' };
		}
		if ( deltaMs < -100 && pctChange < -20 ) {
			return { cls: 'verdict-improvement', label: '✓ Improvement' };
		}
		if ( Math.abs( deltaMs ) < 10 && Math.abs( pctChange ) < 5 ) {
			return { cls: 'verdict-noise', label: '≈ Within noise' };
		}
		if ( deltaMs > 0 ) {
			return { cls: 'verdict-slower', label: '↑ Slower' };
		}
		if ( deltaMs < 0 ) {
			return { cls: 'verdict-faster', label: '↓ Faster' };
		}
		return { cls: 'verdict-noise', label: '≈ No change' };
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
		html += '<div class="compare-vs">vs</div>';
		html += '<div class="compare-profile-label"><strong>B:</strong> ' + esc( reqB.method || '' ) + ' ' + esc( truncate( reqB.url || b.request_url || '', 60 ) ) + '<br><small>' + esc( b.captured_at ) + '</small></div>';
		html += '</div>';

		// Summary comparison.
		html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
		html += '<thead><tr><th>Metric</th><th class="numeric">Profile A</th><th class="numeric">Profile B</th><th class="numeric">Change</th></tr></thead>';
		html += '<tbody>';

		html += compareRow( 'Server Request Duration',
			( delta.duration_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.duration_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.duration_ns, delta.duration_a_ns, 'time'
		);

		html += compareRow( 'Unattributed Time',
			( delta.unattributed_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.unattributed_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.unattributed_delta_ns, delta.unattributed_a_ns, 'time'
		);

		html += compareRow( 'DB Queries',
			String( delta.query_count_a ),
			String( delta.query_count_b ),
			delta.query_count_delta, delta.query_count_a || 1, 'count'
		);

		if ( delta.query_time_a_ms !== undefined ) {
			html += compareRow( 'Query Time',
				delta.query_time_a_ms.toFixed( 1 ) + ' ms',
				delta.query_time_b_ms.toFixed( 1 ) + ' ms',
				( delta.query_time_delta_ms || 0 ) * 1e6, ( delta.query_time_a_ms || 1 ) * 1e6, 'time'
			);
		}

		if ( delta.memory_peak_a || delta.memory_peak_b ) {
			html += compareRow( 'Peak Memory',
				formatBytes( delta.memory_peak_a ),
				formatBytes( delta.memory_peak_b ),
				delta.memory_peak_delta, delta.memory_peak_a || 1, 'memory'
			);
		}

		if ( delta.memory_alloc_a || delta.memory_alloc_b ) {
			html += compareRow( 'Memory Used by Hooks',
				formatBytes( delta.memory_alloc_a ),
				formatBytes( delta.memory_alloc_b ),
				delta.memory_alloc_delta, delta.memory_alloc_a || 1, 'memory'
			);
		}

		if ( delta.callback_count_a !== undefined ) {
			html += compareRow( 'Callbacks',
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
			html += '<h3>Per-Source Changes</h3>';
			html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
			html += '<thead><tr><th>Source</th><th class="numeric">Profile A</th><th class="numeric">Profile B</th><th class="numeric">Change</th></tr></thead>';
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
				deltaStr = 'no change';
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
				deltaStr = 'no change';
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
				deltaStr = 'no change';
				cls = 'scrutinizer-delta-neutral';
			} else if ( Math.abs( deltaMs ) < 10 && Math.abs( pctChange ) < 5 ) {
				// Within noise threshold.
				deltaStr = ( deltaMs > 0 ? '+' : '' ) + deltaMs.toFixed( 1 ) + ' ms';
				deltaStr += ' (' + ( pctChange > 0 ? '+' : '' ) + pctChange.toFixed( 1 ) + '%)';
				deltaStr += ' · within noise';
				cls = 'scrutinizer-delta-neutral';
			} else {
				cls = deltaNs < 0 ? 'scrutinizer-delta-negative' : 'scrutinizer-delta-positive';
				deltaStr = ( deltaMs > 0 ? '+' : '' ) + deltaMs.toFixed( 1 ) + ' ms';
				deltaStr += ' (' + ( pctChange > 0 ? '+' : '' ) + pctChange.toFixed( 1 ) + '%)';
				if ( deltaMs > 100 && pctChange > 20 ) {
					deltaStr += ' · regression';
				} else if ( deltaMs < -100 && pctChange < -20 ) {
					deltaStr += ' · improved';
				} else {
					deltaStr += deltaNs > 0 ? ' slower' : ' faster';
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
		var $notice = $( '<div class="scrutinizer-notice ' + type + '">' + esc( message ) + '</div>' );
		$( '#scrutinizer-dashboard h1' ).after( $notice );
		setTimeout( function() {
			$notice.fadeOut( 300, function() {
				$notice.remove();
			} );
		}, 4000 );
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
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-share-alt2"></span> Send to Agent</h3>';
		html += '<p class="scrutinizer-api-desc">Generate a one-time prompt that gives an AI agent read-only access to your profiling data. ';
		html += 'The credential auto-expires and is scoped to Scrutineer endpoints only.</p>';
		html += '<div class="scrutinizer-send-agent-controls">';
		html += '<button type="button" class="button button-primary" id="scrutinizer-create-api-key">';
		html += '<span class="dashicons dashicons-clipboard"></span> Copy Prompt to Clipboard</button>';
		html += '<button type="button" class="button button-link scrutinizer-revoke-link" id="scrutinizer-revoke-api-key" style="display:none;">';
		html += '<span class="dashicons dashicons-dismiss"></span> Revoke Access</button>';
		html += '</div>';
		html += '<p class="scrutinizer-privacy-advisory">This prompt includes your site URL and a short-lived credential. Paste it into a private AI conversation \u2014 not a public or shared chat.</p>';
		html += '<div id="scrutinizer-api-key-result" class="scrutinizer-api-result" style="display:none;"></div>';
		html += '</div>';

		// --- Diagnostics sharing fields ---
		html += '<div class="scrutinizer-api-section">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-admin-tools"></span> Diagnostics Sharing</h3>';
		html += '<p class="scrutinizer-api-desc">Choose which server environment details to include when an agent reads <code>/v1/diagnostics</code>. ';
		html += 'These fields are opt-in — nothing is shared unless you check it.</p>';
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
		html += '<button type="button" class="button" id="scrutinizer-save-diag-fields">Save Preferences</button>';
		html += '<span id="scrutinizer-diag-saved" class="scrutinizer-saved-notice" style="display:none;">✓ Saved</span>';
		html += '</div>';
		html += '</div>';

		// --- Endpoints reference ---
		html += '<div class="scrutinizer-api-section">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-rest-api"></span> Endpoints</h3>';
		html += '<table class="scrutinizer-profile-table scrutinizer-api-endpoints widefat">';
		html += '<thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>';
		html += '<tbody>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/prompt</code></td><td>System prompt (text/plain) \u2014 the API contract</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/diagnostics</code></td><td>Server environment details (opt-in fields only)</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/routes</code></td><td>All profiled routes with summary statistics</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/profile/{id}</code></td><td>Full profile detail for one request</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/compare/{a}/{b}</code></td><td>Side-by-side comparison of two profiles</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/manifest</code></td><td>Machine-readable API manifest for AI agent discovery (public)</td></tr>';
		html += '</tbody></table>';
		if ( apiBase ) {
			html += '<p class="scrutinizer-api-base">Base URL: <code>' + esc( apiBase ) + '</code></p>';
		}
		html += '</div>';

		// --- Send to Support section ---
		html += '<div class="scrutinizer-api-section">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-lock"></span> Send to Support</h3>';
		html += '<p class="scrutinizer-api-desc">Share a performance report with your support team or plugin developer via an encrypted, self-destructing link. ';
		html += 'Data is encrypted in your browser before upload &mdash; the relay server never sees your report contents.</p>';
		html += '<p class="scrutinizer-api-desc">To share: open a profile from the <strong>History</strong> tab, then click <strong>Share</strong> in the toolbar.</p>';
		html += '<p class="scrutinizer-api-desc" style="color:#50575e;font-size:12px;">Powered by <code>scrutinizer.dev</code> &mdash; zero-knowledge encrypted relay.</p>';
		html += '</div>';

		// --- Audit Log section ---
		html += '<div class="scrutinizer-api-section">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-list-view"></span> Access Log</h3>';
		html += '<p class="scrutinizer-api-desc">Recent API credential usage. Shows when endpoints were accessed, from which IP, and by which user agent.</p>';
		html += '<div id="scrutinizer-api-log-content"><p class="scrutinizer-empty">Loading...</p></div>';
		html += '<div class="scrutinizer-diag-actions">';
		html += '<button type="button" class="button" id="scrutinizer-refresh-api-log"><span class="dashicons dashicons-update"></span> Refresh</button>';
		html += '<button type="button" class="button button-link" id="scrutinizer-clear-api-log" style="color:#d63638;">Clear Log</button>';
		html += '</div>';
		html += '</div>';

		$container.html( html );

		bindApiEvents( $container );

		// Load audit log on render.
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

			$btn.prop( 'disabled', true ).text( 'Saving…' );

			$.post( scrutinizerAdmin.ajaxUrl, {
				action: 'scrutinizer_save_diagnostics_fields',
				nonce:  scrutinizerAdmin.nonce,
				fields: fields
			}, function( response ) {
				$btn.prop( 'disabled', false ).text( 'Save Preferences' );
				if ( response.success ) {
					scrutinizerAdmin.diagnosticsFields = response.data.fields;
					$( '#scrutinizer-diag-saved' ).fadeIn( 200 ).delay( 2000 ).fadeOut( 400 );
				}
			} ).fail( function() {
				$btn.prop( 'disabled', false ).text( 'Save Preferences' );
			} );
		} );

		// Create API password and copy prompt.
		$container.find( '#scrutinizer-create-api-key' ).off( 'click' ).on( 'click', function() {
			var $btn = $( this );
			$btn.prop( 'disabled', true ).html( '<span class="dashicons dashicons-update spin"></span> Generating…' );

			$.post( scrutinizerAdmin.ajaxUrl, {
				action: 'scrutinizer_create_api_password',
				nonce:  scrutinizerAdmin.nonce
			}, function( response ) {
				if ( response.success ) {
					var d = response.data;

					// Copy prompt to clipboard.
					copyToClipboard( d.prompt );

					// Show success.
					var ttlLabel = d.ttl_hours <= 1 ? '1 hour' : d.ttl_hours + ' hours';
					$( '#scrutinizer-api-key-result' )
						.html(
							'<div class="scrutinizer-api-success">' +
							'<span class="dashicons dashicons-yes-alt"></span> ' +
							'<strong>Prompt copied to clipboard.</strong> ' +
							'Paste it into your AI agent. Access expires in ' + esc( ttlLabel ) + '.' +
							'</div>'
						)
						.slideDown( 200 );

					$btn.prop( 'disabled', false )
						.html( '<span class="dashicons dashicons-clipboard"></span> Regenerate &amp; Copy' );
					$( '#scrutinizer-revoke-api-key' ).show();
				} else {
					$( '#scrutinizer-api-key-result' )
						.html(
							'<div class="scrutinizer-api-error">' +
							'<span class="dashicons dashicons-warning"></span> ' +
							esc( response.data.message || 'Failed to create access key.' ) +
							'</div>'
						)
						.slideDown( 200 );
					$btn.prop( 'disabled', false )
						.html( '<span class="dashicons dashicons-clipboard"></span> Copy Prompt to Clipboard' );
				}
			} ).fail( function() {
				$btn.prop( 'disabled', false )
					.html( '<span class="dashicons dashicons-clipboard"></span> Copy Prompt to Clipboard' );
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
							'Access revoked.' +
							'</div>'
						)
						.slideDown( 200 )
						.delay( 3000 )
						.slideUp( 400 );

					$( '#scrutinizer-create-api-key' )
						.html( '<span class="dashicons dashicons-clipboard"></span> Copy Prompt to Clipboard' );
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

	function loadApiAuditLog() {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_get_api_log',
			nonce:  scrutinizerAdmin.nonce
		}, function( response ) {
			if ( response.success ) {
				renderApiAuditLog( response.data.log || [] );
			} else {
				$( '#scrutinizer-api-log-content' ).html(
					'<p class="scrutinizer-empty">Failed to load access log.</p>'
				);
			}
		} ).fail( function() {
			$( '#scrutinizer-api-log-content' ).html(
				'<p class="scrutinizer-empty">Failed to load access log.</p>'
			);
		} );
	}

	function renderApiAuditLog( entries ) {
		var $container = $( '#scrutinizer-api-log-content' );

		if ( ! entries || 0 === entries.length ) {
			$container.html( '<p class="scrutinizer-empty">No API access recorded yet.</p>' );
			return;
		}

		var html = '<table class="scrutinizer-api-log-table widefat">';
		html += '<thead><tr>';
		html += '<th>Endpoint</th>';
		html += '<th>IP</th>';
		html += '<th>User Agent</th>';
		html += '<th>When</th>';
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
			html += '<p class="scrutinizer-api-desc" style="margin-top:8px">Showing 50 of ' + entries.length + ' entries.</p>';
		}
		$container.html( html );
	}

	// Bind audit log buttons (outside bindApiEvents to avoid duplicate binding).
	$( document ).on( 'click', '#scrutinizer-refresh-api-log', function() {
		$( '#scrutinizer-api-log-content' ).html( '<p class="scrutinizer-empty">Loading...</p>' );
		loadApiAuditLog();
	} );

	$( document ).on( 'click', '#scrutinizer-clear-api-log', function() {
		if ( ! confirm( 'Clear the entire API access log?' ) ) {
			return;
		}
		$.post( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_clear_api_log',
			nonce:  scrutinizerAdmin.nonce
		}, function( response ) {
			if ( response.success ) {
				$( '#scrutinizer-api-log-content' ).html(
					'<p class="scrutinizer-empty">No API access recorded yet.</p>'
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
		html += '<h4><span class="dashicons dashicons-share-alt2"></span> Share Report</h4>';
		html += '<p class="description">Create an encrypted, self-destructing link. The relay server never sees your data.</p>';

		// Options
		html += '<div class="scrutinizer-share-options">';
		html += '<label class="scrutinizer-share-option">';
		html += '<span>Expires after</span>';
		html += '<select id="scrutinizer-share-ttl">';
		html += '<option value="1">1 day</option>';
		html += '<option value="7" selected>7 days</option>';
		html += '<option value="14">14 days</option>';
		html += '<option value="30">30 days</option>';
		html += '</select></label>';

		html += '<label class="scrutinizer-share-option">';
		html += '<input type="checkbox" id="scrutinizer-share-burn">';
		html += ' <span>Expire after first view</span></label>';

		html += '<label class="scrutinizer-share-option">';
		html += '<input type="checkbox" id="scrutinizer-share-passphrase-toggle">';
		html += ' <span>Add passphrase</span></label>';

		html += '<div id="scrutinizer-share-passphrase-field" style="display:none;">';
		html += '<input type="text" id="scrutinizer-share-passphrase" placeholder="Passphrase (share separately)" />';
		html += '</div>';

		html += '</div>';

		// Include sections
		html += '<details class="scrutinizer-share-sections">';
		html += '<summary>Sections to include</summary>';
		html += '<div class="scrutinizer-share-section-list">';
		html += '<label><input type="checkbox" name="share_section" value="summary" checked disabled> Summary</label>';
		html += '<label><input type="checkbox" name="share_section" value="sources" checked> Sources</label>';
		html += '<label><input type="checkbox" name="share_section" value="queries" checked> Queries</label>';
		html += '<label><input type="checkbox" name="share_section" value="timeline" checked> Timeline</label>';
		html += '<label><input type="checkbox" name="share_section" value="trace" checked> Trace</label>';
		html += '<label><input type="checkbox" name="share_section" value="http_calls" checked> HTTP Calls</label>';
		html += '<label><input type="checkbox" name="share_section" value="autoloaded_options" checked> Options</label>';
		html += '<label><input type="checkbox" name="share_section" value="enqueued_assets" checked> Assets</label>';
		html += '<label><input type="checkbox" name="share_section" value="diagnostics"> Diagnostics</label>';
		html += '</div></details>';

		html += '<div class="scrutinizer-share-actions">';
		html += '<button type="button" class="button button-primary" id="scrutinizer-share-go">';
		html += '<span class="dashicons dashicons-lock"></span> Encrypt &amp; Share</button>';
		html += '<button type="button" class="button button-link" id="scrutinizer-share-cancel">Cancel</button>';
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
		$btn.prop( 'disabled', true ).html( '<span class="dashicons dashicons-update spin"></span> Encrypting…' );

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
				$btn.prop( 'disabled', false ).html( '<span class="dashicons dashicons-lock"></span> Encrypt &amp; Share' );
				$result.html( '<p class="scrutinizer-share-error">Failed to load profile data.</p>' ).show();
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
					encryptAndUpload( shareData, ttlDays, burnAfterReading, passphrase );
				} ).fail( function() {
					// Continue without diagnostics
					encryptAndUpload( shareData, ttlDays, burnAfterReading, passphrase );
				} );
			} else {
				encryptAndUpload( shareData, ttlDays, burnAfterReading, passphrase );
			}

		} ).fail( function() {
			$btn.prop( 'disabled', false ).html( '<span class="dashicons dashicons-lock"></span> Encrypt &amp; Share' );
			$result.html( '<p class="scrutinizer-share-error">Request failed. Please try again.</p>' ).show();
		} );
	}

	/**
	 * Encrypt a report payload and upload to the relay.
	 */
	function encryptAndUpload( data, ttlDays, burnAfterReading, passphrase ) {
		var $btn = $( '#scrutinizer-share-go' );
		var $result = $( '#scrutinizer-share-result' );

		$btn.html( '<span class="dashicons dashicons-update spin"></span> Compressing…' );

		// Gzip the JSON before encryption for smaller payloads
		var jsonBytes = new TextEncoder().encode( JSON.stringify( data ) );

		compressGzip( jsonBytes ).then( function( compressed ) {
			$btn.html( '<span class="dashicons dashicons-update spin"></span> Encrypting…' );

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
					var keyB64 = base64urlEncode( keyBytes );
					var hasPassphrase = false;

					// If passphrase, wrap the key and use wrapped material in URL fragment
					if ( passphrase ) {
						hasPassphrase = true;
						return wrapKeyWithPassphrase( keyBytes, iv, passphrase ).then( function( wrapped ) {
							keyB64 = base64urlEncode( new Uint8Array( wrapped ) );
							urlFragment = keyB64;
							return uploadToRelay( ciphertextB64, ivB64, keyB64, ttlDays, burnAfterReading, hasPassphrase );
						} );
					}

					return uploadToRelay( ciphertextB64, ivB64, keyB64, ttlDays, burnAfterReading, hasPassphrase );
				} )
				.then( function( resp ) {
					$btn.hide();
					$( '.scrutinizer-share-options, .scrutinizer-share-sections, #scrutinizer-share-cancel' ).hide();

					var shareUrl = resp.url + '#' + urlFragment;

					var html = '<div class="scrutinizer-share-success">';
					html += '<p><span class="dashicons dashicons-yes-alt" style="color:#4ab866;"></span> Report encrypted and shared.</p>';
					html += '<div class="scrutinizer-share-url-row">';
					html += '<input type="text" readonly value="' + esc( shareUrl ) + '" id="scrutinizer-share-url" />';
					html += '<button type="button" class="button" id="scrutinizer-share-copy">Copy</button>';
					html += '</div>';
					html += '<p class="description">Expires: ' + esc( resp.expires_at ) + '</p>';
					html += '<button type="button" class="button button-link scrutinizer-revoke-link" id="scrutinizer-share-revoke" data-id="' + esc( resp.id ) + '" data-token="' + esc( resp.revoke_token ) + '">';
					html += '<span class="dashicons dashicons-dismiss"></span> Revoke</button>';
					html += '</div>';

					$result.html( html ).show();

					// Copy handler
					$( '#scrutinizer-share-copy' ).on( 'click', function() {
						$( '#scrutinizer-share-url' ).select();
						copyToClipboard( shareUrl );
						$( this ).html( '✓ Copied' );
						setTimeout( function() {
							$( '#scrutinizer-share-copy' ).html( 'Copy' );
						}, 2000 );
					} );

					// Revoke handler
					$( '#scrutinizer-share-revoke' ).on( 'click', function() {
						var id = $( this ).data( 'id' );
						var token = $( this ).data( 'token' );
						revokeSharedReport( id, token );
					} );
				} );
		} )
		.catch( function( err ) {
			console.error( 'Share error:', err );
			$btn.prop( 'disabled', false ).html( '<span class="dashicons dashicons-lock"></span> Encrypt &amp; Share' );
			$result.html( '<p class="scrutinizer-share-error">Encryption failed: ' + esc( err.message || 'Unknown error' ) + '</p>' ).show();
		} );
	}

	/**
	 * Upload encrypted payload to the relay.
	 */
	function uploadToRelay( ciphertext, iv, keyB64, ttlDays, burnAfterReading, hasPassphrase ) {
		return new Promise( function( resolve, reject ) {
			var payload = {
				ciphertext: ciphertext,
				iv: iv,
				ttl_days: ttlDays,
				expire_after_reading: burnAfterReading,
				has_passphrase: hasPassphrase,
				compressed: true
			};

			// Use fetch to avoid jQuery AJAX CORS defaults
			var bodyStr = JSON.stringify( payload );

			// Guard against relay's 10 MB limit.
			if ( bodyStr.length > 10000000 ) {
				reject( new Error( 'Report too large (' + ( bodyStr.length / 1048576 ).toFixed( 1 ) + ' MB). Try unchecking Trace and Timeline.' ) );
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
						throw new Error( data.error || 'Upload failed' );
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
	function wrapKeyWithPassphrase( keyBytes, salt, passphrase ) {
		var enc = new TextEncoder();
		return crypto.subtle.importKey( 'raw', enc.encode( passphrase ), 'PBKDF2', false, [ 'deriveBits', 'deriveKey' ] )
			.then( function( passphraseKey ) {
				return crypto.subtle.deriveKey(
					{ name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
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
					return result;
				} );
			} );
	}

	/**
	 * Revoke a shared report via the relay.
	 */
	function revokeSharedReport( id, token ) {
		var $btn = $( '#scrutinizer-share-revoke' );
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
				$( '#scrutinizer-share-result' ).html(
					'<div class="scrutinizer-share-revoked"><span class="dashicons dashicons-yes-alt"></span> Report revoked. The link will no longer work.</div>'
				);
			} else {
				$btn.prop( 'disabled', false );
				$( '#scrutinizer-share-result' ).append(
					'<p class="scrutinizer-share-error">Revocation failed: ' + esc( data.error || 'Unknown error' ) + '</p>'
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
