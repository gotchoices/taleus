/**
 * The discovery sweep runner: turns a {@link SimSweepSpec} into a stream of {@link SimRunRecord}s, mirroring
 * the oracle sweep runner (`runner.ts`). For each sweep cell (one combination of varied values) and each
 * seed it materialises the network, builds the all-seeing oracle on the **full** (undegraded) network, draws
 * a random payment workload, runs the real `tallynet` route-discovery protocol over a simulated network on
 * compressed time, pairs each query's trace + outcome with the oracle's verdict (`protocol-metrics.ts`), and
 * yields **one record per run**. See `docs/design.md` § Discovery simulation.
 *
 * Unlike the oracle runner (synchronous BFS), this one is an **`async` generator**: settling a query means
 * awaiting `clock.runUntilIdle()`, so the whole sweep is async. It touches no filesystem — the CLI
 * (sibling io ticket) drives it for file output; a browser viewer can drive the same code live.
 *
 * ── Seeds (mirror the oracle runner's three-stream scheme) ──────────────────────────────────────────────
 * Each run offsets every base seed by the run seed so every run is distinct yet the whole sweep replays
 * byte-for-byte: the **network** seed via `materializeNetwork` (`network.seed + runSeed`), the **workload**
 * seed (`workload.seed + runSeed`), and the **conditions** seed (`(conditionsSeed ?? 0) + runSeed`).
 *
 * ── Sequential vs concurrent (a runner dep, not a scenario field) ───────────────────────────────────────
 * Sequential (default) issues and settles one query at a time; concurrent issues every query (session codes
 * mint in call order → deterministic) before a single `runUntilIdle()`. Both agree on the **outcome** metrics
 * (found, messages, nodes-touched, prune reasons, `pFoundGivenExists`) and both are byte-deterministic within
 * their mode. They do **NOT** agree on `roundsUsed` or the timing distributions: concurrent queries share one
 * `VirtualClock`, so a round's budget-expiry races a sub-request's delivery at equal timestamps, and the
 * shared global fire-order counter interleaves across sessions — a late answer that folds into round N
 * sequentially can fold into round N−1 concurrently, shifting rounds and times. This is a known limitation,
 * not a measurement artefact fixable here; use sequential mode for round/timing-sensitive metrics. See
 * `tickets/fix/tallysim-sim-runner-concurrent-divergence`. `concurrent` lives on {@link SimRunnerDeps}, never
 * on {@link SimScenario} (which is embedded verbatim in trace headers).
 */

import { SeededRandom } from 'tallynet/testing'
import type { TraceEvent, TraceSink } from 'tallynet'
import type { CapacityDistribution } from '../distributions.js'
import { buildGraphView } from '../graph-view.js'
import { type StructuralMetrics } from '../metrics.js'
import type { Network } from '../model.js'
import { Oracle } from '../oracle.js'
import type { NetworkSource, SimScenario, SimSweepSpec, WorkloadSpec } from '../scenario.js'
import { connectedComponents, meanDegree } from '../structure.js'
import { cartesian, coordsOf, requireNonEmptyValues, setByPath, type VaryAssignment } from '../sweep-vary.js'
import { materializeNetwork } from '../workload.js'
import type { ConditionsSpec } from './conditions.js'
import { buildSimNetwork, drawPaymentQueries, issueQuery, type QueryOutcome, type QuerySpec } from './harness.js'
import {
	analyzeQuery,
	summarizeProtocolMetrics,
	zeroPruneReasons,
	type ProtocolQueryResult,
	type ProtocolRunMetrics,
} from './protocol-metrics.js'

/** One discovery run's result: resolved sweep coordinates, the run seed, provenance labels, and the metrics. */
export interface SimRunRecord {
	/** Generator id — for a materialised network this is its baked `network.meta.generator`, not the literal
	 * `'materialized'`. (`capacity`, below, *does* report `'materialized'`.) Same provenance shape as `RunRecord`. */
	generator: string
	/** Capacity-distribution kind (or `'materialized'`). */
	capacity: string
	/** The varied values at this cell, keyed by their `vary` path (the sweep coordinates). */
	params: Record<string, number>
	/** The run seed (one of `spec.seeds`). */
	seed: number
	/** Aggregated protocol metrics for this run. */
	metrics: ProtocolRunMetrics
}

