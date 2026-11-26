import { MemberTypes, type DependentMember, type Plan, type UniQuery } from 'tallynet'
import { selectPlan, voterAwareScorePlan } from './plan-select.js'
import type { LiftTerms } from './terms.js'

/** A plan with `hops` dummy links and an id smuggled on a nonce so a test can tell two same-length plans apart. */
function planOf(hops: number, tag: string): Plan<LiftTerms, unknown> {
	return {
		path: Array.from({ length: hops }, (_, i) => ({ nonce: `${tag}:${i}`, intents: {} })),
		members: [],
	}
}

/**
 * A plan with `hops` dummy links and a voter set: each key becomes a `['V']` member (its `address.key` is
 * the node name the voter-aware scorer reads as an entity id). The `tag` keeps same-shape plans distinct.
 */
function planWithVoters(hops: number, voterKeys: string[], tag: string): Plan<LiftTerms, unknown> {
	const members: DependentMember[] = voterKeys.map((key) => ({ types: [MemberTypes.voter], address: { key } }))
	return {
		path: Array.from({ length: hops }, (_, i) => ({ nonce: `${tag}:${i}`, intents: {} })),
		members,
	}
}

/** A throwaway query exposing only the `maxDepth` the exported scorer reads as its hop bound. */
function queryWithDepth(maxDepth: number): UniQuery<LiftTerms> {
	return { maxDepth } as unknown as UniQuery<LiftTerms>
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

describe('selectPlan — voter-aware policy', () => {
	// Entities 0 and 1 are the well-known hubs; any other key is an obscure voter.
	const wellKnown = new Set([0, 1])
	// A: 1 well-known voter, 3 hops.  B: 1 obscure voter, 1 hop.  C: 2 well-known voters, 1 hop.
	const planA = planWithVoters(3, ['0'], 'A')
	const planB = planWithVoters(1, ['5'], 'B')
	const planC = planWithVoters(1, ['0', '1'], 'C')

	it('prefers the lean, well-known voter set over a shorter route with an obscure voter', () => {
		// A and B both have 1 voter (so both beat C's 2); between them A has 0 obscure voters to B's 1, so A
		// wins despite being longer — "fewer voters, then well-known" outranks "shorter path".
		expect(selectPlan([planA, planB, planC], 'voter-aware', wellKnown)).toBe(planA)
	})

	it('fewer voters dominates fewer obscure voters (one obscure voter beats two well-known ones)', () => {
		expect(selectPlan([planB, planC], 'voter-aware', wellKnown)).toBe(planB) // 1 voter beats 2 voters
	})

	it('breaks an exact tie (same voter set, same hops) by first-found', () => {
		const first = planWithVoters(2, ['0'], 'first')
		const second = planWithVoters(2, ['0'], 'second')
		expect(selectPlan([first, second], 'voter-aware', wellKnown)).toBe(first)
	})

	it('with no well-known set, every voter is obscure → it degrades to fewer-voters-then-shorter-path', () => {
		// A and B now tie on voters (1) and obscure (1), so the shorter B wins; C still loses on voter count.
		expect(selectPlan([planA, planB, planC], 'voter-aware')).toBe(planB)
	})

	it("leaves 'shortest' unchanged — it ignores the voter set and the well-known arg", () => {
		expect(selectPlan([planA, planB, planC], 'shortest')).toBe(planB) // first 1-hop plan
		expect(selectPlan([planA, planB, planC], 'shortest', wellKnown)).toBe(planB) // wellKnown has no effect
	})

	it('the exported ScorePlan ranks a plan set the same way as the voter-aware pick', () => {
		const scorePlan = voterAwareScorePlan<LiftTerms, unknown>(wellKnown)
		const query = queryWithDepth(7)
		const plans = [planC, planB, planA] // deliberately not best-first on input
		const ranked = [...plans].sort((p, q) => scorePlan(q, query) - scorePlan(p, query)) // score desc
		// The top of the score ranking is exactly selectPlan's voter-aware pick, and the full order agrees.
		expect(ranked[0]).toBe(selectPlan(plans, 'voter-aware', wellKnown))
		expect(ranked).toEqual([planA, planB, planC])
	})
})
