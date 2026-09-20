import { openStrand, rows, statementsOf, schemaPath } from './strand.js'
import { readFileSync } from 'node:fs'

/**
 * The schema is the thing everything else stands on, and until this suite existed nothing
 * had ever executed it -- the lift tests use an in-memory double their own harness calls
 * "schema-EMULATING". These tests are the floor: the real file, the real engine.
 */
describe('the schema loads into Quereus', () => {
	it('every statement in draft1.qsql executes', async () => {
		const statements = statementsOf(readFileSync(schemaPath('draft1'), 'utf8'))
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

/**
 * Determinism is not a style preference here. Every replica of a strand re-validates every
 * write; a gate that read a clock would have replicas disagree about the same row. Quereus
 * enforces this, and these tests record that the schema depends on it.
 */
describe('constraints are deterministic', () => {
	it('no constraint or default reads a clock or a random source', () => {
		const sql = readFileSync(schemaPath('draft1'), 'utf8')
		const code = sql
			.split('\n')
			.filter(line => !line.trim().startsWith('--'))
			.join('\n')
		expect(code).not.toMatch(/\bjulianday\s*\(/)
		expect(code).not.toMatch(/\bRandomUUID\s*\(/)
		expect(code).not.toMatch(/\bnow\s*\(\s*\)/)
	})
})
