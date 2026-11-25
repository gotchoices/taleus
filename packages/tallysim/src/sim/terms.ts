/**
 * The discovery link-term type and the capacity-aware node policy that make a real `tallynet` route
 * search honour each node's own view of its tallies' capacity — the correctness anchor of this tier.
 *
 * {@link LiftTerms} carries, on a link, the directed capacity available in that view's **forward**
 * direction (computed from the very same `capacity.ts` helpers the oracle's graph view uses), and, on a
 * query, the required payment amount. Because a node's forward view of a link equals the oracle's
 * directed-edge capacity for that same direction, every route the protocol finds is one the oracle also
 * confirms (the *found ⊆ oracle* guarantee). See `docs/design.md` § Discovery simulation.
 *
 * {@link makeCapacityHooks} overrides only the two capacity checks of `tallynet`'s {@link defaultHooks}:
 * a candidate link is forwarded only when its forward capacity covers the query amount, and a whole plan
 * satisfies only when every one of its hops does. `annotateReturn` / `negotiatePlan` keep the
 * single-denomination identity defaults — bridging denominations is later work, not here.
 */

import { defaultHooks, type DiscoveryHooks } from 'tallynet'

/**
 * The terms on one discovery link for the single lift intent code, and the shape a query carries.
 *
 * - On a **link** (one node's view of a tally): `capFwd` is the directed capacity available in this
 *   view's forward direction (`node1 → node2`), `capBack` is the opposite direction's capacity, and
 *   `amount` is 0 (unused on a link).
 * - On a **query**: `amount` is the required payment amount; `capFwd` / `capBack` are 0 (unused).
 */
export interface LiftTerms {
	capFwd: number
	capBack: number
	amount: number
}

/** Invert one link's terms for the reverse (`node2 → node1`) view: swap the two directed capacities. */
export const invertLiftTerms = (t: LiftTerms): LiftTerms => ({ capFwd: t.capBack, capBack: t.capFwd, amount: t.amount })

/**
 * The capacity-aware discovery hooks: `tallynet`'s single-denomination defaults with the two capacity
 * checks overridden, so a node only forwards over — and a plan is only accepted on — hops whose forward
 * capacity covers the query amount. A node acting on its own local view, which also keeps the message
 * count honest (an insufficient candidate is pruned before it is ever queried).
 */
export function makeCapacityHooks(): DiscoveryHooks<LiftTerms, unknown> {
	const base = defaultHooks<LiftTerms, unknown>()
	return {
		...base,
		negotiateIntent: ({ code, linkTerms, query }) => {
			if (!Object.prototype.hasOwnProperty.call(query.intents, code)) {
				return undefined
			}
			return linkTerms.capFwd >= query.intents[code].amount ? linkTerms : undefined
		},
		planSatisfies: (query, plan) => {
			// A payment needs a real hop: the originator is never the payee in this tier, so an empty
			// (self-match) path can never satisfy — re-checked here, not only in negotiateIntent.
			if (plan.path.length === 0) {
				return false
			}
			return Object.keys(query.intents).every((code) =>
				plan.path.every((link) => {
					const terms = link.intents[code]
					return terms !== undefined && terms.capFwd >= query.intents[code].amount
				}),
			)
		},
	}
}
