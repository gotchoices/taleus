/**
 * The app shell: the top bar, the left control panel, and the two main views, with a light/dark theme toggle.
 * A **view-mode toggle** (`Graph | Sweep`) switches between the graph tier (load a network, draw it, search it,
 * replay a trace) and the sweeps tier (chart a parameter sweep). Each mode shows its own panel-control group and
 * its own main container; switching to Sweep re-fits the chart (uPlot measures 0×0 while its tab is hidden). The
 * live-run source tab is still a later ticket — its mount point keeps the seam comment below.
 *
 * ── The load path ──────────────────────────────────────────────────────────────────────────────────
 * A file the developer picks is read as text and handed to {@link indexTrace} (which wraps `tallysim`'s
 * `parseTrace`) inside a `try/catch`; a version/format error surfaces in the panel's status area, never the
 * console. On success — or when the "Load sample" button materialises an in-page network — the shell builds
 * the graph ({@link buildGraph}), mounts the renderer ({@link createGraphView}), and starts the seeded worker
 * layout ({@link runLayout}) off the main thread. A previous view/layout is torn down first so repeated loads
 * do not leak a sigma instance or a running worker.
 */

import { compileConditions, type Network } from 'tallysim'
import { indexTrace, type TraceIndex } from '../core/trace-index.js'
import { createDeanonymiser, type Deanonymiser } from '../core/deanonymise.js'
import { buildGraph } from '../graph/model.js'
import { createGraphView, type GraphView } from '../graph/render.js'
import { runLayout, type LayoutController } from '../graph/layout.js'
import { mountDisabledReplayControls, mountReplayControls, type ReplayControls } from '../replay/controls.js'
import { mountSweepView, type SweepView } from '../sweeps/view.js'
import { sampleNetwork } from './sample-network.js'
import { SHELL_CSS } from './styles.js'
import { initialTheme, paletteFor, storeTheme, type Palette, type ThemeName } from './theme.js'

/** A one-line network summary shown in the panel after a load. */
interface NetworkSummary {
	generator: string
	entityCount: number
	tallyCount: number
	queryCount: number
}

/** A loaded trace's replay inputs, assembled once on load and handed to the replay controls. */
interface TraceContext {
	index: TraceIndex
	deanon: Deanonymiser
	conditions: ReturnType<typeof compileConditions>
}

/** The viewer's two main modes: the network graph, or the parameter-sweep charts. */
type ViewMode = 'graph' | 'sweep'

/** The shell's live references — the current view, layout and replay, torn down and replaced on each load. */
interface ShellState {
	theme: ThemeName
	mode: ViewMode
	view: GraphView | undefined
	layout: LayoutController | undefined
	replay: ReplayControls | undefined
}

/** Create a styled element with an id, in one call. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, id?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag)
	if (id !== undefined) {
		node.id = id
	}
	return node
}

/** The human message for a caught value (a `parseTrace` version error carries a clear `.message`). */
function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

/** Inject the shell stylesheet once (idempotent on the element id). */
function injectStyles(): void {
	if (document.getElementById('tsv-style') !== null) {
		return
	}
	const style = el('style', 'tsv-style')
	style.textContent = SHELL_CSS
	document.head.append(style)
}

/** Set the chrome CSS custom properties from a palette (the graph surface itself is the renderer's job). */
function applyChrome(palette: Palette): void {
	const root = document.documentElement.style
	root.setProperty('--tsv-surface', palette.surface)
	root.setProperty('--tsv-page', palette.pagePlane)
	root.setProperty('--tsv-text', palette.textPrimary)
	root.setProperty('--tsv-text-secondary', palette.textSecondary)
	root.setProperty('--tsv-border', palette.border)
}

/** Build a labelled panel section with a title and a content host, appended to `panel`. */
function panelSection(panel: HTMLElement, title: string): HTMLDivElement {
	const section = el('div')
	const heading = el('p')
	heading.className = 'tsv-section-title'
	heading.textContent = title
	const body = el('div')
	body.className = 'tsv-field'
	section.append(heading, body)
	panel.append(section)
	return body
}

