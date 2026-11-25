/**
 * Discovery negotiation hooks: the points where a host shapes a route search. These replace
 * ChipNet's `NegotiateIntentFunc` / `intentsSatisfied` / `NegotiatePlanFunc` and the hard-coded
 * `prependMatch` body's return handling, and they carry the **hop context** the multi-denomination
 * work needs (docs/design.md § Multiple denominations) -- *without* implementing any currency
 * conversion here. The defaults ({@link defaultHooks}) reproduce ChipNet's single-unit behaviour, so
 * a host that never bridges denominations can ignore the extra context entirely.
 *
 * All four hooks are **synchronous** (as ChipNet's were): the engine calls them inline while
 * building and returning plans. Terms (`TTerms`) and payload (`TPayload`) are opaque to TallyNet.
 */

import type { Match, Plan, UniQuery } from './types.js'

export interface DiscoveryHooks<TTerms, TPayload> {
	/**
	 * Constrain one candidate link's terms for one intent code, given the hop.
	 *
	 * - `code` is the intent code (e.g. a lift or comms code).
	 * - `linkTerms` is that code's terms on the outbound candidate link.
	 * - `inboundTerms` is that code's terms on the link this node was reached by (the last link of
	 *   the path so far); `undefined` at the originator, which has no inbound link.
	 * - `query` is the originator's query.
	 *
	 * @returns the outbound link's terms as constrained for this code, or `undefined` to drop this
	 *   code on this candidate. The **default** passes `linkTerms` straight through when the query
	 *   carries `code`, and returns `undefined` otherwise -- single-unit behaviour that ignores the
	 *   hop context (`inboundTerms`) entirely. The multi-denomination work overrides this to read
	 *   `inboundTerms` and the hop.
	 */
	negotiateIntent(ctx: { code: string; linkTerms: TTerms; inboundTerms?: TTerms; query: UniQuery<TTerms> }): TTerms | undefined

	/**
	 * Does this whole plan satisfy the query? Replaces ChipNet's per-link uniform `intentsSatisfied`
	 * (which required every link of *some* plan to satisfy the *same* query terms). The engine calls
	 * this per candidate plan and concludes a search when `plans.some(p => planSatisfies(query, p))`.
	 *
	 * The **default** returns true iff, for every code in `query.intents`, every link of the plan
	 * carries that code. **It deliberately ignores the terms' *values*** (a trivially-true per-term
	 * predicate) -- a host that needs value checks (enough capacity, right denomination) overrides it.
	 * An empty-path plan satisfies vacuously (matching ChipNet), which covers the originator-is-target
	 * case.
	 */
	planSatisfies(query: UniQuery<TTerms>, plan: Plan<TTerms, TPayload>): boolean

	/**
	 * Return-path hook, called once per plan this node is about to prepend itself onto -- exactly
	 * where ChipNet calls `prependMatch`, and **before** that prepend. `inboundNonce` is the nonce of
	 * the link this node was reached by (`undefined` at the originator). This is where the
	 * multi-denomination work computes `req_in` from `req_out` with a node's private quote, so the
	 * quote never leaves the node; only the resulting integer amounts are disclosed.
	 *
	 * @returns the (possibly amended) plan, or `undefined` to drop it. The **default** is identity.
	 */
	annotateReturn?(ctx: { plan: Plan<TTerms, TPayload>; self: Match; inboundNonce?: string }): Plan<TTerms, TPayload> | undefined

	/**
	 * Optional whole-plan vetting/extension (e.g. add referees). ChipNet's `NegotiatePlanFunc`.
	 * @returns the revised plan, or `undefined` to reject it. The **default** is identity.
	 */
	negotiatePlan?(plan: Plan<TTerms, TPayload>): Plan<TTerms, TPayload> | undefined
}

/**
 * The single-unit default hooks (ChipNet's behaviour):
 *
 * - `negotiateIntent`: pass the candidate link's terms through for any code the query carries; drop
 *   codes the query doesn't carry. Ignores the hop context.
 * - `planSatisfies`: every code in the query is present on every link of the plan (values ignored).
 * - `annotateReturn` / `negotiatePlan`: identity.
 *
 * A host overrides any subset; the engine tolerates a hooks object that omits the two optional ones.
 */
export function defaultHooks<TTerms, TPayload>(): DiscoveryHooks<TTerms, TPayload> {
	return {
		negotiateIntent: ({ code, linkTerms, query }) =>
			Object.prototype.hasOwnProperty.call(query.intents, code) ? linkTerms : undefined,
		planSatisfies: (query, plan) =>
			Object.keys(query.intents).every((code) =>
				plan.path.every((link) => Object.prototype.hasOwnProperty.call(link.intents, code)),
			),
		annotateReturn: ({ plan }) => plan,
		negotiatePlan: (plan) => plan,
	}
}
