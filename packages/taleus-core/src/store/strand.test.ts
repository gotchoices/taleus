
import { openStrand, readSchema } from './schema-node.js'
import { appTable, functionsCalledBy, rows, statementsOf, stripComments } from './strand.js'

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
			await expect(rows(db, `select count(*) as n from ${appTable(table)}`)).resolves.toEqual([{ n: 0 }])
		}
	})
})

describe('the schema calls only what every Sereus node has', () => {
	// Every node holding a replica re-validates every write -- an always-on cadre machine as much
	// as either party's phone -- and none of them runs Taleus code. So the schema may call only
	// Quereus's built-ins and the stack's crypto. A function used only inside a column CHECK is
	// planned lazily, so a missing one is invisible until the first insert into that table;
	// read the schema, not memory.

	/** Quereus built-ins the schemas call. */
	const BUILTIN_SCALARS = ['IsISODate', 'length', 'glob', 'date', 'timespan', 'Greatest', 'Least']
	/** The stack's, from `@optimystic/quereus-plugin-crypto`, which Sereus registers itself. */
	const STACK_SCALARS = ['digest', 'verify']

	it.each(['draft1', 'portfolio'] as const)('%s.qsql calls nothing a Sereus node lacks', name => {
		for (const fn of functionsCalledBy(readSchema(name))) {
			expect([...BUILTIN_SCALARS, ...STACK_SCALARS]).toContain(fn)
		}
	})

	it('the tally schema really does call them — the scan is not vacuous', () => {
		// Without this, a scanner that matched nothing would pass the check above forever.
		// (`portfolio.qsql` calls none, which is why the check above cannot assert a count.)
		const called = functionsCalledBy(readSchema('draft1'))
		expect(called).toEqual(expect.arrayContaining(['digest', 'verify', 'IsISODate']))
	})

	it('and every one of them resolves on a database with only the crypto plugin', async () => {
		const db = await openStrand('draft1')
		// Arity differs, so call each with what it takes; the point is that it resolves.
		const calls = [
			"IsISODate('2026-03-02')",
			"length('abc')",
			"glob('a*', 'abc')",
			"date('now')",
			"timespan('P21D')",
			'Greatest(1, 2)',
			'Least(1, 2)',
			"digest('a','b')",
			"verify('d','s','k','ed25519')",
		]
		for (const call of calls) {
			await expect(rows(db, `select ${call} as v`)).resolves.toHaveLength(1)
		}
	})

	it('every verify in the schema names its curve', () => {
		// The plugin's `verify` defaults to secp256k1. Taleus keys are ed25519, so a call that
		// leaves the curve out refuses every genuine signature -- and reads as a permissions
		// failure, not a typo.
		const calls = verifyCalls(stripComments(readSchema('draft1')))
		expect(calls.length).toBeGreaterThan(0)
		for (const call of calls) {
			expect(call).toMatch(/,\s*'ed25519'\s*\)$/)
		}
	})
})

/** Every `verify( … )` call in some SQL, whole, with nested parentheses balanced. */
function verifyCalls(sql: string): string[] {
	const calls: string[] = []
	const pattern = /\bverify\(/g
	for (let match = pattern.exec(sql); match; match = pattern.exec(sql)) {
		let depth = 0
		for (let i = match.index + 'verify'.length; i < sql.length; i++) {
			if (sql[i] === '(') depth++
			if (sql[i] === ')' && --depth === 0) {
				calls.push(sql.slice(match.index, i + 1))
				break
			}
		}
	}
	return calls
}

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
