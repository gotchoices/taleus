/**
 * The participant half of unidirectional discovery: the logic that runs at every node a query
 * passes through. The originator side and the end-to-end wiring are a later ticket; this module
 * delivers the data model, the durable/in-flight state split (see `store.ts`), and the
 * `enter`/`reenter` logic -- with every ChipNet discovery defect from docs/chipnet-review.md
 * § *Discovery defects* fixed:
 *
 *   - **Cycles are removed, not merely reported** (ChipNet `participant.ts:233-244` built a set of
 *     link ids and filtered by nonce, so it never matched). A candidate whose nonce already appears
 *     on the path is dropped, with a `candidate-pruned`/`cycle` trace.
 *   - **Failed candidates are pruned** (ChipNet `:113`'s `!r || !r.isError || !r.isResponse || …`
 *     kept nearly everything). Errored, and completed-without-a-reentrance candidates, are dropped.
 *   - **Duplicate-query rejection actually fires** -- the store keys a context by one (session,
 *     path) tuple throughout (ChipNet `memory-participant-state.ts:25,32` keyed two different ways).
 *   - **The real time budget is honoured** (ChipNet `:102` hard-coded `budgetedStep(1000, …)`). Each
 *     round awaits `budgetedStep(clock, budgetMs - elapsed, …)` on the injected {@link Clock}, which
 *     always clears its timer (no leaked timers).
 *   - **No live `Pending` ever reaches the store** -- in-flight requests live in an in-memory table
 *     here, keyed by (session, path, linkId); the durable context holds only the last *completed*
 *     response per candidate. A restart loses the table and simply re-queries.
 *   - **Plans carry no stray `sessionCode`** (ChipNet `:167` built plans with an undeclared field).
 *
 * Everything runs on injected ports (clock, random, hasher, trace), with candidate iteration sorted
 * by nonce, so a seeded run on a virtual clock is reproducible (docs/design.md § Determinism).
 */

import type { Clock } from '../clock.js'
import type { Hasher, RandomSource } from '../crypto.js'
import { makeNonce } from '../nonce.js'
import { Rule, RuleSet, type RuleResponse } from '../rule.js'
import { Pending, budgetedStep } from '../sequencing.js'
import { expiresAt, isExpired, isValid } from '../session-code.js'
import { noopTraceSink, safeTraceSink, type TraceBase, type TraceSink } from '../trace.js'
import type { DiscoveryHooks } from './hooks.js'
import { contextKey, type ParticipantStore, type StoredCandidate, type StoredContext } from './store.js'
import {
	addressesMatch,
	appendPath,
	MemberTypes,
	type DependentMember,
	type FindAddressFunc,
	type FindResult,
	type IdentifiedMember,
	type Link,
	type Match,
	type Plan,
	type QueryPeerFunc,
	type QueryRequest,
	type QueryResponse,
	type Reentrance,
	type UniQuery,
} from './types.js'

/** The shared signature of every query-validation rule, so one {@link RuleSet} types them all. */
type QueryRuleTest<TTerms, TPayload> = (
	plan: Plan<TTerms, TPayload>,
	query: UniQuery<TTerms>,
	inLinkId?: string,
) => Promise<RuleResponse>

/**
 * Participant tuning. Ported from ChipNet's `UniParticipantOptions`. ChipNet's `timingStatBuckets`
 * and `debugBudget` are dropped (no histogram; the budget is a real argument now), and
 * `negotiatePlan` moved to {@link DiscoveryHooks} where all the negotiation hooks live.
 */
export interface ParticipantOptions {
	/**
	 * Reserved: the maximum age a reentrance may reach before it is refused. Not yet enforced
	 * (ChipNet declared it but never read it either); kept so the field is stable for the engine.
	 */
	maxQueryAgeMs: number
	/**
	 * Default search depth ceiling used only when this node mints a query of its own. A received
	 * query's own `maxDepth` is authoritative per-search and is what `reenter` enforces.
	 */
	maxDepth: number
	/** Minimum session life (ms) that must remain for this node to accept a first visit. */
	minSessionMs: number
}

