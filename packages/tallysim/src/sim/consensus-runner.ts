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
import { MemberTypes, type DependentMember, type DiscoveryHooks, type MemberType, type ScorePlan, type TraceEvent, type TraceSink } from 'tallynet'
import type { CapacityDistribution } from '../distributions.js'
import { type StructuralMetrics } from '../metrics.js'
import { cloneNetwork, type Network } from '../model.js'
import {
	DEFAULT_CONSENSUS_IDENTITY_SEED,
	type ConsensusSpec,
	type NetworkSource,
	type RouteShape,
	type SimScenario,
	type SimSweepSpec,
	type WorkloadSpec,
} from '../scenario.js'
import { connectedComponents, meanDegree } from '../structure.js'
import { cartesian, coordsOf, requireNonEmptyValues, setByPath, type VaryAssignment } from '../sweep-vary.js'
import { materializeNetwork } from '../workload.js'
import type { CompiledConsensusConditions, ConditionsSpec } from './conditions.js'
import { compileConsensusConditions } from './conditions.js'
import { runLiftForOutcome, type RunLiftOptions } from './consensus-harness.js'
import { analyzeLift, summarizeConsensusMetrics, type ConsensusLiftMetrics, type ConsensusRunMetrics } from './consensus-metrics.js'
import { makeSimResources, refusesStackedVoterSet, type SimResourceSpec, type StackedVoterPolicy } from './consensus-resource.js'
import { buildCircularOutcome } from './route.js'
import { voterAwareScorePlan } from './plan-select.js'
import type { LiftTerms } from './terms.js'
import { makeNomineesFor, wellKnownEntities } from './well-known.js'
import {
	buildSimNetwork,
	drawCircularOrigins,
	drawPaymentQueries,
	runQuery,
	type ConsensusConfig,
	type QueryOutcome,
	type QuerySpec,
	type SimNetwork,
} from './harness.js'

const VOTER: MemberType = MemberTypes.voter

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

	const routeShape: RouteShape = scenario.consensus?.routeShape ?? 'linear'
	const workloadRng = new SeededRandom(scenario.workload.seed + runSeed)
	// Linear draws distinct pairs and lifts the line route; circular draws a single origin per query and lifts
	// the shortest cycle back to it (the clearing-discovery stand-in — see `resolveOutcome` / `buildCircularOutcome`).
	const queries =
		routeShape === 'circular'
			? drawCircularOrigins(scenario.workload, network.entityCount, workloadRng)
			: drawPaymentQueries(scenario.workload, network.entityCount, workloadRng)
	const { liftMetrics, planRefusalCount } = await runConsensusQueries(network, scenario, queries, routeShape, runSeed)
	return { ...provenance, metrics: summarizeConsensusMetrics(liftMetrics, structural, queries.length, planRefusalCount) }
}

/**
 * Drive every query to a settled lift against the one kept (mutated) network, in order. Rebuilds the sim per
 * query (see the module header); a query that finds no route contributes no lift.
 */
async function runConsensusQueries(
	network: Network,
	scenario: SimScenario,
	queries: readonly QuerySpec[],
	routeShape: RouteShape,
	runSeed: number,
): Promise<{ liftMetrics: ConsensusLiftMetrics[]; planRefusalCount: number }> {
	const conditions = scenario.conditions ?? {}
	const conditionsSeed = (scenario.conditionsSeed ?? 0) + runSeed
	// Compile the failure sets ONCE per run on the dedicated consensus seed, then build BOTH the shared
	// network config (refuser/non-relayer/silent ports + the voter-model wiring) and the per-lift
	// `nonCooperating` exclusion from the SAME compiled selection — so the network injection and the pull-pass
	// exclusion cannot diverge. The config is reused across the per-query rebuilds (its gates are stateless/
	// deterministic), keeping the failure sets stable; `wiring.planRefusals` is the ONE mutable cell the
	// counting scorer accumulates into across every rebuild.
	const compiled = compileConsensusConditions(network, scenario.consensus ?? {}, (scenario.consensusSeed ?? 0) + runSeed)
	const wiring = consensusWiring(scenario, network, compiled, runSeed)
	const consensus = wiring.config
	const nonCooperating = [...compiled.nonRelayers, ...compiled.silent]
	const consensusMethod = scenario.consensus?.consensusMethod
	// Hoisted once: the per-lift options never change across queries (only the query does). `consensusMethod`
	// and `wellKnown` are spread only when set, so a run without them passes exactly the pre-existing options.
	const liftOptions: RunLiftOptions = {
		contactPoints: scenario.consensus?.contactPoints ?? false,
		nonCooperating,
		...(consensusMethod ? { consensusMethod } : {}),
		...(wiring.wellKnown ? { wellKnown: wiring.wellKnown } : {}),
	}

	const liftMetrics: ConsensusLiftMetrics[] = []
	// NOTE: rebuild-per-query pays keygen per query; fine for the small grids this tier runs (~50 queries).
	// If a grid grows large, cache the consensus identities / nodes across rebuilds instead of re-deriving.
	for (const query of queries) {
		const events: TraceEvent[] = []
		const sink: TraceSink = (event) => {
			events.push(event)
		}
		const sim = buildSimNetwork(network, conditions, conditionsSeed, sink, scenario.budget, consensus)
		const outcome = await resolveOutcome(sim, network, query, routeShape)
		if (!outcome) {
			continue // a circular origin on no cycle contributes no lift
		}
		// mutates network.balance on commit; contactPoints + nonCooperating turn on record-availability recovery
		const result = await runLiftForOutcome(sim, network, outcome, query, liftOptions)
		if (result) {
			liftMetrics.push(analyzeLift(events, result))
		}
	}
	return { liftMetrics, planRefusalCount: wiring.planRefusals.count }
}

