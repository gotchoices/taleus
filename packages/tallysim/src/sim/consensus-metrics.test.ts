import type { TraceEvent } from 'tallynet'
import type { StructuralMetrics } from '../metrics.js'
import type { LiftResult } from './consensus-harness.js'
import {
	ALL_VOID_REASONS,
	analyzeLift,
	summarizeConsensusMetrics,
	zeroVoidReasons,
	type ConsensusLiftMetrics,
} from './consensus-metrics.js'

const STRUCTURAL: StructuralMetrics = { meanDegree: 3, largestComponentFraction: 1 }

/** A LiftResult with the given code and outcome; route/amount are irrelevant to these metrics. */
function lift(transactionCode: string, outcome: LiftResult['outcome']): LiftResult {
	return { transactionCode, sessionCode: 'S1', route: [0, 1, 0], tallyPath: [0, 1], amount: 10, outcome }
}

describe('zeroVoidReasons / ALL_VOID_REASONS', () => {
	it('covers exactly the four reasons, all zeroed', () => {
		expect([...ALL_VOID_REASONS].sort()).toEqual(['expired', 'refused-promise', 'stalled', 'voted-no-commit'])
		const zeroed = zeroVoidReasons()
		expect(Object.values(zeroed)).toEqual([0, 0, 0, 0])
	})
})

describe('analyzeLift — a committed lift (hand trace)', () => {
	const tx = 'TX1'
	const events: TraceEvent[] = [
		{ type: 'record-pushed', time: 0, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, to: 'E1', promiseCount: 0, commitCount: 0, ok: true },
		{ type: 'promise-signed', time: 5, nodeId: 'E1', sessionCode: 'S1', transactionCode: tx, signatureType: 'P' },
		{ type: 'record-pushed', time: 10, nodeId: 'E1', sessionCode: 'S1', transactionCode: tx, to: 'E0', promiseCount: 1, commitCount: 0, ok: true },
		{ type: 'referee-vote', time: 15, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision: 'C' },
		{ type: 'settled', time: 20, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision: 'commit' },
		// A discovery event (no transactionCode) and another lift's event — both must be ignored.
		{ type: 'query-sent', time: 3, nodeId: 'E9', sessionCode: 'S1', nonce: 'n', depth: 3, round: 0 },
		{ type: 'record-pushed', time: 99, nodeId: 'E7', sessionCode: 'S1', transactionCode: 'OTHER', to: 'E8', promiseCount: 0, commitCount: 0, ok: true },
	]

	it('reads messages and the settle span from only this lift, with no void reason', () => {
		const metrics = analyzeLift(events, lift(tx, 'commit'))
		expect(metrics.outcome).toBe('commit')
		expect(metrics.messages).toBe(2) // two record-pushed for TX1 (OTHER's and the discovery event excluded)
		expect(metrics.timeToSettleMs).toBe(20) // last event t=20 − first push t=0
		expect(metrics.voidReason).toBeUndefined()
	})
})

describe('analyzeLift — a refused (NP) void', () => {
	it('maps an NP refusal on a void to refused-promise', () => {
		const tx = 'TX2'
		const events: TraceEvent[] = [
			{ type: 'record-pushed', time: 0, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, to: 'E1', promiseCount: 0, commitCount: 0, ok: true },
			{ type: 'promise-signed', time: 8, nodeId: 'E1', sessionCode: 'S1', transactionCode: tx, signatureType: 'NP' },
			{ type: 'settled', time: 12, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision: 'void' },
		]
		const metrics = analyzeLift(events, lift(tx, 'void'))
		expect(metrics.outcome).toBe('void')
		expect(metrics.voidReason).toBe('refused-promise')
		expect(metrics.timeToSettleMs).toBe(12) // t=12 − first push/promise t=0
	})
})

describe('analyzeLift — a no-commit vote void', () => {
	it('maps an NC vote (no NP, no expiry) to voted-no-commit', () => {
		const tx = 'TX3'
		const events: TraceEvent[] = [
			{ type: 'record-pushed', time: 0, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, to: 'E1', promiseCount: 0, commitCount: 0, ok: true },
			{ type: 'promise-signed', time: 4, nodeId: 'E1', sessionCode: 'S1', transactionCode: tx, signatureType: 'P' },
			{ type: 'referee-vote', time: 9, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision: 'NC' },
			{ type: 'settled', time: 11, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision: 'void' },
		]
		const metrics = analyzeLift(events, lift(tx, 'void'))
		expect(metrics.voidReason).toBe('voted-no-commit')
	})
})

