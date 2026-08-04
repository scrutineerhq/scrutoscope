<?php
/**
 * AI Provider detection for outbound HTTP calls.
 *
 * Maps known AI vendor host patterns to a short provider slug so the
 * profiler can badge and aggregate AI traffic without leaking URLs.
 *
 * @package Scrutoscope
 */

namespace Scrutoscope\Util;

defined( 'ABSPATH' ) || exit;

/**
 * Shared helper for AI provider detection.
 */
class AiProvider {

	/**
	 * Exact host => provider map (lowercased).
	 *
	 * @var array<string,string>
	 */
	const EXACT = array(
		'api.openai.com'                    => 'openai',
		'api.anthropic.com'                 => 'anthropic',
		'api.cohere.ai'                     => 'cohere',
		'api.mistral.ai'                    => 'mistral',
		'api.perplexity.ai'                 => 'perplexity',
		'api.groq.com'                      => 'groq',
		'api.openrouter.ai'                 => 'openrouter',
		'openrouter.ai'                     => 'openrouter',
		'generativelanguage.googleapis.com' => 'google',
		'aiplatform.googleapis.com'         => 'google',
		'api.stability.ai'                  => 'stability',
		'api.replicate.com'                 => 'replicate',
		'inference.nebius.com'              => 'nebius',
	);

	/**
	 * Suffix patterns (host ends-with) => provider.
	 *
	 * Used for Azure OpenAI and similar custom domains.
	 *
	 * @var array<string,string>
	 */
	const SUFFIX = array(
		'.openai.azure.com' => 'openai',
	);

	/**
	 * Detect AI provider from a URL.
	 *
	 * @param string $url Full URL or host.
	 * @return string|null Provider slug or null when not an AI host.
	 */
	public static function detect( $url ) {
		if ( ! is_string( $url ) || '' === $url ) {
			return null;
		}

		// parse_url needs scheme to reliably extract host; tolerate bare hosts.
		$host = '';
		if ( function_exists( 'wp_parse_url' ) ) {
			$parts = wp_parse_url( $url );
		} else {
			$parts = parse_url( $url );
		}

		if ( is_array( $parts ) && ! empty( $parts['host'] ) ) {
			$host = $parts['host'];
		} else {
			// Fallback: url might be bare host or scheme-less //host.
			$maybe = $url;
			// Strip scheme:// prefix if present.
			$pos = strpos( $maybe, '://' );
			if ( false !== $pos ) {
				$maybe = substr( $maybe, $pos + 3 );
			} elseif ( 0 === strpos( $maybe, '//' ) ) {
				$maybe = substr( $maybe, 2 );
			}
			// Trim path, port, query.
			$slash = strpos( $maybe, '/' );
			if ( false !== $slash ) {
				$maybe = substr( $maybe, 0, $slash );
			}
			$q = strpos( $maybe, '?' );
			if ( false !== $q ) {
				$maybe = substr( $maybe, 0, $q );
			}
			$colon = strrpos( $maybe, ':' );
			// Avoid trimming IPv6 colons - crude check: if host contains '.' treat colon as port.
			if ( false !== $colon && false !== strpos( $maybe, '.' ) ) {
				$maybe = substr( $maybe, 0, $colon );
			}
			$host = $maybe;
		}

		if ( '' === $host ) {
			return null;
		}

		$host = strtolower( trim( $host ) );

		// Exact match first (fast path).
		if ( isset( self::EXACT[ $host ] ) ) {
			return self::EXACT[ $host ];
		}

		// Suffix match for azure-style hosts.
		foreach ( self::SUFFIX as $suffix => $provider ) {
			$len = strlen( $suffix );
			if ( strlen( $host ) >= $len && substr( $host, -$len ) === $suffix ) {
				return $provider;
			}
			// Also allow without leading dot for direct match edge case.
			$trim = ltrim( $suffix, '.' );
			if ( $host === $trim ) {
				return $provider;
			}
		}

		return null;
	}

	/**
	 * Return a human label for a provider slug.
	 *
	 * @param string $provider Provider slug from detect().
	 * @return string
	 */
	public static function label( $provider ) {
		$map = array(
			'openai'     => 'OpenAI',
			'anthropic'  => 'Anthropic',
			'google'     => 'Google',
			'cohere'     => 'Cohere',
			'mistral'    => 'Mistral',
			'perplexity' => 'Perplexity',
			'groq'       => 'Groq',
			'openrouter' => 'OpenRouter',
			'stability'  => 'Stability',
			'replicate'  => 'Replicate',
			'nebius'     => 'Nebius',
		);
		return isset( $map[ $provider ] ) ? $map[ $provider ] : $provider;
	}
}
