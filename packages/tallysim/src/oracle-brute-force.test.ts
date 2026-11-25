/**
 * The oracle's correctness anchor: an **independent exhaustive enumeration** on small graphs, cross-checked
 * against the oracle's bounded searches. The brute-force functions below are deliberately naive (adjacency
 * lists + recursive enumeration of every simple path / cycle, and max-flow by **min-cut subset
 * enumeration** — a genuinely different computation, via the max-flow/min-cut theorem) so a bug shared with
 * the oracle cannot hide in both. They live in the test tree, intentionally slow, run only on tiny graphs.
 *
 * Reviewer: scrutinise this harness as hard as the oracle — the depth/capacity boundary conventions
 * (`capacity >= amount`; `maxDepth` counts hops; a cycle is length ≥ 2) must match `oracle.ts` and the
 * design doc exactly, because the discovery tier compares its protocol results against these.
 */

import { SeededRandom } from 'tallynet/testing'
import { uniform } from './generators/index.js'
import type { Network } from './model.js'
import { Oracle, type ClearingResult, type RouteResult } from './oracle.js'

/** One directed capacity edge, derived independently of `graph-view.ts` straight from the capacity model. */
interface DirectedEdge {
	to: number
	cap: number
}

/** Directed adjacency list from a {@link Network}: each tally ⇒ stock→foil (cap S→F) and foil→stock (cap F→S). */
function adjacency(network: Network): DirectedEdge[][] {
	const adj: DirectedEdge[][] = Array.from({ length: network.entityCount }, () => [])
	for (const t of network.tallies) {
		adj[t.stock].push({ to: t.foil, cap: t.balance + t.foilCreditLimit }) // cap(S→F)
		adj[t.foil].push({ to: t.stock, cap: t.stockCreditLimit - t.balance }) // cap(F→S)
	}
	return adj
}

/** Brute force: shortest simple path `from → to` (≠), each edge `cap ≥ amount`, length ≤ maxDepth. */
function bruteRoute(network: Network, from: number, to: number, amount: number, maxDepth: number): RouteResult {
	const adj = adjacency(network)
	const visited = new Set<number>([from])
	let best = Infinity
	const walk = (u: number, len: number): void => {
		if (len >= maxDepth) {
			return
		}
		for (const e of adj[u]) {
			if (e.cap < amount) {
				continue
			}
			if (e.to === to) {
				best = Math.min(best, len + 1)
				continue
			}
			if (!visited.has(e.to)) {
				visited.add(e.to)
				walk(e.to, len + 1)
				visited.delete(e.to)
			}
		}
	}
	walk(from, 0)
	return best === Infinity ? { exists: false } : { exists: true, shortestLength: best }
}

/** Brute force: enumerate every simple directed cycle through `node`, returning count + shortest length. */
function bruteCycles(network: Network, node: number, amount: number, maxDepth: number): ClearingResult {
	const adj = adjacency(network)
	const onPath = new Set<number>()
	let count = 0
	let best = Infinity
	const walk = (u: number, len: number): void => {
		for (const e of adj[u]) {
			if (e.cap < amount) {
				continue
			}
			if (e.to === node) {
				const cycleLength = len + 1
				if (cycleLength >= 2) {
					count++
					best = Math.min(best, cycleLength)
				}
				continue
			}
			if (len + 1 <= maxDepth - 1 && !onPath.has(e.to)) {
				onPath.add(e.to)
				walk(e.to, len + 1)
				onPath.delete(e.to)
			}
		}
	}
	walk(node, 0)
	const result: ClearingResult = { count, capped: false }
	if (best !== Infinity) {
		result.shortestLength = best
	}
	return result
}

/** Brute force max-flow via min-cut: min over subsets S (s ∈ S, t ∉ S) of the capacity crossing out of S. */
function bruteMaxFlow(network: Network, s: number, t: number): number {
	const n = network.entityCount
	const edges: { from: number; to: number; cap: number }[] = []
	for (const tally of network.tallies) {
		edges.push({ from: tally.stock, to: tally.foil, cap: tally.balance + tally.foilCreditLimit })
		edges.push({ from: tally.foil, to: tally.stock, cap: tally.stockCreditLimit - tally.balance })
	}
	const others: number[] = []
	for (let v = 0; v < n; v++) {
		if (v !== s && v !== t) {
			others.push(v)
		}
	}
	let best = Infinity
	for (let mask = 0; mask < 1 << others.length; mask++) {
		const inS = new Set<number>([s])
		for (let b = 0; b < others.length; b++) {
			if (mask & (1 << b)) {
				inS.add(others[b])
			}
		}
		let cut = 0
		for (const e of edges) {
			if (inS.has(e.from) && !inS.has(e.to)) {
				cut += e.cap
			}
		}
		best = Math.min(best, cut)
	}
	return best
}