describe('analyzeLift — a stalled (pending) lift', () => {
	it('is always stalled and yields no settle-time sample', () => {
		const tx = 'TX4'
		const events: TraceEvent[] = [
			{ type: 'record-pushed', time: 0, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, to: 'E1', promiseCount: 0, commitCount: 0, ok: true },
			// A stray NP that never reached a decision must NOT override 'stalled' for a pending outcome.
			{ type: 'promise-signed', time: 6, nodeId: 'E1', sessionCode: 'S1', transactionCode: tx, signatureType: 'NP' },
		]
		const metrics = analyzeLift(events, lift(tx, 'pending'))
		expect(metrics.outcome).toBe('pending')
		expect(metrics.voidReason).toBe('stalled')
		expect(metrics.timeToSettleMs).toBeUndefined()
	})
})

describe('analyzeLift — expired beats a co-present NP', () => {
	it('an expired signature-rejection on a void wins over a refusal', () => {
		const tx = 'TX5'
		const events: TraceEvent[] = [
			{ type: 'record-pushed', time: 0, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, to: 'E1', promiseCount: 0, commitCount: 0, ok: true },
			{ type: 'promise-signed', time: 5, nodeId: 'E1', sessionCode: 'S1', transactionCode: tx, signatureType: 'NP' },
			{ type: 'signature-rejected', time: 7, nodeId: 'E1', sessionCode: 'S1', transactionCode: tx, reason: 'expired' },
			{ type: 'settled', time: 9, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision: 'void' },
		]
		const metrics = analyzeLift(events, lift(tx, 'void'))
		expect(metrics.voidReason).toBe('expired')
	})
})

describe('analyzeLift — a refuser AND a dropped edge counts once', () => {
	it('an NP on a void counts once as refused-promise (refusal observed before any stall)', () => {
		const tx = 'TX6'
		const events: TraceEvent[] = [
			{ type: 'record-pushed', time: 0, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, to: 'E1', promiseCount: 0, commitCount: 0, ok: true },
			{ type: 'promise-signed', time: 5, nodeId: 'E1', sessionCode: 'S1', transactionCode: tx, signatureType: 'NP' },
			// A dropped push elsewhere, but the refusal still carried the lift to a void decision.
			{ type: 'record-pushed', time: 6, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, to: 'E2', promiseCount: 0, commitCount: 0, ok: false },
			{ type: 'settled', time: 10, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision: 'void' },
		]
		const metrics = analyzeLift(events, lift(tx, 'void'))
		expect(metrics.voidReason).toBe('refused-promise')
	})
})

