/**
 * Translate a replay's **derived** state into a plain styling {@link ReplayOverlay} the renderer applies — the
 * "what colour is each node/edge right now" step, kept **pure** (no sigma, no DOM) so it can be unit-tested and
 * so the renderer owns none of the replay's meaning. {@link controls.ts} calls this each frame with the
 * {@link ActiveSet} at the current time; {@link import('../graph/render.js').GraphView.setReplayOverlay} applies
 * the result.
 *
 * ── What the overlay encodes ───────────────────────────────────────────────────────────────────────
 *   - **Lit nodes/edges** — reached by the search by now — take a colour from {@link Palette.roundScale} by
 *     their round (the search spreading outward, round by round). Edges keep their resting capacity *thickness*
 *     (the overlay recolours but does not resize them) and rise above the un-lit edges. A `late-answer-folded`
 *     edge carries its *later* round here because the reducer already folded it to that round in place.
 *   - **Pruned edges** fade to {@link Palette.pruned} (distinct from a never-reached blue edge) and carry the
 *     prune reason as a hover note. Pruning wins over lighting: a dropped candidate reads as discarded, not live.
 *   - **Sleeping / late nodes** take their own distinct marks ({@link Palette.sleeping} / {@link Palette.late}),
 *     applied to the *whole* conditioned set (not only reached nodes) so every asleep/late node is visible.
 *     Sleeping wins over late (a node drawn in both sets is asleep). These are markers only — they add no
 *     "query failed" meaning (a sleeping *target* can still be resolved by a neighbour).
 *   - **Isolate** — when a found route is selected, the overlay keys *only* that route's nodes/edges (in
 *     {@link Palette.found}) and sets {@link ReplayOverlay.dim}, so the renderer recedes everything else and the
 *     one route stands alone. In isolate mode the spreading/condition marks are suppressed by design.
 *   - **Colour-by-session** — when {@link PaintInput.sessionColor} is set, lit nodes/edges take that one hue
 *     instead of the round scale, so several sessions overlaid at once stay separable by colour. The caller
 *     builds one overlay per session and {@link mergeOverlays merges} them.
 *   - **Consensus** — when {@link PaintInput.consensus} is set (a settling lift's state at `currentTime`), the
 *     sign-and-settle phase is layered **over** the spread marks: promised hops take {@link Palette.promised},
 *     a committed route turns solid {@link Palette.committed}, and a voided route's held hops flash
 *     {@link Palette.voidFlash} for {@link VOID_FLASH_MS} then clear back to their resting/discovery style. It
 *     is composed last (consensus is later in event time than discovery, so it wins past settlement) and is
 *     **suppressed in isolate mode** (isolate stays the green route selection). See the design doc's *Consensus
 *     phase*.
 *
 * This module is sigma-free on purpose: it imports only the key-mapping helpers (`edgeKeyForTally`,
 * `entityName`) that are the one documented place the tally-index↔edge-key and id↔node-key conventions live.
 */

import { entityName } from 'tallysim'
import { edgeKeyForTally } from '../graph/model.js'
import type {
	ActiveSet,
	ConsensusDecision,
	ConsensusEdgeState,
	ConsensusNodeState,
	ConsensusState,
} from '../core/timeline.js'
import type { Palette } from '../app/theme.js'

/** Overlay styling for one node (keyed by node key). Any field left `undefined` keeps the renderer's base. */
export interface OverlayNodeStyle {
	color?: string
	size?: number
}

/** Overlay styling for one edge (keyed by edge key). `note` extends the hover tooltip (e.g. a prune reason). */
export interface OverlayEdgeStyle {
	color?: string
	size?: number
	zIndex?: number
	hidden?: boolean
	note?: string
}

/**
 * A plain, sigma-free description of the replay's current paint. The renderer looks each node/edge key up in
 * these maps; a key that is absent keeps its resting style, unless {@link ReplayOverlay.dim} is set (isolate
 * mode), when the absent item recedes to the dim colour instead.
 */
export interface ReplayOverlay {
	nodes: Map<string, OverlayNodeStyle>
	edges: Map<string, OverlayEdgeStyle>
	/** When set (a route is isolated), the recede colours for every node/edge *not* keyed above. */
	dim?: { node: string; edge: string }
}

