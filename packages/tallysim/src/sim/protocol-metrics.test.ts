import type { TraceEvent } from 'tallynet'
import type { StructuralMetrics } from '../metrics.js'
import type { QueryOutcome } from './harness.js'
import {
	ALL_PRUNE_REASONS,
	analyzeQuery,
	summarizeProtocolMetrics,
	zeroPruneReasons,
	type ProtocolQueryResult,
} from './protocol-metrics.js'

/** A QueryOutcome with `plansFound` plans (their contents are irrelevant to the metrics). */
function outcome(sessionCode: string, plansFound: number): QueryOutcome {
	const plans = Array.from({ length: plansFound }, () => ({})) as unknown as QueryOutcome['plans']
	return { sessionCode, plans, found: plansFound > 0 }
}

const STRUCTURAL: StructuralMetrics = { meanDegree: 3, largestComponentFraction: 1 }

describe('zeroPruneReasons / ALL_PRUNE_REASONS', () => {
	it('covers exactly the six discovery reasons, all zeroed', () => {
		expect([...ALL_PRUNE_REASONS].sort()).toEqual(['cycle', 'expired', 'failed', 'max-depth', 'no-reentrance', 'timed-out'])
		const zeroed = zeroPruneReasons()
		expect(Object.values(zeroed)).toEqual([0, 0, 0, 0, 0, 0])
	})
})

describe('analyzeQuery — a found 2-hop query (hand trace)', () => {
	const session = 'S1'
	const events: TraceEvent[] = [
		{ type: 'round-started', time: 0, nodeId: 'E0', sessionCode: session, round: 0, budgetMs: 100 },
		{ type: 'query-sent', time: 0, nodeId: 'E0', sessionCode: session, nonce: 'n1', depth: 3, round: 0 },
		{ type: 'query-sent', time: 10, nodeId: 'E1', sessionCode: session, nonce: 'n2', depth: 2, round: 0 },
		{ type: 'candidate-pruned', time: 15, nodeId: 'E1', sessionCode: session, nonce: 'n3', reason: 'cycle' },
		{ type: 'round-started', time: 20, nodeId: 'E0', sessionCode: session, round: 1, budgetMs: 100 },
		{ type: 'plan-found', time: 30, nodeId: 'E0', sessionCode: session },
		// A different session's event, to prove analyzeQuery filters by sessionCode.
		{ type: 'query-sent', time: 5, nodeId: 'E9', sessionCode: 'OTHER', nonce: 'x', depth: 3, round: 7 },
	]

	it('reads messages/nodes/rounds/times/prunes from only this session, by hand', () => {
		const result = analyzeQuery(events, outcome(session, 2), true, { startMs: 0, endMs: 100 })
		expect(result.found).toBe(true)
		expect(result.plansFound).toBe(2)
		expect(result.routeExists).toBe(true)
		expect(result.messages).toBe(2) // two query-sent for S1 (the OTHER session's is excluded)
		expect(result.nodesTouched).toBe(2) // E0, E1 (not E9)
		expect(result.roundsUsed).toBe(1) // max round over round-started/query-sent (round 1), not OTHER's 7
		expect(result.timeToFirstPlanMs).toBe(30) // first plan-found at t=30, minus startMs 0
		expect(result.timeToCompletionMs).toBe(30) // last S1 event at t=30, minus startMs 0
		expect(result.pruneReasons.cycle).toBe(1)
		expect(result.pruneReasons.failed).toBe(0)
	})
})

describe('analyzeQuery — a session with no events uses the settle time', () => {
	it('falls back to endMs for completion and leaves the first-plan time undefined', () => {
		const result = analyzeQuery([], outcome('EMPTY', 0), false, { startMs: 5, endMs: 50 })
		expect(result.found).toBe(false)
		expect(result.plansFound).toBe(0)
		expect(result.messages).toBe(0)
		expect(result.nodesTouched).toBe(0)
		expect(result.roundsUsed).toBe(0)
		expect(result.timeToFirstPlanMs).toBeUndefined()
		expect(result.timeToCompletionMs).toBe(45) // endMs 50 − startMs 5 (no events to read a last-time from)
		expect(Object.values(result.pruneReasons)).toEqual([0, 0, 0, 0, 0, 0])
	})
})

