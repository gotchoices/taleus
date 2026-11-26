/**
 * The originator half of unidirectional discovery: the payer's own node drives a route search. It
 * mints a session code, builds the {@link UniQuery}, then drives its **own local participant** in
 * rounds -- an `entrance` first, then the `reentrance` each round returns -- one level deeper each
 * round, on a per-round time budget, until a plan satisfies the query, the search is exhausted (no
 * reentrance), or `maxDepth` is reached. The participant half (`participant.ts`) and the data model
 * (`types.ts`) are the previous ticket's; this module is the originator loop plus the budget rule.
 *
 * **Differences from ChipNet's `UniOriginator`** (docs/design.md § Protocol design):
 *
 *   - **No histogram budget.** ChipNet grew the per-round budget from peers' reported timing
 *     histograms (`sparstogram` + a Pareto quantile) with a `validatedStats` TODO that trusted peers
 *     outright. TallyNet drops that entirely: the budget is `initialBudgetMs + round * perHopBudgetMs`,
 *     computed solely from the originator's own options -- never from peer-reported stats. Peer
 *     {@link QueryStats} stay in the protocol as informational only (trace/diagnostics); nothing in
 *     control flow trusts them, so there is nothing to validate. The adaptive, histogram-based
 *     budget is parked as backlog `feat-tallynet-adaptive-budget`.
 *   - **No `UniOriginatorState`.** ChipNet kept a per-originator state that learned a budget growth
 *     rate across searches. A linear budget needs no history, so there is no originator state object;
 *     the options fold straight into the constructor.
 *   - **No target encryption.** ChipNet encrypted `target.unsecret` through an `AsymmetricVault`.
 *     TallyNet has no asymmetric-encryption port (only hash/sign/verify/random), and {@link Target}'s
 *     `secret` is already the host-encrypted secret, so the originator passes the `Target` through
 *     unchanged.
 *
 * A partial round is a normal, possibly-empty result -- the originator **never throws for "not
 * found"**. The final result is `{ sessionCode, plans }` with `plans` possibly empty.
 */

import type { Clock } from '../clock.js'
import type { RandomSource } from '../crypto.js'
import { generate } from '../session-code.js'
import { noopTraceSink, safeTraceSink, type TraceBase, type TraceSink } from '../trace.js'
import type { DiscoveryHooks } from './hooks.js'
import { DEFAULT_CONSENSUS_METHOD, MemberTypes, type ConsensusMethod, type Plan, type QueryRequest, type QueryResponse, type Target, type UniQuery } from './types.js'

/**
 * Originator tuning. The whole time budget lives here: a round's budget is
 * `initialBudgetMs + round * perHopBudgetMs`, so a deeper round -- whose round-trip is longer -- gets
 * a larger budget. These constants are coarse (there is no adaptive tuning in v1); see
 * `feat-tallynet-adaptive-budget`.
 */
export interface OriginatorOptions {
	/** Search-depth ceiling: the originator drives at most this many reentrance rounds. Rides on the query. */
	maxDepth: number
	/** The round-0 / round-1 budget, in ms. */
	initialBudgetMs: number
	/** Added to the budget for each round deeper. */
	perHopBudgetMs: number
	/** Lifetime of the session code this search mints, in ms. Must exceed a participant's `minSessionMs`. */
	sessionTtlMs: number
	/** The consensus method the eventual lift settles under; stamped onto the query. Default: a plain strict majority. */
	method: ConsensusMethod
	/** Optional reference (a Stroc CID) to the lift's written contract; stamped onto the query when set. */
	liftContract?: string
}

export const defaultOriginatorOptions: OriginatorOptions = {
	maxDepth: 7,
	initialBudgetMs: 2_000,
	perHopBudgetMs: 1_500,
	sessionTtlMs: 600_000,
	method: DEFAULT_CONSENSUS_METHOD,
}

