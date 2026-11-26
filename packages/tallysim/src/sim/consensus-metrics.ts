/**
 * Consensus-level measurement: **recorded lifts in, consensus metrics out.** A pure module (no network,
 * no clock, no filesystem) in the exact spirit of `protocol-metrics.ts` — the discovery tier's
 * summariser — so it is testable with hand-built {@link LiftResult}s plus consensus {@link TraceEvent}s
 * and reusable unchanged in the browser. The consensus runner (sibling `tallysim-consensus-runner-cli`)
 * drives each query to a settled lift, records its consensus trace events + {@link LiftResult}, then calls
 * the two functions here. See `docs/design.md` § Consensus simulation.
 *
 * The question these metrics answer, per lift and per run: **out of the routes the protocol found and
 * actually took, how many committed vs. voided vs. stalled, how fast (ms), how many consensus messages,
 * and — for the non-commits — why?** The headline is {@link ConsensusRunMetrics.pCommitGivenFound} —
 * P(commit | a route was found and a lift attempted) — the consensus analogue of the discovery tier's
 * P(found | exists).
 *
 * ── Isolating one lift's events ──────────────────────────────────────────────────────────────────────
 * Every consensus trace event carries `transactionCode`; no discovery event does (see tallynet
 * `src/trace.ts`). So filtering `events` by `event.transactionCode === result.transactionCode` cleanly
 * picks out exactly this lift's consensus events and drops all discovery noise — and, in a concurrent
 * batch, every other lift's events too.
 *
 * ── Why a lift did not commit: the outcome-driven void-reason precedence ──────────────────────────────
 * {@link analyzeLift} assigns at most one {@link VoidReason} per non-commit lift, driven first by the
 * settled outcome and only then by the events:
 *   - `commit`  ⇒ no reason (undefined).
 *   - `pending` ⇒ always `'stalled'`. Pending means no decision was reached — a dropped push on a needed
 *     edge, or an even voter-set tie (v1 has no timeout). We do **not** infer a different reason from
 *     stray `NP`/`NC` events that never carried the lift to a decision.
 *   - `void`    ⇒ the first of: a `signature-rejected` with `reason === 'expired'` ⇒ `'expired'`; else any
 *     `promise-signed` `NP` (a refusal) ⇒ `'refused-promise'`; else any `voter-vote` `NC` (a no-commit
 *     vote) ⇒ `'voted-no-commit'`; else, defensively, `'voted-no-commit'` (a void always has one of these
 *     causes, so the fallback is unreachable).
 * This resolves the "a refuser **and** a dropped edge counts once as `refused-promise`" case correctly:
 * when the refusal reaches a decision the outcome is `void` and the `NP` wins here; when the drop
 * prevents any decision the outcome is `pending`, which is `'stalled'` regardless of a stray `NP`.
 *
 * Every metric is guarded against the degenerate cases the runner can hand it (no lifts): a fraction over
 * zero lifts is **0, never NaN**, and a distribution over zero samples reports `count: 0`, exactly as
 * `metrics.ts` and `protocol-metrics.ts` do.
 */

import type { TraceEvent } from 'tallynet'
import { type DistributionSummary, summarizeDistribution, type StructuralMetrics } from '../metrics.js'
import type { LiftResult } from './consensus-harness.js'

/**
 * The non-commit reasons, one tally per reason. The object literal in {@link zeroVoidReasons} is the
 * single source of truth for the reason set: it must name **every** key of `Record<VoidReason, number>`,
 * so adding a {@link VoidReason} here without adding it there is a compile error (missing property), and a
 * stray key not in the union is a compile error too — exactly as `protocol-metrics.ts`'s
 * {@link zeroPruneReasons} does for its `PruneReason`.
 */
export type VoidReason = 'refused-promise' | 'voted-no-commit' | 'stalled' | 'expired'

/** A fresh void-reason tally with every reason zeroed — the starting point for a run. */
export function zeroVoidReasons(): Record<VoidReason, number> {
	return {
		'refused-promise': 0,
		'voted-no-commit': 0,
		stalled: 0,
		expired: 0,
	}
}

/**
 * The {@link VoidReason} values, derived from {@link zeroVoidReasons} so the two can never drift: the
 * compile-checked literal there is the source of truth, and this is just its key list.
 */
export const ALL_VOID_REASONS: readonly VoidReason[] = Object.keys(zeroVoidReasons()) as VoidReason[]

