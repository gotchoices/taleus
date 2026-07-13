/**
 * In-memory test doubles for the lift discovery half: a scripted `DiscoveryEngine`,
 * an in-memory `LiftJournalStore`, a stub `TermSource`, and small builders for
 * candidate edges. No ChipNet, no strand, no portfolio — enough to exercise the
 * accumulator, term population, route selection, journal correlation, and the
 * sleeping-edge / concurrency paths in-process.
 *
 * Excluded from the production build (see tsconfig.build.json `src/**\/test-harness.ts`).
 */

import type {
	DiscoveryEngine,
	LiftJournalRow,
	LiftJournalStore,
} from './agent.js'
import type { CandidateEdge, CandidateRoute, LiftQuery, NegotiateCallbacks, RouteMathEdge } from './discovery.js'
import type { EdgeDenomination, EdgeLading, RateQuote, TermSource } from './terms.js'

/** A candidate route the scripted engine will offer; `sleeping` models a non-responding hop. */
export interface RouteSpec {
	edges: CandidateEdge[]
	/** When true, ChipNet's time budget would skip this route — the engine omits it (not an error). */
	sleeping?: boolean
}

/**
 * A `DiscoveryEngine` that returns a fixed set of candidate routes, running each
 * through the real negotiate callbacks so accumulation/pruning is exercised end to
 * end. Sleeping routes are dropped (skipped that round), never failing the round.
 */
export class ScriptedDiscoveryEngine implements DiscoveryEngine {
	constructor(private readonly specs: RouteSpec[]) {}

	discover(query: LiftQuery, callbacks: NegotiateCallbacks): Promise<CandidateRoute[]> {
		const live = this.specs.filter((s) => !s.sleeping)
		return Promise.resolve(live.map((s) => callbacks.negotiatePlan(s.edges, query)))
	}
}

/** An append-only in-memory `LiftJournal`, latest-revision-wins `current`. */
export class InMemoryLiftJournalStore implements LiftJournalStore {
	readonly rows: LiftJournalRow[] = []

	append(row: LiftJournalRow): Promise<void> {
		this.rows.push(row)
		return Promise.resolve()
	}

	current(liftId: string): Promise<LiftJournalRow | null> {
		const rows = this.rows.filter((r) => r.liftId === liftId)
		if (rows.length === 0) {
			return Promise.resolve(null)
		}
		return Promise.resolve(rows.reduce((a, b) => (b.revision > a.revision ? b : a)))
	}
}

/** A `TermSource` backed by plain maps. Quote keys are `From|To`; the date is ignored (validity pre-baked). */
export class StubTermSource implements TermSource {
	constructor(
		private readonly denoms: Record<string, EdgeDenomination>,
		private readonly ladings: Record<string, EdgeLading>,
		private readonly quotes: Record<string, RateQuote | null>,
	) {}

	denomination(linkId: string): EdgeDenomination {
		const d = this.denoms[linkId]
		if (!d) {
			throw new Error(`StubTermSource: no denomination for ${linkId}`)
		}
		return d
	}

	lading(linkId: string, receiverSid: string): EdgeLading {
		const l = this.ladings[`${linkId}|${receiverSid}`]
		if (!l) {
			throw new Error(`StubTermSource: no lading for ${linkId}|${receiverSid}`)
		}
		return l
	}

	quote(fromDenom: string, toDenom: string, _date: string): RateQuote | null {
		return this.quotes[`${fromDenom}|${toDenom}`] ?? null
	}
}

/** Build a `RouteMathEdge` for a lift-capable hop. */
export function liftMathEdge(
	denom: string,
	scale: number,
	capacity: { free: bigint; rewarded?: bigint; reward?: number; clutch?: number },
	convertQuote?: RateQuote | null,
): RouteMathEdge {
	return {
		denom,
		scale,
		freeUnits: capacity.free,
		rewardedUnits: capacity.rewarded ?? 0n,
		reward: capacity.reward ?? 0,
		clutch: capacity.clutch ?? 0,
		convertQuote,
	}
}

/** Wrap a math edge as a candidate edge with identity. */
export function candidateEdge(nonce: string, math: RouteMathEdge, owned?: { linkId: string; issuer: 'S' | 'F' }): CandidateEdge {
	return { nonce, math, linkId: owned?.linkId, issuer: owned?.issuer }
}

/** A directional quote helper. */
export function rate(fromDenom: string, toDenom: string, rateNum: bigint, rateDen: bigint): RateQuote {
	return { fromDenom, toDenom, rateNum, rateDen }
}
