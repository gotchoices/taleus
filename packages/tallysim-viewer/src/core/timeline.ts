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

import { entityId, type TraceLiftEntry } from 'tallysim'
import type { PruneReason, TraceEvent } from 'tallynet'
import type { LiftResolver } from './trace-index.js'

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

/**
 * The settlement phase a route edge has reached by `currentTime`:
 *   - `promised` — a record was pushed over it (a promise in flight); nothing has settled yet;
 *   - `committed` — the lift committed, so every route edge is now solid (a closed settled path);
 *   - `released` — the lift voided, so the held edges are let go (the "flash then clear" state — `paint.ts`
 *     times the brief flash off `settledTime`, after which the edge reads as resting again).
 */
export type ConsensusEdgePhase = 'promised' | 'committed' | 'released'

/**
 * The settlement phase a route member node has reached by `currentTime`:
 *   - `promised` — it signed/pushed a promise;
 *   - `voted` — it cast a voter vote (carried in {@link ConsensusNodeState.vote}: `C` commit-pending / `NC`
 *     no-commit, so the two read differently);
 *   - `settled` — the lift settled (every route node settles once, on the single `settled` event).
 */
export type ConsensusNodePhase = 'promised' | 'voted' | 'settled'

/** The settled decision of a lift (from its `settled` event), once the head has reached it. */
export type ConsensusDecision = 'commit' | 'void'

/** One route edge's settlement phase at `currentTime`. */
export interface ConsensusEdgeState {
	tally: number
	phase: ConsensusEdgePhase
}

/** One route member node's settlement phase (and vote, if it voted) at `currentTime`. */
export interface ConsensusNodeState {
	node: number
	phase: ConsensusNodePhase
	/** The voter vote this node cast, if any — `C` (commit-pending) or `NC` (no-commit). */
	vote?: 'C' | 'NC'
}

/**
 * One voter that cast a `voter-vote`, classified by whether its member key sits on the lift's route:
 *   - `participant` — the key resolves to a route entity (via the resolver's `memberKeys` map), so it has a
 *     `node` id and is drawn on the graph (as a route node, with its phase/vote);
 *   - `referee` — the key does **not** resolve: an off-route referee voter. The trace format carries no place
 *     for it (referees nominated at discovery do not reach the lift record — see the design doc's format gap),
 *     so it has no `node` and is **counted** in the side panel ("referee-only, stacked"), never placed on the
 *     graph. Its key is kept out of {@link ConsensusState.unresolved}: an off-route voter is a known format gap,
 *     not a malformed-trace event.
 */
export interface ConsensusVoter {
	/** The member key the `voter-vote` carried (the one field always present, resolved or not). */
	key: string
	/** The route entity id, when the key resolved (a `participant`); `undefined` for an off-route `referee`. */
	node?: number
	/** Whether the voter sits on the lift's route (`participant`) or off it (`referee`). */
	role: 'participant' | 'referee'
	/** The vote cast — `C` (commit-pending) or `NC` (no-commit). */
	vote?: 'C' | 'NC'
}

/**
 * The per-lift settlement state at `currentTime`, recomputed from scratch like the discovery active set — so a
 * scrub back before `settled` un-solidifies the route, and a scrub forward re-settles it. A **stalled** lift
 * (no `settled` event in the trace) leaves `decision`/`settledTime` undefined and its promised edges in
 * `promised` — nothing is fabricated.
 */
