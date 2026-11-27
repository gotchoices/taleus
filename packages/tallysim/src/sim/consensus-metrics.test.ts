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
function lift(transactionCode: string, outcome: LiftResult['outcome'], over: Partial<LiftResult> = {}): LiftResult {
	return {
		transactionCode,
		sessionCode: 'S1',
		route: [0, 1, 0],
		tallyPath: [0, 1],
		amount: 10,
		outcome,
		cooperatingMembers: 0,
		cooperatingCommitted: 0,
		...over,
	}
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
		{ type: 'voter-vote', time: 15, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision: 'C' },
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
			{ type: 'voter-vote', time: 9, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision: 'NC' },
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

// Small event builders for the timeout-metric traces below, so each test reads as a list of moments.
const pushed = (tx: string, time: number): TraceEvent => ({ type: 'record-pushed', time, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, to: 'E1', promiseCount: 0, commitCount: 0, ok: true })
const promise = (tx: string, time: number, signatureType: 'P' | 'NP'): TraceEvent => ({ type: 'promise-signed', time, nodeId: 'E1', sessionCode: 'S1', transactionCode: tx, signatureType })
const vote = (tx: string, time: number, decision: 'C' | 'NC'): TraceEvent => ({ type: 'voter-vote', time, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision })
const settledAt = (tx: string, time: number, decision: 'commit' | 'void'): TraceEvent => ({ type: 'settled', time, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, decision })
const released = (tx: string, time: number): TraceEvent => ({ type: 'resources-released', time, nodeId: 'E0', sessionCode: 'S1', transactionCode: tx, success: true })
const pulled = (tx: string, time: number, ok = true): TraceEvent => ({ type: 'record-pulled', time, nodeId: 'E3', sessionCode: 'S1', transactionCode: tx, from: 'E0', ok })
const tick = (tx: string, time: number, attempt: number): TraceEvent => ({ type: 'recovery-tick', time, nodeId: 'E3', sessionCode: 'S1', transactionCode: tx, attempt, changed: true })

describe('analyzeLift — a deadline-driven void settles like any other void', () => {
	it('an NC vote at the deadline voids as voted-no-commit and yields a finite timeToSettleMs', () => {
		// The engine never emits a `signature-rejected`/`expired` for a timeout; a deadline-driven void surfaces
		// as a `voter-vote` NC (see tallynet-expired-reason-unemitted), so the existing void precedence maps it to
		// `voted-no-commit` with no participant.ts change. The settle span is finite (not Infinity) across it.
		const tx = 'TXDL'
		const events: TraceEvent[] = [
			pushed(tx, 0),
			promise(tx, 5, 'P'),
			vote(tx, 600_000, 'NC'), // the deadline fires: the voter votes no-commit
			settledAt(tx, 600_010, 'void'),
			released(tx, 600_020),
		]
		const metrics = analyzeLift(events, lift(tx, 'void'))
		expect(metrics.voidReason).toBe('voted-no-commit')
		expect(metrics.timeToSettleMs).toBe(600_020) // last event (release) − first push (0)
		expect(Number.isFinite(metrics.timeToSettleMs!)).toBe(true)
	})
})

describe('analyzeLift — pull messages and the recovered 0/1 flag', () => {
	it('counts record-pulled events as pullMessages', () => {
		const tx = 'TXPULL'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'P'), settledAt(tx, 10, 'commit'), pulled(tx, 20), pulled(tx, 25, false)]
		expect(analyzeLift(events, lift(tx, 'commit')).pullMessages).toBe(2)
	})

	it('recovered is 1 for a settled lift whose recovery loop ran (a record-pulled)', () => {
		const tx = 'TXREC1'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'P'), settledAt(tx, 10, 'commit'), pulled(tx, 20)]
		expect(analyzeLift(events, lift(tx, 'commit')).recovered).toBe(1)
	})

	it('recovered is 1 when only a recovery-tick (no record-pulled) marks the loop running', () => {
		const tx = 'TXREC1b'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'P'), settledAt(tx, 10, 'commit'), tick(tx, 18, 1)]
		const metrics = analyzeLift(events, lift(tx, 'commit'))
		expect(metrics.pullMessages).toBe(0) // the tick is not a pull
		expect(metrics.recovered).toBe(1)
	})

	it('recovered is 0 for a clean settled lift with no recovery activity', () => {
		const tx = 'TXREC0'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'P'), settledAt(tx, 10, 'commit')]
		expect(analyzeLift(events, lift(tx, 'commit')).recovered).toBe(0)
	})

	it('recovered is 0 for a pending lift even when a recovery-tick fired (it never settled)', () => {
		const tx = 'TXRECP'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'P'), tick(tx, 30, 1), pulled(tx, 35)]
		expect(analyzeLift(events, lift(tx, 'pending')).recovered).toBe(0)
	})
})

