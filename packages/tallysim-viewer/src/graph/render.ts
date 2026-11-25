/**
 * The sigma.js renderer: turn a built {@link TallyGraph} into an interactive WebGL view (pan, zoom, hover
 * tooltips, node search). This is the one browser-only module of the graph tier — it touches `document`,
 * WebGL and sigma, so it is **not** unit-tested (the gate is `vite build` plus a manual interactivity check;
 * see `docs/design.md` § Testing). The headless model (`model.ts`) and layout (`layout.ts`) stay testable;
 * everything visual lives here.
 *
 * ── Why reducers, not baked attributes ─────────────────────────────────────────────────────────────
 * sigma 4 evaluates its built-in styles (x/y/size/colour/label from node attrs) and then merges a
 * **reducer**'s `Partial<…DisplayData>` on top, per node/edge, every refresh. Putting all dynamic styling in
 * reducers — reading a mutable `palette` closure var and a capacity range computed once at setup — means a
 * theme switch is a single `setPalette` + `refresh`, with **no layout recompute** and no attribute rewrite.
 *
 * ── Edge-capacity encoding (the headline requirement) ──────────────────────────────────────────────
 * An edge carries two directed capacities (`capStockToFoil`, `capFoilToStock`). If either is `Infinity` the
 * tally is **unlimited**: it is drawn in a distinct hue (`palette.edgeUnlimited`) at a fixed, moderate
 * thickness that is deliberately **below** the finite-scale maximum — so an unlimited edge can never be
 * mistaken for a merely-large finite one. A finite edge's thickness and (sequential) colour both encode its
 * total swing `capStockToFoil + capFoilToStock`, log-normalised across the finite edges. A direction with
 * `0` capacity is still a present edge (zero ≠ missing); the arrowhead at the target always shows the tally's
 * stock → foil orientation.
 *
 * ── State, not attributes, for interaction ─────────────────────────────────────────────────────────
 * Hover and search selection ride sigma's built-in per-item **state** (`isHovered` / `isHighlighted`), read
 * in the reducers. The replay overlay is a separate channel — a plain {@link ReplayOverlay} (keyed by node/edge
 * key) held in a closure var and read in the same reducers — so the two **compose**: a node/edge takes its
 * overlay colour (or the dim colour when an isolate is active) at rest, and a hovered/selected item still wins
 * on top (the `highlight` accent). The overlay is built by the sigma-free `replay/paint.ts`, so the renderer
 * stays free of replay meaning.
 */

import Sigma from 'sigma'
import type { EdgeDisplayData, NodeDisplayData } from 'sigma/types'
import type { TallyGraph, TallyEdgeAttributes, TallyNodeAttributes } from './model.js'
import type { Palette } from '../app/theme.js'
import type { ReplayOverlay } from '../replay/paint.js'

/** The interactive view a mounted graph exposes to the shell. */
export interface GraphView {
	/** `false` when WebGL2 is unavailable — the view is an inert stub that showed a message instead. */
	readonly webglAvailable: boolean
	/** Re-theme in place (no layout recompute): swap the palette, repaint the surface, refresh. */
	setPalette(palette: Palette): void
	/**
	 * Apply (or clear, with `undefined`) the replay overlay: per-node/-edge styling the reducers compose with
	 * the resting capacity style and the built-in hover/selection. Cheap to call every frame (it swaps the
	 * closure reference and refreshes; no structural recompute).
	 */
	setReplayOverlay(overlay: ReplayOverlay | undefined): void
	/** Highlight + centre the node whose key is `idText` (the entity id as typed). `false` if no such node. */
	search(idText: string): boolean
	/** Clear any search highlight. */
	clearSelection(): void
	/** Centre the camera on a node without changing selection. No-op if the key is unknown. */
	focusNode(key: string): void
	/** Tear down sigma and remove the tooltip/message DOM. Idempotent-safe to call once on unmount. */
	destroy(): void
}