/** The inputs that decide the paint at one instant. */
export interface PaintInput {
	/** The lit/pruned/found set at the current time, from one session's {@link import('../core/timeline.js').Timeline}. */
	active: ActiveSet
	/** Entities made asleep (never answer) — marked distinctly whether or not the search reached them. */
	sleeping: ReadonlySet<number>
	/** Entities made late (answer only after a long delay) — marked distinctly, told apart from `sleeping`. */
	late: ReadonlySet<number>
	palette: Palette
	/** When set, lit nodes/edges take this single hue instead of the round scale (colour-by-session). */
	sessionColor?: string
	/** When set, isolate just this route: key only its nodes/edges and dim everything else. */
	isolate?: IsolatedRoute
	/**
	 * When set, the selected lift's settlement state at {@link currentTime} — layered over the spread marks
	 * (never in isolate mode). Omit for a discovery-only timeline (no lift bound).
	 */
	consensus?: ConsensusState
	/** The playback head time, for the void-flash window (`currentTime − settledTime ≤ VOID_FLASH_MS`). */
	currentTime?: number
}

/** A route to isolate, as entity ids and the tally indices its links traverse (from `routes.ts`). */
export interface IsolatedRoute {
	nodes: readonly number[]
	tallies: readonly number[]
}

/** The size a route's nodes take when isolated (above the base so the route stands out against the dimmed rest). */
const ISOLATE_NODE_SIZE = 7
/** The size a route's edges take when isolated (above the finite capacity maximum so the route is unmistakable). */
const ISOLATE_EDGE_SIZE = 6

/**
 * How long (in the trace's **virtual-time** ms) a voided lift's released hops flash before clearing to their
 * resting/discovery style. A fixed, brief window: long enough to notice the "let go", short enough not to
 * linger. If a `settled` event sits within this window of the trace's last event, the flash can still be
 * showing at `t = max` (the head cannot advance past it) — acceptable; the route reads as "just voided".
 */
export const VOID_FLASH_MS = 400
/** The size a committed/flashing route's edges take (a solid boost above the finite-capacity maximum). */
const CONSENSUS_EDGE_SIZE = 6
/** The size a settled (committed or flashing-void) route's nodes take, so the settled route stands out. */
const CONSENSUS_NODE_SIZE = 7

/** The round ramp colour for `round`, clamping a round past the last step to the last colour. */
function roundColor(scale: readonly string[], round: number): string {
	if (scale.length === 0) {
		return '#000000'
	}
	const i = round < 0 ? 0 : round >= scale.length ? scale.length - 1 : round
	return scale[i]
}

/** Build the overlay for one session's active set (or, with {@link PaintInput.isolate}, the isolate overlay). */
export function buildOverlay(input: PaintInput): ReplayOverlay {
	if (input.isolate !== undefined) {
		// Isolate is the green route-selection view; the consensus phase is suppressed by design here.
		return isolateOverlay(input.isolate, input.palette)
	}
	const overlay = spreadOverlay(input)
	if (input.consensus !== undefined) {
		applyConsensus(overlay, input.consensus, input.currentTime, input.palette)
	}
	return overlay
}

/**
 * Layer a lift's settlement state over the spreading overlay (mutating it in place). Consensus is later in
 * event time than discovery, so it **wins** on the hops/nodes it touches past settlement. A released (voided)
 * hop or node that has fallen outside the flash window is deliberately **not keyed** — it is left to show the
 * resting/discovery style underneath, not forced to a colour.
 */
function applyConsensus(overlay: ReplayOverlay, consensus: ConsensusState, currentTime: number | undefined, palette: Palette): void {
	const flashing =
		consensus.settledTime !== undefined && currentTime !== undefined && currentTime - consensus.settledTime <= VOID_FLASH_MS
	for (const edge of consensus.edges) {
		const style = consensusEdgeStyle(edge, palette, flashing)
		if (style !== undefined) {
			overlay.edges.set(edgeKeyForTally(edge.tally), style)
		}
	}
	for (const node of consensus.nodes) {
		const style = consensusNodeStyle(node, consensus.decision, palette, flashing)
		if (style !== undefined) {
			overlay.nodes.set(entityName(node.node), style)
		}
	}
}

/**
 * One consensus hop's edge style, or `undefined` to leave it resting:
 *   - `promised` — the promise colour, risen above the discovery edges, keeping its capacity thickness;
 *   - `committed` — solid (colour + a size boost), risen highest;
 *   - `released` — flash the void colour while inside the window, else `undefined` (back to resting/discovery).
 */
function consensusEdgeStyle(state: ConsensusEdgeState, palette: Palette, flashing: boolean): OverlayEdgeStyle | undefined {
	switch (state.phase) {
		case 'promised': {
			return { color: palette.promised, zIndex: 2 }
		}
		case 'committed': {
			return { color: palette.committed, size: CONSENSUS_EDGE_SIZE, zIndex: 3 }
		}
		case 'released': {
			return flashing ? { color: palette.voidFlash, size: CONSENSUS_EDGE_SIZE, zIndex: 3 } : undefined
		}
	}
}

