/**
 * The originator's plan-selection policy: given the satisfying {@link Plan}s a discovery query returned,
 * pick the one the originator would actually drive to settlement. Discovery hands back *every* route it
 * found; a payment settles exactly one, so the originator needs a deterministic rule for choosing.
 *
 * Two policies ship:
 *
 * - **`shortest`** — the fewest-hop plan (smallest `path.length`), ties broken by **first found** (the
 *   stable order the discovery participant returned them in). It ignores the voter set entirely.
 * - **`voter-aware`** — rank by the plan's **voter set** first: prefer **fewer** voters, then among an
 *   equal count prefer **well-known** voters (fewer obscure ones), then a shorter path, then first-found.
 *   This is the payer refusing to drive a route whose quorum is padded with obscure referees it doesn't
 *   recognise. It needs the well-known entity set (see {@link wellKnownEntities}) to tell a trusted voter
 *   from an obscure one, so {@link selectPlan} grows an optional `wellKnown` argument.
 *
 * The same voter-aware ranking is exported two ways so the simulator's own pick and the discovery
 * originator's in-protocol ranking stay consistent: {@link selectPlan}'s `voter-aware` branch (the pick
 * over a settled query's `plans`) and {@link voterAwareScorePlan} (a `tallynet`-shaped {@link ScorePlan}
 * the next ticket hands to `buildSimNetwork` as the originator's scorer). Both read one core penalty
 * ({@link voterAwarePenalty}), so they order any plan set identically.
 *
 * Empty plans ⇒ `undefined` (the caller skips the consensus phase — there is nothing to settle). This is
 * the single documented place the originator's route preference lives, so the consensus harness and any
 * future sweep agree on which plan a query commits.
 */

import { MemberTypes, type Plan, type ScorePlan } from 'tallynet'

/** The originator's route-preference policy. `shortest` ignores voters; `voter-aware` ranks by them. */
export type PlanPolicy = 'shortest' | 'voter-aware'

/**
 * Pick the plan the originator drives to settlement under `policy` (default `shortest`), or `undefined`
 * when `plans` is empty.
 *
 * - `shortest` returns the fewest-hop plan; ties keep the earliest in array order (replace the incumbent
 *   only on a strict `path.length <`), so the first-found shortest plan wins. `wellKnown` is ignored.
 * - `voter-aware` ranks by {@link voterAwarePenalty} (fewer voters ≫ fewer obscure voters ≫ shorter path),
 *   keeping the earliest on an exact tie. A voter is **obscure** when its entity id is not in `wellKnown`;
 *   an omitted `wellKnown` is treated as empty (every voter obscure), which degrades the ranking to
 *   fewer-voters-then-shorter-path.
 *
 * The choice is deterministic for a given discovery result (no reliance on sort stability — the scan
 * replaces the incumbent only on a strict improvement).
 */
export function selectPlan<TTerms, TPayload>(
	plans: Plan<TTerms, TPayload>[],
	policy: PlanPolicy = 'shortest',
	wellKnown?: Set<number>,
): Plan<TTerms, TPayload> | undefined {
	if (plans.length === 0) {
		return undefined
	}
	switch (policy) {
		case 'shortest': {
			return shortestPlan(plans)
		}
		case 'voter-aware': {
			return voterAwarePlan(plans, wellKnown ?? new Set())
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

/**
 * The lowest-penalty plan under {@link voterAwarePenalty}, earliest in array order on an exact tie (strict
 * `<` keeps the incumbent). The hop bound is the longest path among `plans`; every plan's hop count is
 * `≤` it, so the hop term stays in range and the three-level order (voters, obscure, hops) holds. The
 * bound only scales the sub-integer hop term, never the order, so this pick matches
 * {@link voterAwareScorePlan}'s ranking (which bounds by `query.maxDepth` instead).
 */
function voterAwarePlan<TTerms, TPayload>(plans: Plan<TTerms, TPayload>[], wellKnown: Set<number>): Plan<TTerms, TPayload> {
	const hopBound = plans.reduce((max, plan) => Math.max(max, plan.path.length), 0)
	let best = plans[0]
	let bestPenalty = voterAwarePenalty(best, wellKnown, hopBound)
	for (let i = 1; i < plans.length; i++) {
		const penalty = voterAwarePenalty(plans[i], wellKnown, hopBound)
		if (penalty < bestPenalty) {
			best = plans[i]
			bestPenalty = penalty
		}
	}
	return best
}

/**
 * A `tallynet`-shaped {@link ScorePlan} (**higher is better**) that ranks a plan voter-aware against
 * `wellKnown`: it returns `-{@link voterAwarePenalty}` with the query's `maxDepth` as the hop bound. Hand
 * this to a discovery originator (`buildSimNetwork`'s scorer, wired in the next ticket) so the in-protocol
 * ranking and the simulator's own {@link selectPlan} `voter-aware` pick order any plan set the same way.
 * The score is always finite, so no plan is ever dropped (voter-aware ranks, it never rejects).
 */
export function voterAwareScorePlan<TTerms, TPayload>(wellKnown: Set<number>): ScorePlan<TTerms, TPayload> {
	return (plan, query) => -voterAwarePenalty(plan, wellKnown, query.maxDepth)
}

/**
 * The voter-aware penalty (**lower is better**) packed into one scalar whose magnitude order is
 * `voters ≫ obscure voters ≫ hops`:
 *
 * ```
 *   penalty = voters + obscure/(voters+1) + hops/((voters+1)·(hopBound+1))
 * ```
 *
 * `obscure` is the count of voters whose entity id is not in `wellKnown` (`obscure ≤ voters`), and
 * `hops = plan.path.length` (`hops ≤ hopBound`). The two fractional terms together are always `< 1`, so
 * the integer `voters` strictly dominates; the hop term is further divided by `voters+1` so it is always
 * smaller than one obscure-voter step (`1/(voters+1)`), so obscure strictly dominates hops. The order the
 * scalar encodes therefore does not depend on `hopBound` (any bound `≥` every plan's hop count gives the
 * same ranking) — only its sub-integer spacing does. A voter's entity id is read as `Number(member.
 * address.key)`: in a discovery plan a member's key IS its node name (the sim names a node `String(id)`),
 * so a non-numeric or unknown key yields `NaN`, which `wellKnown` never contains → counted obscure (the
 * safe default). A `[P,V]` voter counts the same as a `[V]`-only referee here — this is a soft ranking of
 * the whole voter set, not the hard V-only refusal gate ({@link refusesStackedVoterSet}).
 */
function voterAwarePenalty<TTerms, TPayload>(plan: Plan<TTerms, TPayload>, wellKnown: Set<number>, hopBound: number): number {
	// NOTE: assumes `hops ≤ hopBound` (both call sites guarantee it: selectPlan uses the max hops of the set,
	// the scorer uses query.maxDepth which the originator never exceeds). If a plan with hops > hopBound were
	// ever scored, the hop term could exceed 1/(voters+1) and break the "voters dominate" order.
	const voters = plan.members.filter((member) => member.types.includes(MemberTypes.voter))
	const voterCount = voters.length
	const obscure = voters.filter((member) => !wellKnown.has(Number(member.address.key))).length
	const hops = plan.path.length
	return voterCount + obscure / (voterCount + 1) + hops / ((voterCount + 1) * (hopBound + 1))
}