/** Render a summary into the panel's summary host as a definition list. */
function renderSummary(host: HTMLElement, summary: NetworkSummary): void {
	host.textContent = ''
	const list = el('dl')
	const rows: [string, string][] = [
		['generator', summary.generator],
		['entities', String(summary.entityCount)],
		['tallies', String(summary.tallyCount)],
		['queries', String(summary.queryCount)],
	]
	for (const [term, value] of rows) {
		const dt = el('dt')
		dt.textContent = term
		const dd = el('dd')
		dd.textContent = value
		list.append(dt, dd)
	}
	host.append(list)
}

/**
 * Mount the whole shell into `root`. Builds the DOM, wires the file loader, the sample button, the search box
 * and the theme toggle, and holds the single live {@link GraphView}/{@link LayoutController} pair.
 */
export function mountShell(root: HTMLElement): void {
	injectStyles()

	const state: ShellState = { theme: initialTheme(), mode: 'graph', view: undefined, layout: undefined, replay: undefined }

	const app = el('div', 'tsv-app')
	const topbar = el('div', 'tsv-topbar')
	const title = el('h1', 'tsv-title')
	title.textContent = 'TallySim Viewer'
	const modeToggle = el('div', 'tsv-mode')
	const graphModeButton = el('button', 'tsv-mode-graph')
	graphModeButton.textContent = 'Graph'
	const sweepModeButton = el('button', 'tsv-mode-sweep')
	sweepModeButton.textContent = 'Sweep'
	modeToggle.append(graphModeButton, sweepModeButton)
	const themeButton = el('button', 'tsv-theme')
	topbar.append(title, modeToggle, themeButton)

	const body = el('div', 'tsv-body')
	const panel = el('div', 'tsv-panel')
	// The panel holds two control groups — one per mode — shown/hidden by the view-mode toggle.
	const graphControls = el('div', 'tsv-graph-controls')
	const sweepControls = el('div', 'tsv-sweep-controls')
	panel.append(graphControls, sweepControls)
	const graph = el('div', 'tsv-graph')
	const chart = el('div', 'tsv-chart')
	body.append(panel, graph, chart)
	app.append(topbar, body)
	root.append(app)

	// ── Source section: load a recorded trace file, or materialise the in-page sample. ──
	const sourceHost = panelSection(graphControls, 'Source')
	const fileInput = el('input', 'tsv-file')
	fileInput.type = 'file'
	fileInput.accept = '.ndjson,.jsonl,.json,.txt,application/json'
	const sampleButton = el('button', 'tsv-sample')
	sampleButton.textContent = 'Load sample'
	const status = el('div', 'tsv-status')
	sourceHost.append(fileInput, sampleButton, status)
	// SEAM: the live-run driver tab and the sweep-source tab mount here in later tickets.

	// ── Summary section: the loaded network at a glance. ──
	const summaryHost = panelSection(graphControls, 'Network')
	summaryHost.id = 'tsv-summary'

	// ── Search section: highlight + centre a node by entity id. ──
	const searchHost = panelSection(graphControls, 'Find entity')
	const searchInput = el('input', 'tsv-search')
	searchInput.type = 'text'
	searchInput.placeholder = 'entity id, e.g. 3'
	const searchMiss = el('div', 'tsv-search-miss')
	searchHost.append(searchInput, searchMiss)

	// ── Replay section: the payment-search transport (disabled until a trace with sessions is loaded). ──
	const replayHost = panelSection(graphControls, 'Replay')
	state.replay = mountDisabledReplayControls(replayHost)

	// ── Sweep view: the parameter-sweep charts (its own panel controls + the chart main container). ──
	const sweepView: SweepView = mountSweepView({ panelHost: sweepControls, chartHost: chart, palette: paletteFor(state.theme) })

	function setStatus(message: string): void {
		status.textContent = message
	}

	function teardown(): void {
		state.replay?.destroy()
		state.replay = undefined
		state.layout?.stop()
		state.layout = undefined
		state.view?.destroy()
		state.view = undefined
		graph.textContent = ''
	}

	/**
	 * Build the graph + renderer, then mount the replay panel: the live transport when a trace with sessions is
	 * loaded (and WebGL is available to paint the overlay), otherwise the disabled panel (the sample path).
	 */
	function loadNetwork(network: Network, summary: NetworkSummary, trace?: TraceContext): void {
		teardown()
		const built = buildGraph(network)
		const view = createGraphView(graph, built, paletteFor(state.theme))
		state.view = view
		if (view.webglAvailable) {
			state.layout = runLayout(built, { seed: network.meta.seed })
		}
		if (trace !== undefined && view.webglAvailable) {
			state.replay = mountReplayControls({
				host: replayHost,
				view,
				index: trace.index,
				deanon: trace.deanon,
				conditions: trace.conditions,
				palette: paletteFor(state.theme),
			})
		} else {
			state.replay = mountDisabledReplayControls(replayHost)
		}
		renderSummary(summaryHost, summary)
		searchInput.value = ''
		searchMiss.textContent = ''
	}

	function loadTraceText(text: string): void {
		try {
			const index = indexTrace(text.split(/\r?\n/))
			setStatus('')
			// Assemble the replay inputs once: the de-anonymiser over the whole network, and the sleeping/late
			// sets compiled from the scenario's conditions — matching the CLI's seed (no runSeed offset), so the
			// viewer reproduces the exact sets the trace was recorded under.
			const deanon = createDeanonymiser(index.network)
			const scenario = index.header.scenario
			const conditions = compileConditions(index.network, scenario.conditions ?? {}, scenario.conditionsSeed ?? 0)
			loadNetwork(
				index.network,
				{
					generator: index.network.meta.generator,
					entityCount: index.network.entityCount,
					tallyCount: index.network.tallies.length,
					queryCount: index.sessions().length,
				},
				{ index, deanon, conditions },
			)
		} catch (err) {
			// parseTrace throws a version/format error with a clear message — surface it, don't swallow it.
			setStatus(errorMessage(err))
		}
	}

	function loadSample(): void {
		const network = sampleNetwork()
		setStatus('')
		// The sample has no trace sessions, so the replay panel mounts disabled (no `trace` argument).
		loadNetwork(network, {
			generator: network.meta.generator,
			entityCount: network.entityCount,
			tallyCount: network.tallies.length,
			queryCount: 0,
		})
	}

	function runSearch(): void {
		const value = searchInput.value.trim()
		if (value === '') {
			state.view?.clearSelection()
			searchMiss.textContent = ''
			return
		}
		const found = state.view?.search(value) ?? false
		searchMiss.textContent = found ? '' : `No entity "${value}" in this network.`
	}

	function applyTheme(next: ThemeName): void {
		state.theme = next
		storeTheme(next)
		const palette = paletteFor(next)
		applyChrome(palette)
		state.view?.setPalette(palette)
		state.replay?.setPalette(palette)
		sweepView.setPalette(palette)
		themeButton.textContent = next === 'dark' ? 'Light theme' : 'Dark theme'
	}

	/**
	 * Switch the main view mode. Each mode shows its own panel-control group and its own main container; the
	 * other pair is hidden. Switching to Sweep re-fits the chart, because uPlot measured 0×0 while its container
	 * was `display:none` and only finds its real size once shown.
	 */
	function applyMode(next: ViewMode): void {
		state.mode = next
		const sweep = next === 'sweep'
		graphControls.style.display = sweep ? 'none' : ''
		graph.style.display = sweep ? 'none' : ''
		sweepControls.style.display = sweep ? '' : 'none'
		chart.style.display = sweep ? '' : 'none'
		graphModeButton.classList.toggle('tsv-mode-active', !sweep)
		sweepModeButton.classList.toggle('tsv-mode-active', sweep)
		if (sweep) {
			sweepView.relayout()
		}
	}

	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0]
		if (file === undefined) {
			return
		}
		void file
			.text()
			.then((text) => {
				loadTraceText(text)
			})
			.catch((err: unknown) => {
				setStatus(errorMessage(err))
			})
	})
	sampleButton.addEventListener('click', loadSample)
	searchInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			runSearch()
		}
	})
	searchInput.addEventListener('change', runSearch)
	themeButton.addEventListener('click', () => {
		applyTheme(state.theme === 'dark' ? 'light' : 'dark')
	})
	graphModeButton.addEventListener('click', () => {
		applyMode('graph')
	})
	sweepModeButton.addEventListener('click', () => {
		applyMode('sweep')
	})

	applyTheme(state.theme)
	applyMode(state.mode)
}
