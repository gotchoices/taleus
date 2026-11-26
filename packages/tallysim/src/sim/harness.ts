/**
 * The discovery simulation harness: turn a tallysim {@link Network} into a running `tallynet` discovery
 * network on compressed, deterministic time, then run one payment query to completion. This is the wiring
 * that joins the two tiers — the all-seeing oracle (ground truth: *does a route exist*) and the real
 * decentralised route-discovery protocol (`tallynet`) — so an experiment can measure whether the protocol
 * finds the routes the oracle proves exist. See `docs/design.md` § Discovery simulation.
 *
 * The discrete-event scheduler is **not** rebuilt here: `tallynet/testing` ships the {@link VirtualClock}
 * (a min-heap of timers; time advances only when a timer fires) and {@link InMemoryNetwork} (one discovery
 * node per graph node, wired over that clock, with per-link conditions and a shared seeded random). This
 * module consumes them; everything simulator-specific lives in `tallysim`.
 *
 * ── Capacity equality with the oracle (the correctness anchor) ────────────────────────────────────
 * Each tally becomes one discovery link `node1 = entityName(stock)`, `node2 = entityName(foil)`, carrying
 * `intents.L = { capFwd: capStockToFoil(t), capBack: capFoilToStock(t), amount: 0 }` — the very same
 * `capacity.ts` helpers the oracle's graph view uses. `InMemoryNetwork` adds the `node2 → node1` view via
 * {@link invertLiftTerms}, so a node `u`'s forward view of a link to neighbour `v` has `capFwd = cap(u→v)`,
 * identical to the oracle's directed edge `u→v`. With {@link makeCapacityHooks} re-checking `capFwd ≥
 * amount` on every hop, every route the protocol returns is one the oracle also confirms (found ⊆ oracle).
 *
 * ── Session-code randomness ───────────────────────────────────────────────────────────────────────
 * `InMemoryNetwork` needs a `random` source for minting session codes. It is seeded from a fixed module
 * constant ({@link SESSION_CODE_SEED}), independent of the conditions stream: a query's **outcome**
 * (found / plans) never depends on session-code *values* (only nonces do), so a fixed, independent stream
 * keeps outcomes deterministic while leaving the conditions stream free to vary without perturbing them.
 */

import {
	InMemoryNetwork,
	VirtualClock,
	SeededRandom,
	type InMemoryNetworkConfig,
	type NetworkGraph,
	type NetworkLink,
	type RefereeNomination,
} from 'tallynet/testing'
import type {
	DiscoveryHooks,
	OriginatorOptions,
	ParticipantOptions,
	Plan,
	ScorePlan,
	TraceSink,
	TrxParticipantResource,
} from 'tallynet'
import { capFoilToStock, capStockToFoil } from '../capacity.js'
import type { Network } from '../model.js'
import type { WorkloadSpec } from '../scenario.js'
import { drawAmount, drawPaymentPair } from '../workload.js'
import { type ConditionsSpec, compileConditions } from './conditions.js'
import { signerForSeed, simVerifier } from './identity.js'
import { entityId, entityName, linkIdForTally } from './naming.js'
import { type LiftTerms, invertLiftTerms, makeCapacityHooks } from './terms.js'

/** The single lift intent code this tier negotiates (single-denomination; multi-denomination is later work). */
const LIFT_CODE = 'L'

/**
 * The fixed seed for the harness's shared session-code random. A query's outcome never depends on
 * session-code values, so a fixed, conditions-independent stream keeps outcomes deterministic.
 */
const SESSION_CODE_SEED = 1

/** A built discovery network ready to run queries, plus the node↔entity bijection to map results back. */
export interface SimNetwork {
	/** The wired `tallynet` in-memory network. Drive `net.clock` to settle a `discover`. */
	net: InMemoryNetwork<LiftTerms, unknown>
	/** Entity id → node name (the harness's copy of the bijection). */
	entityName(id: number): string
	/** Node name → entity id. */
	entityId(name: string): number
}

/**
 * Turn consensus on for a {@link buildSimNetwork}. When present, the harness builds a {@link ConsensusNode}
 * per graph node (discovery-only runs stay keygen-free); when absent, the discovery-only path is byte-for-
 * byte unchanged. `identitySeed` seeds the deterministic signer/verifier layer ({@link signerForSeed}).
 */
