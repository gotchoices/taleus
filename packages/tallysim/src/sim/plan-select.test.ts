import type { Plan } from 'tallynet'
import { selectPlan } from './plan-select.js'
import type { LiftTerms } from './terms.js'

/** A plan with `hops` dummy links and an id smuggled on a nonce so a test can tell two same-length plans apart. */
function planOf(hops: number, tag: string): Plan<LiftTerms, unknown> {
	return {
		path: Array.from({ length: hops }, (_, i) => ({ nonce: `${tag}:${i}`, intents: {} })),
		members: [],
	}
}

describe('selectPlan — shortest policy', () => {
	it('returns undefined for no plans (the caller skips the consensus phase)', () => {
		expect(selectPlan([])).toBeUndefined()
	})

	it('picks the fewest-hop plan', () => {
		const plans = [planOf(3, 'a'), planOf(1, 'b'), planOf(2, 'c')]
		expect(selectPlan(plans)).toBe(plans[1]) // the 1-hop plan
	})

	it('breaks a length tie by first-found (earliest in array order)', () => {
		const first = planOf(2, 'first')
		const second = planOf(2, 'second')
		expect(selectPlan([first, second])).toBe(first) // strict < keeps the incumbent on equality
	})

	it('returns the sole plan when there is exactly one', () => {
		const only = planOf(4, 'only')
		expect(selectPlan([only])).toBe(only)
	})
})