describe('analyzeQuery — a folded late answer is not double-counted', () => {
	it('late-answer-folded adds to neither messages nor roundsUsed (those read query-sent / round counters)', () => {
		const session = 'LATE'
		const events: TraceEvent[] = [
			{ type: 'query-sent', time: 0, nodeId: 'E0', sessionCode: session, nonce: 'n1', depth: 8, round: 0 },
			{ type: 'round-started', time: 100, nodeId: 'E0', sessionCode: session, round: 1, budgetMs: 100 },
			// A late answer folded into a much later round: its `round: 9` must NOT raise roundsUsed, and the
			// event must NOT raise the message count (only query-sent counts as a message).
			{ type: 'late-answer-folded', time: 3000, nodeId: 'E1', sessionCode: session, nonce: 'n1', round: 9 },
			{ type: 'plan-found', time: 3000, nodeId: 'E0', sessionCode: session },
		]
		const result = analyzeQuery(events, outcome(session, 1), true, { startMs: 0, endMs: 3000 })
		expect(result.messages).toBe(1) // only the one query-sent, not the folded answer
		expect(result.roundsUsed).toBe(1) // max of round-started=1 / query-sent=0, not the folded round 9
		expect(result.found).toBe(true)
		expect(result.timeToFirstPlanMs).toBe(3000)
		expect(result.timeToCompletionMs).toBe(3000)
	})
})

describe('summarizeProtocolMetrics — mixed results', () => {
	function result(over: Partial<ProtocolQueryResult>): ProtocolQueryResult {
		return {
			routeExists: false,
			found: false,
			plansFound: 0,
			timeToCompletionMs: 0,
			messages: 0,
			nodesTouched: 0,
			roundsUsed: 0,
			pruneReasons: zeroPruneReasons(),
			...over,
		}
	}

	it('counts the found/exists cells, guards pFoundGivenExists, and sums prune reasons', () => {
		const results: ProtocolQueryResult[] = [
			result({ routeExists: true, found: true, plansFound: 1, timeToFirstPlanMs: 10, timeToCompletionMs: 20, messages: 3, nodesTouched: 2, roundsUsed: 1, pruneReasons: { ...zeroPruneReasons(), cycle: 1 } }),
			result({ routeExists: true, found: false, timeToCompletionMs: 40, messages: 5, nodesTouched: 4, roundsUsed: 2, pruneReasons: { ...zeroPruneReasons(), failed: 2 } }),
			result({ routeExists: false, found: false, timeToCompletionMs: 5, messages: 1, nodesTouched: 1 }),
		]
		const metrics = summarizeProtocolMetrics(results, STRUCTURAL)
		expect(metrics.queryCount).toBe(3)
		expect(metrics.routeExistsCount).toBe(2)
		expect(metrics.foundCount).toBe(1)
		expect(metrics.foundAndExistsCount).toBe(1)
		expect(metrics.pFoundGivenExists).toBe(0.5)
		expect(metrics.falseFoundCount).toBe(0)
		expect(metrics.meanDegree).toBe(3)
		expect(metrics.largestComponentFraction).toBe(1)
		// timeToFirstPlanMs is over found queries only (one sample: 10).
		expect(metrics.timeToFirstPlanMs.count).toBe(1)
		expect(metrics.timeToFirstPlanMs.mean).toBe(10)
		// Other distributions are over all three queries.
		expect(metrics.timeToCompletionMs.count).toBe(3)
		expect(metrics.messages.count).toBe(3)
		expect(metrics.pruneReasons.cycle).toBe(1)
		expect(metrics.pruneReasons.failed).toBe(2)
	})

	it('counts a false-found (found but no oracle route) — a guardrail the runner asserts is 0', () => {
		const metrics = summarizeProtocolMetrics([result({ routeExists: false, found: true, plansFound: 1 })], STRUCTURAL)
		expect(metrics.falseFoundCount).toBe(1)
		expect(metrics.foundAndExistsCount).toBe(0)
	})

	it('zero queries and zero existing routes give pFoundGivenExists 0, never NaN', () => {
		const empty = summarizeProtocolMetrics([], STRUCTURAL)
		expect(empty.queryCount).toBe(0)
		expect(empty.pFoundGivenExists).toBe(0)
		expect(Number.isNaN(empty.pFoundGivenExists)).toBe(false)
		expect(empty.timeToCompletionMs.count).toBe(0)

		const noRoutes = summarizeProtocolMetrics([result({}), result({})], STRUCTURAL)
		expect(noRoutes.routeExistsCount).toBe(0)
		expect(noRoutes.pFoundGivenExists).toBe(0)
		expect(Number.isNaN(noRoutes.pFoundGivenExists)).toBe(false)
	})
})