/** Finite min/max of edge total-swing across the graph, computed once; `undefined` when no finite edge. */
interface CapacityRange {
	min: number
	max: number
}

/** The two built-in state flags the reducers care about (hover and search selection). */
interface ItemState {
	isHovered: boolean
	isHighlighted: boolean
}

/** Finite edge thickness spans this range; unlimited edges sit at a fixed value strictly inside it. */
const FINITE_SIZE_MIN = 1
const FINITE_SIZE_MAX = 5
/** Unlimited edges: a fixed, moderate thickness that is NOT the finite maximum (so it never reads as "huge"). */
const UNLIMITED_SIZE = 3
/** Base node radius; search/hover bumps it for emphasis. */
const NODE_SIZE = 4
const NODE_SIZE_LIT = 9
/** Extra thickness and a raised depth bucket for a hovered/selected edge. */
const EDGE_SIZE_BOOST = 2

/** Is WebGL2 available in this document? A dev tool must degrade to a message, not a blank canvas. */
function webgl2Supported(): boolean {
	try {
		return document.createElement('canvas').getContext('webgl2') !== null
	} catch {
		// Some locked-down environments throw from getContext rather than returning null.
		return false
	}
}

/** An edge is unlimited when either directed capacity is non-finite (`Infinity`). */
function isUnlimited(attrs: TallyEdgeAttributes): boolean {
	return !Number.isFinite(attrs.capStockToFoil + attrs.capFoilToStock)
}

/** Compute the finite total-swing range once, so the reducer can normalise without rescanning every frame. */
function finiteCapacityRange(graph: TallyGraph): CapacityRange | undefined {
	let min = Infinity
	let max = -Infinity
	graph.forEachEdge((_key, attrs) => {
		const total = attrs.capStockToFoil + attrs.capFoilToStock
		if (Number.isFinite(total)) {
			min = Math.min(min, total)
			max = Math.max(max, total)
		}
	})
	return min === Infinity ? undefined : { min, max }
}

/** Log-normalise `total` to `[0,1]` within the finite range (log, so a heavy tail does not flatten the low end). */
function logNormalize(total: number, range: CapacityRange | undefined): number {
	if (range === undefined) {
		return 0.5
	}
	const lo = Math.log1p(range.min)
	const hi = Math.log1p(range.max)
	if (hi <= lo) {
		// Every finite edge has the same total — no spread to encode; sit mid-scale.
		return 0.5
	}
	const norm = (Math.log1p(total) - lo) / (hi - lo)
	return Math.min(1, Math.max(0, norm))
}

/** Pick the tercile of the sequential ramp a normalised value falls in. */
function tercileColor(ramp: readonly [string, string, string], norm: number): string {
	if (norm < 1 / 3) {
		return ramp[0]
	}
	return norm < 2 / 3 ? ramp[1] : ramp[2]
}

/** The resting colour + thickness of an edge (before any hover/selection override). */
function edgeBaseVisual(
	attrs: TallyEdgeAttributes,
	range: CapacityRange | undefined,
	palette: Palette,
): { color: string; size: number } {
	if (isUnlimited(attrs)) {
		return { color: palette.edgeUnlimited, size: UNLIMITED_SIZE }
	}
	const total = attrs.capStockToFoil + attrs.capFoilToStock
	const norm = logNormalize(total, range)
	return {
		color: tercileColor(palette.edgeRamp, norm),
		size: FINITE_SIZE_MIN + norm * (FINITE_SIZE_MAX - FINITE_SIZE_MIN),
	}
}

/**
 * Full edge style, composing three layers in order: the resting capacity visual, then the replay overlay (the
 * keyed style, or the dim colour when an isolate is active), then the built-in hover/selection accent — which
 * wins on top, and never leaves a hovered edge hidden. `head`/`path`/`parallel*` are the fixed orientation and
 * curving from the graph-view tier.
 */
