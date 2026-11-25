/**
 * The sweep runner: turns a {@link SweepSpec} into a stream of {@link RunRecord}s. For each sweep cell (one
 * combination of the varied values) and each seed, it materialises the network, draws a random workload from
 * a seeded PRNG, runs the oracle per query, aggregates the metrics (`metrics.ts`), and yields **one record
 * per run**. It is a **generator** that touches no filesystem — the CLI (`cli/sweep.ts`) drives it for file
 * output, and the browser viewer can drive the same code live in a page. See `docs/design.md` § Runner.
 *
 * ── Seeds ────────────────────────────────────────────────────────────────────────────────────────────
 * Three independent reproducible streams per run, each a separate {@link SeededRandom}: the **network** seed
 * (graph generation), the **workload** seed (query pairs + amounts), and the **economy** seed (the trading
 * seam). Repeating a cell over `spec.seeds` offsets all three by the run seed, so every run is distinct yet
 * the whole sweep replays byte-for-byte from the spec. Network and workload seeds are both honoured and stay
 * independent (distinct base seeds + distinct derived streams).
 *
 * ── The economy seam ─────────────────────────────────────────────────────────────────────────────────
 * Each run calls `economyStep.step(network, rng)` once, before the graph view is built, as the place a future
 * trading model advances balances between query batches. The default {@link noOpEconomyStep} does nothing, so
 * this tier runs every tally square. See `feat-tallysim-trading-model`.
 */

import { SeededRandom } from 'tallynet/testing'
import type { CapacityDistribution } from './distributions.js'
import { buildGraphView } from './graph-view.js'
import {
	summarizeClearingMetrics,
	summarizePaymentMetrics,
	type ClearingQueryResult,
	type PaymentQueryResult,
	type RunMetrics,
	type StructuralMetrics,
} from './metrics.js'
import type { Network } from './model.js'
import { Oracle } from './oracle.js'
import {
	MAX_FLOW_METRIC,
	noOpEconomyStep,
	DEFAULT_CLEARING_MAX_COUNT,
	DEFAULT_MAX_FLOW_SAMPLES,
	type EconomyStep,
	type NetworkSource,
	type ScenarioSpec,
	type SweepSpec,
	type WorkloadSpec,
} from './scenario.js'
import { connectedComponents, meanDegree } from './structure.js'
import { cartesian, coordsOf, requireNonEmptyValues, setByPath, type VaryAssignment } from './sweep-vary.js'
import { drawAmount, drawPaymentPair, materializeNetwork } from './workload.js'

/** One run's result: resolved sweep coordinates, the run seed, provenance labels, and the metrics. */
export interface RunRecord {
	/** Generator id (or `'materialized'` for a pre-built network). */
	generator: string
	/** Capacity-distribution kind (or `'materialized'`), so a combined CSV is self-describing. */
	capacity: string
	/** The varied values at this cell, keyed by their `vary` path (the sweep coordinates). */
	params: Record<string, number>
	/** The run seed (one of `spec.seeds`). */
	seed: number
	/** Aggregated metrics for this run. */
	metrics: RunMetrics
}

/** Dependencies a caller can inject; all optional. */
export interface RunnerDeps {
	/** The economy seam. Defaults to {@link noOpEconomyStep}. */
	economyStep?: EconomyStep
}

/** A distinct offset so the economy stream never coincides with the workload stream seeded from the same run. */
const ECONOMY_SEED_OFFSET = 1_000_003

/**
 * Run a sweep, yielding one {@link RunRecord} per (cell × seed). Lazy: nothing is computed until the caller
 * pulls a record, and no record is retained — a large sweep streams without buffering.
 */
export function* runSweep(spec: SweepSpec, deps: RunnerDeps = {}): Generator<RunRecord> {
	validateSweep(spec)
	const economyStep = deps.economyStep ?? noOpEconomyStep
	for (const assignment of cartesian(spec.vary)) {
		const resolved = applyVary(spec.base, assignment)
		const coords = coordsOf(assignment)
		for (const runSeed of spec.seeds) {
			yield runOne(resolved, coords, runSeed, economyStep)
		}
	}
}

/** Convenience wrapper that collects a whole sweep into an array (small sweeps / tests only). */
export function runSweepToArray(spec: SweepSpec, deps: RunnerDeps = {}): RunRecord[] {
	return [...runSweep(spec, deps)]
}

/** Run one resolved scenario at one run seed into a {@link RunRecord}. */
function runOne(
	scenario: ScenarioSpec,
	coords: Record<string, number>,
	runSeed: number,
	economyStep: EconomyStep,
): RunRecord {
	const network = materializeNetwork(scenario.network, runSeed)

	// Economy seam (no-op by default): advance balances before the batch. Its own stream, distinct from
	// the workload's. A real trading model mutating `network` must not share a materialised input across
	// runs — see the NOTE in materializeNetwork.
	economyStep.step(network, new SeededRandom(scenario.workload.seed + runSeed + ECONOMY_SEED_OFFSET))

	const oracle = new Oracle(buildGraphView(network))
	const structural = structuralMetrics(network)
	// NOTE: network and workload streams are independent only when the spec gives them distinct base seeds.
	// If a spec sets network.seed === workload.seed, both SeededRandoms start from the same state and the
	// draws correlate. Every checked-in spec uses distinct seeds; if that stops holding, offset the network
	// seed here the way ECONOMY_SEED_OFFSET separates the economy stream.
	const workloadRng = new SeededRandom(scenario.workload.seed + runSeed)
	const metrics =
		scenario.workload.kind === 'payment'
			? runPaymentWorkload(oracle, network.entityCount, scenario.workload, workloadRng, structural)
			: runClearingWorkload(oracle, network.entityCount, scenario.workload, workloadRng, structural)

	return {
		generator: 'materialized' in scenario.network ? network.meta.generator : scenario.network.generator,
		capacity: 'materialized' in scenario.network ? 'materialized' : scenario.network.capacity.kind,
		params: coords,
		seed: runSeed,
		metrics,
	}
}

