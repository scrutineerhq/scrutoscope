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
			SCRUTINIZER_VERSION
		);

		wp_enqueue_script(
			'scrutinizer-dashboard',
			SCRUTINIZER_URL . 'assets/js/dashboard.js',
			array( 'jquery' ),
			SCRUTINIZER_VERSION,
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
				'isActive'             => Session::has_valid_cookie(),
				'sessionId'            => Session::get_session_id(),
				'lastSessionId'        => $last_session_id,
				'profileCount'         => $recent_count,
				'siteUrl'              => home_url( '/' ),
				'backgroundEnabled'    => (bool) get_option( 'scrutinizer_background_profiling', false ),
				'backgroundSampleRate' => (int) get_option( 'scrutinizer_sample_rate', 5 ),
				'apiBase'              => rest_url( 'scrutinizer/v1/' ),
				'diagnosticsFields'    => \Scrutinizer\Api\Diagnostics::get_enabled_fields(),
				'diagnosticsOptIn'     => \Scrutinizer\Api\Diagnostics::OPT_IN_FIELDS,
				'queryProfiling'       => scrutinizer_query_profiling_state(),
				'i18n'                 => array(
					'startProfiling' => __( 'Start Profiling', 'scrutinizer' ),
					'stopProfiling'  => __( 'Stop Profiling', 'scrutinizer' ),
					'profiling'      => __( 'Profiling active…', 'scrutinizer' ),
					'noProfiles'     => __( 'No profiles captured yet. Browse your site to capture requests.', 'scrutinizer' ),
					'copied'         => __( 'Activation URL copied to clipboard.', 'scrutinizer' ),
					'error'          => __( 'An error occurred. Please try again.', 'scrutinizer' ),
					'confirmDelete'  => __( 'Delete this profile?', 'scrutinizer' ),
					'serverDuration' => __( 'Server Request Duration', 'scrutinizer' ),
					'exclusiveTime'  => __( 'Exclusive Callback Time', 'scrutinizer' ),
					'inclusiveTime'  => __( 'Inclusive Callback Time', 'scrutinizer' ),
					'callCount'      => __( 'Call Count', 'scrutinizer' ),
					'unattributed'   => __( 'Unattributed / Bootstrap', 'scrutinizer' ),
					'backToList'     => __( '← Back to profiles', 'scrutinizer' ),
					'pin'            => __( 'Pin', 'scrutinizer' ),
					'unpin'          => __( 'Unpin', 'scrutinizer' ),
					'note'           => __( 'Note', 'scrutinizer' ),
					'tags'           => __( 'Tags', 'scrutinizer' ),
					'history'        => __( 'History', 'scrutinizer' ),
					'routes'         => __( 'Routes', 'scrutinizer' ),
					'compare'        => __( 'Compare', 'scrutinizer' ),
					'pinned'         => __( 'Pinned', 'scrutinizer' ),
					'allProfiles'    => __( 'All Profiles', 'scrutinizer' ),
					'filterByRoute'  => __( 'All routes', 'scrutinizer' ),
					'filterByTag'    => __( 'Filter by tag…', 'scrutinizer' ),
					'noResults'      => __( 'No profiles match the current filters.', 'scrutinizer' ),
					'compareSelected' => __( 'Compare Selected', 'scrutinizer' ),
					'backToHistory'  => __( '← Back to history', 'scrutinizer' ),
					'faster'         => __( 'faster', 'scrutinizer' ),
					'slower'         => __( 'slower', 'scrutinizer' ),
					'noChange'       => __( 'no change', 'scrutinizer' ),
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
			<h1><?php echo esc_html__( 'Scrutinizer', 'scrutinizer' ); ?></h1>
			<p class="description"><?php echo esc_html__( 'WordPress Performance Profiler — See where your server request duration is spent.', 'scrutinizer' ); ?></p>

			<!-- Status Section -->
			<div class="scrutinizer-status-card" id="scrutinizer-status">
				<h2><?php echo esc_html__( 'Session Status', 'scrutinizer' ); ?></h2>
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
				<?php if ( ! $is_active ) : ?>
					<div class="scrutinizer-decision-prompt">
						<h3><?php echo esc_html__( "What's slow?", 'scrutinizer' ); ?></h3>
						<div class="scrutinizer-decision-cards">
							<button type="button" class="scrutinizer-decision-card" data-target="<?php echo esc_url( admin_url() ); ?>">
								<span class="dashicons dashicons-dashboard"></span>
								<strong><?php echo esc_html__( 'Admin Dashboard', 'scrutinizer' ); ?></strong>
								<span><?php echo esc_html__( 'Profile wp-admin requests', 'scrutinizer' ); ?></span>
							</button>
							<button type="button" class="scrutinizer-decision-card" data-target="<?php echo esc_url( home_url( '/' ) ); ?>">
								<span class="dashicons dashicons-admin-users"></span>
								<strong><?php echo esc_html__( 'Logged-in Frontend', 'scrutinizer' ); ?></strong>
								<span><?php echo esc_html__( 'Profile as logged-in user', 'scrutinizer' ); ?></span>
							</button>
							<button type="button" class="scrutinizer-decision-card" data-target="<?php echo esc_url( home_url( '/' ) ); ?>">
								<span class="dashicons dashicons-visibility"></span>
								<strong><?php echo esc_html__( 'Visitor View', 'scrutinizer' ); ?></strong>
								<span><?php echo esc_html__( 'Profile the public frontend', 'scrutinizer' ); ?></span>
							</button>
						</div>
					</div>
				<?php else : ?>
					<button type="button" class="button button-secondary button-large" id="scrutinizer-stop">
						<?php echo esc_html__( 'Stop Profiling', 'scrutinizer' ); ?>
					</button>
				<?php endif; ?>
			</div>

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

			<!-- Results -->
			<div class="scrutinizer-results" id="scrutinizer-results">
				<h2><?php echo esc_html__( 'Routes', 'scrutinizer' ); ?></h2>
				<div id="scrutinizer-profile-list">
					<p class="scrutinizer-empty"><?php echo esc_html__( 'No profiles captured yet.', 'scrutinizer' ); ?></p>
				</div>
			</div>

			<!-- Profile Detail (hidden until selected) -->
			<div class="scrutinizer-detail" id="scrutinizer-detail" style="display:none;">
				<button type="button" class="button button-link" id="scrutinizer-back-to-list">
					<?php echo esc_html__( '← Back to profiles', 'scrutinizer' ); ?>
				</button>
				<div id="scrutinizer-detail-content"></div>
			</div>
		</div>
		<?php
	}
}
