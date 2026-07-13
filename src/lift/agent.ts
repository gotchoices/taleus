/**
 * The lift agent's route-finding driver (see docs/architecture.md § Denomination-
 * aware discovery, § State mapping). It kicks off a **unidirectional** ChipNet
 * query from the originator toward the payee (a payment) or back to self (a circular
 * clearing lift), collects the candidate routes discovery returns, selects one, and
 * surfaces the exact source-denomination cost — stopping at "route selected, cost
 * known, not yet pledged". Pledge + commit are the next ticket
 * (`feat-lift-referee-commit`), which consumes the `LiftPlan` assembled here.
 *
 * ChipNet injects all discovery/correlation state, so the agent backs its
 * originator-state interface with the portfolio `LiftJournal` (schema/portfolio.qsql)
 * — no new store. State is correlated strictly by `liftId`, so concurrent lifts
 * sharing the transport and journal never cross-contaminate.
 *
 * ── The search engine is a port ──────────────────────────────────────────────
 * NOTE: ChipNet is not installable yet (tickets/blocked/chipnet-npm-publish-
 * needed.md), and its **bidirectional** search is unimplemented upstream regardless
 * (§ Why reuse — unidirectional suffices for v1). So the search itself is an
 * injected `DiscoveryEngine` port: in production it wraps ChipNet's unidirectional
 * search over the `/taleus/chipnet/1.0.0` transport, driving the negotiate callbacks
 * (src/lift/discovery.ts); in tests it is a scripted double. The agent's own logic —
 * begin/journal, select, cost, journal-again — is engine-agnostic and fully tested.
 */

import {
	makeNegotiateCallbacks,
	selectRoute,
	type AccumulatedRoute,
	type CandidateRoute,
	type LiftQuery,
	type NegotiateCallbacks,
} from './discovery.js'
import type { LiftPlan, RefereeSlot, RouteEdge, SourceCost } from './terms.js'

/* ── Portfolio LiftJournal backing (ChipNet-injected originator state) ────────── */

/** LiftJournal lifecycle states this ticket drives; commit/void states are the next ticket's. */
export type LiftState = 'proposed' | 'discovering' | 'selected' | 'aborted'

/** The originator's seat in a lift. Discovery is always run by the originator ('O'). */
export type LiftRole = 'O' | 'I' | 'P'

/** One edge as recorded in the journal's `Edges` JSON (units decimal-encoded — JSON has no bigint). */
export interface JournalEdge {
	strandId: string
	denom: string
	units: string
	direction: 'source' | 'relay' | 'payee'
}

/** A `LiftJournal` row (schema/portfolio.qsql). Insert-only, revisioned; `CurrentLift` is the latest. */
export interface LiftJournalRow {
	liftId: string
	revision: number
	role: LiftRole
	state: LiftState
	/** JSON: `JournalEdge[]`. */
	edges: string
	referee: string | null
	updated: string
}

/**
 * The portfolio `LiftJournal` as an append-only, revisioned store — the schema's
 * shape, injected so the agent is testable without a live portfolio strand.
 * `append` mirrors the schema's `RevisionMonotonicInt` (caller supplies the next
 * revision); `current` is the `CurrentLift` view (highest revision for a `liftId`).
 */
export interface LiftJournalStore {
	append(row: LiftJournalRow): Promise<void>
	current(liftId: string): Promise<LiftJournalRow | null>
}

/**
 * The originator-state interface ChipNet injects, backed by `LiftJournal`. Records
 * a phase transition for one lift as a fresh journal revision; reads the current
 * row. Correlates strictly by `liftId` — two discoveries in flight write distinct
 * `liftId`s and never share accumulated state.
 */
export interface OriginatorState {
	record(liftId: string, state: LiftState, edges: JournalEdge[], referee: string | null): Promise<void>
	read(liftId: string): Promise<LiftJournalRow | null>
}

/** `OriginatorState` backed by a `LiftJournalStore`. Computes the next revision from the current row. */
export class LiftJournalOriginatorState implements OriginatorState {
	constructor(
		private readonly store: LiftJournalStore,
		private readonly now: () => string,
		private readonly role: LiftRole = 'O',
	) {}

	async record(liftId: string, state: LiftState, edges: JournalEdge[], referee: string | null): Promise<void> {
		const existing = await this.store.current(liftId)
		const revision = (existing?.revision ?? 0) + 1
		await this.store.append({
			liftId,
			revision,
			role: this.role,
			state,
			edges: JSON.stringify(edges),
			referee,
			updated: this.now(),
		})
	}