/** A seeded run of small random graphs the brute force can exhaustively check. */
function smallGraph(seed: number, entityCount: number): Network {
	// Capacities drawn in [0, 4] exercise the `capacity >= amount` filter, including zero-capacity directions.
	return uniform({ entityCount, meanDegree: 3, seed, capacity: { kind: 'uniform', min: 0, max: 4 } })
}

describe('oracle vs. brute force — route existence & shortest length', () => {
	it('matches exhaustive enumeration across seeds, amounts and depths', () => {
		const pick = new SeededRandom(1001)
		for (let seed = 0; seed < 40; seed++) {
			const network = smallGraph(seed, 9)
			const oracle = Oracle.fromNetwork(network)
			for (let trial = 0; trial < 6; trial++) {
				const from = pick.nextInt(network.entityCount)
				let to = pick.nextInt(network.entityCount)
				if (to === from) {
					to = (to + 1) % network.entityCount
				}
				const amount = 1 + pick.nextInt(4) // 1..4
				const maxDepth = 2 + pick.nextInt(4) // 2..5
				expect(oracle.routeExistence(from, to, amount, maxDepth)).toEqual(
					bruteRoute(network, from, to, amount, maxDepth),
				)
			}
		}
	})
})

describe('oracle vs. brute force — self-payment (shortest cycle)', () => {
	it('matches exhaustive cycle enumeration (shortest only)', () => {
		const pick = new SeededRandom(2002)
		for (let seed = 0; seed < 40; seed++) {
			const network = smallGraph(seed, 9)
			const oracle = Oracle.fromNetwork(network)
			for (let trial = 0; trial < 6; trial++) {
				const node = pick.nextInt(network.entityCount)
				const amount = 1 + pick.nextInt(4)
				const maxDepth = 2 + pick.nextInt(4)
				const brute = bruteCycles(network, node, amount, maxDepth)
				const expected: RouteResult =
					brute.shortestLength === undefined
						? { exists: false }
						: { exists: true, shortestLength: brute.shortestLength }
				expect(oracle.selfPayment(node, amount, maxDepth)).toEqual(expected)
			}
		}
	})
})

describe('oracle vs. brute force — clearing-cycle count & shortest', () => {
	it('matches exhaustive cycle enumeration when the cap is not reached', () => {
		const pick = new SeededRandom(3003)
		for (let seed = 0; seed < 40; seed++) {
			const network = smallGraph(seed, 8)
			const oracle = Oracle.fromNetwork(network)
			for (let trial = 0; trial < 6; trial++) {
				const node = pick.nextInt(network.entityCount)
				const amount = 1 + pick.nextInt(4)
				const maxDepth = 2 + pick.nextInt(4)
				// A cap far above any possible count on these tiny graphs ⇒ never capped.
				expect(oracle.clearingCycles(node, amount, maxDepth, 1_000_000)).toEqual(
					bruteCycles(network, node, amount, maxDepth),
				)
			}
		}
	})
})

describe('oracle vs. brute force — max-flow (min-cut)', () => {
	it('matches the min-cut value across seeds and source/sink pairs', () => {
		const pick = new SeededRandom(4004)
		for (let seed = 0; seed < 40; seed++) {
			const network = smallGraph(seed, 6) // ≤ 6 nodes ⇒ ≤ 16 cut subsets
			const oracle = Oracle.fromNetwork(network)
			for (let trial = 0; trial < 6; trial++) {
				const s = pick.nextInt(network.entityCount)
				let t = pick.nextInt(network.entityCount)
				if (t === s) {
					t = (t + 1) % network.entityCount
				}
				expect(oracle.maxFlow(s, t)).toBe(bruteMaxFlow(network, s, t))
			}
		}
	})
})
