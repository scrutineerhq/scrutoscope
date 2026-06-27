<?php
/**
 * Unit tests for the SQL query reducer.
 *
 * Guards the verb+table reduction invariant, which has regressed twice. These
 * tests cover the stable contract (basic reduction across verbs plus the hard
 * "no structure leaks" rule). Edge cases (comments, comma joins, qualified
 * names) are exercised by their own changesets.
 *
 * @package Scrutinizer
 */

use PHPUnit\Framework\TestCase;
use Scrutinizer\Profiler\QueryReducer;

/**
 * @covers \Scrutinizer\Profiler\QueryReducer
 */
class QueryReducerTest extends TestCase {

	/**
	 * Basic verb + table reduction across the common statement types.
	 *
	 * @dataProvider reductionProvider
	 *
	 * @param string $sql      Input query.
	 * @param string $expected Expected reduced output.
	 */
	public function test_reduces_to_verb_and_table( $sql, $expected ) {
		$this->assertSame( $expected, QueryReducer::reduce( $sql ) );
	}

	/**
	 * @return array<int, array{0: string, 1: string}>
	 */
	public function reductionProvider() {
		return array(
			array( 'SELECT option_value FROM wp_options WHERE option_name = \'siteurl\' LIMIT 1', 'SELECT wp_options' ),
			array( 'SELECT * FROM wp_posts', 'SELECT wp_posts' ),
			array( 'SELECT * FROM wp_posts WHERE post_status = \'publish\' ORDER BY post_date DESC LIMIT 10', 'SELECT wp_posts' ),
			array( 'INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (1, \'k\', \'v\')', 'INSERT wp_postmeta' ),
			array( 'UPDATE wp_options SET option_value = \'x\' WHERE option_name = \'y\'', 'UPDATE wp_options' ),
			array( 'DELETE FROM wp_posts WHERE ID = 5', 'DELETE wp_posts' ),
			array( 'SHOW COLUMNS FROM wp_users', 'SHOW wp_users' ),
			array( 'SELECT FOUND_ROWS()', 'SELECT FOUND_ROWS()' ),
		);
	}

	/**
	 * A JOIN keeps all participating tables; subquery internals stay out.
	 */
	public function test_join_keeps_all_tables() {
		$out = QueryReducer::reduce(
			'SELECT p.ID FROM wp_posts p INNER JOIN wp_postmeta m ON p.ID = m.post_id WHERE m.meta_key = \'x\''
		);
		$this->assertStringContainsString( 'wp_posts', $out );
		$this->assertStringContainsString( 'wp_postmeta', $out );
	}

	/**
	 * Subquery tables are not pulled up to the outer statement.
	 */
	public function test_subquery_internals_excluded() {
		$out = QueryReducer::reduce(
			'SELECT * FROM wp_posts WHERE ID IN (SELECT post_id FROM wp_postmeta WHERE meta_key = \'k\')'
		);
		$this->assertSame( 'SELECT wp_posts', $out );
	}

	/**
	 * The core invariant: no column names, predicates, keywords, or literals
	 * beyond the verb survive reduction. This is the rule that regressed twice.
	 *
	 * @dataProvider leakProvider
	 *
	 * @param string $sql Input query.
	 */
	public function test_no_structure_or_literals_leak( $sql ) {
		$out = QueryReducer::reduce( $sql );

		// Output must be "VERB" or "VERB table[, table2]" (word/comma/space),
		// or the special FOUND_ROWS() form.
		$this->assertMatchesRegularExpression(
			'/^[A-Z_]+(\s[\w, ]+)?$/',
			$out,
			"Reduced query has unexpected structure: {$out}"
		);

		// Specific leakage canaries.
		foreach ( array( 'WHERE', 'LIMIT', 'ORDER', 'option_name', 'siteurl', 'secret', '=' ) as $needle ) {
			$this->assertStringNotContainsStringIgnoringCase( $needle, $out, "Leaked '{$needle}' in: {$out}" );
		}
	}

	/**
	 * @return array<int, array{0: string}>
	 */
	public function leakProvider() {
		return array(
			array( 'SELECT option_value FROM wp_options WHERE option_name = \'secret_token\' LIMIT 1' ),
			array( 'UPDATE wp_users SET user_pass = \'hash\' WHERE user_login = \'admin\'' ),
			array( 'SELECT * FROM wp_posts WHERE post_title = \'My Secret Page\' ORDER BY post_date' ),
		);
	}

	/**
	 * Edge cases that previously under-reported tables or leaked non-table
	 * tokens (comments, comma joins, qualified names, OUTFILE, @vars).
	 *
	 * @dataProvider edgeCaseProvider
	 *
	 * @param string $sql      Input query.
	 * @param string $expected Expected reduced output.
	 */
	public function test_edge_cases( $sql, $expected ) {
		$this->assertSame( $expected, QueryReducer::reduce( $sql ) );
	}

	/**
	 * @return array<int, array{0: string, 1: string}>
	 */
	public function edgeCaseProvider() {
		return array(
			// Comments must not be tokenized as verbs/tables.
			array( "SELECT * FROM wp_posts -- WHERE secret = 'x'", 'SELECT wp_posts' ),
			array( "SELECT a FROM wp_users /* DROP_TABLE evil */ JOIN wp_posts ON a = b", 'SELECT wp_users, wp_posts' ),
			array( "# leading hash\nSELECT id FROM wp_options WHERE k = 'v'", 'SELECT wp_options' ),
			// Comma joins capture every table, skipping aliases.
			array( 'SELECT * FROM a, b, c', 'SELECT a, b, c' ),
			array( 'SELECT * FROM users u, posts p', 'SELECT users, posts' ),
			// STRAIGHT_JOIN is table-preceding.
			array( 'SELECT * FROM wp_a STRAIGHT_JOIN wp_b ON wp_a.id = wp_b.id', 'SELECT wp_a, wp_b' ),
			// Schema-qualified names keep the table, drop the schema.
			array( 'SELECT * FROM mydb.wp_posts', 'SELECT wp_posts' ),
			array( 'SELECT * FROM `mydb`.`wp_posts`', 'SELECT wp_posts' ),
			// INTO OUTFILE/DUMPFILE path and @vars are never treated as tables.
			array( "SELECT * FROM wp_x INTO OUTFILE '/tmp/secret.csv'", 'SELECT wp_x' ),
			array( 'SELECT id INTO @myvar FROM wp_posts', 'SELECT wp_posts' ),
		);
	}
}
