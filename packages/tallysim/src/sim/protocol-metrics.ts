/**
 * Protocol-level measurement: **recorded protocol runs in, protocol metrics out.** A pure module (no
 * network, no oracle, no filesystem, no clock) in the exact spirit of `metrics.ts` — the oracle tier's
 * summariser — so it is testable with hand-built trace events and reusable unchanged in the browser. The
 * sim runner (`sim-runner.ts`) records each query's trace events + outcome, asks the oracle whether a route
 * exists on the undegraded network, then calls the two functions here. See `docs/design.md`
 * § Discovery simulation.
 *
 * The question these metrics answer, per query and per run: **out of the routes that exist (oracle ground
 * truth), how many did the real decentralised protocol find, how fast (ms), how many messages, how many
 * rounds, and why did candidates get pruned?** The headline is {@link ProtocolRunMetrics.pFoundGivenExists}
 * — P(found | a route exists) — complementary to the oracle tier's P(route exists).
 *
 * ── found ⊆ oracle (the correctness guardrail) ───────────────────────────────────────────────────────
 * The harness negotiates each hop against the very capacities the oracle's graph view uses, so every route
 * the protocol returns is one the oracle also confirms. {@link ProtocolRunMetrics.falseFoundCount} counts
 * queries the protocol found but the oracle says have **no** route; it MUST be 0. A non-zero count is a
 * harness/terms bug, not a metric — the sim-runner's tests assert it is 0 on every seeded run.
 *
 * Every metric is guarded against the degenerate cases the runner hands it (no queries, no existing routes):
 * a fraction over zero trials is **0, never NaN**, exactly as `metrics.ts` does.
 */

import type { PruneReason, TraceEvent } from 'tallynet'
import { type DistributionSummary, summarizeDistribution, type StructuralMetrics } from '../metrics.js'
import type { QueryOutcome } from './harness.js'

/**
 * A fresh prune-reason tally with every reason zeroed — the starting point for a query or a run. The object
 * literal is the single source of truth for the reason set: it must name **every** key of
 * `Record<PruneReason, number>`, so adding a {@link PruneReason} in tallynet without adding it here is a
 * compile error (missing property), and a stray key not in the union is a compile error too. (`PruneReason`
 * is a type-only export from tallynet — this is its value-level mirror; distinct from taleus-core's
 * accumulator `PruneReason`.)
 */
export function zeroPruneReasons(): Record<PruneReason, number> {
	return {
		cycle: 0,
		failed: 0,
		'timed-out': 0,
		'max-depth': 0,
		expired: 0,
		'no-reentrance': 0,
	}
}

/**
 * The discovery {@link PruneReason} values, derived from {@link zeroPruneReasons} so the two can never drift:
 * the compile-checked literal there is the source of truth, and this is just its key list.
 */
export const ALL_PRUNE_REASONS: readonly PruneReason[] = Object.keys(zeroPruneReasons()) as PruneReason[]

/** One query's protocol result: the oracle ground truth paired with what the protocol actually did. */
export interface ProtocolQueryResult {
	/** Oracle ground truth: does a route exist on the full, undegraded network at the query's depth? */
	routeExists: boolean
	/** Did the protocol return at least one plan? (`outcome.found`.) */
	found: boolean
	/** How many plans the protocol returned. */
	plansFound: number
	/** Ms from query start to the first `plan-found` event; omitted when none was found. */
	timeToFirstPlanMs?: number
	/** Ms from query start to the last event (or the settle time if the query emitted no events). */
	timeToCompletionMs: number
	/** Number of `query-sent` events (sub-requests issued), not deliveries — a folded late answer adds none. */
	messages: number
	/** Distinct node ids that emitted any event for this query. */
	nodesTouched: number
	/** Max round counter over `round-started` and `query-sent` events (0 if none) — not a delivery count. */
	roundsUsed: number
	/** Count of `candidate-pruned` events per reason, zero-initialised for all six reasons. */
	pruneReasons: Record<PruneReason, number>
}

/** A whole run's protocol metrics: the found-vs-oracle gap plus cost distributions and pruning totals. */
export interface ProtocolRunMetrics {
	/** Number of queries the run ran. */
	queryCount: number
	/** Actual mean degree of the network (structural; one value per network). */
	meanDegree: number
	/** Largest-connected-component fraction of the network (structural). */
	largestComponentFraction: number
	/** Queries for which the oracle confirms a route exists. */
	routeExistsCount: number
	/** Queries the protocol found (returned ≥ 1 plan). */
	foundCount: number
	/** Queries both found by the protocol **and** confirmed by the oracle. */
	foundAndExistsCount: number
	/** `foundAndExistsCount / routeExistsCount`, or 0 when no route exists (never NaN) — P(found | exists). */
	pFoundGivenExists: number
	/** Queries the protocol found but the oracle says have **no** route. MUST be 0 (guardrail; asserted in tests). */
	falseFoundCount: number
	/** Time-to-first-plan distribution, over the found queries only. */
	timeToFirstPlanMs: DistributionSummary
	/** Time-to-completion distribution, over all queries. */
	timeToCompletionMs: DistributionSummary
	/** Messages (`query-sent` count) distribution, over all queries. */
	messages: DistributionSummary
	/** Nodes-touched distribution, over all queries. */
	nodesTouched: DistributionSummary
	/** Rounds-used distribution, over all queries. */
	roundsUsed: DistributionSummary
	/** Plans-found distribution, over all queries. */
	plansFound: DistributionSummary
	/** Prune reasons summed over every query in the run. */
	pruneReasons: Record<PruneReason, number>
}