describe('summarizeConsensusMetrics — mixed lifts', () => {
	function liftMetrics(over: Partial<ConsensusLiftMetrics>): ConsensusLiftMetrics {
		return { outcome: 'commit', messages: 0, ...over }
	}

	it('counts commit/void/pending, guards pCommitGivenFound, and sums void reasons', () => {
		const lifts: ConsensusLiftMetrics[] = [
			liftMetrics({ outcome: 'commit', messages: 2, timeToSettleMs: 20 }),
			liftMetrics({ outcome: 'void', messages: 3, timeToSettleMs: 12, voidReason: 'refused-promise' }),
			liftMetrics({ outcome: 'pending', messages: 1, voidReason: 'stalled' }),
		]
		const metrics = summarizeConsensusMetrics(lifts, STRUCTURAL, 10)
		expect(metrics.queryCount).toBe(10)
		expect(metrics.liftCount).toBe(3)
		expect(metrics.commitCount).toBe(1)
		expect(metrics.voidCount).toBe(1)
		expect(metrics.pendingCount).toBe(1)
		expect(metrics.pCommitGivenFound).toBeCloseTo(1 / 3)
		expect(metrics.meanDegree).toBe(3)
		expect(metrics.largestComponentFraction).toBe(1)
		// timeToSettleMs is over the two settled lifts only (samples 20, 12); the pending contributes none.
		expect(metrics.timeToSettleMs.count).toBe(2)
		expect(metrics.timeToSettleMs.mean).toBe(16)
		// messagesPerLift is over all three lifts.
		expect(metrics.messagesPerLift.count).toBe(3)
		expect(metrics.voidReasons['refused-promise']).toBe(1)
		expect(metrics.voidReasons.stalled).toBe(1)
		expect(metrics.voidReasons['voted-no-commit']).toBe(0)
		expect(metrics.voidReasons.expired).toBe(0)
	})

	it('an all-commit run gives pCommitGivenFound 1 and an all-zero void tally', () => {
		const metrics = summarizeConsensusMetrics(
			[liftMetrics({ outcome: 'commit', messages: 2, timeToSettleMs: 8 })],
			STRUCTURAL,
			1,
		)
		expect(metrics.pCommitGivenFound).toBe(1)
		expect(Object.values(metrics.voidReasons)).toEqual([0, 0, 0, 0])
		expect(metrics.timeToSettleMs.count).toBe(1)
	})

	it('zero lifts give pCommitGivenFound 0 (never NaN), an all-zero tally, and empty distributions', () => {
		const metrics = summarizeConsensusMetrics([], STRUCTURAL, 0)
		expect(metrics.liftCount).toBe(0)
		expect(metrics.pCommitGivenFound).toBe(0)
		expect(Number.isNaN(metrics.pCommitGivenFound)).toBe(false)
		expect(Object.values(metrics.voidReasons)).toEqual([0, 0, 0, 0])
		expect(metrics.timeToSettleMs.count).toBe(0)
		expect(metrics.messagesPerLift.count).toBe(0)
	})
})

describe('analyzeLift + summarizeConsensusMetrics — end to end over hand traces', () => {
	it('a commit, an NP void, and a stall summarise to the expected run metrics', () => {
		const commitEvents: TraceEvent[] = [
			{ type: 'record-pushed', time: 0, nodeId: 'E0', sessionCode: 'S1', transactionCode: 'C', to: 'E1', promiseCount: 0, commitCount: 0, ok: true },
			{ type: 'promise-signed', time: 5, nodeId: 'E1', sessionCode: 'S1', transactionCode: 'C', signatureType: 'P' },
			{ type: 'settled', time: 10, nodeId: 'E0', sessionCode: 'S1', transactionCode: 'C', decision: 'commit' },
		]
		const voidEvents: TraceEvent[] = [
			{ type: 'record-pushed', time: 0, nodeId: 'E0', sessionCode: 'S1', transactionCode: 'V', to: 'E1', promiseCount: 0, commitCount: 0, ok: true },
			{ type: 'promise-signed', time: 3, nodeId: 'E1', sessionCode: 'S1', transactionCode: 'V', signatureType: 'NP' },
			{ type: 'settled', time: 6, nodeId: 'E0', sessionCode: 'S1', transactionCode: 'V', decision: 'void' },
		]
		const stallEvents: TraceEvent[] = [
			{ type: 'record-pushed', time: 0, nodeId: 'E0', sessionCode: 'S1', transactionCode: 'P', to: 'E1', promiseCount: 0, commitCount: 0, ok: true },
		]
		const lifts = [
			analyzeLift(commitEvents, lift('C', 'commit')),
			analyzeLift(voidEvents, lift('V', 'void')),
			analyzeLift(stallEvents, lift('P', 'pending')),
		]
		const metrics = summarizeConsensusMetrics(lifts, STRUCTURAL, 5)
		expect(metrics.queryCount).toBe(5)
		expect(metrics.liftCount).toBe(3)
		expect(metrics.commitCount).toBe(1)
		expect(metrics.voidCount).toBe(1)
		expect(metrics.pendingCount).toBe(1)
		expect(metrics.voidReasons['refused-promise']).toBe(1)
		expect(metrics.voidReasons.stalled).toBe(1)
		expect(metrics.timeToSettleMs.count).toBe(2) // commit (10) and void (6); the stall has no sample
		expect(metrics.messagesPerLift.count).toBe(3)
		expect(metrics.messagesPerLift.max).toBe(1)
	})
})