export const defaultParticipantOptions: ParticipantOptions = {
	maxQueryAgeMs: 10_000,
	maxDepth: 7,
	minSessionMs: 30_000,
}

/**
 * The session-code checks the participant needs, injected so a host (or the simulator's virtual
 * clock) controls them. Defaults wrap `session-code.ts`. All take `now` explicitly -- nothing here
 * reads a real clock.
 */
export interface SessionCodeValidators {
	/** Well-formed, not expired at `now`, and not claiming an implausibly distant expiry. Never throws. */
	isValid(code: string, now: number): boolean
	/** Whether `code` has expired at `now`. May throw on a malformed code -- gate with {@link isValid}. */
	isExpired(code: string, now: number): boolean
	/** The expiry encoded in `code` (ms since epoch). May throw on a malformed code. */
	expiresAt(code: string): number
}

export const defaultSessionCodeValidators: SessionCodeValidators = {
	isValid: (code, now) => isValid(code, now),
	isExpired: (code, now) => isExpired(code, now),
	expiresAt: (code) => expiresAt(code),
}

/** Everything the participant is constructed with. Ports default where sensible; the rest is host-supplied. */
export interface ParticipantConfig<TTerms, TPayload> {
	/** Durable per-(session, path) context store. */
	store: ParticipantStore<TTerms, TPayload>
	/** All time and timers. */
	clock: Clock
	/**
	 * Cryptographic randomness. Held for the engine and any future tie-breaking; the participant's
	 * own logic is fully deterministic (candidates are sorted by nonce), so it draws none today --
	 * which is exactly how it honours "no `Math.random`".
	 */
	random: RandomSource
	/** sha256, for deriving edge nonces via {@link makeNonce}. */
	hasher: Hasher
	/** This node's own id, stamped onto every trace event. */
	nodeId: string
	/** Host callback: resolve this node's role for a query. */
	findAddress: FindAddressFunc<TTerms, TPayload>
	/** Negotiation hooks (use {@link defaultHooks} for single-unit behaviour). */
	hooks: DiscoveryHooks<TTerms, TPayload>
	/** Host callback: send a sub-request across a link. */
	queryPeer: QueryPeerFunc<TTerms, TPayload>
	/** Tuning overrides merged over {@link defaultParticipantOptions}. */
	options?: Partial<ParticipantOptions>
	/** Optional trace sink; wrapped so a throw can never break the engine. Default: no-op. */
	trace?: TraceSink
	/** Session-code checks; default wraps `session-code.ts`. */
	sessionCodes?: SessionCodeValidators
}

export class Participant<TTerms, TPayload> {
	readonly options: ParticipantOptions
	readonly store: ParticipantStore<TTerms, TPayload>
	readonly clock: Clock
	readonly random: RandomSource
	readonly hasher: Hasher
	readonly nodeId: string
	readonly hooks: DiscoveryHooks<TTerms, TPayload>
	private readonly findAddress: FindAddressFunc<TTerms, TPayload>
	private readonly queryPeer: QueryPeerFunc<TTerms, TPayload>
	private readonly traceSink: TraceSink
	private readonly sessionCodes: SessionCodeValidators

	/**
	 * The in-flight sub-request table -- the half of discovery state that is NOT durable. Keyed by
	 * (session, path, linkId). A restart starts it empty; a reenter then re-derives from each
	 * candidate's durable `lastResponse`.
	 */
	private readonly inFlight = new Map<string, Pending<QueryResponse<TTerms, TPayload>>>()

	private readonly queryRules: RuleSet<QueryRuleTest<TTerms, TPayload>>

	constructor(config: ParticipantConfig<TTerms, TPayload>) {
		this.options = { ...defaultParticipantOptions, ...config.options }
		this.store = config.store
		this.clock = config.clock
		this.random = config.random
		this.hasher = config.hasher
		this.nodeId = config.nodeId
		this.hooks = config.hooks
		this.findAddress = config.findAddress
		this.queryPeer = config.queryPeer
		this.traceSink = safeTraceSink(config.trace ?? noopTraceSink)
		this.sessionCodes = config.sessionCodes ?? defaultSessionCodeValidators
		this.queryRules = this.buildQueryRules()
	}

