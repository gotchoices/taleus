/**
 * The shared workload primitives: materialise a network from a {@link NetworkSource}, draw one query
 * amount, and draw one `(from, to)` payment pair. Both the oracle runner (`runner.ts`) and the discovery
 * simulation (`sim/`) draw their workloads here, so there is exactly one materialiser and one amount/pair
 * draw — the two tiers stay in lock-step and the oracle-runner output stays byte-identical to before this
 * extraction (its determinism tests are the regression floor).
 *
 * Every draw consumes a {@link SeededRandom} deterministically; the number of draws depends only on the
 * distribution kind, so a seed replays a workload exactly.
 */

import { SeededRandom } from 'tallynet/testing'
import {
	clustered,
	scaleFree,
	smallWorld,
	uniform,
	CLUSTERED_ID,
	SCALE_FREE_ID,
	SMALL_WORLD_ID,
	UNIFORM_ID,
	type ClusteredParams,
	type ScaleFreeParams,
	type SmallWorldParams,
	type UniformParams,
} from './generators/index.js'
import type { Network } from './model.js'
import type { AmountSpec, NetworkSource } from './scenario.js'

/**
 * Materialise a network from a resolved {@link NetworkSource}. The generator variant offsets its seed by the
 * run seed and draws from a fresh {@link SeededRandom}; the materialised variant is returned as-is.
 */
export function materializeNetwork(source: NetworkSource, runSeed: number): Network {
	if ('materialized' in source) {
		// NOTE: returned by reference, treated read-only by this tier (the no-op economy step never mutates).
		// A future trading model that mutates balances must clone per run, or cells would contaminate each
		// other. Cloning here now would needlessly copy a large network every run, so it is deferred.
		return source.materialized
	}
	const networkSeed = source.seed + runSeed
	const rng = new SeededRandom(networkSeed)
	const invocation = { ...source.params, capacity: source.capacity, seed: networkSeed }
	switch (source.generator) {
		case UNIFORM_ID: {
			return uniform(invocation as unknown as UniformParams, rng)
		}
		case SCALE_FREE_ID: {
			return scaleFree(invocation as unknown as ScaleFreeParams, rng)
		}
		case CLUSTERED_ID: {
			return clustered(invocation as unknown as ClusteredParams, rng)
		}
		case SMALL_WORLD_ID: {
			return smallWorld(invocation as unknown as SmallWorldParams, rng)
		}
		default: {
			throw new Error(`runner: unknown generator "${source.generator}"`)
		}
	}
}

/**
 * Draw one query amount. `constant` consumes no rng; `uniform` consumes one draw. The draw count depends only
 * on the distribution kind (fixed per sweep), so the stream stays reproducible. Always returns a positive
 * integer (the oracle rejects a non-positive amount).
 */
export function drawAmount(spec: AmountSpec, rng: SeededRandom): number {
	switch (spec.dist) {
		case 'constant': {
			const value = spec.params.value
			if (!Number.isInteger(value) || value <= 0) {
				throw new Error(`amount constant: value must be a positive integer, got ${String(value)}`)
			}
			return value
		}
		case 'uniform': {
			const { min, max } = spec.params
			if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max < min) {
				throw new Error(`amount uniform: need integers 0 < min <= max, got (${String(min)}, ${String(max)})`)
			}
			return min + rng.nextInt(max - min + 1)
		}
		default: {
			throw new Error(`amount: unknown distribution "${spec.dist}"`)
		}
	}
}

/**
 * Draw one distinct `(from, to)` payment pair uniformly over `0 .. entityCount - 1`. Consumes one draw for
 * `from` and one-or-more for `to` (re-drawn until distinct). The caller must ensure `entityCount >= 2` (no
 * distinct pair exists otherwise); this mirrors the oracle runner's original inline draw exactly, so its
 * byte-identical output is preserved.
 */
export function drawPaymentPair(entityCount: number, rng: SeededRandom): [number, number] {
	const from = rng.nextInt(entityCount)
	let to = rng.nextInt(entityCount)
	while (to === from) {
		to = rng.nextInt(entityCount)
	}
	return [from, to]
}
