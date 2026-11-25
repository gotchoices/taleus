import type { CapacityDistribution } from '../distributions.js'
import type { Network } from '../model.js'
import { FORMAT_VERSION } from '../model.js'
import { connectedComponents, degreeSequence, meanDegree } from '../structure.js'
import {
	CLUSTERED_ID,
	SCALE_FREE_ID,
	SMALL_WORLD_ID,
	UNIFORM_ID,
	clustered,
	scaleFree,
	smallWorld,
	uniform,
} from './index.js'

const UNLIMITED: CapacityDistribution = { kind: 'unlimited' }

/** No tally is a self-loop. */
function noSelfLoops(net: Network): boolean {
	return net.tallies.every((t) => t.stock !== t.foil)
}

/** Max degree over the undirected multigraph. */
function maxDegree(net: Network): number {
	return degreeSequence(net).reduce((a, b) => Math.max(a, b), 0)
}

/** Which contiguous community an entity falls in, matching the clustered generator's partition. */
function communityOf(n: number, c: number): number[] {
	const base = Math.floor(n / c)
	const remainder = n % c
	const assignment: number[] = []
	let community = 0
	let left = base + (0 < remainder ? 1 : 0)
	for (let i = 0; i < n; i++) {
		while (left === 0 && community < c - 1) {
			community++
			left = base + (community < remainder ? 1 : 0)
		}
		assignment.push(community)
		left--
	}
	return assignment
}

/** Canonical undirected key for a tally. */
function key(a: number, b: number): string {
	return a < b ? `${a}-${b}` : `${b}-${a}`
}

describe('generators — shared guarantees', () => {
	const cases = [
		{ name: UNIFORM_ID, make: () => uniform({ entityCount: 300, meanDegree: 6, seed: 1, capacity: UNLIMITED }) },
		{ name: SCALE_FREE_ID, make: () => scaleFree({ entityCount: 300, edgesPerNode: 3, seed: 1, capacity: UNLIMITED }) },
		{
			name: CLUSTERED_ID,
			make: () =>
				clustered({ entityCount: 300, communityCount: 4, meanIntraDegree: 6, bridgeCount: 10, seed: 1, capacity: UNLIMITED }),
		},
		{
			name: SMALL_WORLD_ID,
			make: () => smallWorld({ entityCount: 300, neighbors: 6, rewireProbability: 0.1, seed: 1, capacity: UNLIMITED }),
		},
	]

	for (const { name, make } of cases) {
		describe(name, () => {
			it('produces no self-loops', () => {
				expect(noSelfLoops(make())).toBe(true)
			})

			it('records a stable meta (id, seed, formatVersion)', () => {
				const net = make()
				expect(net.meta.generator).toBe(name)
				expect(net.meta.seed).toBe(1)
				expect(net.meta.formatVersion).toBe(FORMAT_VERSION)
			})

			it('is reproducible — same seed ⇒ deep-equal network', () => {
				expect(make()).toEqual(make())
			})

			it('assigns both stock/foil orientations across edges (seed is not ignored)', () => {
				const net = make()
				const stockFirst = net.tallies.filter((t) => t.stock < t.foil).length
				const foilFirst = net.tallies.filter((t) => t.stock > t.foil).length
				expect(stockFirst).toBeGreaterThan(0)
				expect(foilFirst).toBeGreaterThan(0)
			})
		})
	}

	it('a different seed yields a different network', () => {
		const a = uniform({ entityCount: 300, meanDegree: 6, seed: 1, capacity: UNLIMITED })
		const b = uniform({ entityCount: 300, meanDegree: 6, seed: 2, capacity: UNLIMITED })
		expect(a).not.toEqual(b)
	})

	it('draws capacities from the chosen distribution (unlimited ⇒ Infinity limits)', () => {
		const net = uniform({ entityCount: 50, meanDegree: 4, seed: 3, capacity: UNLIMITED })
		for (const t of net.tallies) {
			expect(t.stockCreditLimit).toBe(Infinity)
			expect(t.foilCreditLimit).toBe(Infinity)
			expect(t.balance).toBe(0)
		}
	})
})

describe('uniform generator', () => {
	it('hits the requested mean degree within tolerance', () => {
		const net = uniform({ entityCount: 2000, meanDegree: 6, seed: 7, capacity: UNLIMITED })
		expect(meanDegree(net)).toBeCloseTo(6, 1)
	})

	it('produces no edges at mean degree 0', () => {
		const net = uniform({ entityCount: 100, meanDegree: 0, seed: 7, capacity: UNLIMITED })
		expect(net.tallies).toHaveLength(0)
	})

	it('produces no edges for a single entity (no self-loop possible)', () => {
		const net = uniform({ entityCount: 1, meanDegree: 8, seed: 7, capacity: UNLIMITED })
		expect(net.tallies).toHaveLength(0)
	})

	it('handles a near-complete graph without throwing', () => {
		const net = uniform({ entityCount: 20, meanDegree: 19, seed: 7, capacity: UNLIMITED })
		expect(noSelfLoops(net)).toBe(true)
		expect(net.tallies.length).toBeGreaterThan(0)
	})
})

