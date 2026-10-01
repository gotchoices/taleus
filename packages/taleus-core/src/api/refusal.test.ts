import { attempt, refusalFrom, uniqueViolation } from './refusal.js'

/**
 * The mapping from an engine refusal to something a consumer can branch on.
 *
 * The rule under test is that the mapping never guesses. A constraint with no entry comes back
 * as `refused` **with its name intact** -- a wrong code is worse than no code, because a caller
 * will believe it.
 */
describe('reading a refusal', () => {
	it('keeps the constraint name for a rule it does not recognize', async () => {
		const refusal = refusalFrom(new Error('CHECK constraint failed: SomeFutureRule'))
		expect(refusal.code).toBe('refused')
		expect(refusal.constraint).toBe('SomeFutureRule')
	})

	it('recognizes a unique violation even with no named constraint', async () => {
		const refusal = refusalFrom(new Error('UNIQUE constraint failed: Invoice PK.'))
		expect(refusal.code).toBe('already-exists')
	})

	it('falls back to `refused` when nothing in the message names a rule', async () => {
		const refusal = refusalFrom(new Error('something went sideways'))
		expect(refusal).toMatchObject({ code: 'refused', message: 'something went sideways' })
		expect(refusal.constraint).toBeUndefined()
	})

	it('reads a column-level rule as a terms problem', async () => {
		expect(refusalFrom(new Error('CHECK constraint failed: _check_Bound (Bound >= Target)')).code).toBe(
			'terms',
		)
	})
})

describe('refusals that arrive wrapped, as they do on a real strand', () => {
	// Sereus documents that a concurrent duplicate can surface as a plain Error with the
	// constraint text on its cause chain. A mapping that read only the outermost message would
	// treat a refusal as a crash -- and throw where it should have answered.
	const wrapped = (inner: string) => new Error('commit failed', { cause: new Error(inner) })

	it('finds the constraint on the cause chain', () => {
		expect(refusalFrom(wrapped('CHECK constraint failed: WithinCreditLimits')).code).toBe('credit-limit')
	})

	it('treats a wrapped refusal as a refusal, not a fault', async () => {
		const result = await attempt(() => Promise.reject(wrapped('UNIQUE constraint failed: Ledger.Number')))
		expect(result.ok ? '' : result.refusal.code).toBe('already-exists')
	})

	it('survives a cause cycle', () => {
		const a = new Error('a') as Error & { cause?: unknown }
		const b = new Error('b', { cause: a })
		a.cause = b
		expect(refusalFrom(a).code).toBe('refused')
	})
})

describe('naming the unique key that collided', () => {
	it('reads all three spellings', () => {
		expect(uniqueViolation(new Error('UNIQUE constraint failed: Invoice PK.'))).toEqual({ table: 'Invoice', key: 'PK' })
		expect(uniqueViolation(new Error('UNIQUE constraint failed: Ledger (InvoiceId)'))).toEqual({ table: 'Ledger', key: 'InvoiceId' })
		expect(uniqueViolation(new Error('UNIQUE constraint failed: Strand.Id'))).toEqual({ table: 'Strand', key: 'Id' })
	})

	it('reads an already-answered request as a request mismatch, not a duplicate', () => {
		expect(refusalFrom(new Error('UNIQUE constraint failed: Ledger (InvoiceId)')).code).toBe('request-mismatch')
	})

	it('is not fooled by a CHECK', () => {
		expect(uniqueViolation(new Error('CHECK constraint failed: InvoiceLink'))).toBeUndefined()
	})
})
