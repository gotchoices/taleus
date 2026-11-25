import { SeededRandom } from 'tallynet/testing'
import { uniform } from './generators/index.js'
import { FORMAT_VERSION, type Network, type Tally } from './model.js'
import { Oracle } from './oracle.js'

/** Wrap hand-built tallies in a minimal {@link Network}. */
function net(entityCount: number, tallies: Tally[]): Network {
	return {
		entityCount,
		tallies,
		meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION },
	}
}

/**
 * A one-way directed edge `from → to` of capacity `capForward`, with the reverse direction `to → from`
 * given `capBack` (default 0, i.e. a tally that can only carry value one way).
 */
function edge(from: number, to: number, capForward: number, capBack = 0): Tally {
	// cap(S→F) = balance + foilCreditLimit; cap(F→S) = stockCreditLimit − balance. balance 0:
	return { stock: from, foil: to, balance: 0, stockCreditLimit: capBack, foilCreditLimit: capForward }
}

describe('Oracle.routeExistence — payment routes', () => {
	it('finds a route along a directed path and reports the shortest hop count', () => {
		const o = Oracle.fromNetwork(net(4, [edge(0, 1, 10), edge(1, 2, 10), edge(2, 3, 10)]))
		expect(o.routeExistence(0, 3, 5, 5)).toEqual({ exists: true, shortestLength: 3 })
	})

	it('respects the depth bound (a Y reachable only at D+1 is not found at D)', () => {
		const o = Oracle.fromNetwork(net(4, [edge(0, 1, 10), edge(1, 2, 10), edge(2, 3, 10)]))
		// 3 is 3 hops away: found at D=3, not at D=2.
		expect(o.routeExistence(0, 3, 5, 3).exists).toBe(true)
		expect(o.routeExistence(0, 3, 5, 2)).toEqual({ exists: false })
	})

	it('depth 0 reaches nothing but a self-payment', () => {
		const o = Oracle.fromNetwork(net(2, [edge(0, 1, 10)]))
		expect(o.routeExistence(0, 1, 5, 0)).toEqual({ exists: false })
	})

	it('respects the capacity bound at the boundary (capacity === amount qualifies, amount−1 does not)', () => {
		const o = Oracle.fromNetwork(net(2, [edge(0, 1, 5)]))
		expect(o.routeExistence(0, 1, 5, 1)).toEqual({ exists: true, shortestLength: 1 }) // 5 ≥ 5
		expect(o.routeExistence(0, 1, 6, 1)).toEqual({ exists: false }) // 5 < 6
	})

	it('prunes an under-capacity edge and takes a longer qualifying detour instead', () => {
		// Direct 0→2 has capacity 3 (too small for amount 5); the 0→1→2 detour qualifies.
		const o = Oracle.fromNetwork(net(3, [edge(0, 2, 3), edge(0, 1, 10), edge(1, 2, 10)]))
		expect(o.routeExistence(0, 2, 5, 4)).toEqual({ exists: true, shortestLength: 2 })
	})

	it('returns no route to an isolated endpoint', () => {
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, 10)]))
		expect(o.routeExistence(0, 2, 5, 5)).toEqual({ exists: false })
	})

	it('rejects a non-positive amount', () => {
		const o = Oracle.fromNetwork(net(2, [edge(0, 1, 10)]))
		expect(() => o.routeExistence(0, 1, 0, 3)).toThrow()
		expect(() => o.routeExistence(0, 1, -1, 3)).toThrow()
	})

	it('rejects an out-of-range entity id and a bad depth', () => {
		const o = Oracle.fromNetwork(net(2, [edge(0, 1, 10)]))
		expect(() => o.routeExistence(0, 5, 1, 3)).toThrow()
		expect(() => o.routeExistence(0, 1, 1, -1)).toThrow()
		expect(() => o.routeExistence(0, 1, 1, 1.5)).toThrow()
	})
})

describe('Oracle.selfPayment — circular clearing (X === Y)', () => {
	it('treats a self-payment as a cycle (never length 0)', () => {
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, 10), edge(1, 2, 10), edge(2, 0, 10)]))
		expect(o.selfPayment(0, 5, 3)).toEqual({ exists: true, shortestLength: 3 })
	})

	it('finds a 2-cycle when a tally carries both directions', () => {
		const o = Oracle.fromNetwork(net(2, [edge(0, 1, 10, 10)]))
		expect(o.selfPayment(0, 5, 2)).toEqual({ exists: true, shortestLength: 2 })
		expect(o.selfPayment(0, 5, 1)).toEqual({ exists: false }) // a cycle needs ≥ 2 hops
	})

	it('reports no cycle when every return edge is under capacity', () => {
		// Triangle exists but the closing edge 2→0 has capacity 3 < amount 5.
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, 10), edge(1, 2, 10), edge(2, 0, 3)]))
		expect(o.selfPayment(0, 5, 3)).toEqual({ exists: false })
	})

	it('routeExistence(X, X, …) delegates to selfPayment', () => {
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, 10), edge(1, 2, 10), edge(2, 0, 10)]))
		expect(o.routeExistence(0, 0, 5, 3)).toEqual({ exists: true, shortestLength: 3 })
	})
})

