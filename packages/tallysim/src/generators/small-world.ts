/**
 * The `small-world` generator — Watts–Strogatz. Entities are first wired into a ring lattice where each
 * entity links its `neighbors` (`k`) nearest neighbours (`k/2` on each side). Then each lattice edge is
 * **rewired** with probability `rewireProbability` (`β`): one endpoint is kept, the other replaced by a
 * random entity (avoiding self-loops and duplicate edges). Low `β` keeps the lattice's high clustering;
 * even a little rewiring collapses path lengths — the small-world effect. Edge count (and so mean degree
 * `k`) is preserved by rewiring.
 *
 * Edge cases: `β = 0` ⇒ the pure ring lattice; `β = 1` ⇒ every edge rewired where a free target exists;
 * `k = 0` ⇒ no edges. `k` must be even and `< entityCount`.
 */

import type { SeededRandom } from 'tallynet/testing'
import { type Network } from '../model.js'
import {
	type GeneratorParamsBase,
	type Pair,
	materialize,
	requireEntityCount,
	rngFor,
} from './shared.js'

export const SMALL_WORLD_ID = 'small-world'

export interface SmallWorldParams extends GeneratorParamsBase {
	/** Nearest-neighbour count (`k`). Must be an even integer with `0 <= k < entityCount`. */
	neighbors: number
	/** Rewiring probability (`β`), in `[0, 1]`. */
	rewireProbability: number
}

/** Canonical undirected-edge key (lower id first) for duplicate detection. */
function edgeKey(a: number, b: number): string {
	return a < b ? `${a}-${b}` : `${b}-${a}`
}

/**
 * Generate a small-world (Watts–Strogatz) network. `rng` defaults to a fresh {@link SeededRandom} seeded
 * from `params.seed`.
 */
export function smallWorld(params: SmallWorldParams, rng: SeededRandom = rngFor(params.seed)): Network {
	requireEntityCount(params.entityCount)
	const n = params.entityCount
	const k = params.neighbors
	const beta = params.rewireProbability
	if (!Number.isInteger(k) || k < 0 || k % 2 !== 0) {
		throw new Error(`small-world: neighbors (k) must be a non-negative even integer, got ${String(k)}`)
	}
	if (k >= n) {
		throw new Error(`small-world: neighbors (k=${k}) must be < entityCount (${n})`)
	}
	if (!(beta >= 0 && beta <= 1)) {
		throw new Error(`small-world: rewireProbability must be in [0, 1], got ${String(beta)}`)
	}

	const edges: Pair[] = []
	const existing = new Set<string>()
	// Ring lattice: each entity links the next k/2 entities around the ring.
	const half = k / 2
	for (let i = 0; i < n; i++) {
		for (let j = 1; j <= half; j++) {
			const neighbour = (i + j) % n
			edges.push([i, neighbour])
			existing.add(edgeKey(i, neighbour))
		}
	}

	// Rewire: keep the first endpoint, redraw the second. Bounded attempts avoid an infinite loop on a
	// near-complete graph; if no free target is found, the edge is left in place.
	const maxAttempts = 2 * n
	for (let idx = 0; idx < edges.length; idx++) {
		if (rng.nextFloat() >= beta) {
			continue
		}
		const i = edges[idx][0]
		let w = rng.nextInt(n)
		let attempts = 0
		while ((w === i || existing.has(edgeKey(i, w))) && attempts < maxAttempts) {
			w = rng.nextInt(n)
			attempts++
		}
		if (w !== i && !existing.has(edgeKey(i, w))) {
			existing.delete(edgeKey(i, edges[idx][1]))
			existing.add(edgeKey(i, w))
			edges[idx] = [i, w]
		}
	}

	const metaParams = { entityCount: n, neighbors: k, rewireProbability: beta }
	return materialize(n, edges, params.capacity, rng, SMALL_WORLD_ID, metaParams, params.seed)
}
