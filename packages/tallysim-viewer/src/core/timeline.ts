/**
 * The playback state model: a **pure** state machine the replay UI binds to. It owns no clock and no timers
 * — the UI ticket drives the clock and calls these reducers — so the whole module is unit-testable with a
 * scripted event list and no DOM.
 *
 * Two halves, both pure:
 *   1. {@link PlaybackState} + its reducers ({@link seek}, {@link play}, {@link pause}, {@link setSpeed},
 *      {@link step}) — the transport controls. Each returns a new state; none mutates its input.
 *   2. {@link Timeline.deriveActiveSet} — given a `currentTime`, the **active set**: which nodes and edges
 *      are "lit" (reached by the search so far), each with its round/depth; which candidates are pruned (and
 *      why); and which plans have been found. It emits plain data only — node ids, edge = tally index, round
 *      numbers, prune reasons — leaving all colour and rendering to the graph ticket.
 *
 * ── How the active set is derived ──────────────────────────────────────────────────────────────────
 * The active set is **recomputed from every event with `time ≤ currentTime`** on each call. Recompute-from-
 * scratch is correct whether the UI scrubs forward or backward (no incremental cursor to rewind), which is
 * the property the backward-seek test pins. Nodes/edges accumulate (the search's explored subgraph grows as
 * time advances); a node/edge keeps the **max** round and depth seen among its events, so order never matters;
 * an edge also records the kind of the **last** event (by time) that touched it. A `late-answer-folded` event
 * re-touches an already-lit edge at a later round: keyed by tally index it updates in place (no duplicate) and
 * its later round wins (not dropped).
 *
 * Edges are decoded with the {@link Deanonymiser}: the caller binds a `resolveTally(nonce)` for the session
 * being viewed, keeping this module decoupled from the whole-network decoder. A nonce that does not resolve
 * (e.g. the originator's own first `query-received`, whose inbound nonce is empty) is skipped, not an edge.
 */

import { entityId } from 'tallysim'
import type { PruneReason, TraceEvent } from 'tallynet'

/** The transport-control state the UI binds to. The derived active set is computed from `currentTime`, not stored. */
export interface PlaybackState {
	/** The playback head, in the trace's event-time units. */
	currentTime: number
	/** Whether the UI's clock should be advancing. */
	playing: boolean
	/** Playback rate multiplier (UI-defined units; the reducer only stores it). */
	speed: number
}

/** A node reached by the search by `currentTime`, with the furthest round/depth seen touching it. */
export interface ActiveNode {
	node: number
	round: number
	depth: number
}

/** An edge (tally index) touched by the search by `currentTime`, with its round/depth and last event kind. */
export interface ActiveEdge {
	tally: number
	round: number
	depth: number
	lastEventKind: TraceEvent['type']
}

/** A candidate edge that was pruned by `currentTime`, with the reason of the last prune on it. */
export interface PrunedCandidate {
	tally: number
	reason: PruneReason
}

/** A plan found by `currentTime` (a `plan-found` event): when, and at which node (the finder). */
export interface FoundPlanMark {
	time: number
	node: number
}

/** The whole derived view at a `currentTime`: lit nodes/edges, pruned candidates, found plans. All sorted. */
export interface ActiveSet {
	nodes: ActiveNode[]
	edges: ActiveEdge[]
	pruned: PrunedCandidate[]
	foundPlans: FoundPlanMark[]
}

/** Resolve a nonce to a tally index for the session under view (bind `deanon.tallyOfNonce` to a session). */
export type ResolveTally = (nonce: string) => number | undefined

/** A built timeline for one session: its event-time stops and the active-set derivation at any time. */
export interface Timeline {
	readonly sessionCode: string
	/** Distinct event times in ascending order — the stops the UI can `step` between. */
	eventTimes(): readonly number[]
	/** The active set at `currentTime` (recomputed from events ≤ `currentTime`). */
	deriveActiveSet(currentTime: number): ActiveSet
}

/** Does this event type carry a `nonce` (so it maps to an edge)? */
function nonceOf(event: TraceEvent): string | undefined {
	switch (event.type) {
		case 'query-sent':
		case 'query-received':
		case 'candidate-pruned':
		case 'plan-returned':
		case 'late-answer-folded': {
			return event.nonce
		}
		default: {
			return undefined
		}
	}
}

/** The event's `round`, if it carries one (`query-sent`/`received`, `round-*`, `late-answer-folded`). */
function roundOf(event: TraceEvent): number | undefined {
	return 'round' in event ? event.round : undefined
}

/** The event's `depth`, if it carries one (`query-sent`/`query-received`). */
function depthOf(event: TraceEvent): number | undefined {
	return 'depth' in event ? event.depth : undefined
}