export interface ConsensusConfig {
	/** Seeds every node's deterministic ed25519 identity. Two runs with the same seed get the same keys. */
	identitySeed: number
	/**
	 * Failure-injection resource port, keyed by **entity id**. Omit ⇒ the harness's cooperative default
	 * (promise, release, vote commit; hold nothing). See {@link makeSimResources}.
	 */
	resourceFor?: (entityId: number) => TrxParticipantResource<LiftTerms, unknown>
	/**
	 * The originator's discovery plan scorer (higher is better; e.g. {@link voterAwareScorePlan}). It is
	 * **shared** by every node that starts a search — a `ScorePlan` is itself a function, so `InMemoryNetwork`
	 * cannot tell a per-node factory from a scorer. Omit ⇒ the originator's default (first-found order).
	 */
	scorePlan?: ScorePlan<LiftTerms, unknown>
	/**
	 * Per-node discovery voter-set gate, keyed by **entity id**: the `negotiatePlan` hook node `entityId`
	 * runs on every plan it is about to fold itself into (return the plan to accept, `undefined` to drop that
	 * one plan — e.g. {@link refuseStackedPlanHook}). Return `undefined` for a node that vets nothing. When
	 * NO node supplies a gate the harness keeps the single shared capacity-hooks object (the discovery-only
	 * path stays byte-for-byte identical); any gate turns the hooks into a per-node factory.
	 */
	negotiatePlanFor?: (entityId: number) => DiscoveryHooks<LiftTerms, unknown>['negotiatePlan']
	/**
	 * Per-node referee nomination, keyed by **entity id** (adapted to the harness's node-name key). Each node
	 * folds the returned voter-only referees into a discovered plan as `[V]` members. See {@link makeNomineesFor}.
	 */
	nomineesFor?: (entityId: number) => RefereeNomination[]
	/**
	 * The **non-relayer**, keyed by **entity id**: `true` ⇒ node `entityId` promises normally but drops every
	 * commit-phase record it would send or forward, and serves no pulls (the interior refuser a pull routes
	 * around). Omit ⇒ every node relays. Keep this in step with a lift's `nonCooperating` so the pull pass
	 * skips the node that will never recover.
	 */
	refuseRelayFor?: (entityId: number) => boolean
	/**
	 * Goes-silent-after-promising, keyed by **entity id**: `true` ⇒ node `entityId` neither sends nor receives
	 * any commit-phase record once it has promised, and serves no pulls (an originator or payee offline after
	 * minting). Omit ⇒ every node stays reachable.
	 */
	silentAfterPromiseFor?: (entityId: number) => boolean
}

/** One payment query to run: pay `amount` from entity `from` to entity `to`, within `depth` hops. */
export interface QuerySpec {
	from: number
	to: number
	amount: number
	depth: number
}

/** The protocol's answer for one query: the minted session code, the satisfying plans, and whether any was found. */
export interface QueryOutcome {
	sessionCode: string
	/** The protocol's result (possibly empty). Each plan's path links carry the negotiated forward terms. */
	plans: Plan<LiftTerms, unknown>[]
	/** `plans.length > 0`. */
	found: boolean
}

/**
 * Build a {@link SimNetwork} from a tallysim {@link Network}: materialise the discovery graph (one link per
 * tally, forward terms equal to the oracle's directed capacities), compile `conditions` from their own
 * seeded stream, and wire an {@link InMemoryNetwork} over a fresh {@link VirtualClock} with the
 * capacity-aware hooks and {@link invertLiftTerms}.
 *
 * `options` tunes the originator/participant for every node (e.g. `sessionTtlMs`, budgets); a per-query
 * `maxDepth` is supplied later by {@link runQuery} and overrides any here.
 *
 * `consensus` (optional) turns on the atomic promise/commit engine: the harness builds a consensus node per
 * graph node with a deterministic identity and (optionally) a failure-injecting resource port. When it is
 * omitted the discovery-only wiring is **identical** to before — nothing new is passed to the harness, so
 * the pinned discovery sweep is byte-for-byte unchanged.
 */
export function buildSimNetwork(
	network: Network,
	conditions: ConditionsSpec,
	conditionsSeed: number,
	trace?: TraceSink,
	options?: Partial<OriginatorOptions & ParticipantOptions>,
	consensus?: ConsensusConfig,
): SimNetwork {
	const nodes: string[] = []
	for (let id = 0; id < network.entityCount; id++) {
		nodes.push(entityName(id))
	}
	const links: NetworkLink<LiftTerms>[] = network.tallies.map((tally, index) => ({
		id: linkIdForTally(index),
		node1: entityName(tally.stock),
		node2: entityName(tally.foil),
		intents: { [LIFT_CODE]: { capFwd: capStockToFoil(tally), capBack: capFoilToStock(tally), amount: 0 } },
	}))
	const graph: NetworkGraph<LiftTerms> = { nodes, links }

	const compiled = compileConditions(network, conditions, conditionsSeed)
	const net = new InMemoryNetwork<LiftTerms, unknown>({
		graph,
		clock: new VirtualClock(),
		random: new SeededRandom(SESSION_CODE_SEED),
		hooks: consensusHooks(consensus),
		invertTerms: invertLiftTerms,
		conditions: compiled.conditions,
		trace,
		options,
		...consensusPorts(consensus),
	})
	return { net, entityName, entityId }
}

/**
 * The discovery hooks for the harness. Without a `negotiatePlanFor` gate (the common case — every discovery
 * run, and every consensus run that does not vet voter sets) this is the single shared {@link makeCapacityHooks}
 * object, byte-for-byte what the harness passed before consensus existed, so the pinned discovery sweep never
 * moves. When at least one node supplies a gate it becomes a per-node factory: the gated node's capacity hooks
 * gain its `negotiatePlan`, every other node keeps the plain shared object.
 */
