/**
 * The sequential consensus sweep runner: the consensus counterpart to `sim-runner.ts`. It turns a
 * {@link SimSweepSpec} (whose `base` is a {@link SimScenario} that may carry a `consensus` block +
 * `consensusSeed`) into a stream of {@link ConsensusRunRecord}s — one per `(cell × seed)` — by, for each
 * run, cloning the materialised network, drawing the payment workload, and driving each query to a settled
 * lift (discovery → pick a plan → sign-and-settle), then summarising the per-lift commit metrics. See
 * `docs/design.md` § Consensus simulation.
 *
 * ── Sequential, never concurrent (the load-bearing invariant) ───────────────────────────────────────────
 * A committed lift moves `tally.balance` along its route on the ONE kept network, and the next query must
 * see that changed capacity, so the lifts form an ordered sequence: a network balance between two lifts is
 * defined only under a fixed lift order. There is therefore NO concurrent mode here (unlike the discovery
 * runner, whose queries don't mutate shared state) — offering one would make balances order-dependent and
 * the sweep non-deterministic.
 *
 * ── Rebuild the sim PER QUERY ───────────────────────────────────────────────────────────────────────────
 * `InMemoryNetwork` freezes each link's terms from `network.tallies` at construction, so a committed lift's
 * balance change is invisible to an already-built sim. Each query therefore rebuilds `buildSimNetwork` from
 * the current (mutated) network, with a fresh events array + fresh TraceSink. `buildSimNetwork` reseeds its
 * session-code RNG from a fixed constant each build, so session/transaction codes collide across rebuilds —
 * but {@link analyzeLift} reads only this query's events array, filtered by this lift's own transactionCode
 * within it, so collisions never mix lifts. No oracle is needed: the headline is commit÷found, not
 * found÷oracle.
 *
 * ── Seeds (mirror `sim-runner.ts`, plus the two consensus streams) ──────────────────────────────────────
 * Every base seed is offset by the run seed: network via `materializeNetwork`; workload (`workload.seed`);
 * conditions (`(conditionsSeed ?? 0)`); refuser (`(consensusSeed ?? 0)`); identity
 * (`(consensus.identitySeed ?? DEFAULT_CONSENSUS_IDENTITY_SEED)`). The refuser + identity streams are
 * independent of the discovery streams, so failure injection never perturbs which network/queries a run gets.
 */

import { SeededRandom } from 'tallynet/testing'
import type { TraceEvent, TraceSink } from 'tallynet'
import type { CapacityDistribution } from '../distributions.js'
import { type StructuralMetrics } from '../metrics.js'
import { cloneNetwork, type Network } from '../model.js'
import {
	DEFAULT_CONSENSUS_IDENTITY_SEED,
	type ConsensusSpec,
	type NetworkSource,
	type SimScenario,
	type SimSweepSpec,
	type WorkloadSpec,
} from '../scenario.js'
import { connectedComponents, meanDegree } from '../structure.js'
import { cartesian, coordsOf, requireNonEmptyValues, setByPath, type VaryAssignment } from '../sweep-vary.js'
import { materializeNetwork } from '../workload.js'
import type { ConditionsSpec } from './conditions.js'
import { compileConsensusConditions } from './conditions.js'
import { runLiftForOutcome } from './consensus-harness.js'
import { analyzeLift, summarizeConsensusMetrics, type ConsensusLiftMetrics, type ConsensusRunMetrics } from './consensus-metrics.js'
import { makeSimResources, type SimResourceSpec } from './consensus-resource.js'
import { buildSimNetwork, drawPaymentQueries, runQuery, type QuerySpec } from './harness.js'

/** One consensus run's result: resolved sweep coordinates, the run seed, provenance labels, and the metrics. */
export interface ConsensusRunRecord {
	/** Generator id — a materialised network reports its baked `network.meta.generator` (as `SimRunRecord`). */
	generator: string
	/** Capacity-distribution kind (or `'materialized'`). */
	capacity: string
	/** The varied values at this cell, keyed by their `vary` path. */
	params: Record<string, number>
	/** The run seed (one of `spec.seeds`). */
	seed: number
	/** Aggregated consensus metrics for this run. */
	metrics: ConsensusRunMetrics
}

