import type { TraceLiftEntry } from 'tallysim'
import type { TraceEvent } from 'tallynet'
import {
	createTimeline,
	initialPlaybackState,
	pause,
	play,
	seek,
	setSpeed,
	step,
	type ConsensusBinding,
	type ResolveTally,
} from './timeline.js'
import { createLiftResolver } from './trace-index.js'

// Injected decoder: three candidate edges n0→tally0, n1→tally1, n2→tally2.
const resolveTally: ResolveTally = (nonce) => new Map([['n0', 0], ['n1', 1], ['n2', 2]]).get(nonce)

// A scripted one-session run: originator 0 reaches 1 (tally0), prunes a candidate (tally2), goes deeper to 2
// (tally1), finds a plan, then a late answer folds into a later round on tally1.
const events: TraceEvent[] = [
	{ time: 1, nodeId: '0', sessionCode: 'S1', type: 'query-sent', nonce: 'n0', depth: 1, round: 1 },
	{ time: 2, nodeId: '1', sessionCode: 'S1', type: 'query-received', nonce: 'n0', depth: 1, round: 1 },
	{ time: 3, nodeId: '1', sessionCode: 'S1', type: 'candidate-pruned', nonce: 'n2', reason: 'cycle' },
	{ time: 4, nodeId: '1', sessionCode: 'S1', type: 'query-sent', nonce: 'n1', depth: 2, round: 2 },
	{ time: 5, nodeId: '2', sessionCode: 'S1', type: 'query-received', nonce: 'n1', depth: 2, round: 2 },
	{ time: 6, nodeId: '2', sessionCode: 'S1', type: 'plan-found' },
	{ time: 7, nodeId: '1', sessionCode: 'S1', type: 'late-answer-folded', nonce: 'n1', round: 3 },
]

const timeline = createTimeline({ sessionCode: 'S1', events, resolveTally })

describe('createTimeline — active set derivation', () => {
	it('lists the distinct event times in order', () => {
		expect(timeline.eventTimes()).toEqual([1, 2, 3, 4, 5, 6, 7])
	})

	it('is empty before any event', () => {
		expect(timeline.deriveActiveSet(0)).toEqual({ nodes: [], edges: [], pruned: [], foundPlans: [] })
	})

	it('lights nodes and edges reached so far', () => {
		expect(timeline.deriveActiveSet(2)).toEqual({
			nodes: [
				{ node: 0, round: 1, depth: 1 },
				{ node: 1, round: 1, depth: 1 },
			],
			edges: [{ tally: 0, round: 1, depth: 1, lastEventKind: 'query-received' }],
			pruned: [],
			foundPlans: [],
		})
	})

	it('records a pruned candidate with its reason', () => {
		const set = timeline.deriveActiveSet(3)
		expect(set.pruned).toEqual([{ tally: 2, reason: 'cycle' }])
		expect(set.edges).toEqual([
			{ tally: 0, round: 1, depth: 1, lastEventKind: 'query-received' },
			{ tally: 2, round: 0, depth: 0, lastEventKind: 'candidate-pruned' },
		])
	})

	it('accumulates deeper rounds and the found plan', () => {
		const set = timeline.deriveActiveSet(6)
		expect(set.nodes).toEqual([
			{ node: 0, round: 1, depth: 1 },
			{ node: 1, round: 2, depth: 2 },
			{ node: 2, round: 2, depth: 2 },
		])
		expect(set.edges).toContainEqual({ tally: 1, round: 2, depth: 2, lastEventKind: 'query-received' })
		expect(set.foundPlans).toEqual([{ time: 6, node: 2 }])
	})

	it('folds a late answer into a later round on the same edge without duplicating it', () => {
		const set = timeline.deriveActiveSet(7)
		const tally1Edges = set.edges.filter((e) => e.tally === 1)
		expect(tally1Edges).toEqual([{ tally: 1, round: 3, depth: 2, lastEventKind: 'late-answer-folded' }])
		expect(set.edges).toHaveLength(3)
	})

	it('skips an unresolved/empty nonce as a node-only event, not an edge', () => {
		// The originator's own first query-received carries an empty inbound nonce: it lights the node but no edge.
		const originatorEvents: TraceEvent[] = [
			{ time: 1, nodeId: '0', sessionCode: 'S1', type: 'query-received', nonce: '', depth: 1, round: 0 },
			{ time: 2, nodeId: '0', sessionCode: 'S1', type: 'query-sent', nonce: 'unknown-nonce', depth: 1, round: 1 },
		]
		const t = createTimeline({ sessionCode: 'S1', events: originatorEvents, resolveTally })
		const set = t.deriveActiveSet(2)
		expect(set.nodes).toEqual([{ node: 0, round: 1, depth: 1 }])
		// Empty nonce skipped, and a non-empty nonce the decoder cannot resolve is skipped too — no edges.
		expect(set.edges).toEqual([])
	})

	it('derives the same set scrubbing backward as forward (recompute is direction-independent)', () => {
		const forward = timeline.deriveActiveSet(2)
		timeline.deriveActiveSet(7) // advance...
		const backward = timeline.deriveActiveSet(2) // ...then scrub back
		expect(backward).toEqual(forward)
	})
})