	/** Dispatch a request to {@link enter} (first visit) or {@link reenter} (go one level deeper). */
	async query(request: QueryRequest<TTerms, TPayload>, inLinkId?: string): Promise<QueryResponse<TTerms, TPayload>> {
		if (request.entrance) {
			return await this.enter(request.entrance.plan, request.entrance.query, request.budgetMs, inLinkId)
		}
		if (request.reentrance) {
			return await this.reenter(request.reentrance, request.budgetMs, inLinkId)
		}
		throw new Error('Invalid request: neither an entrance nor a reentrance')
	}

	/* ── first visit (depth 1) ──────────────────────────────────────────────────────── */

	private async enter(
		plan: Plan<TTerms, TPayload>,
		query: UniQuery<TTerms>,
		_budgetMs: number,
		inLinkId?: string,
	): Promise<QueryResponse<TTerms, TPayload>> {
		const start = this.clock.now()
		const session = query.sessionCode

		await this.queryRules.runAndCheck(plan, query, inLinkId)
		const pathToHere = plan.path.map((link) => link.nonce)
		await this.store.validateNewQuery(session, pathToHere) // throws on a duplicate visit

		const inboundNonce = inLinkId ? makeNonce(session, inLinkId, this.hasher) : undefined
		this.traceSink({ ...this.base(session), type: 'query-received', nonce: inboundNonce ?? '', depth: 1, round: 0 })

		const context = await this.createContext(plan, query, inLinkId, inboundNonce)
		await this.store.saveContext(context, pathToHere)

		const reentrance = context.candidates.length ? { sessionCode: session, path: pathToHere } : undefined
		return this.makeResponse(context, pathToHere, start, reentrance)
	}

	/** Build the durable context for a first visit: find self, enumerate/negotiate candidates, build match plans. */
	private async createContext(
		plan: Plan<TTerms, TPayload>,
		query: UniQuery<TTerms>,
		inLinkId: string | undefined,
		inboundNonce: string | undefined,
	): Promise<StoredContext<TTerms, TPayload>> {
		const session = query.sessionCode
		const findResult = await this.findAddress(query, inLinkId)

		const nonceToLinkId: Record<string, string> = {}
		if (inLinkId && inboundNonce) {
			nonceToLinkId[inboundNonce] = inLinkId
		}
		const inboundLink = plan.path.length ? plan.path[plan.path.length - 1] : undefined

		const candidates: StoredCandidate<TTerms, TPayload>[] = []
		for (const link of findResult.candidates ?? []) {
			const nonce = makeNonce(session, link.id, this.hasher)
			nonceToLinkId[nonce] = link.id
			const intents = this.negotiateLinkIntents(link.intents, inboundLink, query)
			if (Object.keys(intents).length === 0) {
				continue // no eligible intents on this candidate
			}
			if (plan.path.some((pathLink) => pathLink.nonce === nonce)) {
				// FIX: a candidate already on the path is a cycle -- remove it (ChipNet only reported it).
				this.traceSink({ ...this.base(session), type: 'candidate-pruned', nonce, reason: 'cycle' })
				continue
			}
			candidates.push({ linkId: link.id, nonce, depth: 0, intents })
		}
		candidates.sort((a, b) => (a.nonce < b.nonce ? -1 : a.nonce > b.nonce ? 1 : 0))

		for (const peer of findResult.peerMatch ?? []) {
			nonceToLinkId[makeNonce(session, peer.link.id, this.hasher)] = peer.link.id
		}

		const plans = this.buildMatchPlans(findResult, plan, inboundLink, inboundNonce, query)
		return {
			query,
			plan,
			self: findResult.self,
			candidates,
			nonceToLinkId,
			// Only set `plans` when non-empty: an explicit `plans: undefined` key is dropped by
			// `JSON.stringify` but *rejected* by DAG-CBOR `canonicalEncode`, which would break a
			// SQL-backed store. Everything written here must round-trip through both.
			...(plans.length ? { plans } : {}),
			depth: 1,
			complete: candidates.length === 0,
		}
	}