describe('analyzeLift — creditHeldMs spans the first credit-holding promise to the last release', () => {
	it('spans the earliest P promise to the latest resources-released', () => {
		const tx = 'TXCR'
		const events: TraceEvent[] = [
			pushed(tx, 0),
			promise(tx, 5, 'P'), // the first credit-holding promise
			promise(tx, 8, 'P'), // a later P — not the span's start
			settledAt(tx, 20, 'commit'),
			released(tx, 40),
			released(tx, 50), // the last release — the span's end
		]
		expect(analyzeLift(events, lift(tx, 'commit')).creditHeldMs).toBe(45) // 50 − 5
	})

	it('is omitted when the lift never releases (credit still held)', () => {
		const tx = 'TXCRNOREL'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'P'), settledAt(tx, 20, 'commit')]
		expect(analyzeLift(events, lift(tx, 'commit')).creditHeldMs).toBeUndefined()
	})

	it('is omitted when only an NP promise is seen (an NP holds no credit)', () => {
		const tx = 'TXCRNP'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'NP'), settledAt(tx, 12, 'void'), released(tx, 20)]
		expect(analyzeLift(events, lift(tx, 'void')).creditHeldMs).toBeUndefined()
	})
})

describe('analyzeLift — permanentlyPending flags a pending lift whose resources never released', () => {
	it('is true for a pending lift with no resources-released', () => {
		const tx = 'TXPP'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'P')]
		expect(analyzeLift(events, lift(tx, 'pending')).permanentlyPending).toBe(true)
	})

	it('is false for a pending lift that did release its resources', () => {
		const tx = 'TXPPREL'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'P'), released(tx, 30)]
		expect(analyzeLift(events, lift(tx, 'pending')).permanentlyPending).toBe(false)
	})

	it('is false for any settled lift (it resolved)', () => {
		const tx = 'TXPPS'
		const events: TraceEvent[] = [pushed(tx, 0), promise(tx, 5, 'P'), settledAt(tx, 10, 'commit')]
		expect(analyzeLift(events, lift(tx, 'commit')).permanentlyPending).toBe(false)
	})
})

describe('summarizeConsensusMetrics — mixed lifts', () => {
	function liftMetrics(over: Partial<ConsensusLiftMetrics>): ConsensusLiftMetrics {
		return {
			outcome: 'commit',
			messages: 0,
			cooperatingMembers: 0,
			cooperatingCommitted: 0,
			pullMessages: 0,
			recovered: 0,
			permanentlyPending: false,
			...over,
		}
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

	it('aggregates cooperating completion, pull messages, and recovered across lifts (completion guarded 0/0 ⇒ 0)', () => {
		const lifts: ConsensusLiftMetrics[] = [
			// 4 cooperating members, all committed, the recovery loop never ran (clean happy commit) ⇒ recovered 0.
			liftMetrics({ outcome: 'commit', cooperatingMembers: 4, cooperatingCommitted: 4, pullMessages: 0, recovered: 0 }),
			// 3 cooperating members, a stranded one self-healed via the recovery loop (5 pulls) ⇒ recovered 1.
			liftMetrics({ outcome: 'commit', cooperatingMembers: 3, cooperatingCommitted: 3, pullMessages: 5, recovered: 1 }),
		]
		const metrics = summarizeConsensusMetrics(lifts, STRUCTURAL, 2)
		expect(metrics.cooperatingMemberTotal).toBe(7)
		expect(metrics.cooperatingCommittedTotal).toBe(7)
		expect(metrics.cooperatingCompletion).toBeCloseTo(1)
		// recovered is now per-lift 0/1 (settled lifts that needed the recovery loop); the total sums them.
		expect(metrics.recoveredTotal).toBe(1)
		expect(metrics.pullMessagesPerLift.count).toBe(2) // one sample per lift
		expect(metrics.pullMessagesPerLift.max).toBe(5)
		// Zero cooperating members over the run ⇒ completion guarded to 0, never NaN.
		const empty = summarizeConsensusMetrics([], STRUCTURAL, 0)
		expect(empty.cooperatingCompletion).toBe(0)
		expect(Number.isNaN(empty.cooperatingCompletion)).toBe(false)
		expect(empty.pullMessagesPerLift.count).toBe(0)
	})

	it('distributes defined creditHeldMs only and counts the permanently-pending lifts', () => {
		const lifts: ConsensusLiftMetrics[] = [
			// A committed lift that held and released credit — one creditHeldMs sample, not permanently pending.
			liftMetrics({ outcome: 'commit', creditHeldMs: 100 }),
			// A pending lift that never released — contributes no creditHeldMs sample and is permanently pending.
			liftMetrics({ outcome: 'pending', permanentlyPending: true }),
			// A pending lift that DID release — no creditHeldMs here either, but not permanently pending.
			liftMetrics({ outcome: 'pending', creditHeldMs: 40, permanentlyPending: false }),
		]
		const metrics = summarizeConsensusMetrics(lifts, STRUCTURAL, 3)
		// creditHeldMsPerLift is over the two lifts with a defined span (100, 40); the no-release pending adds none.
		expect(metrics.creditHeldMsPerLift.count).toBe(2)
		expect(metrics.creditHeldMsPerLift.mean).toBe(70)
		expect(metrics.permanentlyPendingCount).toBe(1)
		expect(metrics.permanentlyPendingFraction).toBeCloseTo(1 / 3)
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
		// The new measurements guard the 0-lift case too: an empty credit-held distribution and a
		// permanently-pending fraction of 0, never NaN.
		expect(metrics.creditHeldMsPerLift.count).toBe(0)
		expect(metrics.permanentlyPendingCount).toBe(0)
		expect(metrics.permanentlyPendingFraction).toBe(0)
		expect(Number.isNaN(metrics.permanentlyPendingFraction)).toBe(false)
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
