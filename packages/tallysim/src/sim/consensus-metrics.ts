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
 *   - `pending` ⇒ always `'stalled'`. Pending means no decision was reached — the dead-voter case (a voter
 *     majority that never heard the record: the needed voter cut off by a dropped push or asleep, so no
 *     reachable voter ever votes and the recovery loop abandoned), or a split voter set that cleared no
 *     threshold. (An incomplete set whose voter is REACHABLE is NOT pending: that voter votes `NC` at its
 *     deadline — a `void`, classified `'voted-no-commit'` below — exactly as a late-but-completing lift does.)
 *     We do **not** infer a different reason from stray `NP`/`NC` events that never carried the lift to a decision.
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
	 * Present only for a settled lift (`commit` | `void`); **omitted for `pending`** (nothing settled). A
	 * deadline-driven void is a `void`, so timeout-driven settlements contribute a span here too.
	 */
	timeToSettleMs?: number
	/** Count of `record-pushed` events for this lift — the push is the consensus message. */
	messages: number
	/** The void reason for a non-commit lift (`void` **or** `pending`); omitted for a `commit`. */
	voidReason?: VoidReason
	/** Distinct route members allowed to reach commit (non-relayers/silent excluded); from the {@link LiftResult}. */
	cooperatingMembers: number
	/** How many of those cooperating members reached `commit` after settle + recovery; from the {@link LiftResult}. */
	cooperatingCommitted: number
	/**
	 * Count of `record-pulled` trace events for this lift — the protocol's own recovery-loop pulls (the
	 * simulator drives none). A happy-path lift that settled before its deadline emits none; a lift whose
	 * member was stranded runs the loop and emits ≥1.
	 */
	pullMessages: number
	/**
	 * `1` iff the lift **settled** (`commit` | `void`) **and** emitted ≥1 `record-pulled` **or** `recovery-tick`
	 * event — i.e. the recovery loop had to run to carry a stranded member home — else `0`. A clean
	 * happy-commit or refuser-void (nobody stranded) is `0`. May be non-zero in a drop-sweep where a drop
	 * strands a member who then self-heals; that is the honest value.
	 */
	recovered: number
	/**
	 * Ms the lift held credit: the span from the **first** `promise-signed` carrying a `P` signature (a `P`
	 * promise holds credit; an `NP` holds nothing) to the **last** `resources-released`, both for this lift.
	 * Omitted when either endpoint is absent (no credit-holding promise, or no release seen).
	 */
	creditHeldMs?: number
	/**
	 * `true` iff the lift is `pending` **and** never emitted a `resources-released` event — credit was tied up
	 * and never freed. Tied to "resources never released" (not merely "pending") so it stays correct if a
	 * future path ever releases resources on abandon.
	 */
	permanentlyPending: boolean
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
	/**
	 * Time-to-settle distribution over the SETTLED lifts (`commit` | `void`); a pending contributes no sample.
	 * A deadline-driven void is a `void`, so timeout-driven settlements are included in this distribution.
	 */
	timeToSettleMs: DistributionSummary
	/** Messages-per-lift distribution over ALL lifts. */
	messagesPerLift: DistributionSummary
	/** Void reasons summed over every non-commit lift, zero-initialised via {@link zeroVoidReasons}. */
	voidReasons: Record<VoidReason, number>
	/** Σ `cooperatingMembers` over all lifts — the denominator of {@link cooperatingCompletion}. */
	cooperatingMemberTotal: number
	/** Σ `cooperatingCommitted` over all lifts — the numerator of {@link cooperatingCompletion}. */
	cooperatingCommittedTotal: number
	/**
	 * `cooperatingCommittedTotal / cooperatingMemberTotal`, or 0 when `cooperatingMemberTotal === 0` (never
	 * NaN) — the principle-3 completion curve's y-axis, plotted against the swept `consensus.nonRelayerFraction`.
	 */
	cooperatingCompletion: number
	/** Pulls-per-lift distribution over ALL lifts — the extra messages a pull costs (pulls buy completions). */
	pullMessagesPerLift: DistributionSummary
	/** Σ `recovered` over all lifts — the settled lifts whose protocol recovery loop had to run. */
	recoveredTotal: number
	/**
	 * How many plans the originator's voter-aware scorer **refused** (dropped as `-Infinity`) for carrying a
	 * stacked voter set, summed over the run. This counts **discovery-time** refusals — plans dropped before a
	 * lift ever formed — not voided lifts. The voter-aware *reordering* is a ranking, not a refusal, and is
	 * intentionally not counted here. 0 unless `consensus.stackedVoters > 0`. See the voter-model subsection.
	 */
	planRefusalCount: number
	/** `planRefusalCount / queryCount`, or 0 when `queryCount === 0` (never NaN) — the refused-plan rate. */
	planRefusalShare: number
	/**
	 * Credit-held-time distribution over the lifts whose {@link ConsensusLiftMetrics.creditHeldMs} is defined
	 * (a first-`P`-promise through a last release); a lift that never held credit or never released contributes
	 * no sample. Measures how long a lift ties credit up before it is freed.
	 */
	creditHeldMsPerLift: DistributionSummary
	/** Σ `permanentlyPending` — lifts left `pending` with their resources never released (credit never freed). */
	permanentlyPendingCount: number
	/** `permanentlyPendingCount / liftCount`, or 0 when `liftCount === 0` (never NaN) — the never-resolved rate. */
	permanentlyPendingFraction: number
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
 * concurrent batch's. `messages` is the `record-pushed` count; `pullMessages` the `record-pulled` count;
 * `timeToSettleMs` spans this lift's first push/promise to its last consensus event (omitted for `pending`);
 * `recovered` is 1 iff the lift settled and its recovery loop ran (a `record-pulled` / `recovery-tick`);
 * `creditHeldMs` spans the first credit-holding (`P`) promise to the last `resources-released`;
 * `permanentlyPending` flags a pending lift whose resources were never released; `voidReason` follows the
 * module header's outcome-driven precedence. Pure and O(events) — one pass, no allocation per event.
 */