/** The result of a search: the minted session code and the satisfying plans found (possibly empty). */
export interface DiscoveryResult<TTerms, TPayload> {
	sessionCode: string
	plans: Plan<TTerms, TPayload>[]
}

/**
 * Score a returned plan for the originator's own choice among the routes a round found. **Higher is
 * better**: the originator drives the highest-scoring plan. A score of `-Infinity` (or `NaN`) means
 * "never pick this one" — it is dropped from the result entirely. Pure **originator** policy: it never
 * crosses a hop, so it is NOT a {@link DiscoveryHooks} entry; each node's per-hop refusals live in the
 * hooks (`acceptsQuery`, `negotiatePlan`). The **default** is {@link defaultScorePlan}.
 */
export type ScorePlan<TTerms, TPayload> = (plan: Plan<TTerms, TPayload>, query: UniQuery<TTerms>) => number

/**
 * The default plan score: prefer **fewer voters**, then a **shorter path**, then first-found. Returned
 * as one scalar so "fewer voters" strictly dominates "shorter path": the hop term is divided by
 * `maxDepth + 1`, and a plan's path length never exceeds `maxDepth`, so the fractional hop penalty is
 * always `< 1` and can never outweigh one extra voter. Negated so higher = better. A lean voter set
 * therefore outranks a stacked one, and among equal voter counts the shorter route wins; exact ties
 * (same voters, same hops) fall to the first-found tiebreak the ranker applies.
 */
export function defaultScorePlan<TTerms, TPayload>(plan: Plan<TTerms, TPayload>, query: UniQuery<TTerms>): number {
	const voters = plan.members.filter((member) => member.types.includes(MemberTypes.voter)).length
	const hops = plan.path.length
	return -(voters + hops / (query.maxDepth + 1))
}

/**
 * The originator's one dependency on its node: a function that runs the node's **own** participant
 * `query` for a request (always with no inbound link -- the originator is the start of the route).
 * {@link DiscoveryNode} wires this to its local participant.
 */
export type LocalQuery<TTerms, TPayload> = (request: QueryRequest<TTerms, TPayload>) => Promise<QueryResponse<TTerms, TPayload>>

export interface OriginatorConfig<TTerms, TPayload> {
	/** This node's id, stamped onto trace events. */
	nodeId: string
	/** All time: used to stamp the session code's mint time and trace events. */
	clock: Clock
	/** Randomness for the session code. */
	random: RandomSource
	/** Negotiation hooks; the originator reads {@link DiscoveryHooks.planSatisfies} to decide when to stop. */
	hooks: DiscoveryHooks<TTerms, TPayload>
	/** Scores returned plans so the originator can rank and choose among them. Default: {@link defaultScorePlan}. */
	scorePlan?: ScorePlan<TTerms, TPayload>
	/** Runs the node's own participant query (see {@link LocalQuery}). */
	localQuery: LocalQuery<TTerms, TPayload>
	/** Tuning overrides merged over {@link defaultOriginatorOptions}. */
	options?: Partial<OriginatorOptions>
	/** Optional trace sink; wrapped so a throw can never break the search. Default: no-op. */
	trace?: TraceSink
}

export class UniOriginator<TTerms, TPayload> {
	readonly options: OriginatorOptions
	private readonly clock: Clock
	private readonly random: RandomSource
	private readonly hooks: DiscoveryHooks<TTerms, TPayload>
	private readonly scorePlan: ScorePlan<TTerms, TPayload>
	private readonly localQuery: LocalQuery<TTerms, TPayload>
	private readonly nodeId: string
	private readonly traceSink: TraceSink

	constructor(config: OriginatorConfig<TTerms, TPayload>) {
		this.options = { ...defaultOriginatorOptions, ...config.options }
		this.clock = config.clock
		this.random = config.random
		this.hooks = config.hooks
		this.scorePlan = config.scorePlan ?? defaultScorePlan
		this.localQuery = config.localQuery
		this.nodeId = config.nodeId
		this.traceSink = safeTraceSink(config.trace ?? noopTraceSink)
	}