/** Structural metrics (one per network): actual mean degree and largest-component fraction. */
function structuralMetrics(network: Network): StructuralMetrics {
	return {
		meanDegree: meanDegree(network),
		largestComponentFraction: connectedComponents(network).largestFraction,
	}
}

/** Draw and run a payment (route-existence) workload; optionally sample max-flow over the drawn pairs. */
function runPaymentWorkload(
	oracle: Oracle,
	entityCount: number,
	workload: WorkloadSpec,
	rng: SeededRandom,
	structural: StructuralMetrics,
): RunMetrics {
	const results: PaymentQueryResult[] = []
	const pairs: [number, number][] = []
	for (let i = 0; i < workload.queries; i++) {
		if (entityCount < 2) {
			// No distinct (X, Y) pair exists; count it as "no route" (P contribution 0, never NaN).
			results.push({ exists: false })
			continue
		}
		const [from, to] = drawPaymentPair(entityCount, rng)
		const amount = drawAmount(workload.amount, rng)
		pairs.push([from, to])
		const result = oracle.routeExistence(from, to, amount, workload.depth)
		results.push(result.exists ? { exists: true, shortestLength: result.shortestLength } : { exists: false })
	}

	let maxFlows: number[] | undefined
	if (wantsMaxFlow(workload)) {
		maxFlows = []
		const sampleCount = Math.min(pairs.length, workload.maxFlowSamples ?? DEFAULT_MAX_FLOW_SAMPLES)
		for (let i = 0; i < sampleCount; i++) {
			const [from, to] = pairs[i]
			maxFlows.push(oracle.maxFlow(from, to))
		}
	}
	return summarizePaymentMetrics(results, structural, maxFlows)
}

/** Draw and run a clearing (circular-clearing availability) workload over random sampled nodes. */
function runClearingWorkload(
	oracle: Oracle,
	entityCount: number,
	workload: WorkloadSpec,
	rng: SeededRandom,
	structural: StructuralMetrics,
): RunMetrics {
	const maxCount = workload.clearingMaxCount ?? DEFAULT_CLEARING_MAX_COUNT
	const results: ClearingQueryResult[] = []
	for (let i = 0; i < workload.queries; i++) {
		if (entityCount < 1) {
			results.push({ hasCycle: false })
			continue
		}
		const node = rng.nextInt(entityCount)
		const amount = drawAmount(workload.amount, rng)
		const result = oracle.clearingCycles(node, amount, workload.depth, maxCount)
		results.push(result.count > 0 ? { hasCycle: true, shortestLength: result.shortestLength } : { hasCycle: false })
	}
	return summarizeClearingMetrics(results, structural)
}

/** Whether a workload opted into max-flow. */
function wantsMaxFlow(workload: WorkloadSpec): boolean {
	return workload.metrics?.includes(MAX_FLOW_METRIC) ?? false
}

/** Light validation so a malformed spec fails fast with a clear message rather than deep in a draw. */
function validateSweep(spec: SweepSpec): void {
	if (!Array.isArray(spec.seeds) || spec.seeds.length === 0) {
		throw new Error('sweep: `seeds` must be a non-empty array')
	}
	requireNonEmptyValues(spec.vary)
	// A materialised network is shared by reference across cells (cloneScenario does not deep-clone it), so a
	// vary path reaching into `network.*` would mutate that shared object. Such a scenario must vary only
	// `workload.*`; reject any other path up front with a clear message rather than corrupting shared state.
	if ('materialized' in spec.base.network) {
		for (const dim of spec.vary) {
			if (!dim.path.startsWith('workload.')) {
				throw new Error(`sweep: vary path "${dim.path}" must target workload.* for a materialized network`)
			}
		}
	}
}

/** Clone the base scenario and set each cell's varied values; the clone keeps a materialised network by ref. */
function applyVary(base: ScenarioSpec, assignment: readonly VaryAssignment[]): ScenarioSpec {
	const scenario = cloneScenario(base)
	for (const { path, value } of assignment) {
		setByPath(scenario, path, value)
	}
	return scenario
}

/**
 * A scenario clone deep enough to set varied leaves without touching the base. A materialised {@link Network}
 * is kept **by reference** (not deep-cloned): vary paths for a materialised scenario must target `workload.*`
 * — {@link setByPath} throws before it could reach into the shared network.
 */
function cloneScenario(scenario: ScenarioSpec): ScenarioSpec {
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
	return { network, workload }
}

/** Type-preserving clone of a capacity distribution (so a vary path may target e.g. `network.capacity.limit`). */
function cloneCapacity(cap: CapacityDistribution): CapacityDistribution {
	switch (cap.kind) {
		case 'unlimited': {
			return { kind: 'unlimited' }
		}
		case 'constant': {
			return cap.balance !== undefined
				? { kind: 'constant', limit: cap.limit, balance: cap.balance }
				: { kind: 'constant', limit: cap.limit }
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