/** One lift's consensus metrics: the settled outcome paired with the cost and (for a non-commit) the cause. */
export interface ConsensusLiftMetrics {
	/** The settled outcome of the lift, carried through from the {@link LiftResult}. */
	outcome: 'commit' | 'void' | 'pending'
	/**
	 * Ms from the first `record-pushed` / `promise-signed` to the last consensus event for this lift.
	 * Present only for a settled lift (`commit` | `void`); **omitted for `pending`** (nothing settled).
	 */
	timeToSettleMs?: number
	/** Count of `record-pushed` events for this lift — the push is the consensus message. */
	messages: number
	/** The void reason for a non-commit lift (`void` **or** `pending`); omitted for a `commit`. */
	voidReason?: VoidReason
}

/** A whole run's consensus metrics: the commit-vs-found rate plus cost distributions and void-reason totals. */
export interface ConsensusRunMetrics {
	/** Queries the run attempted (carried through from the runner; a query that found a route becomes a lift). */
	queryCount: number
	/** Actual mean degree of the network (structural; one value per network) — the CSV x-axis. */
	meanDegree: number
	/** Largest-connected-component fraction of the network (structural). */
	largestComponentFraction: number
	/** Routes found **and** taken = lifts attempted = `commitCount + voidCount + pendingCount`. */
	liftCount: number
	/** Lifts that committed (moved balances). */
	commitCount: number
	/** Lifts that voided (a decided non-commit). */
	voidCount: number
	/** Lifts that stalled with no decision (pending). */
	pendingCount: number
	/** `commitCount / liftCount`, or 0 when `liftCount === 0` (never NaN) — P(commit | found). */
	pCommitGivenFound: number
	/** Time-to-settle distribution over the SETTLED lifts (`commit` | `void`); a pending contributes no sample. */
	timeToSettleMs: DistributionSummary
	/** Messages-per-lift distribution over ALL lifts. */
	messagesPerLift: DistributionSummary
	/** Void reasons summed over every non-commit lift, zero-initialised via {@link zeroVoidReasons}. */
	voidReasons: Record<VoidReason, number>
}

/** The {@link TraceEvent} variants that carry a `transactionCode` — i.e. the consensus events. */
type ConsensusTraceEvent = Extract<TraceEvent, { transactionCode: string }>

/**
 * Narrow a {@link TraceEvent} to a consensus event for the given lift. Discovery events lack
 * `transactionCode` and drop out; a consensus event for a different lift is filtered out too.
 */
function forTransaction(event: TraceEvent, transactionCode: string): event is ConsensusTraceEvent {
	return 'transactionCode' in event && event.transactionCode === transactionCode
}

/** The event-derived signals {@link analyzeLift} collects to pick a void lift's reason (see the header). */
interface VoidSignals {
	sawExpired: boolean
	sawNoPromise: boolean
	sawNoCommit: boolean
}

/**
 * The void reason for a lift, by the outcome-driven precedence documented in the module header. Returns
 * `undefined` for a `commit`. A `pending` is always `'stalled'`. A `void` resolves by its first-present
 * signal (`expired` → refusal → no-commit vote), with a defensive — unreachable — `'voted-no-commit'`.
 */
function deriveVoidReason(outcome: LiftResult['outcome'], signals: VoidSignals): VoidReason | undefined {
	switch (outcome) {
		case 'commit': {
			return undefined
		}
		case 'pending': {
			return 'stalled'
		}
		case 'void': {
			if (signals.sawExpired) {
				return 'expired'
			}
			if (signals.sawNoPromise) {
				return 'refused-promise'
			}
			if (signals.sawNoCommit) {
				return 'voted-no-commit'
			}
			// A void always has one of the above causes; this is a defensive, unreachable fallback.
			return 'voted-no-commit'
		}
	}
}

/**
 * Analyse one lift from its consensus trace events and its settled {@link LiftResult}. Filters `events` by
 * `result.transactionCode` **internally**, so it works whether handed just this lift's events or a whole
 * concurrent batch's. `messages` is the `record-pushed` count; `timeToSettleMs` spans this lift's first
 * push/promise to its last consensus event (omitted for `pending`); `voidReason` follows the module
 * header's outcome-driven precedence.
 */
