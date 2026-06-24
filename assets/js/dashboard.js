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
	var currentView   = 'grouped'; // 'grouped', 'route', 'detail', 'history', 'compare'
	var currentRoute  = '';        // route_key for the active drill-down
	var activeTopTab  = 'routes';  // 'routes', 'history', or 'cron'
	var sortField     = '';
	var sortDir       = 'desc';    // 'asc' or 'desc'
	var groupedData   = [];
	var routeData     = [];
	var historyData   = [];
	var compareChecked = {};       // { profileId: true }
	var currentProfileId = 0;     // currently viewed profile detail

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
		renderTopTabs();
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

		// Info bubble toggle (mobile-friendly tooltip).
		$( document ).on( 'click', '.scrutinizer-info-toggle', function( e ) {
			e.stopPropagation();
			$( this ).next( '.scrutinizer-info-bubble' ).toggleClass( 'visible' );
		});
		$( document ).on( 'click', function() {
			$( '.scrutinizer-info-bubble' ).removeClass( 'visible' );
		});
			$( '.scrutinizer-tab-content' ).hide();
			$( '#scrutinizer-tab-' + tab ).show();
		} );

		// Background profiling toggle.
		$( document ).on( 'change', '#scrutinizer-bg-toggle', toggleBackground );
		$( document ).on( 'input', '#scrutinizer-sample-rate', function() {
			$( '#scrutinizer-rate-value' ).text( $( this ).val() + '%' );
		} );
		$( document ).on( 'change', '#scrutinizer-sample-rate', saveBackgroundRate );

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

		// Save annotation on blur.
		$( document ).on( 'blur', '#scrutinizer-note-input', saveAnnotation );
		$( document ).on( 'blur', '#scrutinizer-tags-input', saveAnnotation );
		$( document ).on( 'keydown', '#scrutinizer-note-input, #scrutinizer-tags-input', function( e ) {
			if ( 13 === e.keyCode ) {
				e.preventDefault();
				$( this ).trigger( 'blur' );
			}
		} );

		// History filters.
		$( document ).on( 'change', '#scrutinizer-history-route', fetchHistory );
		$( document ).on( 'input', '#scrutinizer-history-tag', debounceHistory );
		$( document ).on( 'change', '#scrutinizer-history-pinned', fetchHistory );
		$( document ).on( 'change', '#scrutinizer-history-from, #scrutinizer-history-to', fetchHistory );

		// Compare checkboxes.
		$( document ).on( 'change', '.scrutinizer-compare-check', function() {
			var id = $( this ).data( 'profile-id' );
			if ( $( this ).is( ':checked' ) ) {
				compareChecked[ id ] = true;
			} else {
				delete compareChecked[ id ];
			}
			updateCompareButton();
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

		// Trace: toggle expand/collapse.
		$( document ).on( 'click', '.scrutinizer-trace-toggle', function() {
			var $node = $( this ).closest( '.scrutinizer-trace-node' );
			var $children = $node.children( '.scrutinizer-trace-children' );
			if ( $children.is( ':visible' ) ) {
				$children.hide();
				$( this ).text( '▶' );
			} else {
				$children.show();
				$( this ).text( '▼' );
			}
		} );

		// Trace: expand all.
		$( document ).on( 'click', '#scrutinizer-trace-expand-all', function() {
			$( '.scrutinizer-trace-children' ).show();
			$( '.scrutinizer-trace-toggle' ).text( '▼' );
		} );

		// Trace: collapse all.
		$( document ).on( 'click', '#scrutinizer-trace-collapse-all', function() {
			$( '.scrutinizer-trace-node:not(.root-node) > .scrutinizer-trace-children' ).hide();
			$( '.scrutinizer-trace-node:not(.root-node) > .scrutinizer-trace-row .scrutinizer-trace-toggle' ).text( '▶' );
		} );

		// Trace: filter callbacks.
		$( document ).on( 'input', '#scrutinizer-trace-filter', function() {
			var q = $( this ).val().toLowerCase();
			if ( ! q ) {
				$( '.scrutinizer-trace-node' ).show();
				return;
			}
			$( '.scrutinizer-trace-node' ).each( function() {
				var text = $( this ).children( '.scrutinizer-trace-row' ).text().toLowerCase();
				if ( text.indexOf( q ) >= 0 ) {
					$( this ).show();
					// Show all ancestors.
					$( this ).parents( '.scrutinizer-trace-node' ).show();
					$( this ).parents( '.scrutinizer-trace-children' ).show();
				} else if ( $( this ).find( '.scrutinizer-trace-row' ).filter( function() {
					return $( this ).text().toLowerCase().indexOf( q ) >= 0;
				} ).length > 0 ) {
					$( this ).show();
				} else {
					$( this ).hide();
				}
			} );
		} );
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
	/*  Top-level tabs (Routes | History)                                  */
	/* ------------------------------------------------------------------ */

	function renderTopTabs() {
		var html = '<div class="scrutinizer-top-tabs">';
		html += '<button class="scrutinizer-top-tab active" data-top-tab="routes">' + esc( scrutinizerAdmin.i18n.routes || 'Routes' ) + '</button>';
		html += '<button class="scrutinizer-top-tab" data-top-tab="history">' + esc( scrutinizerAdmin.i18n.history || 'History' ) + '</button>';
		html += '<button class="scrutinizer-top-tab" data-top-tab="cron">' + esc( scrutinizerAdmin.i18n.cron || 'Cron' ) + '</button>';
		html += '<button class="scrutinizer-top-tab" data-top-tab="api">' + esc( scrutinizerAdmin.i18n.api || 'API' ) + '</button>';
		html += '</div>';
		$( '#scrutinizer-results h2' ).replaceWith( html );
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
		var httpCalls    = data.http_calls || [];
		var autoloadOpts = data.autoloaded_options || {};
		var assets       = data.enqueued_assets || {};
		var timeline     = data.timeline || [];
		var traceData    = data.trace || [];
		var durMs        = ( summary.duration_ms || 0 ).toFixed( 1 );
		var queryCount   = summary.query_count || 0;
		var httpCount    = summary.http_call_count || 0;
		var isPinned     = parseInt( profile.is_pinned, 10 ) === 1;
		var profileNote  = profile.note || '';
		var profileTags  = profile.tags || '';

		currentProfileId = parseInt( profile.id, 10 );

		var html = '';

		// Pin/annotate toolbar.
		html += '<div class="scrutinizer-pin-toolbar">';
		html += '<button type="button" class="button ' + ( isPinned ? 'button-primary' : '' ) + '" id="scrutinizer-pin-toggle" data-pinned="' + ( isPinned ? '1' : '' ) + '">';
		html += isPinned ? '📌 ' + esc( scrutinizerAdmin.i18n.unpin || 'Unpin' ) : '📌 ' + esc( scrutinizerAdmin.i18n.pin || 'Pin' );
		html += '</button>';
		html += '<label class="scrutinizer-pin-field"><span>' + esc( scrutinizerAdmin.i18n.note || 'Note' ) + ':</span>';
		html += '<input type="text" id="scrutinizer-note-input" value="' + esc( profileNote ) + '" placeholder="Why did you take this measurement?" /></label>';
		html += '<label class="scrutinizer-pin-field"><span>' + esc( scrutinizerAdmin.i18n.tags || 'Tags' ) + ':</span>';
		html += '<input type="text" id="scrutinizer-tags-input" value="' + esc( profileTags ) + '" placeholder="before-update, opcache, v2.1" /></label>';
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
		html += renderMetricCard( formatBytes( summary.memory_allocated || 0 ), 'Allocated', summary.memory_allocated > 10485760 ? 'warning' : 'default' );
		html += renderMetricCard( String( queryCount ), 'DB Queries', queryCount > 100 ? 'warning' : 'default' );
		html += renderMetricCard( String( httpCount ), 'HTTP Calls', httpCount > 0 ? 'warning' : 'default' );
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
		if ( httpCalls.length > 0 ) {
			html += '<button class="scrutinizer-tab" data-tab="http">HTTP Calls (' + httpCalls.length + ')</button>';
		}
		if ( ( assets.counts && ( assets.counts.scripts + assets.counts.styles ) > 0 ) ) {
			html += '<button class="scrutinizer-tab" data-tab="assets">Assets (' + ( assets.counts.scripts + assets.counts.styles ) + ')</button>';
		}
		if ( autoloadOpts.count > 0 ) {
			html += '<button class="scrutinizer-tab" data-tab="options">Options (' + autoloadOpts.count + ')</button>';
		}
		if ( traceData.length > 0 ) {
			html += '<button class="scrutinizer-tab" data-tab="trace">Trace (' + traceData.length + ')</button>';
		}
		html += '<button class="scrutinizer-tab" data-tab="metadata">Metadata</button>';
		html += '</div>';

		// Tab: Timeline.
		html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-timeline">';
		html += renderTimeline( timeline, phaseMarkers, summary, sources, httpCalls );
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

		// Tab: Hook Execution Trace.
		if ( traceData.length > 0 ) {
			html += '<div class="scrutinizer-tab-content" id="scrutinizer-tab-trace" style="display:none">';
			html += renderTraceTab( traceData, sources );
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

	function renderTimeline( timeline, phaseMarkers, summary, sources, httpCalls ) {
		var durationNs = summary.duration_ns || 0;
		if ( 0 === durationNs ) {
			return '<p class="scrutinizer-empty">No timeline data available.</p>';
		}

		var html = '<div class="scrutinizer-timeline-container">';

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
			// Vertical stem from bottom, with dot at top and label above dot.
			html += '<div class="milestone" style="left:' + leftPct + '%;height:' + stemHeight + 'px">';
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
				// Duration-based dot color: fast (<100ms) = green, medium (<500ms) = orange, slow = red.
				var hDotCls = 'http-fast';
				if ( hCall.duration_ms >= 500 ) {
					hDotCls = 'http-slow';
				} else if ( hCall.duration_ms >= 100 ) {
					hDotCls = 'http-medium';
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
				html += '<span class="http-dot ' + hDotCls + '"></span>';
				html += '<span class="http-label">' + esc( truncate( hHost, 24 ) ) + ' <em>' + hDurMs + 'ms</em></span>';
				html += '</div>';
			}
			html += '</div>';
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
	/*  Breakdown bar                                                      */
	/* ------------------------------------------------------------------ */

	function renderBreakdown( summary ) {
		var breakdown = summary.breakdown || {};
		var html = '<div class="scrutinizer-breakdown">';
		html += '<div class="scrutinizer-breakdown-bar">';

		var barTypes = [ 'plugin', 'theme', 'core', 'mu-plugin', 'unknown', 'unattributed' ];
		for ( var b = 0; b < barTypes.length; b++ ) {
			var bt = barTypes[ b ];
			if ( breakdown[ bt ] && breakdown[ bt ].percent > 0 ) {
				var bColor = sourceColors[ bt ] || '#888';
				html += '<div class="segment" style="width:' + breakdown[ bt ].percent + '%;background:' + bColor + '" title="' + esc( bt ) + ': ' + breakdown[ bt ].percent + '%"></div>';
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
					html += ' <button type="button" class="scrutinizer-info-toggle" aria-label="What is unattributed time?">ⓘ</button>';
					html += '<span class="scrutinizer-info-bubble">Time spent in PHP bootstrap, autoloaders, database connections, WordPress core initialization, and opcode compilation — before hooks fire. This is normal overhead, not a problem to solve.</span>';
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
		html += '<th class="numeric">Memory</th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.inclusiveTime + '</th>';
		html += '<th class="numeric">' + scrutinizerAdmin.i18n.callCount + '</th>';
		html += '</tr></thead><tbody>';

		for ( var s = 0; s < sources.length; s++ ) {
			var src     = sources[ s ];
			var exclMs  = ( src.exclusive_ns / 1e6 ).toFixed( 2 );
			var pct     = ( ( src.exclusive_ns / totalExclNs ) * 100 ).toFixed( 1 );
			var barColor = getSourceColor( src.slug, src.type );
			var memDelta = src.memory_delta || 0;
			var memClass = memDelta > 1048576 ? ' scrutinizer-mem-high' : ( memDelta < 0 ? ' scrutinizer-mem-freed' : '' );

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

		html += '<table class="scrutinizer-source-table scrutinizer-http-table widefat">';
		html += '<thead><tr>';
		html += '<th class="numeric">#</th>';
		html += '<th>Method</th>';
		html += '<th>URL</th>';
		html += '<th class="numeric">Status</th>';
		html += '<th class="numeric">Duration</th>';
		html += '<th>Source</th>';
		html += '<th>Caller</th>';
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

			html += '<tr' + slow + '>';
			html += '<td class="numeric">' + ( i + 1 ) + '</td>';
			html += '<td>' + esc( hc.method || 'GET' ) + '</td>';
			html += '<td class="scrutinizer-sql-cell" title="' + esc( hc.url ) + '"><code>' + esc( truncate( hc.url || '', 80 ) ) + '</code></td>';
			html += '<td class="numeric">' + esc( statusLabel ) + '</td>';
			html += '<td class="numeric">' + hMs + ' ms</td>';
			html += '<td>' + esc( sourceName ) + '</td>';
			html += '<td class="scrutinizer-caller-cell" title="' + esc( callerStr ) + '">' + esc( truncate( callerStr, 60 ) ) + '</td>';
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
			html += renderAssetTable( scripts );
		}
		if ( styles.length > 0 ) {
			html += '<h4 class="scrutinizer-asset-section-label">Stylesheets</h4>';
			html += renderAssetTable( styles );
		}

		return html;
	}

	function renderAssetTable( assetList ) {
		var html = '<table class="scrutinizer-source-table scrutinizer-asset-table widefat">';
		html += '<thead><tr>';
		html += '<th>Handle</th>';
		html += '<th>Source</th>';
		html += '<th class="numeric">Size</th>';
		html += '<th>Location</th>';
		html += '<th>Dependencies</th>';
		html += '<th>Version</th>';
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
		html += '<tr><td>Peak Memory</td><td>' + formatBytes( memPeak ) + '</td></tr>';
		html += '<tr><td>Allocated by Hooks</td><td>' + formatBytes( memAlloc ) + '</td></tr>';
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
	 * Build a tree from the flat trace by inferring parent-child from time windows.
	 * A frame B is a child of frame A if B.start >= A.start && B.end <= A.end.
	 * The trace is sorted by start_ns (from CallStack pop order → re-sort needed).
	 */
	function buildTraceTree( flatTrace ) {
		if ( ! flatTrace || flatTrace.length === 0 ) {
			return [];
		}

		// Sort by start_ns ascending, break ties by end_ns descending (parents first).
		var entries = flatTrace.slice().sort( function( a, b ) {
			if ( a.start_ns !== b.start_ns ) { return a.start_ns - b.start_ns; }
			return b.end_ns - a.end_ns;
		});

		// Annotate with parsed id components.
		for ( var i = 0; i < entries.length; i++ ) {
			entries[i] = parseTraceId( entries[i] );
			entries[i].children = [];
		}

		// Stack-based tree builder.
		var roots = [];
		var stack = []; // stack of { node, end_ns }

		for ( var j = 0; j < entries.length; j++ ) {
			var node = entries[j];

			// Pop finished parents.
			while ( stack.length > 0 && stack[ stack.length - 1 ].end_ns <= node.start_ns ) {
				stack.pop();
			}

			if ( stack.length > 0 ) {
				stack[ stack.length - 1 ].node.children.push( node );
			} else {
				roots.push( node );
			}

			stack.push( { node: node, end_ns: node.end_ns } );
		}

		return roots;
	}

	function parseTraceId( entry ) {
		// id format: "callback_name@hook_tag:priority"
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
		return entry;
	}

	function renderTraceTab( traceData, sources ) {
		var tree = buildTraceTree( traceData );
		var totalNs = 0;
		for ( var t = 0; t < traceData.length; t++ ) {
			if ( traceData[t].exclusive_ns > totalNs ) {
				// Use the request duration from trace range instead.
			}
		}
		// Total request window for bar scaling.
		var minNs = Infinity, maxNs = 0;
		for ( var m = 0; m < traceData.length; m++ ) {
			if ( traceData[m].start_ns < minNs ) { minNs = traceData[m].start_ns; }
			if ( traceData[m].end_ns > maxNs ) { maxNs = traceData[m].end_ns; }
		}
		var spanNs = maxNs - minNs || 1;

		var html = '';

		// Summary.
		html += '<div class="scrutinizer-trace-summary">';
		html += '<span>' + traceData.length + ' callbacks traced</span>';
		html += ' · <span>' + tree.length + ' root hooks</span>';
		html += ' · <button class="button button-small" id="scrutinizer-trace-expand-all">Expand All</button>';
		html += ' <button class="button button-small" id="scrutinizer-trace-collapse-all">Collapse All</button>';
		html += ' · <input type="text" id="scrutinizer-trace-filter" placeholder="Filter callbacks…" class="scrutinizer-trace-filter" />';
		html += '</div>';

		// Tree.
		html += '<div class="scrutinizer-trace-tree">';
		html += renderTraceNodes( tree, 0, minNs, spanNs, sources );
		html += '</div>';

		return html;
	}

	function renderTraceNodes( nodes, depth, minNs, spanNs, sources ) {
		var html = '';
		for ( var i = 0; i < nodes.length; i++ ) {
			html += renderTraceNode( nodes[i], depth, minNs, spanNs, sources );
		}
		return html;
	}

	function renderTraceNode( node, depth, minNs, spanNs, sources ) {
		var hasChildren = node.children && node.children.length > 0;
		var inclusiveMs = ( node.inclusive_ns / 1e6 ).toFixed( 2 );
		var exclusiveMs = ( node.exclusive_ns / 1e6 ).toFixed( 2 );
		var barWidth    = Math.max( 1, ( node.inclusive_ns / spanNs ) * 100 );
		var barOffset   = ( ( node.start_ns - minNs ) / spanNs ) * 100;

		// Color from source lookup.
		var color = '#888';
		if ( sources ) {
			for ( var s = 0; s < sources.length; s++ ) {
				var src = sources[s];
				// Match callback to source by checking if the hook is associated.
				if ( src.type ) {
					color = sourceColors[ src.type ] || '#888';
				}
			}
		}
		// Simpler: color by callback prefix matching.
		color = getTraceColor( node._callback, node._hook );

		var nodeClass = 'scrutinizer-trace-node';
		if ( hasChildren ) { nodeClass += ' has-children'; }
		if ( depth === 0 ) { nodeClass += ' root-node'; }

		var html = '<div class="' + nodeClass + '" data-depth="' + depth + '">';

		// Row.
		html += '<div class="scrutinizer-trace-row" style="padding-left:' + ( depth * 20 + 4 ) + 'px">';

		// Toggle.
		if ( hasChildren ) {
			html += '<span class="scrutinizer-trace-toggle" title="' + node.children.length + ' children">▶</span>';
		} else {
			html += '<span class="scrutinizer-trace-leaf">·</span>';
		}

		// Callback name.
		html += '<span class="scrutinizer-trace-callback">' + esc( node._callback ) + '</span>';

		// Hook tag + priority.
		html += ' <span class="scrutinizer-trace-hook">@' + esc( node._hook );
		if ( node._priority ) {
			html += ':' + esc( node._priority );
		}
		html += '</span>';

		// Timing.
		html += '<span class="scrutinizer-trace-timing">';
		html += '<span class="scrutinizer-trace-inclusive">' + inclusiveMs + ' ms</span>';
		if ( hasChildren && node.exclusive_ns !== node.inclusive_ns ) {
			html += ' <span class="scrutinizer-trace-exclusive">(self: ' + exclusiveMs + ' ms)</span>';
		}
		html += '</span>';

		// Mini bar.
		html += '<span class="scrutinizer-trace-bar-wrap">';
		html += '<span class="scrutinizer-trace-bar" style="left:' + barOffset.toFixed( 2 ) + '%;width:' + barWidth.toFixed( 2 ) + '%;background:' + color + '"></span>';
		html += '</span>';

		html += '</div>'; // .scrutinizer-trace-row

		// Children (collapsed by default for depth > 0).
		if ( hasChildren ) {
			var collapsed = depth > 0 ? ' style="display:none"' : '';
			html += '<div class="scrutinizer-trace-children"' + collapsed + '>';
			html += renderTraceNodes( node.children, depth + 1, minNs, spanNs, sources );
			html += '</div>';
		}

		html += '</div>'; // .scrutinizer-trace-node
		return html;
	}

	function getTraceColor( callback, hook ) {
		// Try to identify plugin/theme from callback or hook name.
		// Common patterns: ClassName::method → check class prefix
		// For now, use hook-based coloring: core hooks get core color,
		// plugin-prefixed hooks get plugin color.
		var coreHooks = [ 'plugins_loaded', 'setup_theme', 'after_setup_theme', 'init',
			'wp_loaded', 'parse_request', 'wp', 'template_redirect', 'wp_head',
			'wp_enqueue_scripts', 'wp_footer', 'shutdown', 'admin_init', 'admin_menu',
			'admin_enqueue_scripts' ];

		for ( var i = 0; i < coreHooks.length; i++ ) {
			if ( hook === coreHooks[i] ) {
				return sourceColors.core;
			}
		}

		// WP_ prefix in callback usually means core.
		if ( callback.indexOf( 'WP_' ) === 0 || callback.indexOf( 'wp_' ) === 0 ) {
			return sourceColors.core;
		}

		// If callback contains a class from known sources, match it.
		// Fallback: use a rotating palette by callback's first segment.
		var key = callback.split( '::' )[0] || callback.split( '_' )[0] || callback;
		if ( ! pluginColorMap[ key ] ) {
			pluginColorMap[ key ] = pluginPalette[ colorIndex % pluginPalette.length ];
			colorIndex++;
		}
		return pluginColorMap[ key ];
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
					.html( '📌 ' + esc( scrutinizerAdmin.i18n.unpin || 'Unpin' ) );
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
					.html( '📌 ' + esc( scrutinizerAdmin.i18n.pin || 'Pin' ) );
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

		// Tag filter.
		html += '<input type="text" id="scrutinizer-history-tag" placeholder="' + esc( scrutinizerAdmin.i18n.filterByTag || 'Filter by tag…' ) + '" />';

		// Pinned only.
		html += '<label class="scrutinizer-history-check-label">';
		html += '<input type="checkbox" id="scrutinizer-history-pinned" /> ';
		html += '📌 ' + esc( scrutinizerAdmin.i18n.pinned || 'Pinned' );
		html += '</label>';

		// Date range.
		html += '<input type="date" id="scrutinizer-history-from" title="From date" />';
		html += '<span class="scrutinizer-history-dash">–</span>';
		html += '<input type="date" id="scrutinizer-history-to" title="To date" />';

		// Compare button (hidden until 2 selected).
		html += '<button type="button" class="button" id="scrutinizer-compare-btn" style="display:none">' + esc( scrutinizerAdmin.i18n.compareSelected || 'Compare Selected' ) + '</button>';

		html += '</div>';
		return html;
	}

	function fetchHistory() {
		var params = {
			action: 'scrutinizer_get_history',
			nonce:  scrutinizerAdmin.nonce
		};

		var route = $( '#scrutinizer-history-route' ).val();
		var tag   = $( '#scrutinizer-history-tag' ).val();
		var pinned = $( '#scrutinizer-history-pinned' ).is( ':checked' );
		var from  = $( '#scrutinizer-history-from' ).val();
		var to    = $( '#scrutinizer-history-to' ).val();

		if ( route ) {
			params.route_key = route;
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
				historyData = response.data.profiles || [];
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

		var html = '<table class="scrutinizer-profile-table scrutinizer-history-table widefat">';
		html += '<thead><tr>';
		html += '<th class="scrutinizer-check-col"></th>';
		html += '<th>Captured</th>';
		html += '<th>Route</th>';
		html += '<th class="numeric">Duration</th>';
		html += '<th>📌</th>';
		html += '<th>Note</th>';
		html += '<th>Tags</th>';
		html += '<th>Actions</th>';
		html += '</tr></thead><tbody>';

		for ( var i = 0; i < profiles.length; i++ ) {
			var p     = profiles[ i ];
			var durMs = ( parseInt( p.duration_ns, 10 ) / 1e6 ).toFixed( 1 );
			var pinIcon = parseInt( p.is_pinned, 10 ) === 1 ? '📌' : '';
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
		if ( 2 === count ) {
			$( '#scrutinizer-compare-btn' ).show();
		} else {
			$( '#scrutinizer-compare-btn' ).hide();
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Cron inventory view                                                */
	/* ------------------------------------------------------------------ */

	var cronData = null; // cached cron inventory

	function showCronView() {
		currentView = 'cron';
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
		html += '<div class="scrutinizer-metrics">';
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
		html += '<table class="scrutinizer-cron-table">';
		html += '<thead><tr>';
		html += '<th>Hook</th>';
		html += '<th>Next Run</th>';
		html += '<th>Schedule</th>';
		html += '<th>Source</th>';
		html += '<th>Status</th>';
		html += '</tr></thead>';
		html += '<tbody>';

		for ( var i = 0; i < events.length; i++ ) {
			var ev = events[i];
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
			html += '<table class="scrutinizer-cron-schedule-table"><thead><tr><th>Name</th><th>Interval</th><th>Display</th></tr></thead><tbody>';
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

		var html = '<div id="scrutinizer-compare-view">';
		html += '<button type="button" class="button button-link" id="scrutinizer-back-to-history">' + esc( scrutinizerAdmin.i18n.backToHistory || '← Back to history' ) + '</button>';
		html += '<h2>' + esc( scrutinizerAdmin.i18n.compare || 'Compare' ) + '</h2>';

		// Header: Profile A vs Profile B.
		html += '<div class="scrutinizer-compare-header">';
		html += '<div class="compare-profile-label"><strong>A:</strong> ' + esc( reqA.method || '' ) + ' ' + esc( truncate( reqA.url || a.request_url || '', 60 ) ) + '<br><small>' + esc( a.captured_at ) + '</small></div>';
		html += '<div class="compare-vs">vs</div>';
		html += '<div class="compare-profile-label"><strong>B:</strong> ' + esc( reqB.method || '' ) + ' ' + esc( truncate( reqB.url || b.request_url || '', 60 ) ) + '<br><small>' + esc( b.captured_at ) + '</small></div>';
		html += '</div>';

		// Summary comparison.
		html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
		html += '<thead><tr><th>Metric</th><th class="numeric">Profile A</th><th class="numeric">Profile B</th><th class="numeric">Delta</th></tr></thead>';
		html += '<tbody>';

		// Duration.
		html += compareRow( 'Total Duration',
			( delta.duration_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.duration_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.duration_ns,
			delta.duration_a_ns
		);

		// Unattributed.
		html += compareRow( 'Unattributed',
			( delta.unattributed_a_ns / 1e6 ).toFixed( 1 ) + ' ms',
			( delta.unattributed_b_ns / 1e6 ).toFixed( 1 ) + ' ms',
			delta.unattributed_delta_ns,
			delta.unattributed_a_ns
		);

		// Query count.
		html += compareRow( 'DB Queries',
			String( delta.query_count_a ),
			String( delta.query_count_b ),
			delta.query_count_delta * 1e6, // Scale to ns-like for delta display.
			delta.query_count_a || 1
		);

		// Peak memory.
		if ( delta.memory_peak_a || delta.memory_peak_b ) {
			html += compareRow( 'Peak Memory',
				formatBytes( delta.memory_peak_a ),
				formatBytes( delta.memory_peak_b ),
				delta.memory_peak_delta,
				delta.memory_peak_a || 1
			);
		}

		// Allocated memory.
		if ( delta.memory_alloc_a || delta.memory_alloc_b ) {
			html += compareRow( 'Allocated by Hooks',
				formatBytes( delta.memory_alloc_a ),
				formatBytes( delta.memory_alloc_b ),
				delta.memory_alloc_delta,
				delta.memory_alloc_a || 1
			);
		}

		html += '</tbody></table>';

		// Per-source breakdown.
		var sources = delta.sources || {};
		var sourceKeys = Object.keys( sources );
		if ( sourceKeys.length > 0 ) {
			html += '<h3>Per-Source Breakdown</h3>';
			html += '<table class="scrutinizer-source-table scrutinizer-compare-table widefat">';
			html += '<thead><tr><th>Source</th><th class="numeric">Profile A</th><th class="numeric">Profile B</th><th class="numeric">Delta</th></tr></thead>';
			html += '<tbody>';

			// Sort by absolute delta descending.
			sourceKeys.sort( function( a, b ) {
				return Math.abs( sources[ b ].delta_ns ) - Math.abs( sources[ a ].delta_ns );
			} );

			for ( var si = 0; si < sourceKeys.length; si++ ) {
				var sk  = sourceKeys[ si ];
				var sd  = sources[ sk ];
				html += compareRow( sk,
					( sd.a_ns / 1e6 ).toFixed( 2 ) + ' ms',
					( sd.b_ns / 1e6 ).toFixed( 2 ) + ' ms',
					sd.delta_ns,
					sd.a_ns || 1
				);
			}

			html += '</tbody></table>';
		}

		html += '</div>';

		$( '#scrutinizer-results' ).after( html );
	}

	function compareRow( label, valA, valB, deltaNs, baseNs ) {
		var deltaMs  = ( deltaNs / 1e6 ).toFixed( 1 );
		var pctChange = baseNs ? ( ( deltaNs / baseNs ) * 100 ).toFixed( 1 ) : '0.0';
		var cls = '';
		var suffix = '';
		if ( deltaNs < 0 ) {
			cls = 'scrutinizer-delta-negative'; // Green — faster.
			suffix = ' ' + esc( scrutinizerAdmin.i18n.faster || 'faster' );
		} else if ( deltaNs > 0 ) {
			cls = 'scrutinizer-delta-positive'; // Red — slower.
			suffix = ' ' + esc( scrutinizerAdmin.i18n.slower || 'slower' );
		} else {
			suffix = ' ' + esc( scrutinizerAdmin.i18n.noChange || 'no change' );
		}

		var deltaStr = ( deltaNs >= 0 ? '+' : '' ) + deltaMs + ' ms (' + ( deltaNs >= 0 ? '+' : '' ) + pctChange + '%)' + suffix;

		var html = '<tr>';
		html += '<td>' + esc( label ) + '</td>';
		html += '<td class="numeric">' + esc( valA ) + '</td>';
		html += '<td class="numeric">' + esc( valB ) + '</td>';
		html += '<td class="numeric ' + cls + '">' + deltaStr + '</td>';
		html += '</tr>';
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
		html += '<div class="scrutinizer-api-section">';
		html += '<h3 class="scrutinizer-api-heading"><span class="dashicons dashicons-share-alt2"></span> Send to Agent</h3>';
		html += '<p class="scrutinizer-api-desc">Generate a one-time prompt that gives an AI agent read-only access to your profiling data. ';
		html += 'The credential auto-expires and is scoped to Scrutineer endpoints only.</p>';
		html += '<div class="scrutinizer-send-agent-controls">';
		html += '<button type="button" class="button button-primary" id="scrutinizer-create-api-key">';
		html += '<span class="dashicons dashicons-clipboard"></span> Copy Prompt to Clipboard</button>';
		html += '<button type="button" class="button button-link scrutinizer-revoke-link" id="scrutinizer-revoke-api-key" style="display:none;">';
		html += '<span class="dashicons dashicons-dismiss"></span> Revoke Access</button>';
		html += '</div>';
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
		html += '<table class="scrutinizer-api-endpoints">';
		html += '<thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>';
		html += '<tbody>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/prompt</code></td><td>System prompt (text/plain) — the API contract</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/diagnostics</code></td><td>Site fingerprint with opt-in fields</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/routes</code></td><td>Profiled routes with summary stats</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/profile/{id}</code></td><td>Compiled profile detail</td></tr>';
		html += '<tr><td><code>GET</code></td><td><code>/v1/compare/{a}/{b}</code></td><td>Two profiles with deltas</td></tr>';
		html += '</tbody></table>';
		if ( apiBase ) {
			html += '<p class="scrutinizer-api-base">Base URL: <code>' + esc( apiBase ) + '</code></p>';
		}
		html += '</div>';

		$container.html( html );

		bindApiEvents( $container );
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