	/**
	 * Run one unidirectional search for `target` carrying `intents`. Drives the local participant in
	 * rounds on the linear time budget; stops at the first round that yields a satisfying plan, when
	 * the search is exhausted, or at `maxDepth`. Never throws for "not found" -- returns empty plans.
	 *
	 * The result's `plans` are returned **best-first**: `plans[0]` is the winner (the plan
	 * {@link ScorePlan} scored highest), and `plans[1..]` are the passed-over routes, still best-first.
	 * That ordering is how a simulator or viewer reads which plan won and which were passed over, with
	 * no new trace event. Plans the score rejected (`-Infinity`/`NaN`) are dropped; if every satisfying
	 * plan is rejected, `plans` is empty (a "no acceptable route" result, never a throw).
	 */
	async discover(
		target: Target,
		intents: Record<string, TTerms>,
		options?: Partial<OriginatorOptions>,
	): Promise<DiscoveryResult<TTerms, TPayload>> {
		const opts = options ? { ...this.options, ...options } : this.options
		const sessionCode = generate(opts.sessionTtlMs, { now: this.clock.now(), random: this.random })
		const query: UniQuery<TTerms> = {
			target,
			sessionCode,
			intents,
			maxDepth: opts.maxDepth,
			method: opts.method,
			...(opts.liftContract !== undefined ? { liftContract: opts.liftContract } : {}),
		}

		// Round 0 is the entrance (the local participant enumerates its own links; it ignores the
		// budget). Every later round feeds back the previous round's reentrance ticket.
		let request: QueryRequest<TTerms, TPayload> = { entrance: { plan: { path: [], members: [] }, query }, budgetMs: opts.initialBudgetMs }

		for (let round = 0; round <= opts.maxDepth; round++) {
			const budgetMs = opts.initialBudgetMs + round * opts.perHopBudgetMs
			if (round > 0) {
				this.traceSink({ ...this.base(sessionCode), type: 'round-started', round, budgetMs })
			}
			const response = await this.localQuery({ ...request, budgetMs })

			const satisfying = (response.plans ?? []).filter((plan) => this.hooks.planSatisfies(query, plan))
			if (satisfying.length) {
				// Trace every satisfying plan found this round (before ranking), then rank+filter and return.
				for (let i = 0; i < satisfying.length; i++) {
					this.traceSink({ ...this.base(sessionCode), type: 'plan-found' })
				}
				return { sessionCode, plans: this.rankPlans(satisfying, query) }
			}
			if (!response.reentrance) {
				break // the search is exhausted: no node has a deeper step to take
			}
			request = { reentrance: response.reentrance, budgetMs }
		}
		return { sessionCode, plans: [] }
	}

	/**
	 * Rank the satisfying plans best-first via {@link ScorePlan}, dropping any the score rejects. A plan
	 * is rejected when its score is not strictly greater than `-Infinity` — which drops both `-Infinity`
	 * ("never pick") and `NaN` (a `> -Infinity` test is false for `NaN`), while letting `+Infinity`
	 * through. Survivors sort by score **descending**; exact ties fall back to the original index
	 * (ascending), so the first plan found wins a tie deterministically (no reliance on sort stability).
	 */
	private rankPlans(plans: Plan<TTerms, TPayload>[], query: UniQuery<TTerms>): Plan<TTerms, TPayload>[] {
		const scored = plans.map((plan, index) => ({ plan, index, score: this.scorePlan(plan, query) }))
		const acceptable = scored.filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
		acceptable.sort((a, b) => (a.score !== b.score ? (a.score > b.score ? -1 : 1) : a.index - b.index))
		return acceptable.map((entry) => entry.plan)
	}

	private base(sessionCode: string): TraceBase {
		return { time: this.clock.now(), nodeId: this.nodeId, sessionCode }
	}
}
