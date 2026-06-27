<?php
/**
 * SQL Query Reducer — tokenizer-based table name extraction.
 *
 * Reduces any SQL query to "VERB table1[, table2, ...]" by tokenizing
 * the input and extracting table identifiers from structural positions.
 *
 * Handles: subqueries (depth-aware), CTEs (WITH ... AS), backtick/bracket-
 * quoted identifiers, aliases (AS or bare), all JOIN variants, UNION,
 * INSERT INTO, UPDATE, DELETE FROM, REPLACE INTO, SHOW, CREATE TABLE,
 * and MySQL-specific syntax (SQL_CALC_FOUND_ROWS, FOUND_ROWS()).
 *
 * INVARIANT: No fields, WHERE clauses, predicates, or literal values
 * ever leave this function. Only the SQL verb and table name(s) are kept.
 *
 * @see .context/INVARIANTS.md  "SQL query reduction" invariant.
 * @see .context/GOTCHAS.md     "Query sanitization must reduce, not mask" entry.
 *
 * @package Scrutinizer\Profiler
 * @since   1.0.0
 */

namespace Scrutinizer\Profiler;

/**
 * Reduces SQL queries to verb + table names.
 */
class QueryReducer {

	/**
	 * Keywords that precede a table name in SQL.
	 *
	 * @var array<string>
	 */
	private static $table_preceding = array( 'FROM', 'JOIN', 'STRAIGHT_JOIN', 'INTO', 'UPDATE', 'TABLE' );

	/**
	 * SQL keywords that are NOT table names.
	 *
	 * Used to skip noise tokens when searching for table identifiers
	 * after a table-preceding keyword. Covers MySQL dialect keywords
	 * encountered in WordPress queries.
	 *
	 * @var array<string, int>|null Lazy-initialized flip of keyword list.
	 */
	private static $keyword_set = null;

	/**
	 * Reduce a SQL query to verb + table name(s).
	 *
	 * @param string $sql Raw SQL query.
	 * @return string Reduced string, e.g. "SELECT wp_posts, wp_postmeta".
	 */
	public static function reduce( $sql ) {
		$sql = trim( $sql );
		if ( '' === $sql ) {
			return '(query)';
		}

		// Special: SELECT FOUND_ROWS() — a server function with no table.
		// Must match the function call form, not the SQL_CALC_FOUND_ROWS hint.
		if ( preg_match( '/\bFOUND_ROWS\s*\(/i', $sql )
			&& ! preg_match( '/\bSQL_CALC_FOUND_ROWS\b/i', $sql ) ) {
			return 'SELECT FOUND_ROWS()';
		}

		$tokens = self::tokenize( $sql );
		if ( empty( $tokens ) ) {
			return '(query)';
		}

		$verb = strtoupper( $tokens[0] );
		$len  = count( $tokens );

		// SHOW: extract only the table after FROM.
		if ( 'SHOW' === $verb ) {
			for ( $i = 1; $i < $len; $i++ ) {
				if ( 'FROM' === strtoupper( $tokens[ $i ] ) && isset( $tokens[ $i + 1 ] ) ) {
					return 'SHOW ' . self::strip_quotes( $tokens[ $i + 1 ] );
				}
			}
			return 'SHOW';
		}

		// CTE handling: WITH name AS (...), name2 AS (...) SELECT ...
		$cte_names = array();
		$start_idx = 0;
		if ( 'WITH' === $verb ) {
			$cte_result = self::parse_cte_preamble( $tokens, $len );
			$verb       = $cte_result['verb'];
			$start_idx  = $cte_result['start_idx'];
			$cte_names  = $cte_result['cte_names'];
		}

		$tables = self::extract_tables( $tokens, $len, $start_idx, $cte_names );
		$tables = array_values( array_unique( $tables ) );

		if ( empty( $tables ) ) {
			return $verb;
		}

		return $verb . ' ' . implode( ', ', $tables );
	}

	/**
	 * Parse a CTE preamble (WITH ... AS (...) ...).
	 *
	 * Collects CTE alias names and finds the real DML verb.
	 *
	 * @param array<string> $tokens Token list.
	 * @param int           $len    Token count.
	 * @return array{verb: string, start_idx: int, cte_names: array<string, true>}
	 */
	private static function parse_cte_preamble( $tokens, $len ) {
		$cte_names = array();
		$verb      = 'WITH';
		$start_idx = 0;
		$i         = 1;
		$depth     = 0;

		while ( $i < $len ) {
			$tok   = $tokens[ $i ];
			$upper = strtoupper( $tok );

			if ( '(' === $tok ) {
				++$depth;
				++$i;
				continue;
			}
			if ( ')' === $tok ) {
				$depth = max( 0, $depth - 1 );
				++$i;
				continue;
			}

			// At depth 0, a DML keyword ends the CTE preamble.
			if ( 0 === $depth
				&& in_array( $upper, array( 'SELECT', 'INSERT', 'UPDATE', 'DELETE' ), true ) ) {
				$verb      = $upper;
				$start_idx = $i;
				break;
			}

			// At depth 0, non-keyword/non-punctuation tokens are CTE names.
			if ( 0 === $depth && 'AS' !== $upper && 'RECURSIVE' !== $upper && ',' !== $tok ) {
				$cte_names[ strtolower( self::strip_quotes( $tok ) ) ] = true;
			}

			++$i;
		}

		return array(
			'verb'      => $verb,
			'start_idx' => $start_idx,
			'cte_names' => $cte_names,
		);
	}

