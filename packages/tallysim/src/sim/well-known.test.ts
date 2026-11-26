import { FORMAT_VERSION, type Network, type Tally } from '../model.js'
import { makeNomineesFor, wellKnownEntities } from './well-known.js'

/** A network from an entity count and undirected `[stock, foil]` edges (only degree matters here). */
function net(entityCount: number, pairs: [number, number][]): Network {
	const tallies: Tally[] = pairs.map(([stock, foil]) => ({
		stock,
		foil,
		balance: 0,
		stockCreditLimit: 100,
		foilCreditLimit: 100,
	}))
	return {
		entityCount,
		tallies,
		meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION },
	}
}

/**
 * Degrees: 0→3, 1→1, 2→2, 3→2, 4→0. Entity 0 is the clear top hub; 2 and 3 tie at degree 2 (lower id 2
 * wins the tiebreak); 1 and 4 trail. Used across the well-known and nomination cases.
 */
function degreeGraph(): Network {
	return net(5, [[0, 1], [0, 2], [0, 3], [2, 3]])
}

describe('wellKnownEntities — top fraction by degree', () => {
	it('returns the exact top-k by degree, ties broken by lower id', () => {
		// round(0.4 · 5) = 2 → the two highest degrees: 0 (deg 3) then the deg-2 tie, lower id 2 over 3.
		expect(wellKnownEntities(degreeGraph(), 0.4)).toEqual(new Set([0, 2]))
	})

	it('includes both sides of a degree tie once the count reaches them', () => {
		// round(0.6 · 5) = 3 → 0, then the full deg-2 tie {2, 3}; 1 (deg 1) and 4 (deg 0) stay out.
		expect(wellKnownEntities(degreeGraph(), 0.6)).toEqual(new Set([0, 2, 3]))
	})

	it('fraction 0 ⇒ empty set', () => {
		expect(wellKnownEntities(degreeGraph(), 0)).toEqual(new Set())
	})

	it('fraction ≥ 1 ⇒ every entity (including a degree-0 isolate)', () => {
		expect(wellKnownEntities(degreeGraph(), 1)).toEqual(new Set([0, 1, 2, 3, 4]))
	})

	it('an empty network has no well-known entities at any fraction', () => {
		expect(wellKnownEntities(net(0, []), 0.5)).toEqual(new Set())
	})
})

describe('makeNomineesFor — referee nominations by policy', () => {
	it("'self' nominates the participant itself as a voter, keyed by its node name", () => {
		const nomineesFor = makeNomineesFor(degreeGraph(), new Set(), 'self')
		expect(nomineesFor(3)).toEqual([{ name: '3' }]) // entityName(3) === '3'
		expect(nomineesFor(0)).toEqual([{ name: '0' }])
	})

	it("'well-known' nominates the single highest-degree hub in the well-known set, for every node", () => {
		const wellKnown = wellKnownEntities(degreeGraph(), 0.4) // {0, 2}; 0 is the higher-degree hub
		const nomineesFor = makeNomineesFor(degreeGraph(), wellKnown, 'well-known')
		expect(nomineesFor(4)).toEqual([{ name: '0' }]) // an obscure node still nominates the hub
		expect(nomineesFor(2)).toEqual([{ name: '0' }]) // so does a well-known-but-not-top node
	})

	it("'well-known' with an empty well-known set nominates nobody", () => {
		const nomineesFor = makeNomineesFor(degreeGraph(), new Set(), 'well-known')
		expect(nomineesFor(0)).toEqual([])
	})

	it('returns a fresh array per call (no shared mutable nomination list)', () => {
		const nomineesFor = makeNomineesFor(degreeGraph(), wellKnownEntities(degreeGraph(), 0.4), 'well-known')
		expect(nomineesFor(1)).not.toBe(nomineesFor(1))
		expect(nomineesFor(1)).toEqual(nomineesFor(1))
	})

	it('rejects an unknown nomination policy', () => {
		// @ts-expect-error — exhaustiveness guard: an unlisted policy must throw.
		expect(() => makeNomineesFor(degreeGraph(), new Set(), 'bogus')).toThrow(/unknown nomination policy/)
	})
})