	/** Build concluding plans for a self-match (this node is the target) and any peer-matches (a neighbour is). */
	private buildMatchPlans(
		findResult: FindResult<TTerms, TPayload>,
		plan: Plan<TTerms, TPayload>,
		inboundLink: Link<TTerms> | undefined,
		inboundNonce: string | undefined,
		query: UniQuery<TTerms>,
	): Plan<TTerms, TPayload>[] {
		const session = query.sessionCode
		const raw: Plan<TTerms, TPayload>[] = []
		if (findResult.selfIsMatch) {
			// Omit `payload` when the host supplied none: a bare `payload: undefined` key is not
			// DAG-CBOR encodable (see createContext's note), and most nodes carry no payload.
			raw.push({ path: [...plan.path], members: [], ...(findResult.payload !== undefined ? { payload: findResult.payload } : {}) })
		}
		for (const peer of findResult.peerMatch ?? []) {
			const nonce = makeNonce(session, peer.link.id, this.hasher)
			const intents = this.negotiateLinkIntents(peer.link.intents, inboundLink, query)
			if (Object.keys(intents).length === 0) {
				continue // can't reach the peer with any eligible intent
			}
			const peerPlan: Plan<TTerms, TPayload> = {
				path: [...plan.path, { nonce, intents }],
				members: [],
				...(findResult.payload !== undefined ? { payload: findResult.payload } : {}),
			}
			raw.push(prependMatch(peerPlan, peer.match)) // the target becomes a member first
		}

		const result: Plan<TTerms, TPayload>[] = []
		for (const candidatePlan of raw) {
			if (!this.hooks.planSatisfies(query, candidatePlan)) {
				continue
			}
			const returned = this.returnPlan(candidatePlan, findResult.self, inboundNonce)
			if (!returned) {
				continue
			}
			result.push(returned)
			this.traceSink(
				inboundNonce
					? { ...this.base(session), type: 'plan-returned', nonce: inboundNonce }
					: { ...this.base(session), type: 'plan-found' },
			)
		}
		return result
	}

	/* ── subsequent visit: search one level deeper ──────────────────────────────────── */

	private async reenter(
		reentrance: Reentrance,
		budgetMs: number,
		inLinkId?: string,
	): Promise<QueryResponse<TTerms, TPayload>> {
		const start = this.clock.now()
		const session = reentrance.sessionCode

		this.validateTicket(reentrance, start)

		const context = await this.store.getContext(session, reentrance.path)
		if (!context || context.complete || context.candidates.length === 0) {
			throw new Error('Query already complete for this session') // discloses no link ids
		}
		this.validateQueryState(reentrance, context, inLinkId)

		const inboundNonce = inLinkId ? makeNonce(session, inLinkId, this.hasher) : undefined
		this.traceSink({ ...this.base(session), type: 'query-received', nonce: inboundNonce ?? '', depth: context.depth, round: context.depth })
		this.traceSink({ ...this.base(session), type: 'round-started', round: context.depth, budgetMs })

		const errored = new Set<string>()

		// Reconcile prior-round in-flight completions into durable state (and fold late answers).
		this.harvest(context, reentrance.path, errored)
		this.foldPlans(context, inboundNonce)
		if (this.anySatisfies(context)) {
			return await this.concludeSatisfied(context, reentrance.path, start)
		}

		// Enforce the per-search depth ceiling before going any deeper.
		if (context.depth >= context.query.maxDepth) {
			return await this.concludeMaxDepth(context, reentrance.path, start)
		}

		// Issue the next batch and wait up to the real remaining budget.
		const requests = this.issueBatch(context, reentrance.path, budgetMs, start)
		await budgetedStep(this.clock, Math.max(0, budgetMs - (this.clock.now() - start)), requests)
		if (Object.values(requests).some((pending) => !pending.isComplete)) {
			this.traceSink({ ...this.base(session), type: 'round-budget-expired', round: context.depth })
		}

		// Harvest this round's completions, fold, check satisfaction, prune, and advance.
		this.harvest(context, reentrance.path, errored)
		this.foldPlans(context, inboundNonce)
		if (this.anySatisfies(context)) {
			return await this.concludeSatisfied(context, reentrance.path, start)
		}
		this.pruneCandidates(context, errored)
		context.depth += 1
		context.complete = context.candidates.length === 0
		await this.store.saveContext(context, reentrance.path)

		const reentranceOut = context.candidates.length ? reentrance : undefined
		return this.makeResponse(context, reentrance.path, start, reentranceOut)
	}