/**
 * Resolve one query to the {@link QueryOutcome} its lift runs over.
 *
 * - **linear** — ordinary discovery: {@link runQuery} finds the line route `from → to`.
 * - **circular** — mint a real session code with a self-query (whose discovery plans may be empty — that is
 *   expected), then build the shortest simple cycle through `query.from` straight from the graph
 *   ({@link buildCircularOutcome}), the clearing-discovery stand-in. `undefined` when the origin lies on no
 *   cycle, so the caller skips it (no lift). The self-query still runs real discovery, so a circular run with
 *   nomination/stacked wiring replays its discovery identically to a trace even though the taken route comes
 *   from the graph.
 */
async function resolveOutcome(
	sim: SimNetwork,
	network: Network,
	query: QuerySpec,
	routeShape: RouteShape,
): Promise<QueryOutcome | undefined> {
	if (routeShape === 'circular') {
		const base = await runQuery(sim, query)
		return buildCircularOutcome(network, base.sessionCode, query.from)
	}
	return runQuery(sim, query)
}

/**
 * Build the {@link ConsensusConfig} a scenario's consensus phase runs under: the identity seed (offset by the
 * run seed) and a resource port whose refusers are drawn from the dedicated consensus (refuser-selection)
 * stream — independent of the discovery streams, so failure injection never perturbs which network/queries a
 * run gets. Shared by this sweep runner and the trace recorder (`cli/trace.ts`), so both derive the **same**
 * identities + refusers for a given `(scenario, runSeed)`.
 */
export function consensusConfigFor(scenario: SimScenario, network: Network, runSeed: number): ConsensusConfig {
	const refuserSeed = (scenario.consensusSeed ?? 0) + runSeed
	const compiled = compileConsensusConditions(network, scenario.consensus ?? {}, refuserSeed)
	return consensusWiring(scenario, network, compiled, runSeed).config
}

/**
 * The full consensus wiring for a run: the base {@link ConsensusConfig} plus the voter-model layers the
 * sweep runner also needs to read back — the shared well-known set (so a lift's voter-aware pick matches the
 * scorer) and the mutable `planRefusals` cell the counting scorer accumulates into. `consensusConfigFor` (the
 * trace recorder) uses only `.config`; the sweep runner uses all three.
 */
interface ConsensusWiring {
	config: ConsensusConfig
	/** The one mutable cell the counting refusal scorer increments — shared across every per-query rebuild. */
	planRefusals: { count: number }
	/** The well-known entity set (only when `voterNomination === 'well-known'`); passed on to each lift. */
	wellKnown?: Set<number>
}

/**
 * Build the {@link ConsensusWiring} for a run from an already-compiled failure selection. Starts from the
 * base config ({@link consensusConfigFromCompiled} — identity + refuser/non-relayer/silent ports) and layers
 * on the voter-model knobs:
 *
 * - **`voterNomination: 'well-known'`** — derive the well-known (high-degree) set, nominate the one hub as an
 *   off-route `[V]` referee (`nomineesFor`), and score plans voter-aware (`scorePlan`).
 * - **`stackedVoters > 0`** — staple that many obscure referees onto every plan an even-id node folds into
 *   (`negotiatePlanFor`) and **override** the scorer with one that refuses (drops, `-Infinity`) any stacked
 *   plan, counting each refusal into `planRefusals`.
 *
 * `'self'` nomination needs no wiring — the default `voters: [route[0]]` already makes the originator the
 * sole `[P, V]` voter. A run with none of these knobs returns exactly the base config (no new keys), so the
 * existing refuser/stalled/all-cooperative runs stay byte-identical.
 */
function consensusWiring(scenario: SimScenario, network: Network, compiled: CompiledConsensusConditions, runSeed: number): ConsensusWiring {
	const config = consensusConfigFromCompiled(scenario, compiled, runSeed)
	const planRefusals = { count: 0 }
	let wellKnown: Set<number> | undefined
	if (scenario.consensus?.voterNomination === 'well-known') {
		// NOTE: recomputes the degree sequence every run (once, here). Fine for the small grids this tier runs;
		// if a grid grows large, cache the well-known set per network across runs instead of re-deriving it.
		wellKnown = wellKnownEntities(network, scenario.consensus?.wellKnownFraction ?? 0)
		config.nomineesFor = makeNomineesFor(network, wellKnown, 'well-known')
		config.scorePlan = voterAwareScorePlan(wellKnown)
	}
	const stackedVoters = scenario.consensus?.stackedVoters ?? 0
	if (stackedVoters > 0) {
		config.negotiatePlanFor = stackingNegotiateFor(stackedVoters)
		// Override any voter-aware scorer: the counting scorer still ranks lean plans voter-aware, but drops a
		// stacked plan (returns -Infinity, which the originator's `rankPlans` filters out) and counts it.
		config.scorePlan = countingRefusalScorer(wellKnown ?? new Set(), planRefusals)
	}
	return { config, planRefusals, wellKnown }
}