export interface ConsensusState {
	/** The lift this state is for (joins to the header's {@link TraceLiftEntry}). */
	transactionCode: string
	/** Each route edge touched by a promise/settle so far, with its phase. Sorted by tally index. */
	edges: ConsensusEdgeState[]
	/** Each route member node reached by a consensus event so far, with its phase. Sorted by entity id. */
	nodes: ConsensusNodeState[]
	/**
	 * Every voter that cast a `voter-vote`, classified {@link ConsensusVoter.role participant/referee}. Sorted:
	 * participants first by entity id, then referees by key. Deduped by key (a re-vote updates in place, latest
	 * wins). Default `[]`.
	 */
	voters: ConsensusVoter[]
	/**
	 * Route entity ids that recovered via a **successful pull** — a member the push could not reach that fetched
	 * the settled outcome from a reachable peer (`record-pulled` with `ok:true`; its puller is `nodeId`). Note the
	 * single `settled` event still settles the whole route — `pulled` is an orthogonal marker of *which* member
	 * needed a pull, not a separate phase. Sorted, deduped. Default `[]`.
	 */
	pulled: number[]
	/** Route entity ids caught equivocating — a signer that emitted both faces (`equivocation-proof-kept.signer`). Sorted, deduped. Default `[]`. */
	equivocators: number[]
	/** Route entity ids that detected a contradiction — our-vs-peer outcome mismatch (`contradiction-detected.nodeId`). Sorted, deduped. Default `[]`. */
	contradictions: number[]
	/** The settled decision, if the head has reached the `settled` event; `undefined` while still in flight / stalled. */
	decision?: ConsensusDecision
	/** The time of the `settled` event, for `paint.ts`'s void flash window; `undefined` until settled. */
	settledTime?: number
	/**
	 * Member keys a consensus event carried that the lift's `memberKeys` map did not resolve — a malformed-trace
	 * sentinel, surfaced (never silently dropped) so a well-formed self-recorded trace can be asserted to leave
	 * it empty. An off-route `referee` voter key is **not** counted here (that is a known format gap, not
	 * malformed — see {@link ConsensusVoter}). Sorted for stability.
	 */
	unresolved: string[]
}

/** The whole derived view at a `currentTime`: lit nodes/edges, pruned candidates, found plans. All sorted. */
export interface ActiveSet {
	nodes: ActiveNode[]
	edges: ActiveEdge[]
	pruned: PrunedCandidate[]
	foundPlans: FoundPlanMark[]
	/** The lift's settlement state — present only on a {@link Timeline} bound to a lift (a consensus trace). */
	consensus?: ConsensusState
}

/** Resolve a nonce to a tally index for the session under view (bind `deanon.tallyOfNonce` to a session). */
export type ResolveTally = (nonce: string) => number | undefined

/**
 * Bind a session's {@link Timeline} to the one lift it settled into (consensus trace only): the header's
 * {@link TraceLiftEntry} plus the {@link LiftResolver} built from it (see `trace-index.ts`). When present, the
 * active set gains its {@link ConsensusState}; when absent, the timeline is discovery-only and unchanged.
 */
export interface ConsensusBinding {
	lift: TraceLiftEntry
	resolver: LiftResolver
}

/** A built timeline for one session: its event-time stops and the active-set derivation at any time. */
export interface Timeline {
	readonly sessionCode: string
	/** Distinct event times in ascending order — the stops the UI can `step` between. */
	eventTimes(): readonly number[]
	/** The active set at `currentTime` (recomputed from events ≤ `currentTime`). */
	deriveActiveSet(currentTime: number): ActiveSet
}

/** The consensus events carry a `transactionCode` (discovery events do not) and their ids are member keys. */
type ConsensusTraceEvent = Extract<TraceEvent, { transactionCode: string }>

/** Is this a consensus event (carries `transactionCode`)? Such events are decoded via the {@link LiftResolver}. */
function isConsensusEvent(event: TraceEvent): event is ConsensusTraceEvent {
	return 'transactionCode' in event
}

/** The settlement-phase ranks, so a node only ever moves forward (promised → voted → settled) within a seek. */
const PHASE_RANK: Record<ConsensusNodePhase, number> = { promised: 1, voted: 2, settled: 3 }

/** The node phase for a rank (the inverse of {@link PHASE_RANK}). */
function phaseOfRank(rank: number): ConsensusNodePhase {
	return rank >= 3 ? 'settled' : rank === 2 ? 'voted' : 'promised'
}

/** The distinct entity ids on a route, in ascending order (a circular route's repeated origin counted once). */
function distinctRouteNodes(route: readonly number[]): number[] {
	return [...new Set(route)].sort((a, b) => a - b)
}