/**
 * Build a {@link Timeline} for one session. `events` are that session's events (from
 * {@link TraceIndex.eventsForSession}); `resolveTally` decodes a nonce to a tally index for this session.
 * Events are read in the given (time) order; `deriveActiveSet` filters to `time ≤ currentTime`.
 */
export function createTimeline(params: {
	sessionCode: string
	events: readonly TraceEvent[]
	resolveTally: ResolveTally
}): Timeline {
	const { sessionCode, events, resolveTally } = params
	const times = [...new Set(events.map((event) => event.time))].sort((a, b) => a - b)

	function deriveActiveSet(currentTime: number): ActiveSet {
		// NOTE: recomputes from every event ≤ currentTime on each call — O(events) per seek. Correct in both
		// scrub directions and fine for planned trace sizes. If a trace's event count ever makes scrubbing
		// slow, maintain an incremental cursor (advance on forward seek, rebuild only on backward seek) rather
		// than this full recompute.
		const nodes = new Map<number, ActiveNode>()
		const edges = new Map<number, ActiveEdge>()
		const pruned = new Map<number, PruneReason>()
		const foundPlans: FoundPlanMark[] = []

		for (const event of events) {
			if (event.time > currentTime) {
				continue
			}
			const node = entityId(event.nodeId)
			const round = roundOf(event)
			const depth = depthOf(event)
			touchNode(nodes, node, round, depth)

			const nonce = nonceOf(event)
			if (nonce !== undefined && nonce !== '') {
				const tally = resolveTally(nonce)
				if (tally !== undefined) {
					touchEdge(edges, tally, round, depth, event.type)
					if (event.type === 'candidate-pruned') {
						pruned.set(tally, event.reason)
					}
				}
			}

			if (event.type === 'plan-found') {
				foundPlans.push({ time: event.time, node })
			}
		}

		return {
			nodes: [...nodes.values()].sort((a, b) => a.node - b.node),
			edges: [...edges.values()].sort((a, b) => a.tally - b.tally),
			pruned: [...pruned.entries()].map(([tally, reason]) => ({ tally, reason })).sort((a, b) => a.tally - b.tally),
			foundPlans: foundPlans.sort((a, b) => a.time - b.time || a.node - b.node),
		}
	}

	return {
		sessionCode,
		eventTimes: () => times,
		deriveActiveSet,
	}
}

/** Merge one event's round/depth into a node's running record (max round, max depth). */
function touchNode(nodes: Map<number, ActiveNode>, node: number, round: number | undefined, depth: number | undefined): void {
	const existing = nodes.get(node)
	if (existing === undefined) {
		nodes.set(node, { node, round: round ?? 0, depth: depth ?? 0 })
		return
	}
	if (round !== undefined && round > existing.round) {
		existing.round = round
	}
	if (depth !== undefined && depth > existing.depth) {
		existing.depth = depth
	}
}

/** Merge one event's round/depth/kind into an edge's running record (max round/depth, last kind by time order). */
function touchEdge(
	edges: Map<number, ActiveEdge>,
	tally: number,
	round: number | undefined,
	depth: number | undefined,
	kind: TraceEvent['type'],
): void {
	const existing = edges.get(tally)
	if (existing === undefined) {
		edges.set(tally, { tally, round: round ?? 0, depth: depth ?? 0, lastEventKind: kind })
		return
	}
	if (round !== undefined && round > existing.round) {
		existing.round = round
	}
	if (depth !== undefined && depth > existing.depth) {
		existing.depth = depth
	}
	// events are iterated in time order, so the last assignment is the latest-by-time event kind.
	existing.lastEventKind = kind
}

// ── Transport-control reducers (pure; each returns a new PlaybackState) ─────────────────────────────

/** The initial paused state at `startTime` (default rate 1). */
export function initialPlaybackState(startTime: number): PlaybackState {
	return { currentTime: startTime, playing: false, speed: 1 }
}

/** Move the playback head to `time` (the UI clamps to the trace bounds; the reducer stores what it is given). */
export function seek(state: PlaybackState, time: number): PlaybackState {
	return { ...state, currentTime: time }
}

/** Start playing. */
export function play(state: PlaybackState): PlaybackState {
	return { ...state, playing: true }
}

/** Pause. */
export function pause(state: PlaybackState): PlaybackState {
	return { ...state, playing: false }
}

/** Set the playback-rate multiplier. */
export function setSpeed(state: PlaybackState, speed: number): PlaybackState {
	return { ...state, speed }
}

/** Advance the head to the next event's time (the UI supplies it from {@link Timeline.eventTimes}). */
export function step(state: PlaybackState, nextEventTime: number): PlaybackState {
	return { ...state, currentTime: nextEventTime }
}
