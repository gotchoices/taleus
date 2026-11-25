/**
 * The `uniform` generator — Erdős–Rényi style. Parameterised by **mean tallies per entity** `meanDegree`
 * (`k`): it creates `m = round(n · k / 2)` edges between random distinct pairs. Parallel edges are allowed
 * (two tallies between a pair are two edges); no self-loops. Produces a roughly Poisson degree
 * distribution — the plain random-graph baseline.
 *
 * Edge cases: `meanDegree = 0` ⇒ `m = 0` ⇒ no edges (every entity isolated). `entityCount = 1` ⇒ no edge
 * can be placed without a self-loop ⇒ no edges, whatever `meanDegree` is.
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

export const UNIFORM_ID = 'uniform'

export interface UniformParams extends GeneratorParamsBase {
	/** Mean tallies per entity (`k`). `m = round(entityCount · k / 2)` edges are placed. Must be `>= 0`. */
	meanDegree: number
}

/**
 * Generate a uniform (Erdős–Rényi style) network. `rng` defaults to a fresh {@link SeededRandom} seeded
 * from `params.seed`, so the same params reproduce the same network; pass a shared rng to interleave
 * generation with other seeded draws.
 */
export function uniform(params: UniformParams, rng: SeededRandom = rngFor(params.seed)): Network {
	requireEntityCount(params.entityCount)
	if (!(params.meanDegree >= 0) || !Number.isFinite(params.meanDegree)) {
		throw new Error(`uniform: meanDegree must be a finite number >= 0, got ${String(params.meanDegree)}`)
	}
	const n = params.entityCount
	const edgeCount = Math.round((n * params.meanDegree) / 2)

	const pairs: Pair[] = []
	// With fewer than two entities no non-self-loop edge exists, so place none.
	if (n >= 2) {
		for (let i = 0; i < edgeCount; i++) {
			const a = rng.nextInt(n)
			let b = rng.nextInt(n)
			while (b === a) {
				b = rng.nextInt(n)
			}
			pairs.push([a, b])
		}
	}

	return materialize(n, pairs, params.capacity, rng, UNIFORM_ID, { entityCount: n, meanDegree: params.meanDegree }, params.seed)
}
