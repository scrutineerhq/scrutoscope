<?php
/**
 * Admin dashboard page.
 *
 * @package Scrutinizer
 */

namespace Scrutinizer\Admin;

use Scrutinizer\Profiler\Session;
use Scrutinizer\Profiler\Storage;

/**
 * Registers the Scrutinizer page under the Tools menu and renders the dashboard.
 */
class Dashboard {

	/**
	 * Register the admin page.
	 */
	public static function register() {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu_page' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );
		add_action( 'admin_head', array( __CLASS__, 'suppress_admin_notices' ) );
	}

	/**
	 * Add the Tools → Scrutinizer menu page.
	 */
	public static function add_menu_page() {
		add_management_page(
			__( 'Scrutinizer', 'scrutinizer' ),
			__( 'Scrutinizer', 'scrutinizer' ),
			'manage_options',
			'scrutinizer',
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * Suppress third-party admin notices on the Scrutinizer page.
	 */
	public static function suppress_admin_notices() {
		$screen = get_current_screen();
		if ( null === $screen || 'tools_page_scrutinizer' !== $screen->id ) {
			return;
		}
		remove_all_actions( 'admin_notices' );
		remove_all_actions( 'all_admin_notices' );
	}

	/**
	 * Enqueue admin assets on the Scrutinizer page only.
	 *
	 * @param string $hook_suffix  The admin page hook suffix.
	 */
	public static function enqueue_assets( $hook_suffix ) {
		if ( 'tools_page_scrutinizer' !== $hook_suffix ) {
			return;
		}

		wp_enqueue_style(
			'scrutinizer-dashboard',
			SCRUTINIZER_URL . 'assets/css/dashboard.css',
			array(),
			SCRUTINIZER_VERSION . '.' . filemtime( SCRUTINIZER_DIR . 'assets/css/dashboard.css' )
		);

		wp_enqueue_script(
			'scrutinizer-dashboard',
			SCRUTINIZER_URL . 'assets/js/dashboard.js',
			array( 'jquery' ),
			SCRUTINIZER_VERSION . '.' . filemtime( SCRUTINIZER_DIR . 'assets/js/dashboard.js' ),
			true
		);

		// Look up recent profiles so the dashboard always has something to show.
		$recent          = Storage::get_recent_profiles( 50 );
		$recent_count    = count( $recent );
		$last_session_id = '';
		if ( $recent_count > 0 && isset( $recent[0]['session_id'] ) ) {
			$last_session_id = $recent[0]['session_id'];
		}

		wp_localize_script(
			'scrutinizer-dashboard',
			'scrutinizerAdmin',
			array(
				'ajaxUrl'              => admin_url( 'admin-ajax.php' ),
				'nonce'                => wp_create_nonce( 'scrutinizer_nonce' ),
				'version'              => SCRUTINIZER_VERSION,
				'isActive'             => Session::has_valid_cookie(),
				'sessionId'            => Session::get_session_id(),
				'lastSessionId'        => $last_session_id,
				'profileCount'         => $recent_count,
				'siteUrl'              => home_url( '/' ),
				'backgroundEnabled'    => (bool) get_option( 'scrutinizer_background_profiling', false ),
				'backgroundSampleRate' => (float) get_option( 'scrutinizer_sample_rate', 10 ),
				'onlySuccessful'       => (bool) get_option( 'scrutinizer_only_successful', false ),
				'retentionDays'        => (int) get_option( 'scrutinizer_retention_days', 7 ),
				'trustProxyHeaders'    => (bool) get_option( 'scrutinizer_trust_proxy_headers', false ),
				'detectedProxyHeaders' => self::detect_proxy_headers(),
				'maxPerRoute'          => (int) get_option( 'scrutinizer_max_per_route', 100 ),
				'apiBase'              => rest_url( 'scrutinizer/v1/' ),
				'restNonce'            => wp_create_nonce( 'wp_rest' ),
				'diagnosticsFields'    => \Scrutinizer\Api\Diagnostics::get_enabled_fields(),
				'diagnosticsOptIn'     => \Scrutinizer\Api\Diagnostics::OPT_IN_FIELDS,
				'queryProfiling'       => scrutinizer_query_profiling_state(),
				'i18n'                 => array(
					'startProfiling'  => __( 'Start Profiling', 'scrutinizer' ),
					'stopProfiling'   => __( 'Stop Profiling', 'scrutinizer' ),
					'profiling'       => __( 'Profiling active…', 'scrutinizer' ),
					'noProfiles'      => __( 'No profiles captured yet. Browse your site to capture requests.', 'scrutinizer' ),
					'copied'          => __( 'Activation URL copied to clipboard.', 'scrutinizer' ),
					'error'           => __( 'An error occurred. Please try again.', 'scrutinizer' ),
					'confirmDelete'   => __( 'Delete this profile?', 'scrutinizer' ),
					'serverDuration'  => __( 'Server Request Duration', 'scrutinizer' ),
					'exclusiveTime'   => __( 'Exclusive Callback Time', 'scrutinizer' ),
					'inclusiveTime'   => __( 'Inclusive Callback Time', 'scrutinizer' ),
					'callCount'       => __( 'Call Count', 'scrutinizer' ),
					'unattributed'    => __( 'Unattributed / Bootstrap', 'scrutinizer' ),
					'backToList'      => __( '← Back to profiles', 'scrutinizer' ),
					'pin'             => __( 'Pin', 'scrutinizer' ),
					'unpin'           => __( 'Unpin', 'scrutinizer' ),
					'note'            => __( 'Note', 'scrutinizer' ),
					'tags'            => __( 'Tags', 'scrutinizer' ),
					'history'         => __( 'History', 'scrutinizer' ),
					'routes'          => __( 'Routes', 'scrutinizer' ),
					'compare'         => __( 'Compare', 'scrutinizer' ),
					'pinned'          => __( 'Pinned', 'scrutinizer' ),
					'allProfiles'     => __( 'All Profiles', 'scrutinizer' ),
					'filterByRoute'   => __( 'All routes', 'scrutinizer' ),
					'filterByTag'     => __( 'Filter by tag…', 'scrutinizer' ),
					'noResults'       => __( 'No profiles match the current filters.', 'scrutinizer' ),
					'compareSelected' => __( 'Compare Selected', 'scrutinizer' ),
					'backToHistory'   => __( '← Back to history', 'scrutinizer' ),
					'faster'          => __( 'faster', 'scrutinizer' ),
					'slower'          => __( 'slower', 'scrutinizer' ),
					'noChange'        => __( 'no change', 'scrutinizer' ),
				),
			)
		);
	}

	/**
	 * Render the dashboard page.
	 */
	public static function render() {
		$is_active  = Session::has_valid_cookie();
		$session_id = Session::get_session_id();
		?>
		<div class="wrap" id="scrutinizer-dashboard">
			<h1>
				<a href="#" id="scrutinizer-home-link" style="text-decoration:none;color:inherit;">
				<?php echo esc_html__( 'Scrutinizer', 'scrutinizer' ); ?>
				</a>
				<button type="button" class="scrutinizer-gear-toggle" title="<?php echo esc_attr__( 'Settings', 'scrutinizer' ); ?>" aria-label="<?php echo esc_attr__( 'Settings', 'scrutinizer' ); ?>" aria-expanded="false" aria-controls="scrutinizer-settings-panel">
					<span class="dashicons dashicons-admin-generic"></span>
				</button>
			</h1>

			<!-- Activation URL (hidden until generated) -->
			<div class="scrutinizer-activation" id="scrutinizer-activation" style="display:none;">
				<h3><?php echo esc_html__( 'Activation URL', 'scrutinizer' ); ?></h3>
				<p><?php echo esc_html__( 'Visit this URL to start capturing profiles. The link expires in 5 minutes.', 'scrutinizer' ); ?></p>
				<div class="scrutinizer-url-box">
					<input type="text" id="scrutinizer-activation-url" readonly class="regular-text" />
					<button type="button" class="button" id="scrutinizer-copy-url">
						<?php echo esc_html__( 'Copy', 'scrutinizer' ); ?>
					</button>
				</div>
			</div>

			<!-- Home View (landing screen) -->
			<div class="scrutinizer-home" id="scrutinizer-home">
				<div class="scrutinizer-home-cards">
					<button type="button" class="scrutinizer-home-card" id="scrutinizer-home-capture">
						<span class="dashicons dashicons-performance"></span>
						<strong><?php echo esc_html__( 'Capture Profile', 'scrutinizer' ); ?></strong>
						<span><?php echo esc_html__( 'Measure a page and see where time goes', 'scrutinizer' ); ?></span>
					</button>
					<button type="button" class="scrutinizer-home-card" id="scrutinizer-home-profiles">
						<span class="dashicons dashicons-chart-bar"></span>
						<strong><?php echo esc_html__( 'View Profiles', 'scrutinizer' ); ?></strong>
						<span><?php echo esc_html__( 'Browse captured measurements', 'scrutinizer' ); ?></span>
					</button>
					<button type="button" class="scrutinizer-home-card" id="scrutinizer-home-settings">
						<span class="dashicons dashicons-admin-generic"></span>
						<strong><?php echo esc_html__( 'Settings', 'scrutinizer' ); ?></strong>
						<span><?php echo esc_html__( 'Background measurement, sample rate, query profiling', 'scrutinizer' ); ?></span>
					</button>
				</div>
				<div class="scrutinizer-home-faq">
					<div class="scrutinizer-faq-item">
						<strong><?php echo esc_html__( 'Will this slow down my site?', 'scrutinizer' ); ?></strong>
						<p><?php echo esc_html__( 'Instrumentation adds 2–5 ms per request. Background measurement samples a fraction of traffic. Your visitors will not notice.', 'scrutinizer' ); ?></p>
					</div>
					<div class="scrutinizer-faq-item">
						<strong><?php echo esc_html__( 'Does any data leave my server?', 'scrutinizer' ); ?></strong>
						<p><?php echo esc_html__( 'No. All profiling data stays in your WordPress database. Sharing a report is optional and end-to-end encrypted — the relay server cannot read your data.', 'scrutinizer' ); ?></p>
					</div>
					<div class="scrutinizer-faq-item">
						<strong><?php echo esc_html__( 'Who can see this?', 'scrutinizer' ); ?></strong>
						<p><?php echo esc_html__( 'Only administrators. Scrutinizer is invisible to logged-out visitors and non-admin users.', 'scrutinizer' ); ?></p>
					</div>
					<div class="scrutinizer-faq-item">
						<strong><?php echo esc_html__( 'Need help?', 'scrutinizer' ); ?></strong>
						<p>
							<?php
							printf(
								/* translators: %s: GitHub Issues URL */
								esc_html__( 'File an issue at %s — bug reports, feature requests, and questions are all welcome.', 'scrutinizer' ),
								'<a href="https://github.com/scrutineerhq/scrutinizer/issues" target="_blank" rel="noopener">GitHub Issues</a>'
							);
							?>
						</p>
					</div>
				</div>
			</div>
			<div class="scrutinizer-capture-flow" id="scrutinizer-capture-flow" style="display:none;">
				<button type="button" class="button button-link" id="scrutinizer-capture-back">
					<?php echo esc_html__( '← Back', 'scrutinizer' ); ?>
				</button>
				<h2><?php echo esc_html__( 'Capture Profile', 'scrutinizer' ); ?></h2>
				<p class="scrutinizer-capture-intro"><?php echo esc_html__( 'Choose what to measure. The target page opens in a new tab — browse around, then come back to this window and click Stop Profiling when done.', 'scrutinizer' ); ?></p>
				<div class="scrutinizer-decision-cards">
					<button type="button" class="scrutinizer-decision-card" data-target="<?php echo esc_url( admin_url() ); ?>" data-mode="admin">
						<span class="dashicons dashicons-dashboard"></span>
						<strong><?php echo esc_html__( 'Admin Dashboard', 'scrutinizer' ); ?></strong>
						<span><?php echo esc_html__( 'Measure admin page performance', 'scrutinizer' ); ?></span>
						<span class="scrutinizer-card-hint"><?php echo esc_html__( 'Opens in new tab', 'scrutinizer' ); ?></span>
					</button>
					<button type="button" class="scrutinizer-decision-card" data-target="<?php echo esc_url( home_url( '/' ) ); ?>" data-mode="frontend">
						<span class="dashicons dashicons-admin-users"></span>
						<strong><?php echo esc_html__( 'Logged-in Frontend', 'scrutinizer' ); ?></strong>
						<span><?php echo esc_html__( 'Measure pages while logged in', 'scrutinizer' ); ?></span>
						<span class="scrutinizer-card-hint"><?php echo esc_html__( 'Opens in new tab', 'scrutinizer' ); ?></span>
					</button>
					<button type="button" class="scrutinizer-decision-card" data-target="<?php echo esc_url( home_url( '/' ) ); ?>" data-mode="visitor">
						<span class="dashicons dashicons-visibility"></span>
						<strong><?php echo esc_html__( 'Visitor View', 'scrutinizer' ); ?></strong>
						<span><?php echo esc_html__( 'Measure what visitors experience', 'scrutinizer' ); ?></span>
						<span class="scrutinizer-card-hint"><?php echo esc_html__( 'Requires incognito window', 'scrutinizer' ); ?></span>
					</button>
				</div>
				<div id="scrutinizer-capture-status"></div>
			</div>

			<!-- Results (routes/history/cron/api tabs) -->
			<div class="scrutinizer-results" id="scrutinizer-results" style="display:none;">
				<h2><?php echo esc_html__( 'Routes', 'scrutinizer' ); ?></h2>
				<div id="scrutinizer-profile-list">
					<p class="scrutinizer-empty scrutinizer-loading"><?php echo esc_html__( 'Loading…', 'scrutinizer' ); ?></p>
				</div>
			</div>

			<!-- Profile Detail (hidden until selected) -->
			<div class="scrutinizer-detail" id="scrutinizer-detail" style="display:none;">
				<button type="button" class="button button-link" id="scrutinizer-back-to-list">
					<?php echo esc_html__( '← Back to profiles', 'scrutinizer' ); ?>
				</button>
				<div id="scrutinizer-detail-content"></div>
			</div>

			<!-- Settings Panel (D33 — toggled by gear icon) -->
			<div id="scrutinizer-settings-modal" class="scrutinizer-modal" style="display:none;" role="dialog" aria-label="<?php echo esc_attr__( 'Settings', 'scrutinizer' ); ?>">
				<div class="scrutinizer-modal-overlay"></div>
				<div class="scrutinizer-modal-content">
					<div class="scrutinizer-modal-header">
						<h2><?php echo esc_html__( 'Settings', 'scrutinizer' ); ?></h2>
						<button type="button" id="scrutinizer-settings-modal-close" class="scrutinizer-modal-close" aria-label="<?php echo esc_attr__( 'Close', 'scrutinizer' ); ?>">&times;</button>
					</div>
					<div class="scrutinizer-modal-body" id="scrutinizer-settings-panel">

				<!-- Session Status -->
				<div class="scrutinizer-status-card" id="scrutinizer-status">
					<h3><?php echo esc_html__( 'Session Status', 'scrutinizer' ); ?></h3>
					<div class="scrutinizer-status-indicator">
						<span class="scrutinizer-dot <?php echo $is_active ? 'active' : 'inactive'; ?>"></span>
						<span id="scrutinizer-status-text">
							<?php
							if ( $is_active ) {
								echo esc_html__( 'Profiling active', 'scrutinizer' );
							} else {
								echo esc_html__( 'Profiling inactive', 'scrutinizer' );
							}
							?>
						</span>
					</div>

					<?php if ( $is_active ) : ?>
						<p class="scrutinizer-session-info">
							<?php
							printf(
								/* translators: %s: session ID */
								esc_html__( 'Session: %s', 'scrutinizer' ),
								'<code>' . esc_html( $session_id ) . '</code>'
							);
							?>
						</p>
					<?php endif; ?>
				</div>

				<!-- Controls -->
				<div class="scrutinizer-controls" id="scrutinizer-controls">
					<?php if ( $is_active ) : ?>
						<button type="button" class="button button-secondary button-large" id="scrutinizer-stop"><?php echo esc_html__( 'Stop Profiling', 'scrutinizer' ); ?></button>
					<?php endif; ?>
				</div>

				<!-- Background Profiling + Query Profiling rendered by JS here -->
					</div>
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * Detect which proxy headers are present on the current request.
	 *
	 * Used to auto-recommend the trust-proxy-headers setting.
	 *
	 * @return array List of detected header names (empty if none).
	 */
	private static function detect_proxy_headers() {
		$check   = array(
			'HTTP_CF_CONNECTING_IP' => 'CF-Connecting-IP',
			'HTTP_X_FORWARDED_FOR'  => 'X-Forwarded-For',
			'HTTP_X_REAL_IP'        => 'X-Real-IP',
		);
		$found = array();

		foreach ( $check as $server_key => $header_name ) {
			if ( ! empty( $_SERVER[ $server_key ] ) ) {
				$found[] = $header_name;
			}
		}

		return $found;
	}
}
