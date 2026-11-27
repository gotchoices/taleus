/**
 * Found-route reconstruction — the **pure**, headless logic behind the replay's "routes the search found"
 * panel. Given a plan's anonymised link-nonce path, it recovers the exact node sequence (via the
 * {@link Deanonymiser} the scaffold-core ticket built) and classifies the result so the UI can draw it:
 * an open path, a closed loop (a self-payment / circular lift), an empty result, or a decode failure.
 *
 * ── Where the link-nonce paths come from (and the trace-format gap) ─────────────────────────────────
 * A plan's `path` is a list of {@link Link} nonces, available on the originator's `QueryOutcome.plans[i].path`
 * — i.e. when the viewer **drives** the search (the live-run source, a later ticket) or when a test hands one
 * in. A recorded **trace file does NOT carry found-plan paths**: the `plan-found` event is path-less and
 * `plan-returned` carries only a single per-node inbound nonce, so the winning route's ordered path cannot be
 * recovered from the event stream without *inferring* it — which the design forbids (edge lighting is precise,
 * not guessed). So for a loaded trace this module reconstructs a route only when its path nonces are supplied;
 * the replay surfaces the `plan-found` **markers** (finder node + time + count, from the `timeline` reducer)
 * regardless. The clean fix — have the originator's `plan-found` event carry its own plan's path nonces (it
 * owns the result, so this discloses nothing new) — is deferred (see `docs/design.md` § Replay tier).
 *
 * This module is pure (no DOM, no sigma): the paint/controls tiers turn a {@link ReconstructedRoute} into
 * styling, and this stays unit-tested with hand-built plan paths.
 */

import type { TraceLiftEntry } from 'tallysim'
import type { Deanonymiser } from '../core/deanonymise.js'
import type { ConsensusDecision, ConsensusState } from '../core/timeline.js'
import type { IsolatedRoute } from './paint.js'

/**
 * One found plan's anonymised description, as the UI hands it in: the originator `from`, the query target `to`
 * (equal to `from` for a self-payment), the plan's ordered link nonces, and — optionally — the per-link
 * negotiated terms (index-aligned to `linkNonces`) for the side list. `terms` is deliberately `unknown`: the
 * viewer renders them opaquely and must not couple to the lift's term shape.
 */
export interface RouteInput {
	from: number
	to: number
	linkNonces: readonly string[]
	terms?: readonly unknown[]
}

/** A reconstructed route the UI can draw. `nodes` is the entity-id sequence from the originator to the end. */
export type ReconstructedRoute =
	| { kind: 'path'; nodes: number[]; hops: number; terms?: readonly unknown[] }
	| { kind: 'loop'; nodes: number[]; hops: number; terms?: readonly unknown[] }
	| { kind: 'empty' }
	| { kind: 'decode-failed' }

/**
 * Reconstruct one plan's node path from its link nonces and classify it:
 *   - `decode-failed` — a nonce did not resolve or the walk was non-contiguous (the decoder's sentinel; a bug
 *     worth seeing, never a silent empty path);
 *   - `empty` — no hops (an empty `linkNonces`): nothing to draw;
 *   - `loop` — the path returns to its origin (`nodes` first === last): a closed cycle (a self-payment);
 *   - `path` — an ordinary open route from the originator to the target.
 */
export function reconstructRoute(deanon: Deanonymiser, sessionCode: string, input: RouteInput): ReconstructedRoute {
	const nodes = deanon.nodePathOfPlanPath(sessionCode, input.from, input.linkNonces)
	if (nodes === undefined) {
		return { kind: 'decode-failed' }
	}
	const hops = input.linkNonces.length
	if (hops === 0) {
		return { kind: 'empty' }
	}
	const closesOnOrigin = nodes.length > 1 && nodes[0] === nodes[nodes.length - 1]
	if (closesOnOrigin) {
		return { kind: 'loop', nodes, hops, terms: input.terms }
	}
	return { kind: 'path', nodes, hops, terms: input.terms }
}

/** Reconstruct every found plan for one session, preserving order (plan index === list index). */
export function reconstructRoutes(
	deanon: Deanonymiser,
	sessionCode: string,
	inputs: readonly RouteInput[],
): ReconstructedRoute[] {
	return inputs.map((input) => reconstructRoute(deanon, sessionCode, input))
}

/** The undirected edge keys (`T{tally}` graph edge ids) a reconstructed route traverses, for isolate/highlight. */
export function routeEdgeTallies(deanon: Deanonymiser, sessionCode: string, input: RouteInput): number[] | undefined {
	const tallies: number[] = []
	for (const nonce of input.linkNonces) {
		const tally = deanon.tallyOfNonce(sessionCode, nonce)
		if (tally === undefined) {
			return undefined
		}
		tallies.push(tally)
	}
	return tallies
}

// ── Lift routes (consensus v2): the header carries the chosen lift's exact route, so unlike the discovery
// found-plan case above, no de-anonymisation or inference is needed — the route is read straight from the
// `TraceLiftEntry`. This closes the trace-format gap for the *settled lift's* route (see the design doc).

