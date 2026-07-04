<?php
/**
 * Admin dashboard page.
 *
 * @package Scrutoscope
 */

namespace Scrutoscope\Admin;

defined( 'ABSPATH' ) || exit;

use Scrutoscope\Profiler\Session;
use Scrutoscope\Profiler\Storage;

/**
 * Registers the Scrutoscope page under the Tools menu and renders the dashboard.
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
	 * Add the Tools → Scrutoscope menu page.
	 */
	public static function add_menu_page() {
		add_management_page(
			__( 'Scrutoscope', 'scrutoscope' ),
			__( 'Scrutoscope', 'scrutoscope' ),
			'manage_options',
			'scrutoscope',
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * Suppress third-party admin notices on the Scrutoscope page.
	 */
	public static function suppress_admin_notices() {
		$screen = get_current_screen();
		if ( null === $screen || 'tools_page_scrutoscope' !== $screen->id ) {
			return;
		}
		remove_all_actions( 'admin_notices' );
		remove_all_actions( 'all_admin_notices' );
	}

	/**
	 * Enqueue admin assets on the Scrutoscope page only.
	 *
	 * @param string $hook_suffix  The admin page hook suffix.
	 */
	public static function enqueue_assets( $hook_suffix ) {
		if ( 'tools_page_scrutoscope' !== $hook_suffix ) {
			return;
		}

		$suffix = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min';

		wp_enqueue_style(
			'scrutoscope-dashboard',
			SCRUTOSCOPE_URL . 'assets/css/dashboard' . $suffix . '.css',
			array(),
			SCRUTOSCOPE_VERSION . '.' . filemtime( SCRUTOSCOPE_DIR . 'assets/css/dashboard' . $suffix . '.css' )
		);

		// Shared, framework-agnostic timeline renderer — the same module the
		// relay viewer embeds, so both viewing surfaces render identically.
		wp_enqueue_script(
			'scrutoscope-timeline',
			SCRUTOSCOPE_URL . 'assets/js/scrutoscope-timeline' . $suffix . '.js',
			array(),
			SCRUTOSCOPE_VERSION . '.' . filemtime( SCRUTOSCOPE_DIR . 'assets/js/scrutoscope-timeline' . $suffix . '.js' ),
			true
		);

		wp_enqueue_script(
			'scrutoscope-dashboard',
			SCRUTOSCOPE_URL . 'assets/js/dashboard' . $suffix . '.js',
			array( 'jquery', 'wp-i18n', 'scrutoscope-timeline' ),
			SCRUTOSCOPE_VERSION . '.' . filemtime( SCRUTOSCOPE_DIR . 'assets/js/dashboard' . $suffix . '.js' ),
			true
		);

		// Load JS translations for strings wrapped with wp.i18n. Requires the
		// 'wp-i18n' dependency above and compiled .json files in languages/.
		wp_set_script_translations( 'scrutoscope-dashboard', 'scrutoscope', SCRUTOSCOPE_DIR . 'languages' );

		// Look up recent profiles so the dashboard always has something to show.
		$recent          = Storage::get_recent_profiles( 50 );
		$recent_count    = count( $recent );
		$last_session_id = '';
		if ( $recent_count > 0 && isset( $recent[0]['session_id'] ) ) {
			$last_session_id = $recent[0]['session_id'];
		}

		wp_localize_script(
			'scrutoscope-dashboard',
			'scrutoscopeAdmin',
			array(
				'ajaxUrl'              => admin_url( 'admin-ajax.php' ),
				'nonce'                => wp_create_nonce( 'scrutoscope_nonce' ),
				'version'              => SCRUTOSCOPE_VERSION,
				'dbPrefix'             => $GLOBALS['wpdb']->prefix,
				'isActive'             => Session::has_valid_cookie(),
				'sessionId'            => Session::get_session_id(),
				'lastSessionId'        => $last_session_id,
				'profileCount'         => $recent_count,
				'siteUrl'              => home_url( '/' ),
				'backgroundEnabled'    => (bool) get_option( 'scrutoscope_background_profiling', false ),
				'backgroundSampleRate' => (float) get_option( 'scrutoscope_sample_rate', 10 ),
				'onlySuccessful'       => (bool) get_option( 'scrutoscope_only_successful', false ),
				'retentionDays'        => (int) get_option( 'scrutoscope_retention_days', 7 ),
				'trustProxyHeaders'    => (bool) get_option( 'scrutoscope_trust_proxy_headers', false ),
				'detectedProxyHeaders' => self::detect_proxy_headers(),
				'userScope'            => get_option( 'scrutoscope_user_scope', 'all' ),
				'excludePaths'         => get_option( 'scrutoscope_exclude_paths', '' ),
				'maxPerRoute'          => (int) get_option( 'scrutoscope_max_per_route', 100 ),
				'apiBase'              => rest_url( 'scrutoscope/v1/' ),
				'restNonce'            => wp_create_nonce( 'wp_rest' ),
				'diagnosticsFields'    => \Scrutoscope\Api\Diagnostics::get_enabled_fields(),
				'diagnosticsOptIn'     => \Scrutoscope\Api\Diagnostics::OPT_IN_FIELDS,
				'queryProfiling'       => scrutoscope_query_profiling_state(),
				'lightweightMode'      => (bool) get_option( 'scrutoscope_lightweight_mode', false ),
				'profileCron'          => (bool) get_option( 'scrutoscope_profile_cron', false ),
				'earlyBoot'            => array(
					'installed' => EarlyBoot::is_installed(),
					'enabled'   => (bool) get_option( EarlyBoot::OPTION, false ),
					'path'      => EarlyBoot::target_path(),
					'dismissed' => (bool) get_user_meta( get_current_user_id(), 'scrutoscope_early_boot_banner_dismissed', true ),
				),
				'i18n'                 => array(
					'startProfiling'  => __( 'Start Profiling', 'scrutoscope' ),
					'stopProfiling'   => __( 'Stop Profiling', 'scrutoscope' ),
					'profiling'       => __( 'Profiling active…', 'scrutoscope' ),
					'noProfiles'      => __( 'No profiles captured yet. Browse your site to capture requests.', 'scrutoscope' ),
					'copied'          => __( 'Activation URL copied to clipboard.', 'scrutoscope' ),
					'error'           => __( 'An error occurred. Please try again.', 'scrutoscope' ),
					'confirmDelete'   => __( 'Delete this profile?', 'scrutoscope' ),
					'serverDuration'  => __( 'Server Request Duration', 'scrutoscope' ),
					'exclusiveTime'   => __( 'Exclusive Callback Time', 'scrutoscope' ),
					'inclusiveTime'   => __( 'Inclusive Callback Time', 'scrutoscope' ),
					'callCount'       => __( 'Call Count', 'scrutoscope' ),
					'unattributed'    => __( 'Unattributed / Bootstrap', 'scrutoscope' ),
					'backToList'      => __( '← Back to profiles', 'scrutoscope' ),
					'pin'             => __( 'Pin', 'scrutoscope' ),
					'unpin'           => __( 'Unpin', 'scrutoscope' ),
					'note'            => __( 'Note', 'scrutoscope' ),
					'tags'            => __( 'Tags', 'scrutoscope' ),
					'history'         => __( 'History', 'scrutoscope' ),
					'routes'          => __( 'Routes', 'scrutoscope' ),
					'compare'         => __( 'Compare', 'scrutoscope' ),
					'pinned'          => __( 'Pinned', 'scrutoscope' ),
					'allProfiles'     => __( 'All Profiles', 'scrutoscope' ),
					'filterByRoute'   => __( 'All routes', 'scrutoscope' ),
					'filterByTag'     => __( 'Filter by tag…', 'scrutoscope' ),
					'noResults'       => __( 'No profiles match the current filters.', 'scrutoscope' ),
					'compareSelected' => __( 'Compare Selected', 'scrutoscope' ),
					'backToHistory'   => __( '← Back to history', 'scrutoscope' ),
					'faster'          => __( 'faster', 'scrutoscope' ),
					'slower'          => __( 'slower', 'scrutoscope' ),
					'noChange'        => __( 'no change', 'scrutoscope' ),
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
		<div class="wrap" id="scrutoscope-dashboard">
			<h1>
				<a href="#" id="scrutoscope-home-link" style="text-decoration:none;color:inherit;">
				<?php echo esc_html__( 'Scrutoscope', 'scrutoscope' ); ?>
				</a>
				<button type="button" class="scrutoscope-gear-toggle" title="<?php echo esc_attr__( 'Settings', 'scrutoscope' ); ?>" aria-label="<?php echo esc_attr__( 'Settings', 'scrutoscope' ); ?>" aria-expanded="false" aria-controls="scrutoscope-settings-view">
					<span class="dashicons dashicons-admin-generic"></span>
				</button>
			</h1>

			<!-- Activation URL (hidden until generated) -->
			<div class="scrutoscope-activation" id="scrutoscope-activation" style="display:none;">
				<h3><?php echo esc_html__( 'Activation URL', 'scrutoscope' ); ?></h3>
				<p><?php echo esc_html__( 'Visit this URL to start capturing profiles. The link expires in 5 minutes.', 'scrutoscope' ); ?></p>
				<div class="scrutoscope-url-box">
					<input type="text" id="scrutoscope-activation-url" readonly class="regular-text" />
					<button type="button" class="button" id="scrutoscope-copy-url">
						<?php echo esc_html__( 'Copy', 'scrutoscope' ); ?>
					</button>
				</div>
			</div>

			<!-- Home View (landing screen) -->
			<div class="scrutoscope-home" id="scrutoscope-home">
				<div class="scrutoscope-home-cards">
					<button type="button" class="scrutoscope-home-card" id="scrutoscope-home-capture">
						<span class="dashicons dashicons-performance"></span>
						<strong><?php echo esc_html__( 'Capture Profile', 'scrutoscope' ); ?></strong>
						<span><?php echo esc_html__( 'Measure a page and see where time goes', 'scrutoscope' ); ?></span>
					</button>
					<button type="button" class="scrutoscope-home-card" id="scrutoscope-home-profiles">
						<span class="dashicons dashicons-chart-bar"></span>
						<strong><?php echo esc_html__( 'View Profiles', 'scrutoscope' ); ?></strong>
						<span><?php echo esc_html__( 'Browse captured measurements', 'scrutoscope' ); ?></span>
					</button>
					<button type="button" class="scrutoscope-home-card" id="scrutoscope-home-settings">
						<span class="dashicons dashicons-admin-generic"></span>
						<strong><?php echo esc_html__( 'Settings', 'scrutoscope' ); ?></strong>
						<span><?php echo esc_html__( 'Background measurement, sample rate, query profiling', 'scrutoscope' ); ?></span>
					</button>
				</div>
				<div class="scrutoscope-home-faq">
					<div class="scrutoscope-faq-item">
						<strong><?php echo esc_html__( 'Will this slow down my site?', 'scrutoscope' ); ?></strong>
						<p><?php echo esc_html__( 'Non-profiled requests add under 2 ms. Profiled requests record full traces. The sample rate controls how often the full cost is paid.', 'scrutoscope' ); ?></p>
					</div>
					<div class="scrutoscope-faq-item">
						<strong><?php echo esc_html__( 'Does any data leave my server?', 'scrutoscope' ); ?></strong>
						<p><?php echo esc_html__( 'No. All profiling data stays in your WordPress database. Sharing a report is optional and end-to-end encrypted — the relay server cannot read your data.', 'scrutoscope' ); ?></p>
					</div>
					<div class="scrutoscope-faq-item">
						<strong><?php echo esc_html__( 'Who can see this?', 'scrutoscope' ); ?></strong>
						<p><?php echo esc_html__( 'Only administrators. Scrutoscope is invisible to logged-out visitors and non-admin users.', 'scrutoscope' ); ?></p>
					</div>
					<div class="scrutoscope-faq-item">
						<strong><?php echo esc_html__( 'Need help?', 'scrutoscope' ); ?></strong>
						<p>
							<?php
							printf(
								/* translators: %s: GitHub Issues URL */
								esc_html__( 'File an issue at %s — bug reports, feature requests, and questions are all welcome.', 'scrutoscope' ),
								'<a href="https://github.com/scrutineerhq/scrutoscope/issues" target="_blank" rel="noopener">GitHub Issues</a>'
							);
							?>
						</p>
					</div>
				</div>
			</div>
			<div class="scrutoscope-capture-flow" id="scrutoscope-capture-flow" style="display:none;">
				<button type="button" class="button button-link" id="scrutoscope-capture-back">
					<?php echo esc_html__( '← Back', 'scrutoscope' ); ?>
				</button>
				<h2><?php echo esc_html__( 'Capture Profile', 'scrutoscope' ); ?></h2>
				<p class="scrutoscope-capture-intro"><?php echo esc_html__( 'Choose what to measure. The target page opens in a new tab — browse around, then come back to this window and click Stop Profiling when done.', 'scrutoscope' ); ?></p>
				<div class="scrutoscope-decision-cards">
					<button type="button" class="scrutoscope-decision-card" data-target="<?php echo esc_url( admin_url() ); ?>" data-mode="admin">
						<span class="dashicons dashicons-dashboard"></span>
						<strong><?php echo esc_html__( 'Admin Dashboard', 'scrutoscope' ); ?></strong>
						<span><?php echo esc_html__( 'Measure admin page performance', 'scrutoscope' ); ?></span>
						<span class="scrutoscope-card-hint"><?php echo esc_html__( 'Opens in new tab', 'scrutoscope' ); ?></span>
					</button>
					<button type="button" class="scrutoscope-decision-card" data-target="<?php echo esc_url( home_url( '/' ) ); ?>" data-mode="frontend">
						<span class="dashicons dashicons-admin-users"></span>
						<strong><?php echo esc_html__( 'Logged-in Frontend', 'scrutoscope' ); ?></strong>
						<span><?php echo esc_html__( 'Measure pages while logged in', 'scrutoscope' ); ?></span>
						<span class="scrutoscope-card-hint"><?php echo esc_html__( 'Opens in new tab', 'scrutoscope' ); ?></span>
					</button>
					<button type="button" class="scrutoscope-decision-card" data-target="<?php echo esc_url( home_url( '/' ) ); ?>" data-mode="visitor">
						<span class="dashicons dashicons-visibility"></span>
						<strong><?php echo esc_html__( 'Visitor View', 'scrutoscope' ); ?></strong>
						<span><?php echo esc_html__( 'Measure what visitors experience', 'scrutoscope' ); ?></span>
						<span class="scrutoscope-card-hint"><?php echo esc_html__( 'Requires incognito window', 'scrutoscope' ); ?></span>
					</button>
				</div>
				<div id="scrutoscope-capture-status"></div>
			</div>

			<!-- Results (routes/history/cron/api tabs) -->
			<div class="scrutoscope-results" id="scrutoscope-results" style="display:none;">
				<h2><?php echo esc_html__( 'Routes', 'scrutoscope' ); ?></h2>
				<div id="scrutoscope-profile-list">
					<p class="scrutoscope-empty scrutoscope-loading"><?php echo esc_html__( 'Loading…', 'scrutoscope' ); ?></p>
				</div>
			</div>

			<!-- Profile Detail (hidden until selected) -->
			<div class="scrutoscope-detail" id="scrutoscope-detail" style="display:none;">
				<button type="button" class="button button-link" id="scrutoscope-back-to-list">
					<?php echo esc_html__( '← Back to profiles', 'scrutoscope' ); ?>
				</button>
				<div id="scrutoscope-detail-content"></div>
			</div>

			<!-- Settings Panel (full view — toggled by gear icon) -->
			<div id="scrutoscope-settings-view" class="scrutoscope-settings-view" style="display:none;">
				<button type="button" class="button button-link" id="scrutoscope-settings-back">
					<?php echo esc_html__( '← Back to dashboard', 'scrutoscope' ); ?>
				</button>
				<h2><?php echo esc_html__( 'Settings', 'scrutoscope' ); ?></h2>

				<div class="scrutoscope-settings-grid">
					<!-- Profiling card -->
					<div class="scrutoscope-settings-card" id="scrutoscope-settings-profiling">
						<h3 class="scrutoscope-settings-card-title"><?php echo esc_html__( 'Profiling', 'scrutoscope' ); ?></h3>

						<!-- Session Status -->
						<div class="scrutoscope-status-card" id="scrutoscope-status">
							<h4><?php echo esc_html__( 'Session Status', 'scrutoscope' ); ?></h4>
							<div class="scrutoscope-status-indicator">
								<span class="scrutoscope-dot <?php echo $is_active ? 'active' : 'inactive'; ?>"></span>
								<span id="scrutoscope-status-text">
									<?php
									if ( $is_active ) {
										echo esc_html__( 'Profiling active', 'scrutoscope' );
									} else {
										echo esc_html__( 'Profiling inactive', 'scrutoscope' );
									}
									?>
								</span>
							</div>

							<?php if ( $is_active ) : ?>
								<p class="scrutoscope-session-info">
									<?php
									printf(
										/* translators: %s: session ID */
										esc_html__( 'Session: %s', 'scrutoscope' ),
										'<code>' . esc_html( $session_id ) . '</code>'
									);
									?>
								</p>
							<?php endif; ?>
						</div>

						<!-- Controls -->
						<div class="scrutoscope-controls" id="scrutoscope-controls">
							<?php if ( $is_active ) : ?>
								<button type="button" class="button button-secondary button-large" id="scrutoscope-stop"><?php echo esc_html__( 'Stop Profiling', 'scrutoscope' ); ?></button>
							<?php endif; ?>
						</div>

						<!-- Background Profiling + Query Profiling rendered by JS here -->
					</div>

					<!-- Storage card -->
					<div class="scrutoscope-settings-card" id="scrutoscope-settings-storage">
						<h3 class="scrutoscope-settings-card-title"><?php echo esc_html__( 'Storage', 'scrutoscope' ); ?></h3>
						<!-- Retention controls rendered by JS here -->
					</div>

					<!-- Network card -->
					<div class="scrutoscope-settings-card" id="scrutoscope-settings-network">
						<h3 class="scrutoscope-settings-card-title"><?php echo esc_html__( 'Network', 'scrutoscope' ); ?></h3>
						<!-- Proxy controls rendered by JS here -->
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
		$check = array(
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