function edgeStyle(
	key: string,
	attrs: TallyEdgeAttributes,
	state: ItemState,
	palette: Palette,
	range: CapacityRange | undefined,
	overlay: ReplayOverlay | undefined,
): Partial<EdgeDisplayData> {
	const base = edgeBaseVisual(attrs, range, palette)
	let color = base.color
	let size = base.size
	let zIndex = 0
	let hidden = false
	if (overlay !== undefined) {
		const styled = overlay.edges.get(key)
		if (styled !== undefined) {
			color = styled.color ?? color
			size = styled.size ?? size
			zIndex = styled.zIndex ?? zIndex
			hidden = styled.hidden ?? false
		} else if (overlay.dim !== undefined) {
			color = overlay.dim.edge
		}
	}
	if (state.isHovered || state.isHighlighted) {
		color = palette.highlight
		size = base.size + EDGE_SIZE_BOOST
		zIndex = 1
		hidden = false // a hovered edge is always shown, even if the overlay hid it.
	}
	return {
		head: 'arrow',
		path: 'straight',
		parallelPath: 'curved',
		parallelSpread: 0.35,
		color,
		size,
		zIndex,
		visibility: hidden ? 'hidden' : 'visible',
	}
}

/**
 * Full node style, composing the same three layers as {@link edgeStyle}: the recessive neutral fill, then the
 * replay overlay (keyed style or the isolate dim colour), then the hover/search highlight on top.
 */
function nodeStyle(
	key: string,
	attrs: TallyNodeAttributes,
	state: ItemState,
	palette: Palette,
	overlay: ReplayOverlay | undefined,
): Partial<NodeDisplayData> {
	const lit = state.isHovered || state.isHighlighted
	let color = palette.node
	let size = NODE_SIZE
	if (overlay !== undefined) {
		const styled = overlay.nodes.get(key)
		if (styled !== undefined) {
			color = styled.color ?? color
			size = styled.size ?? size
		} else if (overlay.dim !== undefined) {
			color = overlay.dim.node
		}
	}
	if (lit) {
		color = palette.highlight
		size = NODE_SIZE_LIT
	}
	return {
		label: attrs.label,
		labelColor: palette.nodeLabel,
		color,
		size,
		highlighted: lit,
		labelVisibility: lit ? 'visible' : 'auto',
	}
}

/** Render `Infinity` as `∞` for a tooltip; every finite number prints as-is. */
function formatCapacity(value: number): string {
	return Number.isFinite(value) ? String(value) : '∞'
}

/** Create the floating tooltip element (hidden until a hover positions it). Lives inside `container`. */
function createTooltip(): HTMLDivElement {
	const tooltip = document.createElement('div')
	tooltip.className = 'tsv-tooltip'
	tooltip.style.position = 'absolute'
	tooltip.style.pointerEvents = 'none'
	tooltip.style.display = 'none'
	tooltip.style.zIndex = '10'
	return tooltip
}

// NOTE: the tooltip is placed once, on hover-enter, and does not track the cursor while the pointer moves
// within the same node/edge. Fine for point-like nodes; if it ever feels "stuck" on large/long edges, listen
// to the container's mousemove (or sigma 'moveBody') and reposition the visible tooltip there.
/** Show `html` (already-escaped plain text with `<br>` separators) at viewport `(x, y)` within the container. */
function showTooltip(tooltip: HTMLDivElement, text: string, x: number, y: number): void {
	tooltip.textContent = ''
	for (const [i, line] of text.split('\n').entries()) {
		if (i > 0) {
			tooltip.append(document.createElement('br'))
		}
		tooltip.append(document.createTextNode(line))
	}
	tooltip.style.left = `${x + 12}px`
	tooltip.style.top = `${y + 12}px`
	tooltip.style.display = 'block'
}

/** Render the WebGL-absent fallback into the container and return the element so `destroy` can remove it. */
function renderWebglMissing(container: HTMLElement): HTMLElement {
	const message = document.createElement('div')
	message.className = 'tsv-webgl-missing'
	message.textContent =
		'This graph view needs WebGL2, which this browser or session does not provide. The network cannot be drawn here.'
	container.append(message)
	return message
}