	read(liftId: string): Promise<LiftJournalRow | null> {
		return this.store.current(liftId)
	}
}

/* ── Discovery engine port ───────────────────────────────────────────────────── */

/**
 * The route search itself. Production impl wraps ChipNet's unidirectional search
 * over the `/taleus/chipnet/1.0.0` transport, calling the negotiate callbacks; it is
 * a port here because ChipNet is unbindable today and its bidirectional mode is
 * unimplemented upstream anyway.
 *
 * Contract the agent relies on: `discover` returns whatever candidates the bounded
 * search assembled — a sleeping (non-responding) edge is skipped by ChipNet's time
 * budget and simply absent, and any late response is folded in before return. A
 * partial round is therefore a normal (possibly empty) candidate list, NOT an error.
 */
export interface DiscoveryEngine {
	discover(query: LiftQuery, callbacks: NegotiateCallbacks): Promise<CandidateRoute[]>
}

/* ── Agent ───────────────────────────────────────────────────────────────────── */

/** Everything the agent needs, injected. */
export interface LiftAgentDeps {
	engine: DiscoveryEngine
	state: OriginatorState
	/** Chosen referee slot. Reference default: the originator's own always-on agent (§ Referee model). */
	referee: RefereeSlot
}

/** The outcome of a discovery run — a costed plan, or no viable route (never a throw for "not found"). */
export type DiscoveryOutcome =
	| { found: true; plan: LiftPlan; source: SourceCost }
	| { found: false; reason: 'no-viable-route' }

/**
 * Route-finding half of the lift agent. Construct with an engine, journal-backed
 * originator state, and a referee slot; call `discover` per lift. Ends at a selected,
 * costed `LiftPlan` — the input the commit ticket consumes.
 */
export class LiftAgent {
	private readonly engine: DiscoveryEngine
	private readonly state: OriginatorState
	private readonly referee: RefereeSlot

	constructor(deps: LiftAgentDeps) {
		this.engine = deps.engine
		this.state = deps.state
		this.referee = deps.referee
	}

	/**
	 * Run one unidirectional discovery for `query`. Journals `discovering`, runs the
	 * search, selects the cheapest viable route, journals the outcome (`selected` with
	 * the chosen topology, or `aborted` when nothing is viable), and returns the plan +
	 * exact source cost. Pruned/sleeping edges never appear as candidates, and a partial
	 * round is not a failure — only "zero viable" is `found: false`.
	 */
	async discover(query: LiftQuery): Promise<DiscoveryOutcome> {
		await this.state.record(query.liftId, 'discovering', [], this.referee.key)

		const callbacks = makeNegotiateCallbacks()
		const candidates = await this.engine.discover(query, callbacks)
		const chosen = selectRoute(candidates)

		if (chosen === null) {
			await this.state.record(query.liftId, 'aborted', [], this.referee.key)
			return { found: false, reason: 'no-viable-route' }
		}

		const plan = this.assemblePlan(query, chosen)
		await this.state.record(query.liftId, 'selected', journalEdges(plan.edges), this.referee.key)
		return { found: true, plan, source: plan.source }
	}

	/** Assemble the commit-ticket handoff from the selected candidate + accumulated units. */
	private assemblePlan(query: LiftQuery, chosen: CandidateRoute & { result: AccumulatedRoute }): LiftPlan {
		const edges: RouteEdge[] = chosen.edges.map((e, i) => ({
			nonce: e.nonce,
			linkId: e.linkId,
			denom: e.math.denom,
			scale: e.math.scale,
			units: chosen.result.perEdgeUnits[i],
			issuer: e.issuer,
		}))
		const source: SourceCost = {
			denom: edges[0].denom,
			scale: edges[0].scale,
			units: chosen.result.sourceUnits,
			feeRatioPpm: chosen.result.feeRatioPpm,
		}
		return {
			liftId: query.liftId,
			sessionCode: query.sessionCode,
			kind: query.kind,
			edges,
			referee: this.referee,
			source,
		}
	}
}

/** Encode selected route edges for the journal `Edges` JSON (units → decimal string). */
function journalEdges(edges: RouteEdge[]): JournalEdge[] {
	const last = edges.length - 1
	return edges.map((e, i) => ({
		strandId: e.linkId ?? e.nonce,
		denom: e.denom,
		units: e.units.toString(),
		direction: i === 0 ? 'source' : i === last ? 'payee' : 'relay',
	}))
}