/**
 * Analyse one query from its trace events, protocol outcome, oracle verdict and wall-clock window. Filters
 * `events` by `outcome.sessionCode` **internally**, so it works whether handed just this session's events or
 * a whole concurrent batch's. Reads round counters (not delivery counts) and `query-sent` (not deliveries)
 * so a folded-in late answer inflates neither `messages` nor `roundsUsed`.
 */
export function analyzeQuery(
	events: readonly TraceEvent[],
	outcome: QueryOutcome,
	routeExists: boolean,
	timing: { startMs: number; endMs: number },
): ProtocolQueryResult {
	let firstPlanTime: number | undefined
	let maxEventTime: number | undefined
	let messages = 0
	let maxRound = 0
	const nodes = new Set<string>()
	const pruneReasons = zeroPruneReasons()

	for (const event of events) {
		if (event.sessionCode !== outcome.sessionCode) {
			continue
		}
		nodes.add(event.nodeId)
		if (maxEventTime === undefined || event.time > maxEventTime) {
			maxEventTime = event.time
		}
		switch (event.type) {
			case 'plan-found': {
				if (firstPlanTime === undefined || event.time < firstPlanTime) {
					firstPlanTime = event.time
				}
				break
			}
			case 'query-sent': {
				messages++
				if (event.round > maxRound) {
					maxRound = event.round
				}
				break
			}
			case 'round-started': {
				if (event.round > maxRound) {
					maxRound = event.round
				}
				break
			}
			case 'candidate-pruned': {
				pruneReasons[event.reason]++
				break
			}
			default: {
				// Other event types contribute only their nodeId/time, already accounted for above.
				break
			}
		}
	}

	// Last event time makes per-session completion correct even in a concurrent batch; endMs is the fallback
	// for a session with zero events (nothing ran — e.g. an originator with no usable adjacency).
	const completionBase = maxEventTime ?? timing.endMs
	const result: ProtocolQueryResult = {
		routeExists,
		found: outcome.found,
		plansFound: outcome.plans.length,
		timeToCompletionMs: completionBase - timing.startMs,
		messages,
		nodesTouched: nodes.size,
		roundsUsed: maxRound,
		pruneReasons,
	}
	if (firstPlanTime !== undefined) {
		result.timeToFirstPlanMs = firstPlanTime - timing.startMs
	}
	return result
}

/**
 * Summarise a run's per-query results into {@link ProtocolRunMetrics}. Reuses `summarizeDistribution` from
 * `metrics.ts`; guards `pFoundGivenExists` against 0/0 (→ 0, never NaN) exactly as `metrics.ts` does; sums
 * each query's prune-reason record. `timeToFirstPlanMs` is distributed over the found queries whose
 * `timeToFirstPlanMs` is defined; every other distribution is over all queries. `StructuralMetrics` carries
 * through unchanged — these metrics never overload the oracle's `RunMetrics`.
 */
export function summarizeProtocolMetrics(
	results: readonly ProtocolQueryResult[],
	structural: StructuralMetrics,
): ProtocolRunMetrics {
	let routeExistsCount = 0
	let foundCount = 0
	let foundAndExistsCount = 0
	let falseFoundCount = 0
	const firstPlanTimes: number[] = []
	const completionTimes: number[] = []
	const messages: number[] = []
	const nodesTouched: number[] = []
	const roundsUsed: number[] = []
	const plansFound: number[] = []
	const pruneReasons = zeroPruneReasons()

	for (const result of results) {
		if (result.routeExists) {
			routeExistsCount++
		}
		if (result.found) {
			foundCount++
			if (result.routeExists) {
				foundAndExistsCount++
			} else {
				falseFoundCount++
			}
			if (result.timeToFirstPlanMs !== undefined) {
				firstPlanTimes.push(result.timeToFirstPlanMs)
			}
		}
		completionTimes.push(result.timeToCompletionMs)
		messages.push(result.messages)
		nodesTouched.push(result.nodesTouched)
		roundsUsed.push(result.roundsUsed)
		plansFound.push(result.plansFound)
		for (const reason of ALL_PRUNE_REASONS) {
			pruneReasons[reason] += result.pruneReasons[reason]
		}
	}

	return {
		queryCount: results.length,
		meanDegree: structural.meanDegree,
		largestComponentFraction: structural.largestComponentFraction,
		routeExistsCount,
		foundCount,
		foundAndExistsCount,
		pFoundGivenExists: routeExistsCount > 0 ? foundAndExistsCount / routeExistsCount : 0,
		falseFoundCount,
		timeToFirstPlanMs: summarizeDistribution(firstPlanTimes),
		timeToCompletionMs: summarizeDistribution(completionTimes),
		messages: summarizeDistribution(messages),
		nodesTouched: summarizeDistribution(nodesTouched),
		roundsUsed: summarizeDistribution(roundsUsed),
		plansFound: summarizeDistribution(plansFound),
		pruneReasons,
	}
}