/** The inert view returned when WebGL2 is missing: a shown message and no-op methods (never throws). */
function stubView(message: HTMLElement): GraphView {
	return {
		webglAvailable: false,
		setPalette(): void {},
		setReplayOverlay(): void {},
		search(): boolean {
			return false
		},
		clearSelection(): void {},
		focusNode(): void {},
		destroy(): void {
			message.remove()
		},
	}
}

/**
 * Mount an interactive sigma view of `graph` into `container`, styled by `palette`. Returns a {@link GraphView}
 * handle. When WebGL2 is unavailable it renders a message and returns an inert stub (`webglAvailable: false`)
 * rather than throwing or leaving a blank canvas.
 *
 * The caller owns the layout: positions come from the graph's `x`/`y` attributes (seeded, then updated in place
 * by the layout worker), which sigma re-reads on each refresh — so a running layout animates here for free.
 */
export function createGraphView(container: HTMLElement, graph: TallyGraph, initialPalette: Palette): GraphView {
	if (!webgl2Supported()) {
		return stubView(renderWebglMissing(container))
	}

	let palette = initialPalette
	let overlay: ReplayOverlay | undefined
	const range = finiteCapacityRange(graph)
	container.style.background = palette.surface

	const tooltip = createTooltip()
	container.append(tooltip)

	const sigma = new Sigma<TallyNodeAttributes, TallyEdgeAttributes>(graph, container, {
		settings: {
			enableEdgeEvents: true,
			allowInvalidContainer: true,
		},
		nodeReducer: (key, _data, attrs, state) => nodeStyle(key, attrs, state, palette, overlay),
		edgeReducer: (key, _data, attrs, state) => edgeStyle(key, attrs, state, palette, range, overlay),
	})

	sigma.on('enterNode', ({ node, event }) => {
		showTooltip(tooltip, `Entity ${graph.getNodeAttribute(node, 'label')}\ndegree ${graph.degree(node)}`, event.x, event.y)
	})
	sigma.on('leaveNode', () => {
		tooltip.style.display = 'none'
	})
	sigma.on('enterEdge', ({ edge, event }) => {
		const attrs = graph.getEdgeAttributes(edge)
		const lines = [
			`tally ${attrs.tallyIndex}`,
			`stock ${attrs.stock} → foil ${attrs.foil}`,
			`cap →foil ${formatCapacity(attrs.capStockToFoil)}  cap →stock ${formatCapacity(attrs.capFoilToStock)}`,
		]
		// A replay overlay can attach a note (e.g. the prune reason) to this edge; show it under the capacities.
		const note = overlay?.edges.get(edge)?.note
		if (note !== undefined) {
			lines.push(note)
		}
		showTooltip(tooltip, lines.join('\n'), event.x, event.y)
	})
	sigma.on('leaveEdge', () => {
		tooltip.style.display = 'none'
	})

	let selected: string | undefined

	function focusNode(key: string): void {
		const data = sigma.getNodeDisplayData(key)
		if (data !== undefined) {
			void sigma.getCamera().animate({ x: data.x, y: data.y, ratio: 0.3 }, { duration: 400 })
		}
	}

	function clearSelection(): void {
		if (selected !== undefined) {
			sigma.setNodeState(selected, { isHighlighted: false })
			selected = undefined
		}
	}

	return {
		webglAvailable: true,
		setPalette(next: Palette): void {
			palette = next
			container.style.background = next.surface
			sigma.refresh()
		},
		setReplayOverlay(next: ReplayOverlay | undefined): void {
			overlay = next
			sigma.refresh()
		},
		search(idText: string): boolean {
			if (!graph.hasNode(idText)) {
				return false
			}
			clearSelection()
			selected = idText
			sigma.setNodeState(idText, { isHighlighted: true })
			focusNode(idText)
			return true
		},
		clearSelection,
		focusNode,
		destroy(): void {
			sigma.kill()
			tooltip.remove()
		},
	}
}