export function analyzeLift(events: readonly TraceEvent[], result: LiftResult): ConsensusLiftMetrics {
	let messages = 0
	let pullMessages = 0
	let sawRecoveryActivity = false // a record-pulled or recovery-tick fired ⇒ the recovery loop ran
	let maxTime: number | undefined
	let minStartTime: number | undefined // over record-pushed | promise-signed events only
	let firstCreditPromise: number | undefined // earliest promise-signed 'P' (a P promise holds credit)
	let lastRelease: number | undefined // latest resources-released
	let sawRelease = false
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
			case 'record-pulled': {
				pullMessages++
				sawRecoveryActivity = true
				break
			}
			case 'recovery-tick': {
				// Emitted only on the force-repush path of a non-settling tick, so it is not always present on a
				// recovered lift — hence `recovered` also keys on `record-pulled`. Its presence alone still marks
				// recovery-loop activity.
				sawRecoveryActivity = true
				break
			}
			case 'promise-signed': {
				if (minStartTime === undefined || event.time < minStartTime) {
					minStartTime = event.time
				}
				if (event.signatureType === 'NP') {
					signals.sawNoPromise = true
				} else if (firstCreditPromise === undefined || event.time < firstCreditPromise) {
					// signatureType === 'P' — a credit-holding promise; track its earliest time for creditHeldMs.
					firstCreditPromise = event.time
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
			case 'resources-released': {
				sawRelease = true
				if (lastRelease === undefined || event.time > lastRelease) {
					lastRelease = event.time
				}
				break
			}
			default: {
				// record-received / settled / deadline-reached / … contribute only to maxTime, counted above.
				break
			}
		}
	}

	const settled = result.outcome === 'commit' || result.outcome === 'void'
	const metrics: ConsensusLiftMetrics = {
		outcome: result.outcome,
		messages,
		cooperatingMembers: result.cooperatingMembers,
		cooperatingCommitted: result.cooperatingCommitted,
		pullMessages,
		recovered: settled && sawRecoveryActivity ? 1 : 0,
		permanentlyPending: result.outcome === 'pending' && !sawRelease,
	}
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
	// Credit-held span: the first credit-holding (`P`) promise to the last release. Both endpoints must be
	// present. The `lastRelease >= firstCreditPromise` guard documents intent — releases follow promises, so it
	// holds — and defends the metric against an out-of-order trace rather than emitting a negative span.
	if (firstCreditPromise !== undefined && lastRelease !== undefined && lastRelease >= firstCreditPromise) {
		metrics.creditHeldMs = lastRelease - firstCreditPromise
	}
	return metrics
}

