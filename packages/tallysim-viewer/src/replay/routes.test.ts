import { FORMAT_VERSION, linkIdForTally, type Network, type TraceLiftEntry } from 'tallysim'
import { makeNonce } from 'tallynet'
import { createDeanonymiser } from '../core/deanonymise.js'
import {
	liftIsolate,
	liftOutcome,
	liftRoute,
	liftVoterSummary,
	reconstructRoute,
	reconstructRoutes,
	routeEdgeTallies,
	sessionFoundState,
	type RouteInput,
} from './routes.js'
import type { ConsensusState } from '../core/timeline.js'

const SESSION = 'session-alpha'

/** A path network 0—1—2—3: tally i joins i↔(i+1). */
function pathNetwork(): Network {
	return {
		entityCount: 4,
		tallies: [
			{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
			{ stock: 1, foil: 2, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
			{ stock: 2, foil: 3, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
		],
		meta: { generator: 'test', params: {}, seed: 1, formatVersion: FORMAT_VERSION },
	}
}

/** A ring 0—1—2—0: tally 0 joins 0↔1, tally 1 joins 1↔2, tally 2 closes 2↔0. */
function ringNetwork(): Network {
	return {
		entityCount: 3,
		tallies: [
			{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
			{ stock: 1, foil: 2, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
			{ stock: 2, foil: 0, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
		],
		meta: { generator: 'test', params: {}, seed: 1, formatVersion: FORMAT_VERSION },
	}
}

/** The nonces for a list of tally indices under {@link SESSION}, as the real protocol would stamp them. */
function noncesFor(indices: number[]): string[] {
	return indices.map((i) => makeNonce(SESSION, linkIdForTally(i)))
}

describe('reconstructRoute — a known found plan', () => {
	it('reconstructs the right open node path from the originator', () => {
		const deanon = createDeanonymiser(pathNetwork())
		const input: RouteInput = { from: 0, to: 3, linkNonces: noncesFor([0, 1, 2]) }
		expect(reconstructRoute(deanon, SESSION, input)).toEqual({ kind: 'path', nodes: [0, 1, 2, 3], hops: 3, terms: undefined })
	})

	it('carries per-link terms through to the list, index-aligned to the path', () => {
		const deanon = createDeanonymiser(pathNetwork())
		const terms = [{ fee: 1 }, { fee: 2 }, { fee: 3 }]
		const route = reconstructRoute(deanon, SESSION, { from: 0, to: 3, linkNonces: noncesFor([0, 1, 2]), terms })
		expect(route.kind).toBe('path')
		if (route.kind === 'path') {
			expect(route.terms).toBe(terms)
			expect(route.hops).toBe(3)
		}
	})
})

describe('reconstructRoute — a self-payment (circular lift)', () => {
	it('reconstructs a closed loop, not an open path', () => {
		const deanon = createDeanonymiser(ringNetwork())
		const route = reconstructRoute(deanon, SESSION, { from: 0, to: 0, linkNonces: noncesFor([0, 1, 2]) })
		expect(route).toEqual({ kind: 'loop', nodes: [0, 1, 2, 0], hops: 3, terms: undefined })
	})
})

describe('reconstructRoute — empty and decode-failed', () => {
	it('an empty plan (no hops) is the empty result, not a path', () => {
		const deanon = createDeanonymiser(pathNetwork())
		expect(reconstructRoute(deanon, SESSION, { from: 0, to: 0, linkNonces: [] })).toEqual({ kind: 'empty' })
	})

	it('an unresolvable nonce surfaces the decode-failed sentinel (a bug worth seeing), not a silent empty', () => {
		const deanon = createDeanonymiser(pathNetwork())
		expect(reconstructRoute(deanon, SESSION, { from: 0, to: 3, linkNonces: ['not-a-real-nonce'] })).toEqual({ kind: 'decode-failed' })
	})

	it('a non-contiguous walk (a nonce not touching the current node) is decode-failed too', () => {
		const deanon = createDeanonymiser(pathNetwork())
		// tally 2 (2↔3) does not touch the originator 0 — the walk cannot step onto it.
		expect(reconstructRoute(deanon, SESSION, { from: 0, to: 3, linkNonces: noncesFor([2]) })).toEqual({ kind: 'decode-failed' })
	})
})

describe('reconstructRoutes / routeEdgeTallies', () => {
	it('reconstructs every plan preserving order', () => {
		const deanon = createDeanonymiser(pathNetwork())
		const inputs: RouteInput[] = [
			{ from: 0, to: 2, linkNonces: noncesFor([0, 1]) },
			{ from: 0, to: 3, linkNonces: noncesFor([0, 1, 2]) },
		]
		const routes = reconstructRoutes(deanon, SESSION, inputs)
		expect(routes.map((r) => r.kind)).toEqual(['path', 'path'])
	})

	it('resolves the tally indices a route traverses (for isolate/highlight), or the sentinel', () => {
		const deanon = createDeanonymiser(pathNetwork())
		expect(routeEdgeTallies(deanon, SESSION, { from: 0, to: 3, linkNonces: noncesFor([0, 1, 2]) })).toEqual([0, 1, 2])
		expect(routeEdgeTallies(deanon, SESSION, { from: 0, to: 3, linkNonces: ['bogus'] })).toBeUndefined()
	})
})

describe('liftRoute / liftOutcome / liftIsolate — the settled lift from the header (no decode)', () => {
	const pathLift: TraceLiftEntry = {
		sessionCode: 'session-alpha',
		transactionCode: 'TX1',
		route: [0, 1, 2, 3],
		tallyPath: [0, 1, 2],
		memberKeys: { m0: 0, m1: 1, m2: 2, m3: 3 },
		amount: 100,
	}
	const loopLift: TraceLiftEntry = {
		sessionCode: 'session-beta',
		transactionCode: 'TXL',
		route: [0, 1, 2, 0],
		tallyPath: [0, 1, 2],
		memberKeys: { m0: 0, m1: 1, m2: 2 },
		amount: 100,
	}

	it('reads a path lift straight from the header — exact nodes and tallies, no inference', () => {
		expect(liftRoute(pathLift)).toEqual({
			kind: 'path',
			nodes: [0, 1, 2, 3],
			tallies: [0, 1, 2],
			hops: 3,
			transactionCode: 'TX1',
		})
	})

	it('classifies a circular lift (route returns to origin) as a loop', () => {
		expect(liftRoute(loopLift)).toEqual({
			kind: 'loop',
			nodes: [0, 1, 2, 0],
			tallies: [0, 1, 2],
			hops: 3,
			transactionCode: 'TXL',
		})
	})

	it('maps the settled decision to the outcome badge', () => {
		expect(liftOutcome('commit')).toBe('committed')
		expect(liftOutcome('void')).toBe('voided')
		// An unsettled lift (a tie / no settlement) is `stalled`; the panel renders this word as "unsettled".
		expect(liftOutcome(undefined)).toBe('stalled')
	})

	it('isolates a lift to its exact nodes + tallies from the header', () => {
		expect(liftIsolate(pathLift)).toEqual({ nodes: [0, 1, 2, 3], tallies: [0, 1, 2] })
		expect(liftIsolate(loopLift)).toEqual({ nodes: [0, 1, 2, 0], tallies: [0, 1, 2] })
	})
})

describe('liftVoterSummary — the voter-model side-panel data', () => {
	/** A base ConsensusState with the voter-model fields defaulted empty; each test overrides what it exercises. */
	function consensus(over: Partial<ConsensusState>): ConsensusState {
		return {
			transactionCode: 'TX1',
			edges: [],
			nodes: [],
			voters: [],
			pulled: [],
			equivocators: [],
			contradictions: [],
			decision: 'commit',
			settledTime: 40,
			unresolved: [],
			...over,
		}
	}

	it('splits participant voters (id + vote) from an off-route referee-only count', () => {
		const summary = liftVoterSummary(
			consensus({
				voters: [
					{ key: 'm1', node: 1, role: 'participant', vote: 'C' },
					{ key: 'm2', node: 2, role: 'participant', vote: 'NC' },
					{ key: 'rA', role: 'referee', vote: 'C' },
					{ key: 'rB', role: 'referee', vote: 'C' },
				],
			}),
		)
		expect(summary.participants).toEqual([
			{ node: 1, vote: 'C' },
			{ node: 2, vote: 'NC' },
		])
		// A stacked referee set is counted, not placed — so "a stacked voter set looks stacked".
		expect(summary.refereeOnlyCount).toBe(2)
	})

	it('passes through the pulled / equivocator / contradiction member ids', () => {
		const summary = liftVoterSummary(consensus({ pulled: [3], equivocators: [1], contradictions: [2] }))
		expect(summary.pulled).toEqual([3])
		expect(summary.equivocators).toEqual([1])
		expect(summary.contradictions).toEqual([2])
	})

	it('is all-empty for a lift with no voters or markers', () => {
		expect(liftVoterSummary(consensus({}))).toEqual({
			participants: [],
			refereeOnlyCount: 0,
			pulled: [],
			equivocators: [],
			contradictions: [],
		})
	})
})

describe('sessionFoundState', () => {
	it('distinguishes loading, searching, no-route, and found', () => {
		expect(sessionFoundState({ loaded: false, atEnd: false, foundCount: 0 })).toEqual({ kind: 'loading' })
		expect(sessionFoundState({ loaded: true, atEnd: false, foundCount: 0 })).toEqual({ kind: 'searching' })
		expect(sessionFoundState({ loaded: true, atEnd: true, foundCount: 0 })).toEqual({ kind: 'no-route' })
		expect(sessionFoundState({ loaded: true, atEnd: true, foundCount: 2 })).toEqual({ kind: 'found', count: 2 })
		// A plan already found mid-scrub reads as found, not searching.
		expect(sessionFoundState({ loaded: true, atEnd: false, foundCount: 1 })).toEqual({ kind: 'found', count: 1 })
	})
})
