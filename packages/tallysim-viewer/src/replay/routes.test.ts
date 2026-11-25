import { FORMAT_VERSION, linkIdForTally, type Network } from 'tallysim'
import { makeNonce } from 'tallynet'
import { createDeanonymiser } from '../core/deanonymise.js'
import {
	reconstructRoute,
	reconstructRoutes,
	routeEdgeTallies,
	sessionFoundState,
	type RouteInput,
} from './routes.js'

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