	/**
	 * Move any completed in-flight sub-request into its candidate's durable `lastResponse`, clearing
	 * it from the in-flight table. An answer that completed a round after it was issued
	 * (`candidate.depth < context.depth`) is a late answer and is traced as folded. Errors are
	 * recorded in `errored` for pruning rather than stored.
	 */
	private harvest(
		context: StoredContext<TTerms, TPayload>,
		path: string[],
		errored: Set<string>,
	): void {
		const session = context.query.sessionCode
		for (const candidate of context.candidates) {
			const key = this.inFlightKey(session, path, candidate.linkId)
			const pending = this.inFlight.get(key)
			if (!pending || !pending.isComplete) {
				continue
			}
			this.inFlight.delete(key)
			if (pending.isError) {
				errored.add(candidate.linkId)
				continue
			}
			if (pending.response) {
				candidate.lastResponse = pending.response
				if (candidate.depth < context.depth) {
					this.traceSink({ ...this.base(session), type: 'late-answer-folded', nonce: candidate.nonce, round: context.depth })
				}
			}
		}
	}

	/** Issue entrance/reentrance sub-requests for candidates that need one; return the wait set for this round. */
	private issueBatch(
		context: StoredContext<TTerms, TPayload>,
		path: string[],
		budgetMs: number,
		start: number,
	): Record<string, Pending<QueryResponse<TTerms, TPayload>>> {
		const session = context.query.sessionCode
		const requests: Record<string, Pending<QueryResponse<TTerms, TPayload>>> = {}
		for (const candidate of context.candidates) {
			const key = this.inFlightKey(session, path, candidate.linkId)
			const existing = this.inFlight.get(key)
			if (existing && !existing.isComplete) {
				requests[candidate.linkId] = existing // a sleeping candidate: wait on its existing request
				continue
			}
			const remaining = Math.max(0, budgetMs - (this.clock.now() - start))
			let request: QueryRequest<TTerms, TPayload> | undefined
			if (!candidate.lastResponse) {
				// Never tried (or lost to a restart): fresh entrance with this hop's link appended.
				const subPlan = appendPath(context.plan, { nonce: candidate.nonce, intents: candidate.intents })
				request = { entrance: { plan: subPlan, query: context.query }, budgetMs: remaining }
			} else if (candidate.lastResponse.reentrance) {
				request = { reentrance: candidate.lastResponse.reentrance, budgetMs: remaining }
			}
			if (!request) {
				continue // completed with no reentrance -- nothing to send; pruned after this round
			}
			const pending = new Pending(this.queryPeer(request, candidate.linkId), this.clock)
			this.inFlight.set(key, pending)
			requests[candidate.linkId] = pending
			candidate.depth = context.depth
			this.traceSink({ ...this.base(session), type: 'query-sent', nonce: candidate.nonce, depth: context.depth, round: context.depth })
		}
		return requests
	}

