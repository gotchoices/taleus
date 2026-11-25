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
	type NetworkGraph,
	type NetworkLink,
} from 'tallynet/testing'
import type { OriginatorOptions, ParticipantOptions, Plan, TraceSink } from 'tallynet'
import { capFoilToStock, capStockToFoil } from '../capacity.js'
import type { Network } from '../model.js'
import type { WorkloadSpec } from '../scenario.js'
import { drawAmount, drawPaymentPair } from '../workload.js'
import { type ConditionsSpec, compileConditions } from './conditions.js'
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
 */
export function buildSimNetwork(
	network: Network,
	conditions: ConditionsSpec,
	conditionsSeed: number,
	trace?: TraceSink,
	options?: Partial<OriginatorOptions & ParticipantOptions>,
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
		hooks: makeCapacityHooks(),
		invertTerms: invertLiftTerms,
		conditions: compiled.conditions,
		trace,
		options,
	})
	return { net, entityName, entityId }
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
