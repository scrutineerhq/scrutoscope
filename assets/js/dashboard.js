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
	var currentView   = 'grouped'; // 'grouped', 'route', 'detail'
	var currentRoute  = '';        // route_key for the active drill-down
	var sortField     = '';
	var sortDir       = 'desc';    // 'asc' or 'desc'
	var groupedData   = [];
	var routeData     = [];

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
		fetchGrouped();

		if ( scrutinizerAdmin.isActive ) {
			startPolling();
			showStopButton();
		}

		initBackgroundControls();
	}

	/* ------------------------------------------------------------------ */
	/*  Event binding                                                      */
	/* ------------------------------------------------------------------ */

	function bindEvents() {
		// Decision cards — start profiling.
		$( document ).on( 'click', '.scrutinizer-decision-card', function() {
			startProfiling( $( this ).data( 'target' ) || '' );
		} );

		// Stop button.
		$( document ).on( 'click', '#scrutinizer-stop', stopProfiling );

		// Copy activation URL.
		$( document ).on( 'click', '#scrutinizer-copy-url', copyActivationUrl );

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

		// Sortable headers.
		$( document ).on( 'click', '.scrutinizer-sortable', function() {
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
			}
		} );

		// Detail view tabs.
		$( document ).on( 'click', '.scrutinizer-tab', function() {
			var tab = $( this ).data( 'tab' );
			$( '.scrutinizer-tab' ).removeClass( 'active' );
			$( this ).addClass( 'active' );
			$( '.scrutinizer-tab-content' ).hide();
			$( '#scrutinizer-tab-' + tab ).show();
		} );

		// Background profiling toggle.
		$( document ).on( 'change', '#scrutinizer-bg-toggle', toggleBackground );
		$( document ).on( 'input', '#scrutinizer-sample-rate', function() {
			$( '#scrutinizer-rate-value' ).text( $( this ).val() + '%' );
		} );
		$( document ).on( 'change', '#scrutinizer-sample-rate', saveBackgroundRate );
	}

	/* ------------------------------------------------------------------ */
	/*  Background profiling controls                                      */
	/* ------------------------------------------------------------------ */

	function initBackgroundControls() {
		var html = '<div class="scrutinizer-bg-controls">';
		html += '<h3>Background Profiling</h3>';
		html += '<label class="scrutinizer-toggle-label">';
		html += '<input type="checkbox" id="scrutinizer-bg-toggle"' + ( scrutinizerAdmin.backgroundEnabled ? ' checked' : '' ) + '> ';
		html += 'Enable background sampling</label>';
		html += '<div class="scrutinizer-rate-control' + ( scrutinizerAdmin.backgroundEnabled ? '' : ' hidden' ) + '" id="scrutinizer-rate-group">';
		html += '<label>Sample rate: <span id="scrutinizer-rate-value">' + scrutinizerAdmin.backgroundSampleRate + '%</span></label>';
		html += '<input type="range" id="scrutinizer-sample-rate" min="1" max="100" value="' + scrutinizerAdmin.backgroundSampleRate + '">';
		html += '</div>';
		html += '</div>';

		$( '#scrutinizer-controls' ).after( html );
	}

	function toggleBackground() {
		var enabled = $( '#scrutinizer-bg-toggle' ).is( ':checked' );
		var rate    = parseInt( $( '#scrutinizer-sample-rate' ).val(), 10 ) || 5;

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

	function saveBackgroundRate() {
		var rate = parseInt( $( '#scrutinizer-sample-rate' ).val(), 10 ) || 5;
		$.post( scrutinizerAdmin.ajaxUrl, {
			action:  'scrutinizer_toggle_background',
			nonce:   scrutinizerAdmin.nonce,
			enabled: $( '#scrutinizer-bg-toggle' ).is( ':checked' ) ? 1 : 0,
			rate:    rate
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  Session start / stop                                               */
	/* ------------------------------------------------------------------ */

	function startProfiling( target ) {
		$.post( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_start_profiling',
			nonce:  scrutinizerAdmin.nonce,
			target: target
		}, function( response ) {
			if ( response.success ) {
				$( '#scrutinizer-activation-url' ).val( response.data.activation_url );
				$( '#scrutinizer-activation' ).show();
				window.location.href = response.data.activation_url;
			} else {
				showNotice( response.data.message || scrutinizerAdmin.i18n.error, 'error' );
			}
		} ).fail( function() {
			showNotice( scrutinizerAdmin.i18n.error, 'error' );
		} );
	}

	function stopProfiling() {
		stopPolling();
		$.post( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_stop_profiling',
			nonce:  scrutinizerAdmin.nonce
		}, function( response ) {
			if ( response.success ) {
				showNotice( response.data.message, 'success' );
				window.location.reload();
			} else {
				showNotice( response.data.message || scrutinizerAdmin.i18n.error, 'error' );
			}
		} ).fail( function() {
			showNotice( scrutinizerAdmin.i18n.error, 'error' );
		} );
	}

	function copyActivationUrl() {
		var input = document.getElementById( 'scrutinizer-activation-url' );
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
		var $controls = $( '#scrutinizer-controls' );
		$controls.html(
			'<div class="scrutinizer-polling">' +
				'<span class="spinner is-active"></span>' +
				scrutinizerAdmin.i18n.profiling +
			'</div>' +
			'<button type="button" class="button button-secondary button-large" id="scrutinizer-stop">' +
				scrutinizerAdmin.i18n.stopProfiling +
			'</button>'
		);
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
		pollingTimer = setInterval( fetchGrouped, 2000 );
	}

	function stopPolling() {
		if ( pollingTimer ) {
			clearInterval( pollingTimer );
			pollingTimer = null;
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Level 1: Grouped routes                                            */
	/* ------------------------------------------------------------------ */

	function fetchGrouped() {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action: 'scrutinizer_get_profiles_grouped',
			nonce:  scrutinizerAdmin.nonce
		}, function( response ) {
			if ( response.success ) {
				groupedData = response.data.groups || [];
				if ( 'grouped' === currentView ) {
					renderGroupedTable( groupedData );
				}
			}
		} );
	}

	function renderGroupedTable( groups ) {
		var $list = $( '#scrutinizer-profile-list' );

		if ( ! groups || 0 === groups.length ) {
			$list.html( '<p class="scrutinizer-empty">' + scrutinizerAdmin.i18n.noProfiles + '</p>' );
			return;
		}

		groups = sortRows( groups );

		var html = '<table class="scrutinizer-profile-table widefat">';
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

		for ( var i = 0; i < groups.length; i++ ) {
			var g = groups[ i ];
			var avgMs = ( parseFloat( g.avg_duration_ns ) / 1e6 ).toFixed( 1 );
			var minMs = ( parseInt( g.min_duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var maxMs = ( parseInt( g.max_duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var types = typeBadges( g.profile_types || '' );
			var route = g.route_key || '(unknown)';

			html += '<tr class="scrutinizer-route-row" data-route-key="' + esc( g.route_key ) + '">';
			html += '<td class="scrutinizer-route-cell" title="' + esc( route ) + '">' + esc( truncate( route, 50 ) ) + '</td>';
			html += '<td>' + esc( g.request_method ) + '</td>';
			html += '<td class="numeric">' + parseInt( g.request_count, 10 ) + '</td>';
			html += '<td class="scrutinizer-duration numeric">' + esc( avgMs ) + ' ms</td>';
			html += '<td class="numeric">' + esc( minMs ) + ' ms</td>';
			html += '<td class="numeric">' + esc( maxMs ) + ' ms</td>';
			html += '<td>' + esc( g.last_captured ) + '</td>';
			html += '<td>' + types + '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		$list.html( html );
	}

	function showGroupedView() {
		currentView  = 'grouped';
		currentRoute = '';
		sortField    = '';
		sortDir      = 'desc';
		$( '#scrutinizer-results' ).show();
		$( '#scrutinizer-route-detail' ).remove();
		$( '#scrutinizer-detail' ).hide();
		$( '#scrutinizer-results h2' ).text( 'Routes' );
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
		html += '<div id="scrutinizer-route-profiles"></div>';
		html += '</div>';

		$( '#scrutinizer-results' ).after( html );
		renderRouteTable( routeData );
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
		$container.html( html );
	}

	/* ------------------------------------------------------------------ */
	/*  Level 3: Profile detail                                            */
	/* ------------------------------------------------------------------ */

	function loadProfileDetail( profileId ) {
		$.get( scrutinizerAdmin.ajaxUrl, {
			action:     'scrutinizer_get_profile_detail',
			nonce:      scrutinizerAdmin.nonce,
			profile_id: profileId
		}, function( response ) {
			if ( response.success ) {
				// Reset color map for each profile view.
				pluginColorMap = {};
				colorIndex     = 0;
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
		var timeline     = data.timeline || [];
		var durMs        = ( summary.duration_ms || 0 ).toFixed( 1 );
		var queryCount   = summary.query_count || 0;

		var html = '';

		// Header with role pill.
		html += '<div class="scrutinizer-detail-header">';
		html += '<h3>' + esc( request.method ) + ' ' + esc( request.url ) + ' ' + rolePill( request.user_role ) + '</h3>';
		html += '</div>';

		// Metric cards row.
		html += '<div class="scrutinizer-metric-cards">';
		html += renderMetricCard( durMs + ' ms', scrutinizerAdmin.i18n.serverDuration, 'primary' );
		html += renderMetricCard( formatBytes( request.memory_peak || 0 ), 'Peak Memory', 'default' );
		html += renderMetricCard( String( queryCount ), 'DB Queries', queryCount > 100 ? 'warning' : 'default' );
		html += renderMetricCard( String( summary.callback_count || 0 ), 'Callbacks', 'default' );
		html += '</div>';

		// Tab navigation.
		html += '<div class="scrutinizer-tabs">';
		html += '<button class="scrutinizer-tab active" data-tab="timeline">Timeline</button>';
		html += '<button class="scrutinizer-tab" data-tab="breakdown">Breakdown</button>';
		html += '<button class="scrutinizer-tab" data-tab="sources">Sources</button>';
		if ( queries.length > 0 ) {
			html += '<button class="scrutinizer-tab" data-tab="queries">Queries (' + queries.length + ')</button>';
		}
		html += '<button class="scrutinizer-tab" data-tab="metadata">Metadata</button>';
		html += '</div>';

		// Tab: Timeline.
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-timeline">';
		html += renderTimeline( timeline, phaseMarkers, summary, sources );
		html += '</div>';

		// Tab: Breakdown.
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-breakdown" style="display:none">';
		html += renderBreakdown( summary );
		html += '</div>';

		// Tab: Sources.
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-sources" style="display:none">';
		html += renderSourceTable( sources, summary );
		html += '</div>';

		// Tab: Queries.
		if ( queries.length > 0 ) {
			html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-queries" style="display:none">';
			html += renderQueriesTable( queries );
			html += '</div>';
		}

		// Tab: Metadata.
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-metadata" style="display:none">';
		html += renderMetadata( request, summary );
		html += '</div>';

		$( '#scrutinizer-detail-content' ).html( html );
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

	function renderTimeline( timeline, phaseMarkers, summary, sources ) {
		var durationNs = summary.duration_ns || 0;
		if ( 0 === durationNs ) {
			return '<p class="scrutinizer-empty">No timeline data available.</p>';
		}

		var html = '<div class="scrutinizer-timeline-container">';

		// Phase marker labels at top — stack upward to prevent collisions.
		html += '<div class="scrutinizer-phase-labels">';
		var labelPositions = [];
		for ( var m = 0; m < phaseMarkers.length; m++ ) {
			var marker   = phaseMarkers[ m ];
			var markerPct = ( marker.offset_ns / durationNs ) * 100;
			if ( markerPct > 100 ) {
				markerPct = 100;
			}
			labelPositions.push( { pct: markerPct, name: marker.name } );
		}
		// Assign tiers: each label goes one tier higher if it's within 8% of
		// any label already placed at the same or lower tier.
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
		for ( var lk = 0; lk < labelPositions.length; lk++ ) {
			// Bottom tier = closest to bar. Higher tiers go up.
			var bottomPx = labelTiers[ lk ] * 18;
			html += '<div class="phase-label" style="left:' + labelPositions[ lk ].pct.toFixed( 2 ) + '%;bottom:' + bottomPx + 'px">';
			html += '<span class="phase-label-text">' + esc( formatPhaseName( labelPositions[ lk ].name ) ) + '</span>';
			html += '</div>';
		}
		html += '</div>';

		// Timeline bar with phase marker lines.
		html += '<div class="scrutinizer-timeline-bar">';

		// Phase marker vertical lines.
		for ( var p = 0; p < phaseMarkers.length; p++ ) {
			var pm    = phaseMarkers[ p ];
			var pmPct = ( pm.offset_ns / durationNs ) * 100;
			if ( pmPct > 100 ) {
				pmPct = 100;
			}
			html += '<div class="phase-marker-line" style="left:' + pmPct.toFixed( 2 ) + '%" title="' + esc( pm.name ) + ' @ ' + ( pm.offset_ns / 1e6 ).toFixed( 1 ) + ' ms"></div>';
		}

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
			html += '<div class="timeline-segment" style="left:' + seg.pct_start.toFixed( 3 ) + '%;width:' + Math.max( seg.pct_width, 0.15 ).toFixed( 3 ) + '%;background:' + color + '" title="' + esc( seg.callback ) + ' (' + seg.source + ')\n' + ( seg.wall_ns / 1e6 ).toFixed( 2 ) + ' ms wall"></div>';
		}

		html += '</div>'; // timeline-bar

		// Time axis.
		html += '<div class="scrutinizer-timeline-axis">';
		var tickCount = 5;
		for ( var k = 0; k <= tickCount; k++ ) {
			var tickMs  = ( ( durationNs / 1e6 ) * k / tickCount ).toFixed( 0 );
			var tickPct = ( k / tickCount ) * 100;
			html += '<span class="axis-tick" style="left:' + tickPct + '%">' + tickMs + ' ms</span>';
		}
		html += '</div>';

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

	function formatPhaseName( name ) {
		var short = {
			muplugins_loaded:  'mu-plugins',
			plugins_loaded:    'plugins',
			setup_theme:       'theme setup',
			after_setup_theme: 'after theme',
			init:              'init',
			wp_loaded:         'wp_loaded',
			template_redirect: 'template',
			wp:                'wp',
			shutdown:          'shutdown'
		};
		return short[ name ] || name;
	}

	/* ------------------------------------------------------------------ */
	/*  Breakdown bar                                                      */
	/* ------------------------------------------------------------------ */

	function renderBreakdown( summary ) {
		var breakdown = summary.breakdown || {};
		var html = '<div class="scrutinizer-breakdown">';
		html += '<div class="scrutinizer-breakdown-bar">';

		var barTypes = [ 'plugin', 'theme', 'core', 'mu-plugin', 'unattributed' ];
		for ( var b = 0; b < barTypes.length; b++ ) {
			var bt = barTypes[ b ];
			if ( breakdown[ bt ] && breakdown[ bt ].percent > 0 ) {
				html += '<div class="segment ' + esc( bt ) + '" style="width:' + breakdown[ bt ].percent + '%" title="' + esc( bt ) + ': ' + breakdown[ bt ].percent + '%"></div>';
			}
		}

		html += '</div>'; // breakdown-bar

		// Legend with unattributed tooltip.
		html += '<div class="scrutinizer-breakdown-legend">';
		for ( var lt in breakdown ) {
			if ( breakdown.hasOwnProperty( lt ) && breakdown[ lt ].ms > 0 ) {
				var color = sourceColors[ lt ] || '#888';
				html += '<span class="legend-item">';
				html += '<span class="legend-swatch" style="background:' + color + '"></span>';
				html += esc( lt ) + ': ' + breakdown[ lt ].ms + ' ms (' + breakdown[ lt ].percent + '%)';
				if ( 'unattributed' === lt ) {
					html += ' <span class="scrutinizer-info-tooltip" title="Time spent in PHP bootstrap, autoloaders, database connections, WordPress core initialization, and opcode compilation — before hooks fire. This is normal overhead, not a problem to solve.">ⓘ</span>';
				}
				html += '</span>';
			}
		}
		html += '</div>'; // legend
		html += '</div>'; // breakdown

		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Source table with weight glyphs                                     */
	/* ------------------------------------------------------------------ */

	function renderSourceTable( sources, summary ) {
		if ( ! sources || 0 === sources.length ) {
			return '<p class="scrutinizer-empty">No source data.</p>';
		}

		var totalExclNs = summary.total_exclusive_ns || 1;

		var html = '<table class="scrutinizer-source-table widefat">';
		html += '<thead><tr>';
		html += '<th>Source</th>';
		html += '<th>Type</th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.exclusiveTime + '</th>';
		html += '<th class="numeric">Weight</th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.inclusiveTime + '</th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.callCount + '</th>';
		html += '</tr></thead><tbody>';

		for ( var s = 0; s < sources.length; s++ ) {
			var src     = sources[ s ];
			var exclMs  = ( src.exclusive_ns / 1e6 ).toFixed( 2 );
			var pct     = ( ( src.exclusive_ns / totalExclNs ) * 100 ).toFixed( 1 );
			var barColor = getSourceColor( src.slug, src.type );

			html += '<tr>';
			html += '<td>' + esc( src.name || src.slug ) + '</td>';
			html += '<td>' + esc( src.type ) + '</td>';
			html += '<td class="numeric">' + exclMs + ' ms</td>';
			html += '<td class="scrutinizer-weight-cell">';
			html += '<div class="scrutinizer-weight-bar-wrap">';
			html += '<span class="scrutinizer-weight-pct">' + pct + '%</span>';
			html += '<div class="scrutinizer-weight-bar" style="width:' + pct + '%;background:' + barColor + '"></div>';
			html += '</div>';
			html += '</td>';
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
			return '<p class="scrutinizer-empty">No query data. Enable SAVEQUERIES in wp-config.php.</p>';
		}

		// Compute total query time.
		var totalQueryMs = 0;
		for ( var q = 0; q < queries.length; q++ ) {
			totalQueryMs += queries[ q ].time_ms || 0;
		}

		var html = '<div class="scrutinizer-queries-summary">';
		html += '<strong>' + queries.length + ' queries</strong> totaling <strong>' + totalQueryMs.toFixed( 1 ) + ' ms</strong>';
		html += '</div>';

		html += '<table class="scrutinizer-source-table scrutinizer-queries-table widefat">';
		html += '<thead><tr>';
		html += '<th class="numeric">#</th>';
		html += '<th>SQL</th>';
		html += '<th class="numeric">Time</th>';
		html += '<th>Caller</th>';
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < queries.length; i++ ) {
			var qr    = queries[ i ];
			var qTime = ( qr.time_ms || 0 ).toFixed( 2 );
			var slow  = qr.time_ms > 10 ? ' class="scrutinizer-slow-query"' : '';

			html += '<tr' + slow + '>';
			html += '<td class="numeric">' + ( i + 1 ) + '</td>';
			html += '<td class="scrutinizer-sql-cell"><code>' + esc( truncate( qr.sql || '', 200 ) ) + '</code></td>';
			html += '<td class="numeric">' + qTime + ' ms</td>';
			html += '<td class="scrutinizer-caller-cell" title="' + esc( qr.caller || '' ) + '">' + esc( truncate( qr.caller || '', 80 ) ) + '</td>';
			html += '</tr>';
		}

		html += '</tbody></table>';
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Metadata table                                                     */
	/* ------------------------------------------------------------------ */

	function renderMetadata( request, summary ) {
		var html = '<table class="scrutinizer-source-table widefat">';
		html += '<tbody>';
		html += '<tr><td>Route</td><td>' + esc( request.route_class || '—' ) + '</td></tr>';
		html += '<tr><td>User Role</td><td>' + rolePill( request.user_role ) + '</td></tr>';
		html += '<tr><td>PHP</td><td>' + esc( request.php_version || '—' ) + '</td></tr>';
		html += '<tr><td>WordPress</td><td>' + esc( request.wp_version || '—' ) + '</td></tr>';
		html += '<tr><td>Peak Memory</td><td>' + formatBytes( request.memory_peak || 0 ) + '</td></tr>';
		html += '<tr><td>DB Queries</td><td>' + ( summary.query_count || 0 ) + '</td></tr>';
		html += '<tr><td>Callbacks Observed</td><td>' + ( summary.callback_count || 0 ) + '</td></tr>';
		html += '<tr><td>Sources Identified</td><td>' + ( summary.source_count || 0 ) + '</td></tr>';
		html += '</tbody></table>';
		return html;
	}

	/* ------------------------------------------------------------------ */
	/*  Detail view nav                                                    */
	/* ------------------------------------------------------------------ */

	function showDetailView() {
		currentView = 'detail';
		$( '#scrutinizer-results' ).hide();
		$( '#scrutinizer-route-detail' ).hide();
		$( '#scrutinizer-detail' ).show();

		// Adjust back button based on where we came from.
		var $back = $( '#scrutinizer-detail .button-link' ).first();
		if ( currentRoute ) {
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

	function sortHeader( label, field ) {
		var cls   = 'scrutinizer-sortable';
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

	// Initialize on DOM ready.
	$( init );
}( jQuery ) );