	/**
	 * Extract table names from token stream.
	 *
	 * Walks tokens at parenthesis depth 0, looking for table-preceding
	 * keywords and capturing the next non-keyword identifier.
	 *
	 * @param array<string>      $tokens    Token list.
	 * @param int                $len       Token count.
	 * @param int                $start_idx Index to start scanning from.
	 * @param array<string,true> $cte_names CTE alias names to exclude.
	 * @return array<string> Table names found.
	 */
	private static function extract_tables( $tokens, $len, $start_idx, $cte_names ) {
		self::init_keyword_set();

		$tables = array();
		$depth  = 0;

		for ( $i = $start_idx; $i < $len; $i++ ) {
			$tok   = $tokens[ $i ];
			$upper = strtoupper( $tok );

			if ( '(' === $tok ) {
				++$depth;
				continue;
			}
			if ( ')' === $tok ) {
				$depth = max( 0, $depth - 1 );
				continue;
			}

			// Only extract tables at the outermost query level.
			if ( $depth > 0 ) {
				continue;
			}

			if ( ! in_array( $upper, self::$table_preceding, true ) ) {
				continue;
			}

			// Scan forward for the table name.
			for ( $j = $i + 1; $j < $len; $j++ ) {
				$next       = $tokens[ $j ];
				$next_upper = strtoupper( $next );

				// Skip modifier keywords (INNER, LEFT, OUTFILE, etc.).
				if ( isset( self::$keyword_set[ $next_upper ] ) ) {
					continue;
				}

				// Opening paren = subquery in table position — skip.
				if ( '(' === $next ) {
					break;
				}

				// Resolve a (possibly schema-qualified) table reference.
				list( $table_name, $j ) = self::read_table_ref( $tokens, $len, $j );

				// Skip value placeholders, numbers, and @user variables.
				if ( '' === $table_name || preg_match( '/^[%\d\'"@]/', $table_name ) ) {
					break;
				}

				if ( ! isset( $cte_names[ strtolower( $table_name ) ] ) ) {
					$tables[] = $table_name;
				}
				$i = $j;

				// Continue capturing comma-separated tables (FROM a, b, c),
				// stepping over an optional alias after each (FROM a x, b y).
				$pos = self::skip_alias( $tokens, $len, $i + 1 );
				while ( $pos < $len && ',' === $tokens[ $pos ] ) {
					$k = $pos + 1;
					while ( $k < $len && isset( self::$keyword_set[ strtoupper( $tokens[ $k ] ) ] ) ) {
						++$k;
					}
					if ( $k >= $len || '(' === $tokens[ $k ] ) {
						break;
					}
					list( $next_table, $k ) = self::read_table_ref( $tokens, $len, $k );
					if ( '' === $next_table || preg_match( '/^[%\d\'"@]/', $next_table ) ) {
						break;
					}
					if ( ! isset( $cte_names[ strtolower( $next_table ) ] ) ) {
						$tables[] = $next_table;
					}
					$i   = $k;
					$pos = self::skip_alias( $tokens, $len, $i + 1 );
				}

				break;
			}
		}

		return $tables;
	}

	/**
	 * Resolve a table reference starting at $j, collapsing schema-qualified
	 * names (db.table, `db`.`table`) to their trailing segment so the schema
	 * name is dropped and the real table is kept.
	 *
	 * @param array<string> $tokens Token list.
	 * @param int           $len    Token count.
	 * @param int           $j      Index of the first identifier token.
	 * @return array{0: string, 1: int} Unquoted table name and the end index.
	 */
	private static function read_table_ref( $tokens, $len, $j ) {
		$name = self::strip_quotes( $tokens[ $j ] );
		while ( isset( $tokens[ $j + 1 ] ) && '.' === $tokens[ $j + 1 ] && isset( $tokens[ $j + 2 ] ) ) {
			$j   += 2;
			$name = self::strip_quotes( $tokens[ $j ] );
		}
		return array( $name, $j );
	}

