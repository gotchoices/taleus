/**
 * Capacity / balance distributions: small, named, seeded functions that assign each tally its two credit
 * limits and its starting balance. A generator picks one distribution per run and draws every tally's
 * `(stockCreditLimit, foilCreditLimit, balance)` from it. See `docs/design.md` § Capacity / balance
 * distributions for each distribution's parameters.
 *
 * All draws come from {@link SeededRandom} (reused from `tallynet/testing`), so a seed replays every
 * capacity exactly. Credit limits are produced as **non-negative integers** (so directed capacities, and
 * their sums, stay integers), except the `unlimited` distribution which yields `Infinity`.
 *
 * **Balance default is 0** for every distribution (a tally starts square). `uniform` and `lognormal`
 * accept `randomizeBalance: true` to instead draw the starting balance uniformly within
 * `[-foilCreditLimit, +stockCreditLimit]`.
 */

import type { SeededRandom } from 'tallynet/testing'

/**
 * One tally's capacity assignment: the two credit limits and the starting balance. A plain value (no
 * behaviour); fed straight into a {@link Tally} by the generators.
 */
export interface CapacityDraw {
	stockCreditLimit: number
	foilCreditLimit: number
	balance: number
}

/**
 * A parameterised capacity/balance distribution, chosen per run:
 * - `unlimited` — both limits `Infinity`, balance 0 (capacity is never the constraint).
 * - `constant` — both limits a fixed value, balance 0 (or a fixed `balance`).
 * - `uniform` — each limit drawn uniformly in `[min, max]` (integers); balance 0 or randomised.
 * - `lognormal` — each limit drawn from a lognormal (`mu`, `sigma`), rounded; balance 0 or randomised.
 */
export type CapacityDistribution =
	| { kind: 'unlimited' }
	| { kind: 'constant'; limit: number; balance?: number }
	| { kind: 'uniform'; min: number; max: number; randomizeBalance?: boolean }
	| { kind: 'lognormal'; mu: number; sigma: number; randomizeBalance?: boolean }

/** An integer in `[min, max]` (both inclusive), drawn uniformly. */
export function uniformInt(min: number, max: number, rng: SeededRandom): number {
	if (!Number.isInteger(min) || !Number.isInteger(max)) {
		throw new Error(`uniformInt: min and max must be integers, got (${String(min)}, ${String(max)})`)
	}
	if (max < min) {
		throw new Error(`uniformInt: max (${max}) must be >= min (${min})`)
	}
	return min + rng.nextInt(max - min + 1)
}

/**
 * A standard-normal sample via Box–Muller (one of the pair; the other is discarded). `u1` is drawn away
 * from 0 so `log(u1)` is finite.
 */
function standardNormal(rng: SeededRandom): number {
	let u1 = rng.nextFloat()
	while (u1 === 0) {
		u1 = rng.nextFloat()
	}
	const u2 = rng.nextFloat()
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// NOTE: lognormal/Box–Muller uses Math.log/cos/sqrt/exp, whose last-ULP results are not guaranteed
// bit-identical across JS engines. Within one engine a seed replays exactly; the integer round() here
// absorbs almost all drift. If a scenario must reproduce byte-identically across Node and the browser,
// prefer an integer distribution (constant/uniform) or pin the generating platform.
/** A lognormal sample: `exp(mu + sigma · Z)` where `Z` is standard normal. Always positive. */
export function lognormalSample(mu: number, sigma: number, rng: SeededRandom): number {
	return Math.exp(mu + sigma * standardNormal(rng))
}

/** A starting balance drawn uniformly in `[-foilCreditLimit, +stockCreditLimit]` (integer). */
function randomBalance(stockCreditLimit: number, foilCreditLimit: number, rng: SeededRandom): number {
	return uniformInt(-foilCreditLimit, stockCreditLimit, rng)
}

/**
 * Draw one tally's capacity assignment from `dist`, consuming `rng` deterministically. The number of
 * draws depends only on `dist.kind` (and `randomizeBalance`), so the stream stays reproducible.
 */
export function drawCapacity(dist: CapacityDistribution, rng: SeededRandom): CapacityDraw {
	switch (dist.kind) {
		case 'unlimited': {
			return { stockCreditLimit: Infinity, foilCreditLimit: Infinity, balance: 0 }
		}
		case 'constant': {
			if (!Number.isInteger(dist.limit) || dist.limit < 0) {
				throw new Error(`constant distribution: limit must be a non-negative integer, got ${String(dist.limit)}`)
			}
			const balance = dist.balance ?? 0
			// Keep the capacity invariant: b ∈ [-foilCreditLimit, +stockCreditLimit]. An out-of-range balance
			// would silently yield a negative directed capacity downstream (see capacity.ts).
			if (balance < -dist.limit || balance > dist.limit) {
				throw new Error(`constant distribution: balance ${String(balance)} out of range [${-dist.limit}, ${dist.limit}]`)
			}
			return { stockCreditLimit: dist.limit, foilCreditLimit: dist.limit, balance }
		}
		case 'uniform': {
			const stockCreditLimit = uniformInt(dist.min, dist.max, rng)
			const foilCreditLimit = uniformInt(dist.min, dist.max, rng)
			const balance = dist.randomizeBalance ? randomBalance(stockCreditLimit, foilCreditLimit, rng) : 0
			return { stockCreditLimit, foilCreditLimit, balance }
		}
		case 'lognormal': {
			const stockCreditLimit = Math.max(0, Math.round(lognormalSample(dist.mu, dist.sigma, rng)))
			const foilCreditLimit = Math.max(0, Math.round(lognormalSample(dist.mu, dist.sigma, rng)))
			const balance = dist.randomizeBalance ? randomBalance(stockCreditLimit, foilCreditLimit, rng) : 0
			return { stockCreditLimit, foilCreditLimit, balance }
		}
	}
}
