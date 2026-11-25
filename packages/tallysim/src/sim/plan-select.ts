/**
 * The originator's plan-selection policy: given the satisfying {@link Plan}s a discovery query returned,
 * pick the one the originator would actually drive to settlement. Discovery hands back *every* route it
 * found; a payment settles exactly one, so the originator needs a deterministic rule for choosing.
 *
 * Only one policy ships today — **`shortest`**: the fewest-hop plan (smallest `path.length`), ties broken
 * by **first found** (the stable order the discovery participant returned them in). It is exposed as a
 * named policy ({@link PlanPolicy}) so a later experiment can sweep alternative policies (cheapest,
 * highest-capacity, …) without reshaping the call site; until then `shortest` is the only value.
 *
 * Empty plans ⇒ `undefined` (the caller skips the consensus phase — there is nothing to settle). This is
 * the single documented place the originator's route preference lives, so the consensus harness and any
 * future sweep agree on which plan a query commits.
 */

import type { Plan } from 'tallynet'

/** The originator's route-preference policy. Only `shortest` ships; the type is open for a later sweep. */
export type PlanPolicy = 'shortest'

/**
 * Pick the plan the originator drives to settlement under `policy` (default `shortest`), or `undefined`
 * when `plans` is empty. `shortest` returns the fewest-hop plan; ties keep the earliest in array order
 * (replace the incumbent only on a strict `path.length <`), so the first-found shortest plan wins and the
 * choice is deterministic for a given discovery result.
 */
export function selectPlan<TTerms, TPayload>(
	plans: Plan<TTerms, TPayload>[],
	policy: PlanPolicy = 'shortest',
): Plan<TTerms, TPayload> | undefined {
	if (plans.length === 0) {
		return undefined
	}
	switch (policy) {
		case 'shortest': {
			return shortestPlan(plans)
		}
		default: {
			// Exhaustiveness guard: a new PlanPolicy value must add its own case here.
			throw new Error(`selectPlan: unknown policy ${String(policy)}`)
		}
	}
}

/** The fewest-hop plan, earliest in array order on a tie (strict `<` keeps the incumbent on equality). */
function shortestPlan<TTerms, TPayload>(plans: Plan<TTerms, TPayload>[]): Plan<TTerms, TPayload> {
	let best = plans[0]
	for (let i = 1; i < plans.length; i++) {
		if (plans[i].path.length < best.path.length) {
			best = plans[i]
		}
	}
	return best
}