export function analyzeLift(events: readonly TraceEvent[], result: LiftResult): ConsensusLiftMetrics {
	let messages = 0
	let maxTime: number | undefined
	let minStartTime: number | undefined // over record-pushed | promise-signed events only
	const signals: VoidSignals = { sawExpired: false, sawNoPromise: false, sawNoCommit: false }

	// NOTE: scans the whole `events` array per lift; the runner normally hands just this lift's events, but a
	// caller passing a whole concurrent batch to every lift makes this O(lifts × events). If batch sizes get
	// large, pre-bucket events by transactionCode once. Matches protocol-metrics.ts's analyzeQuery.
	for (const event of events) {
		if (!forTransaction(event, result.transactionCode)) {
			continue
		}
		if (maxTime === undefined || event.time > maxTime) {
			maxTime = event.time
		}
		switch (event.type) {
			case 'record-pushed': {
				messages++
				if (minStartTime === undefined || event.time < minStartTime) {
					minStartTime = event.time
				}
				break
			}
			case 'promise-signed': {
				if (minStartTime === undefined || event.time < minStartTime) {
					minStartTime = event.time
				}
				if (event.signatureType === 'NP') {
					signals.sawNoPromise = true
				}
				break
			}
			case 'signature-rejected': {
				if (event.reason === 'expired') {
					signals.sawExpired = true
				}
				break
			}
			case 'voter-vote': {
				if (event.decision === 'NC') {
					signals.sawNoCommit = true
				}
				break
			}
			default: {
				// record-received / settled / resources-released contribute only to maxTime, counted above.
				break
			}
		}
	}

	const metrics: ConsensusLiftMetrics = { outcome: result.outcome, messages }
	const voidReason = deriveVoidReason(result.outcome, signals)
	if (voidReason !== undefined) {
		metrics.voidReason = voidReason
	}
	// A settle time only for a lift that actually settled (commit|void). A pending gets none; a settled lift
	// missing any push/promise event (degenerate, should not occur) also gets none rather than a bogus span.
	// NOTE: maxTime spans to the LAST consensus event, which may be a post-`settled` `resources-released`, so
	// this is really time-to-completion (cleanup included), not strictly to the `settled` event. Chosen over
	// keying on `settled` for robustness: it yields a sample from any event, surviving a void path that emits
	// no `settled`. Revisit against the real engine's event ordering once the consensus runner lands.
	if (result.outcome !== 'pending' && minStartTime !== undefined && maxTime !== undefined) {
		metrics.timeToSettleMs = maxTime - minStartTime
	}
	return metrics
}

/**
 * Summarise a run's per-lift metrics into {@link ConsensusRunMetrics}. `lifts.length === liftCount`. Reuses
 * `summarizeDistribution` from `metrics.ts`; guards `pCommitGivenFound` against 0/0 (→ 0, never NaN); sums
 * each non-commit lift's `voidReason` into the tally (a commit adds nothing). `timeToSettleMs` is
 * distributed over the lifts whose `timeToSettleMs` is defined (the settled ones); `messagesPerLift` is
 * over all lifts. `queryCount` and `StructuralMetrics` carry through from the runner unchanged.
 */
export function summarizeConsensusMetrics(
	lifts: readonly ConsensusLiftMetrics[],
	structural: StructuralMetrics,
	queryCount: number,
): ConsensusRunMetrics {
	let commitCount = 0
	let voidCount = 0
	let pendingCount = 0
	const settleTimes: number[] = []
	const messages: number[] = []
	const voidReasons = zeroVoidReasons()

	for (const lift of lifts) {
		switch (lift.outcome) {
			case 'commit': {
				commitCount++
				break
			}
			case 'void': {
				voidCount++
				break
			}
			case 'pending': {
				pendingCount++
				break
			}
		}
		if (lift.voidReason !== undefined) {
			voidReasons[lift.voidReason]++
		}
		if (lift.timeToSettleMs !== undefined) {
			settleTimes.push(lift.timeToSettleMs)
		}
		messages.push(lift.messages)
	}

	const liftCount = lifts.length
	return {
		queryCount,
		meanDegree: structural.meanDegree,
		largestComponentFraction: structural.largestComponentFraction,
		liftCount,
		commitCount,
		voidCount,
		pendingCount,
		pCommitGivenFound: liftCount > 0 ? commitCount / liftCount : 0,
		timeToSettleMs: summarizeDistribution(settleTimes),
		messagesPerLift: summarizeDistribution(messages),
		voidReasons,
	}
}