	/**
	 * Step over an optional table alias ("AS x" or a bare "x") so a following
	 * comma can be detected in old-style joins (FROM a x, b y).
	 *
	 * @param array<string> $tokens Token list.
	 * @param int           $len    Token count.
	 * @param int           $pos    Index just after a captured table.
	 * @return int Index after the alias (unchanged when there is none).
	 */
	private static function skip_alias( $tokens, $len, $pos ) {
		if ( $pos >= $len ) {
			return $pos;
		}
		if ( 'AS' === strtoupper( $tokens[ $pos ] ) ) {
			++$pos;
			if ( $pos < $len && self::is_identifier_token( $tokens[ $pos ] ) ) {
				++$pos;
			}
			return $pos;
		}
		if ( self::is_identifier_token( $tokens[ $pos ] )
			&& ! isset( self::$keyword_set[ strtoupper( $tokens[ $pos ] ) ] ) ) {
			++$pos;
		}
		return $pos;
	}

	/**
	 * Whether a token begins an identifier (letter, underscore, or quote).
	 *
	 * @param string $tok Token.
	 * @return bool
	 */
	private static function is_identifier_token( $tok ) {
		return '' !== $tok && (bool) preg_match( '/^[A-Za-z_`\[]/', $tok );
	}

	/**
	 * Tokenize SQL into words, quoted identifiers, and structural punctuation.
	 *
	 * Quoted strings (single/double) are collapsed to '%s'. Backtick-quoted
	 * and bracket-quoted identifiers are preserved as single tokens.
	 * Operators and other punctuation are discarded.
	 *
	 * @param string $sql Raw SQL string.
	 * @return array<string> Token list.
	 */
	private static function tokenize( $sql ) {
		$tokens = array();
		$len    = strlen( $sql );
		$i      = 0;

		while ( $i < $len ) {
			$ch = $sql[ $i ];

			// Whitespace.
			if ( ctype_space( $ch ) ) {
				++$i;
				continue;
			}

			// Line comment: "-- " (MySQL requires whitespace/EOL after the
			// dashes) or "#" to end of line. Must be consumed before the
			// operator branch, which would otherwise discard the dashes/hash
			// and leave the comment body to tokenize as fake verbs/tables.
			if ( '#' === $ch
				|| ( '-' === $ch && $i + 1 < $len && '-' === $sql[ $i + 1 ]
					&& ( $i + 2 >= $len || ctype_space( $sql[ $i + 2 ] ) ) ) ) {
				while ( $i < $len && "\n" !== $sql[ $i ] ) {
					++$i;
				}
				continue;
			}

			// Block comment: /* ... */ (covers MySQL /*! ... */ executable
			// comments and /*+ ... */ optimizer hints). Reducing to verb +
			// table can only drop information here, never leak it.
			if ( '/' === $ch && $i + 1 < $len && '*' === $sql[ $i + 1 ] ) {
				$i += 2;
				while ( $i + 1 < $len && ! ( '*' === $sql[ $i ] && '/' === $sql[ $i + 1 ] ) ) {
					++$i;
				}
				$i += 2; // Skip the closing */ (or past the unterminated tail).
				if ( $i > $len ) {
					$i = $len;
				}
				continue;
			}

			// Single or double quoted string — collapse to placeholder.
			if ( '\'' === $ch || '"' === $ch ) {
				$quote = $ch;
				++$i;
				while ( $i < $len ) {
					if ( '\\' === $sql[ $i ] ) {
						$i += 2;
						continue;
					}
					if ( $sql[ $i ] === $quote ) {
						if ( $i + 1 < $len && $sql[ $i + 1 ] === $quote ) {
							$i += 2; // Doubled-quote escape.
							continue;
						}
						++$i;
						break;
					}
					++$i;
				}
				$tokens[] = '%s';
				continue;
			}

			// Backtick-quoted identifier.
			if ( '`' === $ch ) {
				$start = $i;
				++$i;
				while ( $i < $len && '`' !== $sql[ $i ] ) {
					++$i;
				}
				if ( $i < $len ) {
					++$i;
				}
				$tokens[] = substr( $sql, $start, $i - $start );
				continue;
			}

			// Bracket-quoted identifier.
			if ( '[' === $ch ) {
				$start = $i;
				++$i;
				while ( $i < $len && ']' !== $sql[ $i ] ) {
					++$i;
				}
				if ( $i < $len ) {
					++$i;
				}
				$tokens[] = substr( $sql, $start, $i - $start );
				continue;
			}

			// Structural punctuation — parentheses, commas, semicolons, and the
			// dot. The dot is kept as its own token so qualified identifiers
			// (db.table) can be resolved to their trailing segment instead of
			// being mistaken for "schema name + alias".
			if ( '(' === $ch || ')' === $ch || ',' === $ch || ';' === $ch || '.' === $ch ) {
				$tokens[] = $ch;
				++$i;
				continue;
			}

			// User / system variable (@var, @@global): collapse to a single
			// token so it is recognized and skipped in table position
			// (e.g. SELECT ... INTO @var) rather than leaking "var" as a table.
			if ( '@' === $ch ) {
				$start = $i;
				++$i;
				if ( $i < $len && '@' === $sql[ $i ] ) {
					++$i;
				}
				while ( $i < $len && ( ctype_alnum( $sql[ $i ] ) || '_' === $sql[ $i ] ) ) {
					++$i;
				}
				$tokens[] = substr( $sql, $start, $i - $start );
				continue;
			}

			// Operators — discard.
			if ( false !== strpos( '=<>!+-*/%&|^~', $ch ) ) {
				++$i;
				while ( $i < $len && false !== strpos( '=<>!', $sql[ $i ] ) ) {
					++$i;
				}
				continue;
			}

			// Word (identifier or keyword).
			if ( ctype_alpha( $ch ) || '_' === $ch ) {
				$start = $i;
				while ( $i < $len && ( ctype_alnum( $sql[ $i ] ) || '_' === $sql[ $i ] ) ) {
					++$i;
				}
				$tokens[] = substr( $sql, $start, $i - $start );
				continue;
			}

			// Number.
			if ( ctype_digit( $ch ) ) {
				$start = $i;
				while ( $i < $len && ( ctype_digit( $sql[ $i ] ) || '.' === $sql[ $i ] ) ) {
					++$i;
				}
				$tokens[] = substr( $sql, $start, $i - $start );
				continue;
			}

			// Unknown character — skip.
			++$i;
		}

		return $tokens;
	}

