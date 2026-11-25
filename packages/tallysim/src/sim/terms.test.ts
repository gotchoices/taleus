import type { Link, Plan, UniQuery } from 'tallynet'
import { type LiftTerms, invertLiftTerms, makeCapacityHooks } from './terms.js'

/** A query carrying one `'L'` intent of the given required amount. */
function query(amount: number): UniQuery<LiftTerms> {
	return { target: { address: { key: 'x' } }, sessionCode: 's', intents: { L: { capFwd: 0, capBack: 0, amount } }, maxDepth: 5 }
}

/** A plan whose path links carry the given forward capacities (one link per capacity). */
function plan(...capFwds: number[]): Plan<LiftTerms, unknown> {
	const path: Link<LiftTerms>[] = capFwds.map((capFwd) => ({ nonce: 'n', intents: { L: { capFwd, capBack: 0, amount: 0 } } }))
	return { path, members: [] }
}

describe('invertLiftTerms', () => {
	it('swaps the two directed capacities and round-trips (including Infinity)', () => {
		const t: LiftTerms = { capFwd: 5, capBack: Infinity, amount: 0 }
		expect(invertLiftTerms(t)).toEqual({ capFwd: Infinity, capBack: 5, amount: 0 })
		expect(invertLiftTerms(invertLiftTerms(t))).toEqual(t)
	})

	it('leaves the amount untouched', () => {
		expect(invertLiftTerms({ capFwd: 1, capBack: 2, amount: 9 })).toEqual({ capFwd: 2, capBack: 1, amount: 9 })
	})
})

describe('makeCapacityHooks — negotiateIntent', () => {
	const hooks = makeCapacityHooks()

	it('passes the link terms through when forward capacity covers the amount', () => {
		const linkTerms: LiftTerms = { capFwd: 10, capBack: 0, amount: 0 }
		expect(hooks.negotiateIntent({ code: 'L', linkTerms, query: query(5) })).toEqual(linkTerms)
	})

	it('drops a candidate whose forward capacity is below the amount', () => {
		expect(hooks.negotiateIntent({ code: 'L', linkTerms: { capFwd: 3, capBack: 0, amount: 0 }, query: query(5) })).toBeUndefined()
	})

	it('accepts exactly-equal capacity (>=, not >)', () => {
		const linkTerms: LiftTerms = { capFwd: 5, capBack: 0, amount: 0 }
		expect(hooks.negotiateIntent({ code: 'L', linkTerms, query: query(5) })).toEqual(linkTerms)
	})

	it('drops a code the query does not carry', () => {
		expect(hooks.negotiateIntent({ code: 'X', linkTerms: { capFwd: 100, capBack: 0, amount: 0 }, query: query(5) })).toBeUndefined()
	})

	it('treats Infinity forward capacity as covering any amount', () => {
		const linkTerms: LiftTerms = { capFwd: Infinity, capBack: 0, amount: 0 }
		expect(hooks.negotiateIntent({ code: 'L', linkTerms, query: query(1_000_000) })).toEqual(linkTerms)
	})
})

describe('makeCapacityHooks — planSatisfies', () => {
	const hooks = makeCapacityHooks()

	it('rejects an empty (self-match) path — a payment needs a real hop', () => {
		expect(hooks.planSatisfies(query(5), { path: [], members: [] })).toBe(false)
	})

	it('accepts a plan whose every hop covers the amount', () => {
		expect(hooks.planSatisfies(query(5), plan(10, 8, 5))).toBe(true)
	})

	it('rejects a plan where any single hop is below the amount', () => {
		expect(hooks.planSatisfies(query(5), plan(10, 3, 10))).toBe(false)
	})
})