describe('Oracle.maxFlow — how much is payable', () => {
	it('sums parallel-edge capacities', () => {
		const o = Oracle.fromNetwork(net(2, [edge(0, 1, 5), edge(0, 1, 7)]))
		expect(o.maxFlow(0, 1)).toBe(12)
	})

	it('computes the max-flow / min-cut value on a diamond', () => {
		// 0→1:3, 0→2:5, 1→3:4, 2→3:2 ⇒ max-flow 5 (cut {0,2} = 3 + 2).
		const o = Oracle.fromNetwork(net(4, [edge(0, 1, 3), edge(0, 2, 5), edge(1, 3, 4), edge(2, 3, 2)]))
		expect(o.maxFlow(0, 3)).toBe(5)
	})

	it('is bottlenecked by the tightest edge on a single path', () => {
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, 10), edge(1, 2, 4)]))
		expect(o.maxFlow(0, 2)).toBe(4)
	})

	it('returns Infinity when an all-unlimited path exists', () => {
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, Infinity), edge(1, 2, Infinity)]))
		expect(o.maxFlow(0, 2)).toBe(Infinity)
	})

	it('returns 0 for a disconnected sink and for X === Y', () => {
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, 10)]))
		expect(o.maxFlow(0, 2)).toBe(0)
		expect(o.maxFlow(0, 0)).toBe(0)
	})
})

describe('Oracle.clearingCycles — clearing availability', () => {
	it('counts the single directed cycle through a triangle', () => {
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, 10), edge(1, 2, 10), edge(2, 0, 10)]))
		expect(o.clearingCycles(0, 5, 3, 100)).toEqual({ count: 1, capped: false, shortestLength: 3 })
	})

	it('counts a 2-cycle from a bidirectional tally', () => {
		const o = Oracle.fromNetwork(net(2, [edge(0, 1, 10, 10)]))
		expect(o.clearingCycles(0, 5, 2, 100)).toEqual({ count: 1, capped: false, shortestLength: 2 })
	})

	it('reports no cycles (count 0, no shortestLength) for an acyclic graph', () => {
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, 10), edge(1, 2, 10)]))
		expect(o.clearingCycles(0, 5, 5, 100)).toEqual({ count: 0, capped: false })
	})

	it('caps the count and flags it', () => {
		// 0 bridges to a clique {1,2,3} with many cycles back through 0; cap at 2.
		const o = Oracle.fromNetwork(
			net(4, [
				edge(0, 1, 10), edge(0, 2, 10), edge(0, 3, 10),
				edge(1, 0, 10), edge(2, 0, 10), edge(3, 0, 10),
				edge(1, 2, 10), edge(2, 1, 10), edge(1, 3, 10), edge(3, 1, 10), edge(2, 3, 10), edge(3, 2, 10),
			]),
		)
		const result = o.clearingCycles(0, 5, 4, 2)
		expect(result.count).toBe(2)
		expect(result.capped).toBe(true)
	})

	it('reports the exact shortest cycle even when the count is capped before reaching it', () => {
		// Node 0 reaches a 3-cycle (0→1→2→0) via its first out-edge and a 2-cycle (0↔3) via its last.
		// With maxCount 1 the DFS caps after the 3-cycle, but the BFS-computed shortest is still 2.
		const o = Oracle.fromNetwork(
			net(4, [edge(0, 1, 10), edge(1, 2, 10), edge(2, 0, 10), edge(0, 3, 10, 10)]),
		)
		expect(o.clearingCycles(0, 5, 3, 1)).toEqual({ count: 1, capped: true, shortestLength: 2 })
	})

	it('counts every distinct directed cycle in a fully bidirectional triangle', () => {
		// Every edge bidirectional. Through node 0 within depth 3: two 2-cycles (0↔1, 0↔2) and two
		// 3-cycles (0→1→2→0, 0→2→1→0) ⇒ 4 distinct directed cycles; the shortest is length 2.
		const o = Oracle.fromNetwork(net(3, [edge(0, 1, 10, 10), edge(1, 2, 10, 10), edge(2, 0, 10, 10)]))
		expect(o.clearingCycles(0, 5, 3, 100)).toEqual({ count: 4, capped: false, shortestLength: 2 })
	})
})

describe('Oracle — determinism', () => {
	it('returns identical results for the same query run twice', () => {
		const network = uniform({ entityCount: 200, meanDegree: 6, seed: 42, capacity: { kind: 'constant', limit: 10 } })
		const o = Oracle.fromNetwork(network)
		const first = o.routeExistence(3, 150, 5, 8)
		const second = o.routeExistence(3, 150, 5, 8)
		expect(first).toEqual(second)
	})
})

describe('Oracle — performance smoke (seconds, not minutes)', () => {
	it('answers ~1,000 BFS route queries on a 10k-entity graph well under the ceiling', () => {
		const network = uniform({ entityCount: 10_000, meanDegree: 10, seed: 7, capacity: { kind: 'constant', limit: 100 } })
		const o = Oracle.fromNetwork(network)
		const pick = new SeededRandom(99)

		const start = Date.now()
		for (let i = 0; i < 1000; i++) {
			const from = pick.nextInt(network.entityCount)
			const to = pick.nextInt(network.entityCount)
			o.routeExistence(from, from === to ? (to + 1) % network.entityCount : to, 1, 8)
		}
		const elapsedMs = Date.now() - start
		// Generous ceiling (CI machines vary); the point is "seconds, not minutes".
		expect(elapsedMs).toBeLessThan(30_000)
	}, 120_000)
})
