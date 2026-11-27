/**
 * The experiment scenario and sweep model: plain, JSON-serialisable descriptions of **what to generate
 * and how to query it** ({@link ScenarioSpec}) and **which parameter(s) to vary over which networks**
 * ({@link SweepSpec}). The runner (`runner.ts`) consumes these; the CLI (`cli/sweep.ts`) reads a
 * {@link SweepSpec} from a JSON file. Both are pure data so a scenario can be saved, shared and replayed.
 *
 * ── The "step the economy" seam ──────────────────────────────────────────────────────────────────────
 * A real tally network is not static: entities trade, so credit capacity gets used up in one direction and
 * restored (especially by circular lifts) over time. This tier does **not** model that — every tally starts
 * square (balance 0) and nothing moves it. The hook is left here as {@link EconomyStep}; the backlog item
 * `feat-tallysim-trading-model` supplies a real implementation that mutates balances between query batches.
 * The default is {@link noOpEconomyStep}. See `docs/design.md` § Runner / experiments.
 */

import type { ConsensusMethod } from 'tallynet'
import type { SeededRandom } from 'tallynet/testing'
import type { CapacityDistribution } from './distributions.js'
import type { Network } from './model.js'
import type { ConditionsSpec } from './sim/conditions.js'

/**
 * Where a scenario's network comes from. **Either** a generator recipe (id + numeric structural params +
 * capacity distribution + seed — the runner materialises it) **or** an already-materialised {@link Network}.
 * Both are valid inputs (the parent plan's "store either; runner materialises" decision).
 *
 * The generator variant carries its {@link CapacityDistribution} explicitly: the generators need it and it
 * is not a plain number, so it cannot live inside the numeric `params` map (an extension of the ticket's
 * original sketch, which omitted it).
 */
export type NetworkSource =
	| { generator: string; params: Record<string, number>; capacity: CapacityDistribution; seed: number }
	| { materialized: Network }

/** How amounts are drawn for a workload's queries. `constant` → always `value`; `uniform` → `[min, max]`. */
export interface AmountSpec {
	/** Distribution id: `'constant'` or `'uniform'`. */
	dist: string
	/** Numeric parameters: `constant` needs `value`; `uniform` needs `min` and `max` (both inclusive). */
	params: Record<string, number>
}

/** The metric id that opts a run into max-flow computation (costly; sampled, never run per query). */
export const MAX_FLOW_METRIC = 'max-flow'

/** What to ask of a network: a batch of random queries of one kind, their amounts, and the depth bound. */
export interface WorkloadSpec {
	/** `payment` → route-existence `X → Y` queries; `clearing` → circular-clearing queries at a node. */
	kind: 'payment' | 'clearing'
	/** How many random queries to draw. */
	queries: number
	/** The amount each query asks to move. */
	amount: AmountSpec
	/** Max depth `D` (hop bound) for every query. */
	depth: number
	/** Workload PRNG seed — **independent** of the network seed (both are honoured; see the runner). */
	seed: number
	/** Opt-in expensive metrics (currently only {@link MAX_FLOW_METRIC}); omitted ⇒ none. */
	metrics?: string[]
	/** Cycle-count cap for `clearing` queries (per node); defaults to {@link DEFAULT_CLEARING_MAX_COUNT}. */
	clearingMaxCount?: number
	/** How many query pairs to sample for max-flow when enabled; defaults to {@link DEFAULT_MAX_FLOW_SAMPLES}. */
	maxFlowSamples?: number
}

/** Default cycle-count cap for clearing queries. Availability needs only ≥ 1, but a small count is useful. */
export const DEFAULT_CLEARING_MAX_COUNT = 16

/** Default number of query pairs sampled for max-flow (Edmonds–Karp is costly; never run per query). */
export const DEFAULT_MAX_FLOW_SAMPLES = 32

/** A single scenario: one network and one workload to run against it. */
export interface ScenarioSpec {
	network: NetworkSource
	workload: WorkloadSpec
}

/** The identity seed used when a {@link ConsensusSpec} omits {@link ConsensusSpec.identitySeed}. */
export const DEFAULT_CONSENSUS_IDENTITY_SEED = 1

/**
 * How a run's lifts are routed. `linear` (the default) draws distinct `(from, to)` payment pairs and lifts
 * the found line route; `circular` draws a single origin per query and lifts the shortest simple cycle back
 * to it (the clearing-discovery stand-in — see `buildCircularOutcome`). JSON-serialisable.
 */
export type RouteShape = 'linear' | 'circular'