/** Run a consensus sweep, yielding one {@link ConsensusRunRecord} per `(cell × seed)`. Lazy; nothing buffered. */
export async function* runConsensusSweep(spec: SimSweepSpec): AsyncGenerator<ConsensusRunRecord> {
	validateConsensusSweep(spec)
	for (const assignment of cartesian(spec.vary)) {
		const resolved = applyVary(spec.base, assignment)
		const coords = coordsOf(assignment)
		for (const runSeed of spec.seeds) {
			yield await runOne(resolved, coords, runSeed)
		}
	}
}

/** Collect a whole consensus sweep into an array (small sweeps / tests only). */
export async function runConsensusSweepToArray(spec: SimSweepSpec): Promise<ConsensusRunRecord[]> {
	const records: ConsensusRunRecord[] = []
	for await (const record of runConsensusSweep(spec)) {
		records.push(record)
	}
	return records
}

/** Run one resolved scenario at one run seed into a {@link ConsensusRunRecord}. */
async function runOne(scenario: SimScenario, coords: Record<string, number>, runSeed: number): Promise<ConsensusRunRecord> {
	// Clone: lifts mutate `tally.balance` in place on commit, and the kept network is mutated across the run.
	const network = cloneNetwork(materializeNetwork(scenario.network, runSeed))
	const structural = structuralMetrics(network)
	const provenance = {
		generator: 'materialized' in scenario.network ? network.meta.generator : scenario.network.generator,
		capacity: 'materialized' in scenario.network ? 'materialized' : scenario.network.capacity.kind,
		params: coords,
		seed: runSeed,
	}

	if (network.entityCount < 2) {
		// Degenerate (no distinct payment pair ⇒ no query, no lift): a fully-zeroed ConsensusRunMetrics,
		// mirroring the discovery runner's sub-two-entity guard. Structural carries through.
		return { ...provenance, metrics: summarizeConsensusMetrics([], structural, 0) }
	}

	const workloadRng = new SeededRandom(scenario.workload.seed + runSeed)
	const queries = drawPaymentQueries(scenario.workload, network.entityCount, workloadRng)
	const liftMetrics = await runConsensusQueries(network, scenario, queries, runSeed)
	return { ...provenance, metrics: summarizeConsensusMetrics(liftMetrics, structural, queries.length) }
}

/**
 * Drive every query to a settled lift against the one kept (mutated) network, in order. Rebuilds the sim per
 * query (see the module header); a query that finds no route contributes no lift.
 */
async function runConsensusQueries(
	network: Network,
	scenario: SimScenario,
	queries: readonly QuerySpec[],
	runSeed: number,
): Promise<ConsensusLiftMetrics[]> {
	const conditions = scenario.conditions ?? {}
	const conditionsSeed = (scenario.conditionsSeed ?? 0) + runSeed
	const consensus = scenario.consensus ?? {}
	const refuserSeed = (scenario.consensusSeed ?? 0) + runSeed
	const identitySeed = (consensus.identitySeed ?? DEFAULT_CONSENSUS_IDENTITY_SEED) + runSeed

	const refusers = compileConsensusConditions(network, consensus, refuserSeed).refusers
	// Build the resource port ONCE: its handles accumulate observations across lifts, but the shouldPromise
	// gate is stateless/deterministic, so reuse is fine (and keeps the refuser set stable across rebuilds).
	const { resourceFor } = makeSimResources(refuserSpecs(refusers))

	const liftMetrics: ConsensusLiftMetrics[] = []
	// NOTE: rebuild-per-query pays keygen per query; fine for the small grids this tier runs (~50 queries).
	// If a grid grows large, cache the consensus identities / nodes across rebuilds instead of re-deriving.
	for (const query of queries) {
		const events: TraceEvent[] = []
		const sink: TraceSink = (event) => {
			events.push(event)
		}
		const sim = buildSimNetwork(network, conditions, conditionsSeed, sink, scenario.budget, { identitySeed, resourceFor })
		const outcome = await runQuery(sim, query)
		const result = await runLiftForOutcome(sim, network, outcome, query) // mutates network.balance on commit
		if (result) {
			liftMetrics.push(analyzeLift(events, result))
		}
	}
	return liftMetrics
}

/** Turn a refuser id set into `{ shouldPromise: false }` specs for {@link makeSimResources}. */
function refuserSpecs(refusers: Set<number>): Record<number, SimResourceSpec> {
	const specs: Record<number, SimResourceSpec> = {}
	for (const id of refusers) {
		specs[id] = { shouldPromise: false }
	}
	return specs
}