	/** Fold every candidate's last-response plans into the node's accumulated set (deduped by path). */
	private foldPlans(context: StoredContext<TTerms, TPayload>, inboundNonce: string | undefined): void {
		const session = context.query.sessionCode
		const plans = context.plans ? [...context.plans] : []
		const seen = new Set(plans.map(planKey))
		for (const candidate of context.candidates) {
			for (const raw of candidate.lastResponse?.plans ?? []) {
				const returned = this.returnPlan(raw, context.self, inboundNonce)
				if (!returned) {
					continue
				}
				const key = planKey(returned)
				if (seen.has(key)) {
					continue
				}
				seen.add(key)
				plans.push(returned)
				this.traceSink(
					inboundNonce
						? { ...this.base(session), type: 'plan-returned', nonce: inboundNonce }
						: { ...this.base(session), type: 'plan-found' },
				)
			}
		}
		if (plans.length) {
			context.plans = plans
		} else {
			// Never leave an explicit `plans: undefined` key — it is not DAG-CBOR encodable.
			delete context.plans
		}
	}

	/**
	 * The return-path transform for one plan: vet/extend it (`negotiatePlan`), amend this node's
	 * in-edge (`annotateReturn`), then prepend this node as a member. Either hook may drop the plan.
	 */
	private returnPlan(raw: Plan<TTerms, TPayload>, self: Match, inboundNonce: string | undefined): Plan<TTerms, TPayload> | undefined {
		const negotiated = this.hooks.negotiatePlan ? this.hooks.negotiatePlan(raw) : raw
		if (!negotiated) {
			return undefined
		}
		const annotated = this.hooks.annotateReturn ? this.hooks.annotateReturn({ plan: negotiated, self, inboundNonce }) : negotiated
		if (!annotated) {
			return undefined
		}
		return prependMatch(annotated, self)
	}

	/** Drop candidates showing no promise: errored → `failed`; completed without a reentrance → `no-reentrance`. */
	private pruneCandidates(context: StoredContext<TTerms, TPayload>, errored: Set<string>): void {
		const session = context.query.sessionCode
		const survivors: StoredCandidate<TTerms, TPayload>[] = []
		for (const candidate of context.candidates) {
			if (errored.has(candidate.linkId)) {
				this.traceSink({ ...this.base(session), type: 'candidate-pruned', nonce: candidate.nonce, reason: 'failed' })
				continue
			}
			if (candidate.lastResponse && !candidate.lastResponse.reentrance) {
				this.traceSink({ ...this.base(session), type: 'candidate-pruned', nonce: candidate.nonce, reason: 'no-reentrance' })
				continue
			}
			survivors.push(candidate) // has a reentrance, or is still outstanding (sleeping)
		}
		context.candidates = survivors
	}

	/* ── conclusion paths ───────────────────────────────────────────────────────────── */

	/** Conclude because a plan satisfies the query. Any still-outstanding candidate is abandoned as `timed-out`. */
	private async concludeSatisfied(
		context: StoredContext<TTerms, TPayload>,
		path: string[],
		start: number,
	): Promise<QueryResponse<TTerms, TPayload>> {
		const session = context.query.sessionCode
		for (const candidate of context.candidates) {
			if (this.isOutstanding(session, path, candidate.linkId)) {
				this.traceSink({ ...this.base(session), type: 'candidate-pruned', nonce: candidate.nonce, reason: 'timed-out' })
			}
		}
		return await this.finishConclude(context, path, start)
	}

	/** Conclude because the per-search depth ceiling is reached. Remaining candidates are pruned `max-depth`. */
	private async concludeMaxDepth(
		context: StoredContext<TTerms, TPayload>,
		path: string[],
		start: number,
	): Promise<QueryResponse<TTerms, TPayload>> {
		const session = context.query.sessionCode
		for (const candidate of context.candidates) {
			this.traceSink({ ...this.base(session), type: 'candidate-pruned', nonce: candidate.nonce, reason: 'max-depth' })
		}
		return await this.finishConclude(context, path, start)
	}

	/** Mark the context complete, drop its in-flight requests and candidates, persist, and answer with no reentrance. */
	private async finishConclude(
		context: StoredContext<TTerms, TPayload>,
		path: string[],
		start: number,
	): Promise<QueryResponse<TTerms, TPayload>> {
		const session = context.query.sessionCode
		for (const candidate of context.candidates) {
			this.inFlight.delete(this.inFlightKey(session, path, candidate.linkId))
		}
		context.candidates = []
		context.complete = true
		await this.store.saveContext(context, path)
		return this.makeResponse(context, path, start, undefined)
	}