describe('createTimeline — no consensus binding', () => {
	it('omits the consensus key entirely (discovery-only timeline)', () => {
		// The shared `timeline` above is built with no binding; its active set must carry no consensus phase.
		expect(timeline.deriveActiveSet(6).consensus).toBeUndefined()
	})
})

describe('createTimeline — consensus settlement', () => {
	// A path lift 0→1→2 settled by session S1: hop 0 is tally 0 (0↔1), hop 1 is tally 1 (1↔2).
	const lift: TraceLiftEntry = {
		sessionCode: 'S1',
		transactionCode: 'TX1',
		route: [0, 1, 2],
		tallyPath: [0, 1],
		memberKeys: { m0: 0, m1: 1, m2: 2 },
		amount: 100,
	}
	const binding: ConsensusBinding = { lift, resolver: createLiftResolver(lift) }
	// Consensus events are decoded via the resolver, never the discovery nonce path, so the tally resolver is
	// never consulted for them; a trivial one suffices.
	const noTally: ResolveTally = () => undefined

	/** Build a timeline for one scripted consensus run bound to the lift above. */
	function consensusTimeline(evs: TraceEvent[]) {
		return createTimeline({ sessionCode: 'S1', events: evs, resolveTally: noTally, consensus: binding })
	}

	// A committing run: promises flow 0→1→2, the voter votes commit, then the lift settles commit.
	const commitEvents: TraceEvent[] = [
		{ time: 10, nodeId: 'm0', sessionCode: 'S1', type: 'record-pushed', transactionCode: 'TX1', to: 'm1', promiseCount: 1, commitCount: 0, ok: true },
		{ time: 11, nodeId: 'm1', sessionCode: 'S1', type: 'record-received', transactionCode: 'TX1', from: 'm0', promiseCount: 1, commitCount: 0 },
		{ time: 12, nodeId: 'm1', sessionCode: 'S1', type: 'record-pushed', transactionCode: 'TX1', to: 'm2', promiseCount: 2, commitCount: 0, ok: true },
		{ time: 13, nodeId: 'm2', sessionCode: 'S1', type: 'record-received', transactionCode: 'TX1', from: 'm1', promiseCount: 2, commitCount: 0 },
		{ time: 14, nodeId: 'm2', sessionCode: 'S1', type: 'promise-signed', transactionCode: 'TX1', signatureType: 'P' },
		{ time: 20, nodeId: 'm2', sessionCode: 'S1', type: 'voter-vote', transactionCode: 'TX1', decision: 'C' },
		{ time: 40, nodeId: 'm0', sessionCode: 'S1', type: 'settled', transactionCode: 'TX1', decision: 'commit' },
	]

	it('lights promised edges and the sender node before any vote', () => {
		const set = consensusTimeline(commitEvents).deriveActiveSet(10)
		// Consensus events never feed the discovery active set — it stays empty.
		expect(set.nodes).toEqual([])
		expect(set.edges).toEqual([])
		expect(set.consensus).toEqual({
			transactionCode: 'TX1',
			edges: [{ tally: 0, phase: 'promised' }],
			nodes: [{ node: 0, phase: 'promised' }],
			decision: undefined,
			settledTime: undefined,
			unresolved: [],
		})
	})

	it('records the voter vote (commit-pending) while still in flight', () => {
		const c = consensusTimeline(commitEvents).deriveActiveSet(20).consensus
		expect(c?.edges).toEqual([
			{ tally: 0, phase: 'promised' },
			{ tally: 1, phase: 'promised' },
		])
		expect(c?.nodes).toEqual([
			{ node: 0, phase: 'promised' },
			{ node: 1, phase: 'promised' },
			{ node: 2, phase: 'voted', vote: 'C' },
		])
		expect(c?.decision).toBeUndefined()
	})

	it('solidifies every route edge on commit and settles every route node', () => {
		const c = consensusTimeline(commitEvents).deriveActiveSet(40).consensus
		// Commit ⇒ the WHOLE tallyPath reads committed, not only the edges a promise reached.
		expect(c?.edges).toEqual([
			{ tally: 0, phase: 'committed' },
			{ tally: 1, phase: 'committed' },
		])
		expect(c?.nodes).toEqual([
			{ node: 0, phase: 'settled' },
			{ node: 1, phase: 'settled' },
			{ node: 2, phase: 'settled', vote: 'C' },
		])
		expect(c?.decision).toBe('commit')
		expect(c?.settledTime).toBe(40)
		expect(c?.unresolved).toEqual([])
	})

	it('releases only the promised edges on void (never-promised edges stay resting)', () => {
		// Only one promise went out (0↔1) before a no-commit vote and a void settle.
		const voidEvents: TraceEvent[] = [
			{ time: 10, nodeId: 'm0', sessionCode: 'S1', type: 'record-pushed', transactionCode: 'TX1', to: 'm1', promiseCount: 1, commitCount: 0, ok: true },
			{ time: 14, nodeId: 'm1', sessionCode: 'S1', type: 'promise-signed', transactionCode: 'TX1', signatureType: 'NP' },
			{ time: 20, nodeId: 'm2', sessionCode: 'S1', type: 'voter-vote', transactionCode: 'TX1', decision: 'NC' },
			{ time: 40, nodeId: 'm0', sessionCode: 'S1', type: 'settled', transactionCode: 'TX1', decision: 'void' },
		]
		const c = consensusTimeline(voidEvents).deriveActiveSet(40).consensus
		// Tally 1 was never promised ⇒ it is absent, not solid. Tally 0 is released (flash then clear).
		expect(c?.edges).toEqual([{ tally: 0, phase: 'released' }])
		expect(c?.nodes).toEqual([
			{ node: 0, phase: 'settled' },
			{ node: 1, phase: 'settled' }, // NP refusal did not promote it earlier; the whole-route settle does
			{ node: 2, phase: 'settled', vote: 'NC' },
		])
		expect(c?.decision).toBe('void')
		expect(c?.settledTime).toBe(40)
	})

	it('leaves a stalled lift (no settle) partially promised with no decision', () => {
		const stalledEvents: TraceEvent[] = [
			{ time: 10, nodeId: 'm0', sessionCode: 'S1', type: 'record-pushed', transactionCode: 'TX1', to: 'm1', promiseCount: 1, commitCount: 0, ok: true },
			{ time: 12, nodeId: 'm1', sessionCode: 'S1', type: 'record-pushed', transactionCode: 'TX1', to: 'm2', promiseCount: 2, commitCount: 0, ok: true },
		]
		const c = consensusTimeline(stalledEvents).deriveActiveSet(100).consensus
		expect(c?.edges).toEqual([
			{ tally: 0, phase: 'promised' },
			{ tally: 1, phase: 'promised' },
		])
		expect(c?.decision).toBeUndefined()
		expect(c?.settledTime).toBeUndefined()
		expect(c?.unresolved).toEqual([])
	})

	it('derives the same settlement scrubbing backward as forward (recompute is direction-independent)', () => {
		const t = consensusTimeline(commitEvents)
		const forward = t.deriveActiveSet(20)
		t.deriveActiveSet(40) // advance past settle...
		const backward = t.deriveActiveSet(20) // ...then scrub back before it
		expect(backward).toEqual(forward)
	})

	it('surfaces a member key the lift did not map as unresolved, never silently dropping it', () => {
		const badKeyEvents: TraceEvent[] = [
			{ time: 10, nodeId: 'mX', sessionCode: 'S1', type: 'record-pushed', transactionCode: 'TX1', to: 'm1', promiseCount: 1, commitCount: 0, ok: true },
		]
		const c = consensusTimeline(badKeyEvents).deriveActiveSet(10).consensus
		expect(c?.unresolved).toEqual(['mX'])
		expect(c?.edges).toEqual([]) // the sender did not resolve, so no edge could be placed
		expect(c?.nodes).toEqual([])
	})
})

describe('playback reducers are pure', () => {
	it('seek/play/pause/setSpeed/step return new state without mutating the input', () => {
		const s0 = initialPlaybackState(0)
		expect(s0).toEqual({ currentTime: 0, playing: false, speed: 1 })

		expect(seek(s0, 5)).toEqual({ currentTime: 5, playing: false, speed: 1 })
		expect(play(s0)).toEqual({ currentTime: 0, playing: true, speed: 1 })
		expect(pause(play(s0))).toEqual({ currentTime: 0, playing: false, speed: 1 })
		expect(setSpeed(s0, 2)).toEqual({ currentTime: 0, playing: false, speed: 2 })
		expect(step(s0, 3)).toEqual({ currentTime: 3, playing: false, speed: 1 })

		// input untouched
		expect(s0).toEqual({ currentTime: 0, playing: false, speed: 1 })
	})
})