	/**
	 * Strip backtick or bracket quotes from an identifier.
	 *
	 * @param string $identifier Possibly quoted identifier.
	 * @return string Unquoted identifier.
	 */
	private static function strip_quotes( $identifier ) {
		if ( strlen( $identifier ) >= 2 ) {
			$first = $identifier[0];
			$last  = $identifier[ strlen( $identifier ) - 1 ];
			if ( '`' === $first && '`' === $last ) {
				return substr( $identifier, 1, -1 );
			}
			if ( '[' === $first && ']' === $last ) {
				return substr( $identifier, 1, -1 );
			}
		}
		return $identifier;
	}

	/**
	 * Initialize the keyword set (once).
	 *
	 * @return void
	 */
	private static function init_keyword_set() {
		if ( null !== self::$keyword_set ) {
			return;
		}

		self::$keyword_set = array_flip(
			array(
				'SELECT',
				'FROM',
				'WHERE',
				'AND',
				'OR',
				'NOT',
				'IN',
				'ON',
				'AS',
				'JOIN',
				'INNER',
				'OUTER',
				'LEFT',
				'RIGHT',
				'CROSS',
				'NATURAL',
				'FULL',
				'SET',
				'VALUES',
				'INTO',
				'INSERT',
				'UPDATE',
				'DELETE',
				'CREATE',
				'DROP',
				'ALTER',
				'INDEX',
				'TABLE',
				'ORDER',
				'BY',
				'GROUP',
				'HAVING',
				'LIMIT',
				'OFFSET',
				'UNION',
				'ALL',
				'DISTINCT',
				'EXISTS',
				'BETWEEN',
				'LIKE',
				'IS',
				'NULL',
				'TRUE',
				'FALSE',
				'CASE',
				'WHEN',
				'THEN',
				'ELSE',
				'END',
				'ASC',
				'DESC',
				'IF',
				'USING',
				'FORCE',
				'IGNORE',
				'STRAIGHT_JOIN',
				'WITH',
				'RECURSIVE',
				'SQL_CALC_FOUND_ROWS',
				'LOW_PRIORITY',
				'DELAYED',
				'HIGH_PRIORITY',
				'SQL_NO_CACHE',
				'SQL_CACHE',
				'REPLACE',
				'DUPLICATE',
				'KEY',
				'SHOW',
				'COLUMNS',
				'TABLES',
				'STATUS',
				'TEMPORARY',
				'CASCADE',
				'RESTRICT',
				'LATERAL',
				'ROLLUP',
				'OPTIMIZE',
				'ANALYZE',
				'CHECK',
				'REPAIR',
				'TRUNCATE',
				// SELECT ... INTO OUTFILE/DUMPFILE '<path>' — the keyword after
				// INTO is not a table; skip it so the path is never treated as
				// one.
				'OUTFILE',
				'DUMPFILE',
			)
		);
	}
}
