/**
 * The app shell: the top bar, the left control panel, and the two main views, with a light/dark theme toggle.
 * A **view-mode toggle** (`Graph | Sweep`) switches between the graph tier (load a network, draw it, search it,
 * replay a trace) and the sweeps tier (chart a parameter sweep). Each mode shows its own panel-control group and
 * its own main container; switching to Sweep re-fits the chart (uPlot measures 0×0 while its tab is hidden).
 *
 * ── Two source tabs ───────────────────────────────────────────────────────────────────────────────
 * The graph mode's Source section has a **File | Live-run** tab toggle. The File tab loads a recorded trace (or
 * the in-page sample); the Live-run tab generates a network and runs the real discovery search in a Web Worker,
 * animating the result through the same replay pipeline. Both paths feed the one shared graph view and replay
 * panel: the shell exposes `renderNetwork` (draw a network) + `setReplay` (swap the replay panel) so the live
 * driver reuses exactly the file path's rendering, and a file/sample load calls `liveControls.invalidate()`
 * because it replaces the drawn view out from under the live tab.
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
import { mountLiveControls, type LiveControls, type LiveRunHost } from '../live/controls.js'
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

	// ── Source section: a File | Live-run tab toggle over the file sub-panel and the live-run sub-panel. ──
	const sourceHost = panelSection(graphControls, 'Source')
	const sourceTabs = el('div', 'tsv-source-tabs')
	const fileTabButton = el('button', 'tsv-source-tab-file')
	fileTabButton.textContent = 'File'
	const liveTabButton = el('button', 'tsv-source-tab-live')
	liveTabButton.textContent = 'Live-run'
	sourceTabs.append(fileTabButton, liveTabButton)

	// File sub-panel: load a recorded trace file, or materialise the in-page sample.
	const fileSubPanel = el('div', 'tsv-source-file')
	const fileInput = el('input', 'tsv-file')
	fileInput.type = 'file'
	fileInput.accept = '.ndjson,.jsonl,.json,.txt,application/json'
	const sampleButton = el('button', 'tsv-sample')
	sampleButton.textContent = 'Load sample'
	const status = el('div', 'tsv-status')
	fileSubPanel.append(fileInput, sampleButton, status)

	// Live-run sub-panel: the generate → pick → run → download driver (mounted after the fn defs below).
	const liveSubPanel = el('div', 'tsv-source-live')

	sourceHost.append(sourceTabs, fileSubPanel, liveSubPanel)

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
	 * Build the graph + renderer for `network`, mount a **disabled** replay panel as the default, and return the
	 * new view. Tears down any prior view/layout/replay first. This is the rendering half both the file path and
	 * the live-run driver share; a caller that has a trace (or a finished live run) then calls {@link setReplay}.
	 */
	function renderNetwork(network: Network, summary: NetworkSummary): GraphView | undefined {
		teardown()
		const built = buildGraph(network)
		const view = createGraphView(graph, built, paletteFor(state.theme))
		state.view = view
		if (view.webglAvailable) {
			state.layout = runLayout(built, { seed: network.meta.seed })
		}
		state.replay = mountDisabledReplayControls(replayHost)
		renderSummary(summaryHost, summary)
		searchInput.value = ''
		searchMiss.textContent = ''
		return view
	}

	/** Replace the replay panel (destroying the prior one) without touching the current view. */
	function setReplay(buildFn: () => ReplayControls): void {
		state.replay?.destroy()
		state.replay = buildFn()
	}

	/** The file path: render the network, then — for a trace with sessions — mount the live replay transport. */
	function loadNetwork(network: Network, summary: NetworkSummary, trace?: TraceContext): void {
		const view = renderNetwork(network, summary)
		if (trace !== undefined && view !== undefined && view.webglAvailable) {
			setReplay(() =>
				mountReplayControls({
					host: replayHost,
					view,
					index: trace.index,
					deanon: trace.deanon,
					conditions: trace.conditions,
					palette: paletteFor(state.theme),
				}),
			)
		}
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
			// The load replaced the drawn view out from under the live tab — its generated network is now stale.
			liveControls.invalidate()
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
		// The load replaced the drawn view out from under the live tab — its generated network is now stale.
		liveControls.invalidate()
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

	/** Switch the Source tab (File ↔ Live-run): show one sub-panel, hide the other. */
	function applySourceTab(tab: 'file' | 'live'): void {
		const live = tab === 'live'
		fileSubPanel.style.display = live ? 'none' : ''
		liveSubPanel.style.display = live ? '' : 'none'
		fileTabButton.classList.toggle('tsv-source-tab-active', !live)
		liveTabButton.classList.toggle('tsv-source-tab-active', live)
	}

	// The live-run driver's view of the shell: render a generated network, swap the replay panel, hand over the
	// palette. It reuses `renderNetwork`/`setReplay` so a live run draws and replays exactly as a file load does.
	const liveHost: LiveRunHost = {
		renderNetwork(network: Network): GraphView | undefined {
			return renderNetwork(network, {
				generator: network.meta.generator,
				entityCount: network.entityCount,
				tallyCount: network.tallies.length,
				queryCount: 0,
			})
		},
		mountReplay(p): void {
			const view = state.view
			if (view === undefined) {
				return
			}
			setReplay(() =>
				mountReplayControls({
					host: replayHost,
					view,
					index: p.index,
					deanon: p.deanon,
					conditions: p.conditions,
					routeSource: p.routeSource,
					autoplay: p.autoplay,
					palette: paletteFor(state.theme),
				}),
			)
		},
		mountDisabledReplay(): void {
			setReplay(() => mountDisabledReplayControls(replayHost))
		},
		palette(): Palette {
			return paletteFor(state.theme)
		},
	}
	const liveControls: LiveControls = mountLiveControls(liveSubPanel, liveHost)

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
	fileTabButton.addEventListener('click', () => {
		applySourceTab('file')
	})
	liveTabButton.addEventListener('click', () => {
		applySourceTab('live')
	})

	applyTheme(state.theme)
	applyMode(state.mode)
	applySourceTab('file')
}
