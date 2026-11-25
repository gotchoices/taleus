/**
 * The `scale-free` generator — Barabási–Albert preferential attachment. Parameter `edgesPerNode` (`m`) is
 * how many edges each newly added entity brings. Starting from a small seed set of the first `m` entities,
 * each new entity attaches `m` edges to existing entities chosen with probability proportional to their
 * current degree ("the rich get richer"), producing a few high-degree hubs and many low-degree entities —
 * a heavy-tailed degree distribution.
 *
 * The preferential draw uses the standard "repeated-nodes" bag: every time an edge touches an entity, that
 * entity's id is pushed onto a bag, so sampling a uniform element of the bag is sampling proportional to
 * degree. See `docs/design.md` § Generators.
 *
 * Edge case: when `entityCount <= edgesPerNode` there are too few entities to seed the attachment, so a
 * complete graph among the entities is returned instead.
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

export const SCALE_FREE_ID = 'scale-free'

export interface ScaleFreeParams extends GeneratorParamsBase {
	/** Edges each new entity brings (`m`). Must be a positive integer. */
	edgesPerNode: number
}

/** Pick `count` distinct ids from `bag` (which may contain repeats), each draw uniform over the bag. */
function randomSubset(bag: number[], count: number, rng: SeededRandom): number[] {
	const picked: number[] = []
	const seen = new Set<number>()
	while (picked.length < count) {
		const candidate = bag[rng.nextInt(bag.length)]
		if (!seen.has(candidate)) {
			seen.add(candidate)
			picked.push(candidate)
		}
	}
	return picked
}

/** Every distinct pair among `0 .. n-1` — the complete graph, used for the degenerate small-`n` case. */
function completeGraph(n: number): Pair[] {
	const pairs: Pair[] = []
	for (let a = 0; a < n; a++) {
		for (let b = a + 1; b < n; b++) {
			pairs.push([a, b])
		}
	}
	return pairs
}

/**
 * Generate a scale-free (Barabási–Albert) network. `rng` defaults to a fresh {@link SeededRandom} seeded
 * from `params.seed`.
 */
export function scaleFree(params: ScaleFreeParams, rng: SeededRandom = rngFor(params.seed)): Network {
	requireEntityCount(params.entityCount)
	if (!Number.isInteger(params.edgesPerNode) || params.edgesPerNode <= 0) {
		throw new Error(`scale-free: edgesPerNode must be a positive integer, got ${String(params.edgesPerNode)}`)
	}
	const n = params.entityCount
	const m = params.edgesPerNode
	const metaParams = { entityCount: n, edgesPerNode: m }

	if (n <= m) {
		return materialize(n, completeGraph(n), params.capacity, rng, SCALE_FREE_ID, metaParams, params.seed)
	}

	const pairs: Pair[] = []
	const bag: number[] = []
	// The first `m` entities are the seed set; the first attached entity connects to all of them.
	let targets = Array.from({ length: m }, (_unused, i) => i)
	for (let source = m; source < n; source++) {
		for (const target of targets) {
			pairs.push([source, target])
			bag.push(source, target)
		}
		targets = randomSubset(bag, m, rng)
	}

	return materialize(n, pairs, params.capacity, rng, SCALE_FREE_ID, metaParams, params.seed)
}