/** Dependencies a caller can inject; all optional. */
export interface SimRunnerDeps {
	/** Issue every query before one `runUntilIdle()` (default `false` ⇒ one query at a time). */
	concurrent?: boolean
}

/**
 * Run a discovery sweep, yielding one {@link SimRunRecord} per `(cell × seed)`. Lazy: nothing is computed
 * until the caller pulls a record, and no record is retained — a large sweep streams without buffering.
 */
export async function* runSimSweep(spec: SimSweepSpec, deps: SimRunnerDeps = {}): AsyncGenerator<SimRunRecord> {
	validateSimSweep(spec)
	const concurrent = deps.concurrent ?? false
	for (const assignment of cartesian(spec.vary)) {
		const resolved = applyVary(spec.base, assignment)
		const coords = coordsOf(assignment)
		for (const runSeed of spec.seeds) {
			yield await runOne(resolved, coords, runSeed, concurrent)
		}
	}
}

/** Convenience wrapper that collects a whole sweep into an array (small sweeps / tests only). */
export async function runSimSweepToArray(spec: SimSweepSpec, deps?: SimRunnerDeps): Promise<SimRunRecord[]> {
	const records: SimRunRecord[] = []
	for await (const record of runSimSweep(spec, deps)) {
		records.push(record)
	}
	return records
}

/** Run one resolved scenario at one run seed into a {@link SimRunRecord}. */
async function runOne(
	scenario: SimScenario,
	coords: Record<string, number>,
	runSeed: number,
	concurrent: boolean,
): Promise<SimRunRecord> {
	const network = materializeNetwork(scenario.network, runSeed)
	// Oracle on the FULL, undegraded network: conditions degrade only the protocol run, never ground truth.
	const oracle = new Oracle(buildGraphView(network))
	const structural = structuralMetrics(network)
	const workload = scenario.workload

	// NOTE: network and workload streams are independent only when the spec gives them distinct base seeds.
	// If a spec sets network.seed === workload.seed, both SeededRandoms start from the same state and the
	// draws correlate. Every checked-in spec uses distinct seeds; if that stops holding, offset the network
	// seed the way the oracle runner notes for ECONOMY_SEED_OFFSET.
	const workloadRng = new SeededRandom(workload.seed + runSeed)
	const queries = drawPaymentQueries(workload, network.entityCount, workloadRng)

	const results =
		network.entityCount < 2
			? // Degenerate: no SimNetwork, no queries drawn; emit workload.queries degenerate results (the
				// same guard the oracle runner uses for a sub-two-entity network).
				Array.from({ length: workload.queries }, () => degenerateResult())
			: await runProtocolQueries(network, scenario, queries, oracle, runSeed, concurrent)

	return {
		generator: 'materialized' in scenario.network ? network.meta.generator : scenario.network.generator,
		capacity: 'materialized' in scenario.network ? 'materialized' : scenario.network.capacity.kind,
		params: coords,
		seed: runSeed,
		metrics: summarizeProtocolMetrics(results, structural),
	}
}

/**
 * Build one simulated network, run every query on it (sequential or concurrent), and analyse each against
 * the oracle. A single in-memory {@link TraceSink} collects every event; {@link analyzeQuery} filters by
 * session code, so one shared array serves both modes.
 */
