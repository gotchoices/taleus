/**
 * The network-conditions compiler: turns a declarative {@link ConditionsSpec} (latency, dropped links,
 * sleeping and late nodes) into the static per-link {@link LinkCondition} map the `tallynet` harness
 * consumes, plus the set of entities made asleep. Everything is drawn from a **dedicated**
 * {@link SeededRandom} stream (the "conditions" seed, independent of the network/workload/economy seeds),
 * so a scenario's conditions replay exactly and — crucially — never perturb the harness's shared random,
 * which mints session codes. See `docs/design.md` § Discovery simulation.
 *
 * ── Node conditions are an undirected approximation ───────────────────────────────────────────────
 * The harness's only degradation surface is per **link** (`latencyMs` / `drop`). A node is therefore made
 * to "contribute nothing" (sleeping) or "answer late" (late) by applying the condition to **both** links
 * incident to it. That is the correct per-link model of a node that never answers / answers slowly; it
 * cannot distinguish the two directions of a tally, and it does not need to for this tier. A late node's
 * incident links carry a large `latencyMs` that exceeds a round budget, so the participant folds the late
 * answer into a later round rather than dropping it.
 *
 * ── Selection is count-based, not Bernoulli ──────────────────────────────────────────────────────
 * Each fraction selects **exactly** `round(fraction · poolSize)` members (clamped to the pool) via a
 * seeded partial Fisher–Yates shuffle, so a test can assert a precise count instead of a distribution.
 * Sleeping and late entities are drawn first (independently over all entities; a node may be both, and
 * sleeping wins at resolution); dropped links are then drawn over the links that are neither sleeping- nor
 * late-incident; every remaining link draws its base latency.
 *
 * ── Precedence at resolution (per link) ──────────────────────────────────────────────────────────
 *     sleeping (drop) > late (lateLatencyMs) > dropFraction (drop) > base latency
 */

import type { LinkCondition } from 'tallynet/testing'
import { SeededRandom } from 'tallynet/testing'
import { lognormalSample, uniformInt } from '../distributions.js'
import type { Network } from '../model.js'
import { linkIdForTally } from './naming.js'

/** A base per-link request-latency distribution (ms). Reuses the capacity-distribution shapes. */
export type LatencyDistribution =
	| { kind: 'constant'; value: number }
	| { kind: 'uniform'; min: number; max: number }
	| { kind: 'lognormal'; mu: number; sigma: number }

/**
 * A declarative description of the network conditions to impose on a run. Every field is optional; an
 * empty spec is a perfect network (instant, reliable, every node awake). Fractions are `0..1`.
 */
export interface ConditionsSpec {
	/** Base per-link request latency (ms, non-negative integers). Omitted ⇒ links deliver instantly. */
	latency?: LatencyDistribution
	/** Fraction of links (not incident to a sleeping/late node) that drop every delivery, eternally. */
	dropFraction?: number
	/** Fraction of entities that never answer (asleep); both incident links drop. */
	sleepingFraction?: number
	/** Fraction of entities that answer only after {@link ConditionsSpec.lateLatencyMs}; both incident links carry it. */
	lateFraction?: number
	/** The latency (ms) a late node's incident links carry — choose it to exceed a round budget. */
	lateLatencyMs?: number
}

/** The compiled result: the per-link condition map for the harness, and which entities were made asleep. */
export interface CompiledConditions {
	/** Per-link conditions keyed by `linkIdForTally(i)`. A link with no entry delivers instantly and reliably. */
	conditions: Record<string, LinkCondition>
	/** The entities made asleep (so metrics and tests can see which nodes contributed nothing). */
	sleeping: Set<number>
}

/** `[0, 1, …, n - 1]`. */
function range(n: number): number[] {
	const out: number[] = []
	for (let i = 0; i < n; i++) {
		out.push(i)
	}
	return out
}

/**
 * The first `k` elements of a seeded partial Fisher–Yates shuffle of `items` (a copy; `items` is not
 * mutated). Deterministic for a given `rng` state. `k` is clamped to `items.length`.
 */
function partialShuffle(items: number[], k: number, rng: SeededRandom): number[] {
	const arr = [...items]
	const count = Math.min(Math.max(0, k), arr.length)
	for (let i = 0; i < count; i++) {
		const j = i + rng.nextInt(arr.length - i)
		const tmp = arr[i]
		arr[i] = arr[j]
		arr[j] = tmp
	}
	return arr.slice(0, count)
}

/** Select exactly `round(fraction · pool.length)` members of `pool` (clamped), or none if `fraction` is falsy. */
function pickFraction(pool: number[], fraction: number | undefined, rng: SeededRandom): Set<number> {
	if (!fraction || fraction <= 0 || pool.length === 0) {
		return new Set()
	}
	const k = Math.min(pool.length, Math.max(0, Math.round(fraction * pool.length)))
	return new Set(partialShuffle(pool, k, rng))
}

/** Draw one base latency (ms, non-negative integer) from `dist`, or `undefined` when no distribution is given. */
function drawLatency(dist: LatencyDistribution | undefined, rng: SeededRandom): number | undefined {
	if (!dist) {
		return undefined
	}
	switch (dist.kind) {
		case 'constant': {
			return Math.max(0, Math.round(dist.value))
		}
		case 'uniform': {
			return uniformInt(dist.min, dist.max, rng)
		}
		case 'lognormal': {
			return Math.max(0, Math.round(lognormalSample(dist.mu, dist.sigma, rng)))
		}
	}
}

/**
 * Compile `spec` against `network` into the harness's per-link conditions and the sleeping-node set,
 * drawing every random choice from a fresh `SeededRandom(seed)` — the dedicated conditions stream.
 *
 * Draw order (so a seed replays exactly): sleeping entities, then late entities, then the dropped-link
 * selection, then each remaining link's base latency in tally-index order.
 */
export function compileConditions(network: Network, spec: ConditionsSpec, seed: number): CompiledConditions {
	const rng = new SeededRandom(seed)
	const entities = range(network.entityCount)
	const sleeping = pickFraction(entities, spec.sleepingFraction, rng)
	const late = pickFraction(entities, spec.lateFraction, rng)

	const isSleeping = (t: { stock: number; foil: number }): boolean => sleeping.has(t.stock) || sleeping.has(t.foil)
	const isLate = (t: { stock: number; foil: number }): boolean => late.has(t.stock) || late.has(t.foil)

	// Links eligible for the dropFraction selection: neither endpoint sleeping nor late (sleeping and late
	// take precedence, so a drop drawn onto such a link would be wasted — exclude them from the pool).
	const eligibleForDrop: number[] = []
	for (let i = 0; i < network.tallies.length; i++) {
		const tally = network.tallies[i]
		if (!isSleeping(tally) && !isLate(tally)) {
			eligibleForDrop.push(i)
		}
	}
	const dropped = pickFraction(eligibleForDrop, spec.dropFraction, rng)

	const conditions: Record<string, LinkCondition> = {}
	for (let i = 0; i < network.tallies.length; i++) {
		const tally = network.tallies[i]
		const id = linkIdForTally(i)
		if (isSleeping(tally)) {
			conditions[id] = { drop: true }
		} else if (isLate(tally)) {
			conditions[id] = { latencyMs: Math.max(0, Math.round(spec.lateLatencyMs ?? 0)) }
		} else if (dropped.has(i)) {
			conditions[id] = { drop: true }
		} else {
			const latencyMs = drawLatency(spec.latency, rng)
			if (latencyMs !== undefined) {
				conditions[id] = { latencyMs }
			}
		}
	}
	return { conditions, sleeping }
}