/** Structural metrics (one per network): actual mean degree and largest-component fraction. */
function structuralMetrics(network: Network): StructuralMetrics {
	return { meanDegree: meanDegree(network), largestComponentFraction: connectedComponents(network).largestFraction }
}

// ── Sweep plumbing: duplicated from sim-runner.ts (private there) + consensus fields, to keep the pinned ──
// ── byte-identical discovery sweep untouched. See the ticket's note on the deliberate duplication.      ──

/** Reject a malformed spec fast. Mirrors `sim-runner.ts`'s `validateSimSweep`. */
function validateConsensusSweep(spec: SimSweepSpec): void {
	if (!Array.isArray(spec.seeds) || spec.seeds.length === 0) {
		throw new Error('consensus sweep: `seeds` must be a non-empty array')
	}
	requireNonEmptyValues(spec.vary)
	if ('materialized' in spec.base.network) {
		for (const dim of spec.vary) {
			if (!dim.path.startsWith('workload.') && !dim.path.startsWith('conditions.') && !dim.path.startsWith('consensus.')) {
				throw new Error(`consensus sweep: vary path "${dim.path}" must target workload./conditions./consensus.* for a materialized network`)
			}
		}
	}
}

/** Clone the base scenario and set each cell's varied values. */
function applyVary(base: SimScenario, assignment: readonly VaryAssignment[]): SimScenario {
	const scenario = cloneSimScenario(base)
	for (const { path, value } of assignment) {
		setByPath(scenario, path, value)
	}
	return scenario
}

/** A SimScenario clone deep enough to set varied leaves without touching the base — plus the consensus fields. */
function cloneSimScenario(scenario: SimScenario): SimScenario {
	const network: NetworkSource =
		'materialized' in scenario.network
			? { materialized: scenario.network.materialized }
			: {
					generator: scenario.network.generator,
					params: { ...scenario.network.params },
					capacity: cloneCapacity(scenario.network.capacity),
					seed: scenario.network.seed,
				}
	const workload: WorkloadSpec = {
		...scenario.workload,
		amount: { dist: scenario.workload.amount.dist, params: { ...scenario.workload.amount.params } },
		metrics: scenario.workload.metrics ? [...scenario.workload.metrics] : undefined,
	}
	const clone: SimScenario = { network, workload }
	if (scenario.conditions !== undefined) {
		clone.conditions = cloneConditions(scenario.conditions)
	}
	if (scenario.budget !== undefined) {
		clone.budget = { ...scenario.budget }
	}
	if (scenario.conditionsSeed !== undefined) {
		clone.conditionsSeed = scenario.conditionsSeed
	}
	if (scenario.consensus !== undefined) {
		clone.consensus = cloneConsensus(scenario.consensus)
	}
	if (scenario.consensusSeed !== undefined) {
		clone.consensusSeed = scenario.consensusSeed
	}
	return clone
}

/** Clone a consensus spec one level deep so a varied leaf (e.g. `consensus.refuserFraction`) is isolated. */
function cloneConsensus(consensus: ConsensusSpec): ConsensusSpec {
	return { ...consensus }
}

/** Clone a conditions spec one level deep (its nested `latency` too). */
function cloneConditions(conditions: ConditionsSpec): ConditionsSpec {
	const clone: ConditionsSpec = { ...conditions }
	if (conditions.latency !== undefined) {
		clone.latency = { ...conditions.latency }
	}
	return clone
}

/** Type-preserving clone of a capacity distribution. */
function cloneCapacity(cap: CapacityDistribution): CapacityDistribution {
	switch (cap.kind) {
		case 'unlimited': {
			return { kind: 'unlimited' }
		}
		case 'constant': {
			return cap.balance !== undefined ? { kind: 'constant', limit: cap.limit, balance: cap.balance } : { kind: 'constant', limit: cap.limit }
		}
		case 'uniform': {
			return cap.randomizeBalance !== undefined
				? { kind: 'uniform', min: cap.min, max: cap.max, randomizeBalance: cap.randomizeBalance }
				: { kind: 'uniform', min: cap.min, max: cap.max }
		}
		case 'lognormal': {
			return cap.randomizeBalance !== undefined
				? { kind: 'lognormal', mu: cap.mu, sigma: cap.sigma, randomizeBalance: cap.randomizeBalance }
				: { kind: 'lognormal', mu: cap.mu, sigma: cap.sigma }
		}
	}
}