/**
 * Summarise a run's per-lift metrics into {@link ConsensusRunMetrics}. `lifts.length === liftCount`. Reuses
 * `summarizeDistribution` from `metrics.ts`; guards `pCommitGivenFound` against 0/0 (→ 0, never NaN); sums
 * each non-commit lift's `voidReason` into the tally (a commit adds nothing). `timeToSettleMs` is
 * distributed over the lifts whose `timeToSettleMs` is defined (the settled ones); `messagesPerLift` is
 * over all lifts. `queryCount` and `StructuralMetrics` carry through from the runner unchanged. The
 * principle-3 aggregates sum each lift's cooperating-member counts: `cooperatingCompletion` is
 * `cooperatingCommittedTotal / cooperatingMemberTotal` guarded to 0 when no cooperating members exist (never
 * NaN); `pullMessagesPerLift` distributes the pull cost over all lifts; `recoveredTotal` sums the per-lift
 * `recovered` 0/1 flag — the settled lifts whose recovery loop ran. `creditHeldMsPerLift` distributes the defined per-lift credit-held spans only (like
 * `timeToSettleMs`); `permanentlyPendingCount` sums the never-released pending lifts and
 * `permanentlyPendingFraction` divides it by `liftCount`, guarded to 0 (never NaN) when there are no lifts.
 */
export function summarizeConsensusMetrics(
	lifts: readonly ConsensusLiftMetrics[],
	structural: StructuralMetrics,
	queryCount: number,
	planRefusalCount = 0,
): ConsensusRunMetrics {
	let commitCount = 0
	let voidCount = 0
	let pendingCount = 0
	let cooperatingMemberTotal = 0
	let cooperatingCommittedTotal = 0
	let recoveredTotal = 0
	let permanentlyPendingCount = 0
	const settleTimes: number[] = []
	const messages: number[] = []
	const pullMessages: number[] = []
	const creditHeldTimes: number[] = []
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
		if (lift.creditHeldMs !== undefined) {
			creditHeldTimes.push(lift.creditHeldMs)
		}
		if (lift.permanentlyPending) {
			permanentlyPendingCount++
		}
		messages.push(lift.messages)
		pullMessages.push(lift.pullMessages)
		cooperatingMemberTotal += lift.cooperatingMembers
		cooperatingCommittedTotal += lift.cooperatingCommitted
		recoveredTotal += lift.recovered
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
		cooperatingMemberTotal,
		cooperatingCommittedTotal,
		// NOTE: a refuser-voided lift contributes 0/N here just like a stranded one, so if a sweep ever varies
		// `refuserFraction` AND `nonRelayerFraction` together this number conflates "refused" with "stranded".
		// Today only `nonRelayerFraction` is swept, so it reads cleanly; split it by void-reason if that changes.
		cooperatingCompletion: cooperatingMemberTotal > 0 ? cooperatingCommittedTotal / cooperatingMemberTotal : 0,
		pullMessagesPerLift: summarizeDistribution(pullMessages),
		recoveredTotal,
		planRefusalCount,
		planRefusalShare: queryCount > 0 ? planRefusalCount / queryCount : 0,
		creditHeldMsPerLift: summarizeDistribution(creditHeldTimes),
		permanentlyPendingCount,
		permanentlyPendingFraction: liftCount > 0 ? permanentlyPendingCount / liftCount : 0,
	}
}
