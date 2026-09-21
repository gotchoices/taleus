import { refusalFrom } from './refusal.js'

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
