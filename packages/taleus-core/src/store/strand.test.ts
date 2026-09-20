import { openStrand, readSchema } from './schema-node.js'
import { functionsCalledBy, rows, statementsOf, stripComments } from './strand.js'

/**
 * The schema is the thing everything else stands on, and until this suite existed nothing
 * had ever executed it -- the lift tests use an in-memory double their own harness calls
 * "schema-EMULATING". These tests are the floor: the real file, the real engine.
 */
describe('the schema loads into Quereus', () => {
	it('every statement in draft1.qsql executes', async () => {
		const statements = statementsOf(readSchema('draft1'))
		expect(statements.length).toBeGreaterThan(20)
		await expect(openStrand('draft1')).resolves.toBeDefined()
	})

	it('every statement in portfolio.qsql executes', async () => {
		await expect(openStrand('portfolio')).resolves.toBeDefined()
	})

	it('declares the tables the tally lifecycle needs', async () => {
		const db = await openStrand('draft1')
		for (const table of ['TallyCore', 'TallyContractProposal', 'TallyContract', 'CreditTerms', 'Ledger']) {
			await expect(rows(db, `select count(*) as n from ${table}`)).resolves.toEqual([{ n: 0 }])
		}
	})
})

describe('every scalar the schema calls is registered', () => {
	// A function used only inside a column CHECK is planned lazily, so a missing one is
	// invisible until the first insert into that table -- `ValidDenomination` was missing
	// and the load test above passed regardless. Read the schema, not memory.
	const HOST_SCALARS = [
		'DayNumber',
		'Digest',
		'Greatest',
		'Least',
		'SignatureValid',
		'Today',
		'ValidDate',
		'ValidDenomination',
	]
	it.each(['draft1', 'portfolio'] as const)('%s.qsql calls nothing the host does not provide', name => {
		for (const fn of functionsCalledBy(readSchema(name))) {
			expect(HOST_SCALARS).toContain(fn)
		}
	})

	it('the tally schema really does call them — the scan is not vacuous', () => {
		// Without this, a scanner that matched nothing would pass the check above forever.
		// (`portfolio.qsql` calls none, which is why the check above cannot assert a count.)
		const called = functionsCalledBy(readSchema('draft1'))
		expect(called).toEqual(expect.arrayContaining(['Digest', 'SignatureValid', 'DayNumber']))
	})

	it('and every one of them is actually registered', async () => {
		const db = await openStrand('draft1')
		// Arity differs, so call each with what it takes; the point is that it resolves.
		const calls = [
			"DayNumber('2026-03-02')",
			"Digest('a','b')",
			'Greatest(1, 2)',
			'Least(1, 2)',
			"SignatureValid('d','s','k')",
			'Today()',
			"ValidDate('2026-03-02')",
			"ValidDenomination('CHIP')",
		]
		for (const call of calls) {
			await expect(rows(db, `select ${call} as v`)).resolves.toHaveLength(1)
		}
	})
})

/**
 * Determinism is not a style preference here. Every replica of a strand re-validates every
 * write; a gate that read a clock would have replicas disagree about the same row. Quereus
 * enforces this, and these tests record that the schema depends on it.
 */
describe('constraints are deterministic', () => {
	it('no constraint or default reads a clock or a random source', () => {
		const code = stripComments(readSchema('draft1'))
		expect(code).not.toMatch(/\bjulianday\s*\(/)
		expect(code).not.toMatch(/\bRandomUUID\s*\(/)
		expect(code).not.toMatch(/\bnow\s*\(\s*\)/)
	})
})