/** The settled lift's chosen route, read straight from its header entry (no decode): the exact nodes + tallies. */
export interface LiftRoute {
	/** `loop` when the route returns to its origin (a self-payment / circular lift); else `path`. */
	kind: 'path' | 'loop'
	/** The entity ids the lift traversed, `[from, …, to]` (loop ⇒ first === last). */
	nodes: readonly number[]
	/** The tally index of each hop, in order (`nodes.length − 1` entries). */
	tallies: readonly number[]
	/** The hop count (`tallies.length`). */
	hops: number
	/** The lift's transaction code (joins to its consensus events). */
	transactionCode: string
}

/** The outcome badge a settled lift shows in the side list. */
export type LiftOutcome = 'committed' | 'voided' | 'stalled'

/**
 * The chosen route of a settled lift, straight from its {@link TraceLiftEntry} — the header records
 * `route` + `tallyPath` exactly, so this is precise with no de-anonymiser and no inference (the gap the
 * discovery found-plan path still has is closed here for the lift's own route).
 */
export function liftRoute(lift: TraceLiftEntry): LiftRoute {
	const nodes = lift.route
	const closesOnOrigin = nodes.length > 1 && nodes[0] === nodes[nodes.length - 1]
	return {
		kind: closesOnOrigin ? 'loop' : 'path',
		nodes,
		tallies: lift.tallyPath,
		hops: lift.tallyPath.length,
		transactionCode: lift.transactionCode,
	}
}

/** The outcome badge for a lift's settled decision: commit ⇒ committed, void ⇒ voided, none ⇒ stalled (pending). */
export function liftOutcome(decision: ConsensusDecision | undefined): LiftOutcome {
	if (decision === 'commit') {
		return 'committed'
	}
	if (decision === 'void') {
		return 'voided'
	}
	return 'stalled'
}

/**
 * One participant voter the side panel draws: its route node id and the vote it cast (if any). A participant is
 * a voter whose member key resolved to a route entity (so it is also drawn on the graph).
 */
export interface ParticipantVoter {
	node: number
	vote?: 'C' | 'NC'
}

/**
 * The voter-model summary the side panel renders for a settled lift, distilled from its {@link ConsensusState}:
 *   - `participants` — voters that sit on the route (drawn as graph nodes), id + vote;
 *   - `refereeOnlyCount` — how many voters are **off-route referees** the trace format cannot place (counted,
 *     never drawn — so "a stacked voter set looks stacked"; see the design doc's format gap);
 *   - `pulled` — members that recovered via a successful pull;
 *   - `equivocators` — members caught signing both faces;
 *   - `contradictions` — members that detected an outcome mismatch.
 */
export interface LiftVoterSummary {
	participants: ParticipantVoter[]
	refereeOnlyCount: number
	pulled: readonly number[]
	equivocators: readonly number[]
	contradictions: readonly number[]
}

/** Distil a lift's {@link ConsensusState} into the {@link LiftVoterSummary} the side panel renders. */
export function liftVoterSummary(consensus: ConsensusState): LiftVoterSummary {
	const participants: ParticipantVoter[] = []
	let refereeOnlyCount = 0
	for (const voter of consensus.voters) {
		if (voter.role === 'participant' && voter.node !== undefined) {
			participants.push(voter.vote === undefined ? { node: voter.node } : { node: voter.node, vote: voter.vote })
		} else {
			refereeOnlyCount += 1
		}
	}
	return {
		participants,
		refereeOnlyCount,
		pulled: consensus.pulled,
		equivocators: consensus.equivocators,
		contradictions: consensus.contradictions,
	}
}

/** The isolate view for a settled lift's route — its exact nodes + tallies, from the header (no decode). */
export function liftIsolate(lift: TraceLiftEntry): IsolatedRoute {
	return { nodes: lift.route, tallies: lift.tallyPath }
}

/**
 * The session-level result state the controls show, kept distinct so the UI never conflates them:
 *   - `loading` — no trace / this session is not applicable yet;
 *   - `searching` — the playback head has not reached the session's end (mid-scrub): still exploring;
 *   - `no-route` — the search finished and found nothing: an explicit "no route found";
 *   - `found` — the search finished with `count` plans.
 */
export type SessionFoundState =
	| { kind: 'loading' }
	| { kind: 'searching' }
	| { kind: 'no-route' }
	| { kind: 'found'; count: number }

/**
 * Classify a session's found state from whether a trace is loaded, whether the playback head has reached the
 * end of time (so the search is complete at `currentTime`), and how many plans have been found by now. Before
 * the end, zero found reads as "still searching", not "no route" — only at the end is an empty result final.
 */
export function sessionFoundState(params: { loaded: boolean; atEnd: boolean; foundCount: number }): SessionFoundState {
	if (!params.loaded) {
		return { kind: 'loading' }
	}
	if (params.foundCount > 0) {
		return { kind: 'found', count: params.foundCount }
	}
	return params.atEnd ? { kind: 'no-route' } : { kind: 'searching' }
}
