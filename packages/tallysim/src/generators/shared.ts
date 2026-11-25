/**
 * Shared building blocks for the four generators: a common params base, the stock/foil orientation rule,
 * and a helper that turns a list of unordered entity pairs (the topology) into a {@link Network} by
 * assigning each pair an orientation and a capacity draw.
 *
 * Splitting topology (which pairs are joined) from assignment (who is stock, and the limits/balance) keeps
 * each generator's structural logic separate from the capacity distribution, and lets the structural
 * fidelity tests reason about the pairs alone.
 */

import { SeededRandom } from 'tallynet/testing'
import type { CapacityDistribution } from '../distributions.js'
import { drawCapacity } from '../distributions.js'
import { FORMAT_VERSION, type Network, type NetworkMeta, type Tally } from '../model.js'

/** An unordered pair of distinct entity ids — one undirected edge before orientation is assigned. */
export type Pair = [number, number]

/** What every generator needs: how many entities, which capacity distribution, and the seed to replay. */
export interface GeneratorParamsBase {
	/** Number of entities (nodes) in the network. Must be a positive integer. */
	entityCount: number
	/** The capacity/balance distribution every tally is drawn from. */
	capacity: CapacityDistribution
	/** Seed recorded in `meta.seed`; also the default source for the rng (see each generator). */
	seed: number
}

/** Validate the entity count shared by every generator. */
export function requireEntityCount(entityCount: number): void {
	if (!Number.isInteger(entityCount) || entityCount <= 0) {
		throw new Error(`entityCount must be a positive integer, got ${String(entityCount)}`)
	}
}

/**
 * Orientation rule (stock vs foil for one edge): draw a coin from `rng` — heads (`< 0.5`) makes `a` the
 * stock and `b` the foil, tails swaps them. Documented in `docs/design.md` § Generators. One `rng` draw.
 */
export function orient(a: number, b: number, rng: SeededRandom): { stock: number; foil: number } {
	return rng.nextFloat() < 0.5 ? { stock: a, foil: b } : { stock: b, foil: a }
}

/**
 * Build a {@link Network} from the given topology: for each pair in order, orient it (one `rng` draw) and
 * draw its capacity assignment (`drawCapacity`). Pairs are consumed in array order so the whole network is
 * reproducible from the rng stream the generator has drawn so far.
 */
export function materialize(
	entityCount: number,
	pairs: Pair[],
	capacity: CapacityDistribution,
	rng: SeededRandom,
	generator: string,
	params: Record<string, number>,
	seed: number,
): Network {
	const tallies: Tally[] = pairs.map(([a, b]) => {
		const { stock, foil } = orient(a, b, rng)
		const draw = drawCapacity(capacity, rng)
		return {
			stock,
			foil,
			balance: draw.balance,
			stockCreditLimit: draw.stockCreditLimit,
			foilCreditLimit: draw.foilCreditLimit,
		}
	})
	const meta: NetworkMeta = { generator, params, seed, formatVersion: FORMAT_VERSION }
	return { entityCount, tallies, meta }
}

/** The rng a generator uses: the injected one, or a fresh {@link SeededRandom} seeded from `seed`. */
export function rngFor(seed: number, injected?: SeededRandom): SeededRandom {
	return injected ?? new SeededRandom(seed)
}