	/* ── validation ─────────────────────────────────────────────────────────────────── */

	private buildQueryRules(): RuleSet<QueryRuleTest<TTerms, TPayload>> {
		type Test = QueryRuleTest<TTerms, TPayload>
		return new RuleSet<Test>([
			new Rule<Test>('SessionCode', (_plan, query) =>
				Promise.resolve({
					passed: this.sessionCodes.isValid(query.sessionCode, this.clock.now()),
					message: 'Invalid or expired session code',
				}),
			),
			new Rule<Test>('SessionLongevity', (_plan, query) => {
				const now = this.clock.now()
				const ok =
					this.sessionCodes.isValid(query.sessionCode, now) &&
					this.sessionCodes.expiresAt(query.sessionCode) >= now + this.options.minSessionMs
				return Promise.resolve({ passed: ok, message: 'Session code too short-lived to accept' })
			}),
			new Rule<Test>(
				'NewPlan',
				(plan) => Promise.resolve({ passed: plan.path.length === 0, message: 'Plan must be empty for an initial query' }),
				{ condition: (_plan, _query, inLinkId) => !inLinkId },
			),
			new Rule<Test>(
				'NonEmptyPlan',
				(plan) => Promise.resolve({ passed: plan.path.length > 0, message: 'A plan is required when reached over an inbound link' }),
				{ condition: (_plan, _query, inLinkId) => Boolean(inLinkId) },
			),
			new Rule<Test>(
				'PlanMatch',
				(plan, query, inLinkId) => {
					const nonce = makeNonce(query.sessionCode, inLinkId as string, this.hasher)
					return Promise.resolve({
						passed: plan.path.length > 0 && plan.path[plan.path.length - 1].nonce === nonce,
						message: 'Inbound link does not match the plan', // discloses no link id
					})
				},
				{ dependencies: ['NonEmptyPlan'], condition: (_plan, _query, inLinkId) => Boolean(inLinkId) },
			),
		])
	}

	/** Reject an expired (or malformed) reentrance ticket, tracing the `expired` prune. */
	private validateTicket(reentrance: Reentrance, now: number): void {
		if (!this.sessionCodes.isValid(reentrance.sessionCode, now)) {
			this.traceSink({
				...this.base(reentrance.sessionCode),
				type: 'candidate-pruned',
				nonce: reentrance.path[reentrance.path.length - 1] ?? '',
				reason: 'expired',
			})
			throw new Error('Query session expired')
		}
	}

	/** Re-validate that a reentrance ticket matches its stored context: same session, inbound nonce vs plan tail. */
	private validateQueryState(reentrance: Reentrance, context: StoredContext<TTerms, TPayload>, inLinkId?: string): void {
		if (context.query.sessionCode !== reentrance.sessionCode) {
			throw new Error('Session code mismatch between reentrance and stored context')
		}
		if (inLinkId) {
			const nonce = makeNonce(context.query.sessionCode, inLinkId, this.hasher)
			if (!context.plan.path.length || context.plan.path[context.plan.path.length - 1].nonce !== nonce) {
				throw new Error('Inbound link does not match the plan') // discloses no link id
			}
		} else if (context.plan.path.length) {
			throw new Error('An inbound link is required for a non-empty plan')
		}
	}

	/* ── intent / plan helpers ──────────────────────────────────────────────────────── */

	/** Negotiate one link's terms per intent code against the hop (inbound terms from the path tail). */
	private negotiateLinkIntents(
		linkIntents: Record<string, TTerms>,
		inboundLink: Link<TTerms> | undefined,
		query: UniQuery<TTerms>,
	): Record<string, TTerms> {
		const out: Record<string, TTerms> = {}
		for (const code of Object.keys(linkIntents).sort()) {
			const negotiated = this.hooks.negotiateIntent({
				code,
				linkTerms: linkIntents[code],
				inboundTerms: inboundLink?.intents[code],
				query,
			})
			if (negotiated !== undefined) {
				out[code] = negotiated
			}
		}
		return out
	}

