import type { TraceEvent } from 'tallynet'
import {
	createTimeline,
	initialPlaybackState,
	pause,
	play,
	seek,
	setSpeed,
	step,
	type ResolveTally,
} from './timeline.js'

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

	it('derives the same set scrubbing backward as forward (recompute is direction-independent)', () => {
		const forward = timeline.deriveActiveSet(2)
		timeline.deriveActiveSet(7) // advance...
		const backward = timeline.deriveActiveSet(2) // ...then scrub back
		expect(backward).toEqual(forward)
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