/**
 * The per-node discovery gate for a `stackedVoters` run: **every** node staples `count` obscure referees onto
 * every plan it folds into (keyed by its own id, so no two nodes' staples collide). This is the maximal-padding
 * model — a route of `L` processed hops accrues `L · count` obscure referees — so every discovered plan is
 * stacked and reliably refused by the counting scorer.
 *
 * Why every node, not a subset (e.g. even ids): a plan is only ever vetted by the nodes that **process** it,
 * and the payee never does — discovery peer-matches the terminus from its neighbour, so the payee's
 * `negotiatePlan` never runs. A subset staple therefore leaves any single-hop route whose only subset member
 * is the (un-processed) payee un-stapled, letting that lift escape refusal. Stapling on every node closes that
 * hole: the originator always processes its own plan, so even a single-hop route is stapled by its origin.
 * (A circular self-query finds no satisfying plan, so the staple is a no-op there — the attack is on the
 * linear discovery path.)
 */
function stackingNegotiateFor(count: number): (entityId: number) => DiscoveryHooks<LiftTerms, unknown>['negotiatePlan'] {
	return (entityId) => (plan) => ({ ...plan, members: [...plan.members, ...stackedVoterMembers(entityId, count)] })
}

/** `count` obscure `[V]`-only referees for node `entityId`, keyed by a **non-numeric** address (⇒ obscure). */
function stackedVoterMembers(entityId: number, count: number): DependentMember[] {
	const members: DependentMember[] = []
	for (let i = 0; i < count; i++) {
		members.push({ types: [VOTER], address: { key: `sv${entityId}_${i}` } })
	}
	return members
}

/**
 * A {@link ScorePlan} that **refuses** a stacked voter set at discovery time: it drops a plan carrying an
 * obscure referee (returns `-Infinity`, which the originator's `rankPlans` filters out) and counts the
 * refusal into `refusals.count`; otherwise it ranks voter-aware against `wellKnown` as usual. Measured at the
 * **discovery scorer**, not the promise-time `acceptsProposal` gate, because the sim's nominated/stapled
 * referees reach the discovery layer only — they never land in the lift record's members (the composition gap
 * documented in `well-known.ts` and `backlog/debt-voter-nomination-on-path-composition`). The shared
 * `refusals` cell sums every refused plan across the per-query rebuilds.
 */
function countingRefusalScorer(wellKnown: Set<number>, refusals: { count: number }): ScorePlan<LiftTerms, unknown> {
	const rank = voterAwareScorePlan<LiftTerms, unknown>(wellKnown)
	const policy: StackedVoterPolicy = { wellKnown, memberEntity: (m: DependentMember) => Number(m.address.key) }
	return (plan, query) => {
		if (refusesStackedVoterSet(plan.members, policy)) {
			refusals.count++
			return Number.NEGATIVE_INFINITY
		}
		return rank(plan, query)
	}
}

/**
 * Build the {@link ConsensusConfig} from an already-compiled failure selection: refusers become
 * `{ shouldPromise: false }` resource specs, and the non-relayer / silent sets become the harness's
 * `refuseRelayFor` / `silentAfterPromiseFor` ports. The two failure ports are added **only when their set is
 * non-empty**, so a run with no non-relayers/silent nodes passes exactly `{ identitySeed, resourceFor }` as
 * before — the existing refuser/stalled/all-cooperative runs stay byte-identical. Shared by the sweep runner
 * (which also derives `nonCooperating` from the same `compiled`) and {@link consensusConfigFor}.
 */
function consensusConfigFromCompiled(scenario: SimScenario, compiled: CompiledConsensusConditions, runSeed: number): ConsensusConfig {
	const identitySeed = (scenario.consensus?.identitySeed ?? DEFAULT_CONSENSUS_IDENTITY_SEED) + runSeed
	const { resourceFor } = makeSimResources(refuserSpecs(compiled.refusers))
	const config: ConsensusConfig = { identitySeed, resourceFor }
	if (compiled.nonRelayers.size > 0) {
		config.refuseRelayFor = (id) => compiled.nonRelayers.has(id)
	}
	if (compiled.silent.size > 0) {
		config.silentAfterPromiseFor = (id) => compiled.silent.has(id)
	}
	return config
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
	const clone: ConsensusSpec = { ...consensus }
	// `consensusMethod` is the one nested (non-scalar) knob, so deep-clone it; the rest are scalars/strings.
	if (consensus.consensusMethod !== undefined) {
		clone.consensusMethod = { ...consensus.consensusMethod }
	}
	return clone
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