	private anySatisfies(context: StoredContext<TTerms, TPayload>): boolean {
		return (context.plans ?? []).some((plan) => this.hooks.planSatisfies(context.query, plan))
	}

	/* ── small helpers ──────────────────────────────────────────────────────────────── */

	private makeResponse(
		context: StoredContext<TTerms, TPayload>,
		path: string[],
		start: number,
		reentrance: Reentrance | undefined,
	): QueryResponse<TTerms, TPayload> {
		const gross = this.clock.now() - start
		let outstanding = 0
		for (const candidate of context.candidates) {
			if (this.isOutstanding(context.query.sessionCode, path, candidate.linkId)) {
				outstanding++
			}
		}
		// Omit absent `plans`/`reentrance` rather than emitting `undefined` keys: a response is sent
		// over the wire (DAG-CBOR) and may be stored as a candidate's `lastResponse`, both of which
		// reject `undefined`-valued keys.
		return {
			...(context.plans?.length ? { plans: context.plans } : {}),
			...(reentrance ? { reentrance } : {}),
			stats: { earliest: gross, latest: gross, gross, outstanding },
		}
	}

	private isOutstanding(session: string, path: string[], linkId: string): boolean {
		const pending = this.inFlight.get(this.inFlightKey(session, path, linkId))
		return Boolean(pending) && !pending!.isComplete
	}

	private inFlightKey(session: string, path: string[], linkId: string): string {
		return `${contextKey(session, path)}\u0000${linkId}`
	}

	private base(sessionCode: string): TraceBase {
		return { time: this.clock.now(), nodeId: this.nodeId, sessionCode }
	}
}

/**
 * Return a new plan with `match` prepended as a member (the return-trip step). Rejects a match whose
 * member is not a participant, or whose `dependsOn` contains a participant. Members already present
 * are "upgraded" with any physical/secret this match's dependents supply; dependents not yet present
 * are appended. The engine keeps this internal rather than exposing it as a hook (see
 * {@link DiscoveryHooks.annotateReturn}, which runs *before* it). Ported from ChipNet's `prependMatch`.
 */
export function prependMatch<TTerms, TPayload>(plan: Plan<TTerms, TPayload>, match: Match): Plan<TTerms, TPayload> {
	if (!match.member.types.includes(MemberTypes.participant)) {
		throw new Error('A matched member must be a participant') // discloses no address
	}
	if (match.dependsOn?.some((dependent) => dependent.types.includes(MemberTypes.participant))) {
		throw new Error('A participant match cannot depend on participants')
	}

	const asDependent: DependentMember = {
		...match.member,
		...(match.dependsOn ? { dependsOn: match.dependsOn.map((dependent) => dependent.address) } : {}),
	}

	const upgraded: DependentMember[] = plan.members.map((member) => {
		const dependent = match.dependsOn?.find((candidate) => addressesMatch(member.address, candidate.address))
		const physical = member.physical ?? dependent?.physical
		const secret = member.secret ?? dependent?.secret
		const result: IdentifiedMember = {
			...member,
			...(physical ? { physical } : {}),
			...(secret ? { secret } : {}),
		}
		return result
	})

	const missing = match.dependsOn?.filter((dependent) => !plan.members.some((member) => addressesMatch(member.address, dependent.address))) ?? []

	return { ...plan, members: [asDependent, ...upgraded, ...missing] }
}

/** A plan's dedupe identity: its path nonces. Two plans with the same route are the same plan here. */
function planKey<TTerms, TPayload>(plan: Plan<TTerms, TPayload>): string {
	// NOTE: identity is the path alone. If two plans ever share a path but differ in members or
	// payload (e.g. a downstream node renegotiates referees between rounds), dedupe keeps the first.
	// Fine for single-denomination v1; revisit if return-path annotation makes members path-dependent.
	return plan.path.map((link) => link.nonce).join('\u0000')
}