/**
 * Consensus-phase failure injection + identity for a {@link SimScenario}. Its **presence** on a scenario is
 * the "run consensus" switch (omitted ⇒ discovery-only, consensus not driven); the runner and the trace
 * both key off that. The refuser selection is drawn from the dedicated {@link SimScenario.consensusSeed}
 * stream so it never perturbs which network / queries / link-conditions a run gets.
 *
 * It is structurally assignable to {@link ConsensusConditionsSpec} (it carries every fraction that spec
 * names — `refuserFraction`, `nonRelayerFraction`, `silentAfterPromiseFraction`), so the runner compiles the
 * failure sets with `compileConsensusConditions(network, scenario.consensus, consensusSeed)`.
 */
export interface ConsensusSpec {
	/**
	 * Fraction of entities made refusers — count-based, `round(fraction · entityCount)` selected. A refuser
	 * on a taken route signs `NP` (no-promise), so that lift voids (`refused-promise`). Omitted / 0 ⇒ none.
	 */
	refuserFraction?: number
	/**
	 * Fraction of entities made **non-relayers** — count-based, `round(fraction · entityCount)` selected,
	 * drawn on the same dedicated consensus seed as {@link ConsensusSpec.refuserFraction} (after it, so the
	 * refuser draw is unchanged). Distinct from a refuser: a non-relayer promises normally but then drops
	 * every commit-phase record it would send or forward and serves no pulls, so a member it cuts off from the
	 * commit push must recover by pulling from a reachable peer. This is the swept x-axis of the principle-3
	 * completion curve. Omitted / 0 ⇒ none.
	 */
	nonRelayerFraction?: number
	/**
	 * Fraction of entities made **silent-after-promise** — count-based, `round(fraction · entityCount)`
	 * selected, drawn on the dedicated consensus seed after the non-relayers. Such a node promises, then
	 * neither sends nor receives any commit-phase record and serves no pulls (a node offline after minting).
	 * A count-based fraction over all entities subsumes the "payee goes silent after mint" edge case — the
	 * per-query payee is not a fixed set, so a fraction over every entity is the right model. Omitted / 0 ⇒ none.
	 */
	silentAfterPromiseFraction?: number
	/**
	 * Publish a `physical` contact point on the originator and every voter of each lift (a dial address every
	 * record-holder can reach), so a member the commit push could not reach can still pull the settled record.
	 * Threads to {@link RunLiftOptions.contactPoints}. Omitted ⇒ `false` (only link-neighbours are reachable).
	 */
	contactPoints?: boolean
	/**
	 * Seed for every node's deterministic ed25519 identity (the harness's signer/verifier layer). Omitted ⇒
	 * {@link DEFAULT_CONSENSUS_IDENTITY_SEED}. Same seed ⇒ same keys across runs.
	 */
	identitySeed?: number
	/**
	 * How this run's lifts are routed (see {@link RouteShape}). `'linear'` (default) lifts distinct-pair line
	 * routes; `'circular'` lifts the shortest simple cycle through a single drawn origin — the
	 * clearing-discovery stand-in, exercising "a ring routes around a non-relayer". JSON-serialisable.
	 */
	routeShape?: RouteShape
	/**
	 * Who each participant nominates as a voter-set referee. `'self'` (the implicit default when omitted) is a
	 * voter-set-of-one: the originator votes its own leg, needing no extra wiring. `'well-known'` nominates the
	 * single most-recognised off-route hub (highest degree among the well-known set) as a shared trusted voter.
	 * Omitted ⇒ `'self'` behaviour.
	 */
	voterNomination?: 'self' | 'well-known'
	/**
	 * Fraction of entities treated as **well-known** (highest-degree hubs; see `wellKnownEntities`), used by
	 * `voterNomination: 'well-known'` and the voter-aware plan scorer. Well-known-ness is **measured from the
	 * graph**, not a model flag, so this knob only sizes the top-degree set. Omitted ⇒ `0` (nobody well-known).
	 */
	wellKnownFraction?: number
	/**
	 * How many obscure referees a padding node staples onto every plan it folds into (the stacked-voter
	 * attack model). `> 0` turns on a discovery-time scorer that **refuses** (drops) any plan carrying such a
	 * stacked voter set, counting each refusal into `planRefusalCount`. Omitted / 0 ⇒ no padding, no refusals.
	 */
	stackedVoters?: number
	/**
	 * The consensus method (vote weighting + win threshold) every lift settles under. Omitted ⇒ `tallynet`'s
	 * {@link ConsensusMethod} default (`distinct-voter` weighting at a plain strict-majority `1/2` threshold).
	 * Raising the threshold (e.g. `2/3`) makes a split voter set settle nowhere (`pending`) rather than commit.
	 */
	consensusMethod?: ConsensusMethod
	/**
	 * The lift code lifetime / deadline (ms) every lift in the run settles under; threads to
	 * {@link RunLiftOptions.ttlMs} and so onto `buildLift`'s mint. Omitted ⇒ `buildLift`'s own 600_000 ms
	 * default. Must exceed the happy-path settle time but stay inside the run's stall budget.
	 */
	ttlMs?: number
	/**
	 * Per-scenario override of the recovery-loop give-up window (ms): how long past the deadline a node's
	 * recovery loop polls before abandoning. Threads onto {@link ConsensusConfig.recoveryGiveupMs}. Omitted ⇒
	 * the sim's 60_000 ms default. (`recoveryBaseMs` / `recoveryMaxMs` are left to a later scenarios ticket.)
	 */
	recoveryGiveupMs?: number
}