function consensusHooks(
	consensus: ConsensusConfig | undefined,
): DiscoveryHooks<LiftTerms, unknown> | ((nodeId: string) => DiscoveryHooks<LiftTerms, unknown>) {
	const base = makeCapacityHooks()
	const negotiatePlanFor = consensus?.negotiatePlanFor
	if (!negotiatePlanFor) {
		return base
	}
	return (name: string) => {
		const negotiatePlan = negotiatePlanFor(entityId(name))
		return negotiatePlan ? { ...base, negotiatePlan } : base
	}
}

/**
 * The harness ports that turn consensus on, or `{}` when `consensus` is omitted. `signerFor` + `verifier`
 * together switch {@link InMemoryNetwork} from discovery-only to consensus; the three entity-id-keyed ports
 * (`resourceFor`, `nomineesFor`, `refuseRelay`, `silentAfterPromise`) are each adapted to the node-name key
 * the harness calls with, and the shared `scorePlan` is passed through as-is. Each is spread only when the
 * config supplies it, and the whole thing is `{}` when consensus is off — so the discovery-only config is
 * byte-for-byte unchanged (nothing new is passed to the harness) and a consensus run that sets none of the
 * voter-model ports adds no keys beyond `signerFor`/`verifier`.
 */
function consensusPorts(
	consensus: ConsensusConfig | undefined,
):
	| Pick<
			InMemoryNetworkConfig<LiftTerms, unknown>,
			'signerFor' | 'verifier' | 'resourceFor' | 'scorePlan' | 'nomineesFor' | 'refuseRelay' | 'silentAfterPromise'
	  >
	| Record<string, never> {
	if (!consensus) {
		return {}
	}
	const { resourceFor, scorePlan, nomineesFor, refuseRelayFor, silentAfterPromiseFor } = consensus
	return {
		signerFor: signerForSeed(consensus.identitySeed),
		verifier: simVerifier,
		...(resourceFor ? { resourceFor: (name: string) => resourceFor(entityId(name)) } : {}),
		...(scorePlan ? { scorePlan } : {}),
		...(nomineesFor ? { nomineesFor: (name: string) => nomineesFor(entityId(name)) } : {}),
		...(refuseRelayFor ? { refuseRelay: (name: string) => refuseRelayFor(entityId(name)) } : {}),
		...(silentAfterPromiseFor ? { silentAfterPromise: (name: string) => silentAfterPromiseFor(entityId(name)) } : {}),
	}
}

/**
 * Issue one payment query **without driving the clock**: call `discover` (which mints the session code
 * synchronously and arms round-0 work) and return the pending outcome promise. The caller settles it by
 * driving `sim.net.clock` — `runQuery` does so immediately; the sim runner's concurrent mode issues many
 * queries before a single `runUntilIdle()`. This is the one place the `'L'` intent code and target shape
 * live, so both paths stay in lock-step.
 */
export function issueQuery(sim: SimNetwork, q: QuerySpec): Promise<QueryOutcome> {
	const pending = sim.net.discover(
		sim.entityName(q.from),
		{ address: { key: sim.entityName(q.to) } },
		{ [LIFT_CODE]: { capFwd: 0, capBack: 0, amount: q.amount } },
		{ maxDepth: q.depth },
	)
	return pending.then(({ sessionCode, plans }) => ({ sessionCode, plans, found: plans.length > 0 }))
}

/**
 * Run one payment query to completion on simulated time: issue `discover`, drive the clock to idle, and
 * return the outcome. Never throws for "not found" (the originator returns empty plans), nor for
 * `from === to`, nor for a network with fewer than two entities.
 */
export async function runQuery(sim: SimNetwork, q: QuerySpec): Promise<QueryOutcome> {
	// issueQuery() arms round-0 work; runUntilIdle() then drains every scheduled delivery/budget timer in
	// virtual time, settling the promise. Observable behaviour is identical to issuing + settling inline.
	const pending = issueQuery(sim, q)
	await sim.net.clock.runUntilIdle()
	return pending
}

/**
 * Draw a workload's payment queries over an already-materialised network: `workload.queries` draws of a
 * distinct `(from, to)` pair then an amount (pair-first, matching the oracle runner's draw order exactly),
 * each at `workload.depth`. Empty for `entityCount < 2` (no distinct pair exists). The **caller owns the
 * rng seeding** — pass a {@link SeededRandom} seeded on the workload stream.
 */
export function drawPaymentQueries(workload: WorkloadSpec, entityCount: number, rng: SeededRandom): QuerySpec[] {
	if (entityCount < 2) {
		return []
	}
	const queries: QuerySpec[] = []
	for (let i = 0; i < workload.queries; i++) {
		const [from, to] = drawPaymentPair(entityCount, rng)
		const amount = drawAmount(workload.amount, rng)
		queries.push({ from, to, amount, depth: workload.depth })
	}
	return queries
}