/**
 * One consensus member node's style, or `undefined` to leave it resting:
 *   - `promised` — the promise colour;
 *   - `voted` — a commit-pending (`C`) vote previews committed; a no-commit (`NC`) vote previews the void flash,
 *     so the two read differently before the lift settles;
 *   - `settled` — committed ⇒ the commit colour (boosted); void ⇒ flash while inside the window, else resting.
 */
function consensusNodeStyle(
	state: ConsensusNodeState,
	decision: ConsensusDecision | undefined,
	palette: Palette,
	flashing: boolean,
): OverlayNodeStyle | undefined {
	switch (state.phase) {
		case 'promised': {
			return { color: palette.promised }
		}
		case 'voted': {
			return { color: state.vote === 'NC' ? palette.voidFlash : palette.committed }
		}
		case 'settled': {
			if (decision === 'commit') {
				return { color: palette.committed, size: CONSENSUS_NODE_SIZE }
			}
			return flashing ? { color: palette.voidFlash, size: CONSENSUS_NODE_SIZE } : undefined
		}
	}
}

/** Isolate: only the route's nodes/edges are lit (in `found`); `dim` makes the renderer recede the rest. */
function isolateOverlay(route: IsolatedRoute, palette: Palette): ReplayOverlay {
	const nodes = new Map<string, OverlayNodeStyle>()
	const edges = new Map<string, OverlayEdgeStyle>()
	for (const id of route.nodes) {
		nodes.set(entityName(id), { color: palette.found, size: ISOLATE_NODE_SIZE })
	}
	for (const tally of route.tallies) {
		edges.set(edgeKeyForTally(tally), { color: palette.found, size: ISOLATE_EDGE_SIZE, zIndex: 2 })
	}
	return { nodes, edges, dim: { node: palette.dimmed, edge: palette.dimmed } }
}

/** The normal spreading overlay: round-lit nodes/edges, pruned fades, sleeping/late distinct marks. */
function spreadOverlay(input: PaintInput): ReplayOverlay {
	const { active, sleeping, late, palette, sessionColor } = input
	const nodes = new Map<string, OverlayNodeStyle>()
	const edges = new Map<string, OverlayEdgeStyle>()

	const prunedTallies = new Set(active.pruned.map((p) => p.tally))

	// Lit edges first, coloured by round (skip the pruned ones — pruning overrides lighting, applied next).
	for (const edge of active.edges) {
		if (prunedTallies.has(edge.tally)) {
			continue
		}
		edges.set(edgeKeyForTally(edge.tally), { color: sessionColor ?? roundColor(palette.roundScale, edge.round), zIndex: 1 })
	}
	// Pruned edges fade and carry the reason as a hover note.
	for (const candidate of active.pruned) {
		edges.set(edgeKeyForTally(candidate.tally), { color: palette.pruned, zIndex: 0, note: `pruned: ${candidate.reason}` })
	}

	// Lit nodes, coloured by round.
	for (const node of active.nodes) {
		nodes.set(entityName(node.node), { color: sessionColor ?? roundColor(palette.roundScale, node.round) })
	}
	// Conditioned nodes override the round colour (whole sets, so every one is visible). Late first, then
	// sleeping, so a node drawn in both ends up asleep (sleeping wins, matching the conditions' precedence).
	// NOTE: sigma's default node program has no dash/stroke, so the distinct sleeping/late mark is colour only
	// (not the dashed outline the ticket floated). If a dashed/ringed mark is wanted, it needs a custom node
	// program or a second overlay ring — not reachable by recolouring alone.
	for (const id of late) {
		nodes.set(entityName(id), { color: palette.late })
	}
	for (const id of sleeping) {
		nodes.set(entityName(id), { color: palette.sleeping })
	}

	return { nodes, edges }
}

/**
 * Merge several per-session overlays into one (colour-by-session): a later overlay's key wins on a conflict
 * (an edge/node two sessions both touch takes the last session's colour — acceptable for a dev overlay). `dim`
 * is never merged: isolate is a single-session action, so a colour-by-session overlay never carries one.
 */
export function mergeOverlays(overlays: readonly ReplayOverlay[]): ReplayOverlay {
	const nodes = new Map<string, OverlayNodeStyle>()
	const edges = new Map<string, OverlayEdgeStyle>()
	for (const overlay of overlays) {
		for (const [key, style] of overlay.nodes) {
			nodes.set(key, style)
		}
		for (const [key, style] of overlay.edges) {
			edges.set(key, style)
		}
	}
	return { nodes, edges }
}