async function runProtocolQueries(
	network: Network,
	scenario: SimScenario,
	queries: readonly QuerySpec[],
	oracle: Oracle,
	runSeed: number,
	concurrent: boolean,
): Promise<ProtocolQueryResult[]> {
	const events: TraceEvent[] = []
	const sink: TraceSink = (event) => {
		events.push(event)
	}
	// Conditions get their own run-offset stream, independent of the network / workload seeds.
	const conditionsSeed = (scenario.conditionsSeed ?? 0) + runSeed
	const sim = buildSimNetwork(network, scenario.conditions ?? {}, conditionsSeed, sink, scenario.budget)

	const windows: { outcome: QueryOutcome; startMs: number; endMs: number }[] = []
	// NOTE: concurrent and sequential modes agree on outcome metrics but NOT on roundsUsed/timing — the
	// shared clock makes round progression race sub-request delivery (see the module header and
	// tickets/fix/tallysim-sim-runner-concurrent-divergence). The shared `startMs`/`endMs` here is the window
	// for a session with zero events; today every session emits ≥ 1 event (the originator's own participant
	// emits `query-received` on entrance), so analyzeQuery reads each session's own last-event time.
	if (concurrent) {
		// One start instant for all queries; issue in query order (session codes mint in call order →
		// deterministic), settle once, then read a single end instant.
		const startMs = sim.net.clock.now()
		const pending = queries.map((query) => issueQuery(sim, query))
		await sim.net.clock.runUntilIdle()
		const outcomes = await Promise.all(pending)
		const endMs = sim.net.clock.now()
		for (const outcome of outcomes) {
			windows.push({ outcome, startMs, endMs })
		}
	} else {
		for (const query of queries) {
			const startMs = sim.net.clock.now()
			const pending = issueQuery(sim, query)
			await sim.net.clock.runUntilIdle()
			const outcome = await pending
			windows.push({ outcome, startMs, endMs: sim.net.clock.now() })
		}
	}

	// NOTE: route discovery is ~O(network) per query, far costlier than the oracle's bounded BFS. If a sweep
	// ever needs large N, record only sampled queries and/or cap concurrency rather than running every pair.
	return queries.map((query, index) => {
		const { outcome, startMs, endMs } = windows[index]
		const routeExists = oracle.routeExistence(query.from, query.to, query.amount, query.depth).exists
		return analyzeQuery(events, outcome, routeExists, { startMs, endMs })
	})
}

/** A degenerate result for a sub-two-entity network: everything zeroed, no first-plan time, no throw. */
function degenerateResult(): ProtocolQueryResult {
	return {
		routeExists: false,
		found: false,
		plansFound: 0,
		timeToCompletionMs: 0,
		messages: 0,
		nodesTouched: 0,
		roundsUsed: 0,
		pruneReasons: zeroPruneReasons(),
	}
}

/** Structural metrics (one per network): actual mean degree and largest-component fraction. */
function structuralMetrics(network: Network): StructuralMetrics {
	return {
		meanDegree: meanDegree(network),
		largestComponentFraction: connectedComponents(network).largestFraction,
	}
}

/**
 * Light validation so a malformed spec fails fast with a clear message. Mirrors the oracle runner: a
 * non-empty seeds array, non-empty `vary` values, and — because a materialised network is shared by
 * reference across cells — a vary path reaching outside `workload.*` is rejected for a materialised network.
 */
function validateSimSweep(spec: SimSweepSpec): void {
	if (!Array.isArray(spec.seeds) || spec.seeds.length === 0) {
		throw new Error('sim sweep: `seeds` must be a non-empty array')
	}
	requireNonEmptyValues(spec.vary)
	if ('materialized' in spec.base.network) {
		for (const dim of spec.vary) {
			if (!dim.path.startsWith('workload.')) {
				throw new Error(`sim sweep: vary path "${dim.path}" must target workload.* for a materialized network`)
			}
		}
	}
}

/** Clone the base scenario and set each cell's varied values; the clone keeps a materialised network by ref. */
function applyVary(base: SimScenario, assignment: readonly VaryAssignment[]): SimScenario {
	const scenario = cloneSimScenario(base)
	for (const { path, value } of assignment) {
		setByPath(scenario, path, value)
	}
	return scenario
}

/**
 * A {@link SimScenario} clone deep enough to set varied leaves without touching the base. A materialised
 * {@link Network} is kept **by reference** (not deep-cloned): vary paths for a materialised scenario must
 * target `workload.*`, so {@link setByPath} throws before it could reach into the shared network. Optional
 * conditions / budget are cloned one level deep (their leaves are the plausible vary targets).
 */
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
	return clone
}

/** Clone a conditions spec one level deep (its nested `latency` object too), so a varied leaf is isolated. */
function cloneConditions(conditions: ConditionsSpec): ConditionsSpec {
	const clone: ConditionsSpec = { ...conditions }
	if (conditions.latency !== undefined) {
		clone.latency = { ...conditions.latency }
	}
	return clone
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