/**
 * A discovery-simulation scenario: the same network + workload a {@link ScenarioSpec} carries, plus the
 * discovery-tier knobs (network conditions, the discovery time budget, and the conditions seed). It is
 * the full, reproducible description of one run of the real `tallynet` protocol over a simulated network
 * — enough to rebuild the run from a trace file alone — and is embedded verbatim in a trace file's
 * header (see `sim/trace-format.ts`).
 *
 * Defined here (not in `sim/`) so the oracle scenario model and the sim scenario model live side by
 * side; the discovery sweep runner (`tallysim-discovery-metrics`) adds its `SimSweepSpec` alongside it.
 */
export interface SimScenario {
	/** Where the network comes from — the same generator-recipe | materialised union the oracle uses. */
	network: NetworkSource
	/** The query batch. `kind` must be `'payment'` this tier (clearing discovery is deferred). */
	workload: WorkloadSpec
	/** Network conditions (latency, drops, sleeping/late nodes); omitted ⇒ an ideal network. */
	conditions?: ConditionsSpec
	/** Discovery time budget mapped onto `OriginatorOptions`; depth rides on {@link WorkloadSpec.depth}. */
	budget?: { initialBudgetMs?: number; perHopBudgetMs?: number }
	/** Seed for the conditions stream — independent of the network / workload / economy seeds. */
	conditionsSeed?: number
	/**
	 * Consensus failure-injection + identity. **Presence is the "run consensus" switch** — omitted ⇒ the run
	 * is discovery-only. Optional and absent on a discovery-only scenario, so it round-trips through a trace
	 * header unchanged. See {@link ConsensusSpec}.
	 */
	consensus?: ConsensusSpec
	/**
	 * Seed for the **dedicated** consensus (refuser-selection) stream — independent of the network / workload
	 * / conditions / economy seeds (same discipline as {@link SimScenario.conditionsSeed}), so the refuser
	 * draw never shifts which network / queries / link-conditions a run gets. Optional; absent on a
	 * discovery-only scenario.
	 */
	consensusSeed?: number
}

/**
 * A discovery-simulation sweep: a base {@link SimScenario}, the parameter(s) to vary (same cartesian-product
 * `vary` dimensions the oracle {@link SweepSpec} uses), and the seeds to repeat each cell over. The sim
 * runner (`sim/sim-runner.ts`) yields one record per `(cell × seed)`. `concurrent` is a runner dep, **not**
 * a field here — it must never ride on `SimScenario` (which is embedded verbatim in trace headers).
 */
export interface SimSweepSpec {
	base: SimScenario
	vary: VarySpec[]
	seeds: number[]
}

/** One varied dimension: a dotted path into the base scenario and the numeric values to step it through. */
export interface VarySpec {
	/** Dotted path, e.g. `network.params.meanDegree`, `network.params.entityCount`, `workload.depth`. */
	path: string
	/** The values to set at `path`, one sweep cell per value (combined cartesian-wise with other dimensions). */
	values: number[]
}

/**
 * A sweep: a base scenario, the parameter(s) to vary, and the seeds to repeat each cell over. The runner
 * takes the **cartesian product** of every `vary` dimension's values — one record per
 * `(valueA, valueB, …, seed)` cell. One or two dimensions is the readable norm (and what plots want); the
 * runner imposes no arity cap, and the checked-in route-existence experiment uses three.
 */
export interface SweepSpec {
	base: ScenarioSpec
	vary: VarySpec[]
	seeds: number[]
}

/**
 * The "step the economy" seam: advances the economy (mutates balances) before a batch of queries. This tier
 * ships only the {@link noOpEconomyStep} default — `feat-tallysim-trading-model` supplies a real
 * implementation (producers/consumers trading, circular lifts restoring capacity). The runner gives it the
 * run's {@link SeededRandom} so a real model's draws stay on the one reproducible stream.
 */
export interface EconomyStep {
	step(network: Network, rng: SeededRandom): void
}

/** The default {@link EconomyStep}: does nothing (balances stay as the generator set them). */
export const noOpEconomyStep: EconomyStep = {
	step(): void {
		// Intentionally empty: this tier does not model trading. See feat-tallysim-trading-model.
	},
}