/** Order voters deterministically: resolved participants first by entity id, then off-route referees by key. */
function compareVoters(a: ConsensusVoter, b: ConsensusVoter): number {
	if (a.node !== undefined && b.node !== undefined) {
		return a.node - b.node
	}
	if (a.node !== undefined) {
		return -1 // a participant sorts before a referee
	}
	if (b.node !== undefined) {
		return 1
	}
	return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
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
	/** Bind the session's lift to animate its settlement (consensus trace); omit for discovery-only. */
	consensus?: ConsensusBinding
}): Timeline {
	const { sessionCode, events, resolveTally, consensus: binding } = params
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
			// Consensus events carry a member key in `nodeId` (not an entity id) and are decoded separately in
			// deriveConsensus — never through the discovery path below (which would `entityId(memberKey)` → NaN).
			if (isConsensusEvent(event)) {
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

		const result: ActiveSet = {
			nodes: [...nodes.values()].sort((a, b) => a.node - b.node),
			edges: [...edges.values()].sort((a, b) => a.tally - b.tally),
			pruned: [...pruned.entries()].map(([tally, reason]) => ({ tally, reason })).sort((a, b) => a.tally - b.tally),
			foundPlans: foundPlans.sort((a, b) => a.time - b.time || a.node - b.node),
		}
		if (binding !== undefined) {
			result.consensus = deriveConsensus(currentTime)
		}
		return result
	}

	/**
	 * The lift's settlement state at `currentTime`, recomputed from scratch (so a backward scrub un-settles).
	 * Only this lift's consensus events (filtered by `transactionCode`) are read; each node is decoded via the
	 * resolver's `memberKeys` map and each `record-pushed` edge via the `(from, to) → tally` map.
	 */
	function deriveConsensus(currentTime: number): ConsensusState {
		const { lift, resolver } = binding as ConsensusBinding
		const promisedEdges = new Set<number>() // tally indices a record was pushed over, by now
		const nodeRank = new Map<number, number>() // entity id → max PHASE_RANK reached
		const nodeVote = new Map<number, 'C' | 'NC'>()
		const voters = new Map<string, ConsensusVoter>() // member key → voter (a re-vote updates in place)
		const pulled = new Set<number>() // entity ids recovered via a successful pull
		const equivocators = new Set<number>() // entity ids caught signing both faces
		const contradictions = new Set<number>() // entity ids that detected an outcome mismatch
		const unresolved = new Set<string>()
		let decision: ConsensusDecision | undefined
		let settledTime: number | undefined

		const bumpNode = (id: number, rank: number): void => {
			const prev = nodeRank.get(id)
			if (prev === undefined || rank > prev) {
				nodeRank.set(id, rank)
			}
		}
		// Resolve a route-member key, surfacing a miss in `unresolved` (the malformed-trace sentinel). Used for the
		// record/promise/settle events whose keys are always route members — a miss there genuinely is malformed.
		const resolveMember = (key: string): number | undefined => {
			const id = resolver.entityOfMember(key)
			if (id === undefined) {
				unresolved.add(key) // malformed-trace sentinel — surfaced, never silently dropped
			}
			return id
		}

		for (const event of events) {
			if (event.time > currentTime || !isConsensusEvent(event) || event.transactionCode !== lift.transactionCode) {
				continue
			}
			switch (event.type) {
				case 'record-pushed': {
					const node = resolveMember(event.nodeId)
					const to = resolveMember(event.to)
					if (node !== undefined && to !== undefined) {
						const tally = resolver.tallyOfEdge(node, to)
						if (tally !== undefined) {
							promisedEdges.add(tally)
						}
					}
					if (node !== undefined) {
						bumpNode(node, PHASE_RANK.promised)
					}
					break
				}
				case 'record-received': {
					const node = resolveMember(event.nodeId)
					if (node !== undefined) {
						bumpNode(node, PHASE_RANK.promised)
					}
					break
				}
				case 'record-pulled': {
					// Emitted once per reachable peer (`ok` for the one that served, not for the others). The puller
					// (`nodeId`) recovered iff at least one of its pulls succeeded; the Set dedupes the ok:true ones.
					const node = resolveMember(event.nodeId)
					if (node !== undefined && event.ok) {
						pulled.add(node)
					}
					break
				}
				case 'promise-signed': {
					// A real promise (`P`) marks participation; a refusal (`NP`) does not promote the node — the void
					// outcome (below) is what the refusal drives, and there is no distinct "refused" node phase in v1.
					const node = resolveMember(event.nodeId)
					if (node !== undefined && event.signatureType === 'P') {
						bumpNode(node, PHASE_RANK.promised)
					}
					break
				}
				case 'voter-vote': {
					// Classify via `entityOfMember` DIRECTLY — not `resolveMember`: an off-route referee voter
					// legitimately does not map, and must stay out of `unresolved` (reserved for malformed
					// route-member events). A participant also promotes/records its node phase + vote.
					const node = resolver.entityOfMember(event.nodeId)
					voters.set(
						event.nodeId,
						node === undefined
							? { key: event.nodeId, role: 'referee', vote: event.decision }
							: { key: event.nodeId, node, role: 'participant', vote: event.decision },
					)
					if (node !== undefined) {
						bumpNode(node, PHASE_RANK.voted)
						nodeVote.set(node, event.decision)
					}
					break
				}
				case 'equivocation-proof-kept': {
					// The equivocator is the `signer` (the member that emitted both faces), not the keeper (`nodeId`).
					const signer = resolveMember(event.signer)
					if (signer !== undefined) {
						equivocators.add(signer)
					}
					break
				}
				case 'contradiction-detected': {
					const node = resolveMember(event.nodeId)
					if (node !== undefined) {
						contradictions.add(node)
					}
					break
				}
				case 'settled': {
					decision = event.decision
					settledTime = event.time
					break
				}
				default: {
					// record-received's `from`, signature-rejected, resources-released: no node/edge phase in v1.
					break
				}
			}
		}

		// On settle, every distinct route node settles once (one `settled` per lift carries the whole route).
		if (decision !== undefined) {
			for (const id of distinctRouteNodes(lift.route)) {
				bumpNode(id, PHASE_RANK.settled)
			}
		}

		return {
			transactionCode: lift.transactionCode,
			edges: consensusEdges(lift, decision, promisedEdges),
			nodes: [...nodeRank.entries()]
				.map(([node, rank]): ConsensusNodeState => {
					const vote = nodeVote.get(node)
					return vote === undefined ? { node, phase: phaseOfRank(rank) } : { node, phase: phaseOfRank(rank), vote }
				})
				.sort((a, b) => a.node - b.node),
			voters: [...voters.values()].sort(compareVoters),
			pulled: [...pulled].sort((a, b) => a - b),
			equivocators: [...equivocators].sort((a, b) => a - b),
			contradictions: [...contradictions].sort((a, b) => a - b),
			decision,
			settledTime,
			unresolved: [...unresolved].sort(),
		}
	}

	return {
		sessionCode,
		eventTimes: () => times,
		deriveActiveSet,
	}
}

/**
 * The route edges' phases from the settled `decision` and the set of edges a promise reached:
 *   - `commit` ⇒ **every** route edge (`tallyPath`) is `committed` — the whole route reads solid;
 *   - `void`   ⇒ only the edges that were promised are `released` (they flash then clear); never-promised
 *     edges stay resting (absent here);
 *   - no decision yet (in flight / stalled) ⇒ the promised edges are `promised`.
 */
function consensusEdges(
	lift: TraceLiftEntry,
	decision: ConsensusDecision | undefined,
	promisedEdges: ReadonlySet<number>,
): ConsensusEdgeState[] {
	const phaseOf = (tallies: readonly number[], phase: ConsensusEdgePhase): ConsensusEdgeState[] =>
		[...tallies].sort((a, b) => a - b).map((tally) => ({ tally, phase }))
	if (decision === 'commit') {
		return phaseOf(lift.tallyPath, 'committed')
	}
	if (decision === 'void') {
		return phaseOf([...promisedEdges], 'released')
	}
	return phaseOf([...promisedEdges], 'promised')
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