describe('scale-free generator', () => {
	it('is heavy-tailed — a hub far above the mean emerges', () => {
		const net = scaleFree({ entityCount: 2000, edgesPerNode: 3, seed: 11, capacity: UNLIMITED })
		expect(maxDegree(net)).toBeGreaterThan(5 * meanDegree(net))
	})

	it('falls back to a complete graph when entityCount <= edgesPerNode', () => {
		const net = scaleFree({ entityCount: 3, edgesPerNode: 5, seed: 11, capacity: UNLIMITED })
		// Complete graph on 3 nodes = 3 edges.
		expect(net.tallies).toHaveLength(3)
		expect(noSelfLoops(net)).toBe(true)
	})

	it('is a connected graph (one giant component) at the default seed set', () => {
		const net = scaleFree({ entityCount: 500, edgesPerNode: 2, seed: 11, capacity: UNLIMITED })
		expect(connectedComponents(net).largestFraction).toBe(1)
	})
})

describe('clustered generator', () => {
	it('has more intra-community than inter-community edges', () => {
		const n = 400
		const c = 4
		const net = clustered({ entityCount: n, communityCount: c, meanIntraDegree: 8, bridgeCount: 15, seed: 13, capacity: UNLIMITED })
		const community = communityOf(n, c)
		const inter = net.tallies.filter((t) => community[t.stock] !== community[t.foil]).length
		const intra = net.tallies.length - inter
		expect(intra).toBeGreaterThan(inter)
	})

	it('places exactly the requested bridge count between communities', () => {
		const n = 400
		const c = 5
		const bridgeCount = 23
		const net = clustered({ entityCount: n, communityCount: c, meanIntraDegree: 6, bridgeCount, seed: 13, capacity: UNLIMITED })
		const community = communityOf(n, c)
		const inter = net.tallies.filter((t) => community[t.stock] !== community[t.foil]).length
		expect(inter).toBe(bridgeCount)
	})

	it('places no bridges with a single community', () => {
		const n = 200
		const net = clustered({ entityCount: n, communityCount: 1, meanIntraDegree: 6, bridgeCount: 10, seed: 13, capacity: UNLIMITED })
		const community = communityOf(n, 1)
		const inter = net.tallies.filter((t) => community[t.stock] !== community[t.foil]).length
		expect(inter).toBe(0)
	})
})

describe('small-world generator', () => {
	it('has the ring lattice mean degree k (rewiring preserves edge count)', () => {
		const net = smallWorld({ entityCount: 1000, neighbors: 6, rewireProbability: 0.3, seed: 17, capacity: UNLIMITED })
		expect(meanDegree(net)).toBe(6)
	})

	it('β = 0 is the pure ring lattice (no edge differs from the lattice)', () => {
		const n = 500
		const k = 4
		const net = smallWorld({ entityCount: n, neighbors: k, rewireProbability: 0, seed: 17, capacity: UNLIMITED })
		const lattice = new Set<string>()
		for (let i = 0; i < n; i++) {
			for (let j = 1; j <= k / 2; j++) {
				lattice.add(key(i, (i + j) % n))
			}
		}
		const rewired = net.tallies.filter((t) => !lattice.has(key(t.stock, t.foil))).length
		expect(rewired).toBe(0)
	})

	it('β = 1 rewires almost every edge', () => {
		const n = 1000
		const k = 6
		const net = smallWorld({ entityCount: n, neighbors: k, rewireProbability: 1, seed: 17, capacity: UNLIMITED })
		const lattice = new Set<string>()
		for (let i = 0; i < n; i++) {
			for (let j = 1; j <= k / 2; j++) {
				lattice.add(key(i, (i + j) % n))
			}
		}
		const rewired = net.tallies.filter((t) => !lattice.has(key(t.stock, t.foil))).length
		expect(rewired / net.tallies.length).toBeGreaterThan(0.8)
	})

	it('a mid β rewires roughly that fraction of edges', () => {
		const n = 1000
		const k = 6
		const beta = 0.5
		const net = smallWorld({ entityCount: n, neighbors: k, rewireProbability: beta, seed: 17, capacity: UNLIMITED })
		const lattice = new Set<string>()
		for (let i = 0; i < n; i++) {
			for (let j = 1; j <= k / 2; j++) {
				lattice.add(key(i, (i + j) % n))
			}
		}
		const fraction = net.tallies.filter((t) => !lattice.has(key(t.stock, t.foil))).length / net.tallies.length
		expect(fraction).toBeGreaterThan(0.35)
		expect(fraction).toBeLessThan(0.65)
	})

	it('k = 0 yields no edges', () => {
		const net = smallWorld({ entityCount: 100, neighbors: 0, rewireProbability: 0.5, seed: 17, capacity: UNLIMITED })
		expect(net.tallies).toHaveLength(0)
	})

	it('rejects an odd neighbour count and k >= entityCount', () => {
		expect(() => smallWorld({ entityCount: 100, neighbors: 3, rewireProbability: 0, seed: 1, capacity: UNLIMITED })).toThrow()
		expect(() => smallWorld({ entityCount: 10, neighbors: 10, rewireProbability: 0, seed: 1, capacity: UNLIMITED })).toThrow()
	})
})
