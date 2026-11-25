/**
 * The app shell: the top bar, the left control panel, and the graph container, wired to the one data path
 * this ticket owns — **load a network, draw it, search it** — with a light/dark theme toggle. The live-run
 * and sweep source tabs are later tickets; their mount points are marked with seam comments below so they
 * slot in without reshaping this file.
 *
 * ── The load path ──────────────────────────────────────────────────────────────────────────────────
 * A file the developer picks is read as text and handed to {@link indexTrace} (which wraps `tallysim`'s
 * `parseTrace`) inside a `try/catch`; a version/format error surfaces in the panel's status area, never the
 * console. On success — or when the "Load sample" button materialises an in-page network — the shell builds
 * the graph ({@link buildGraph}), mounts the renderer ({@link createGraphView}), and starts the seeded worker
 * layout ({@link runLayout}) off the main thread. A previous view/layout is torn down first so repeated loads
 * do not leak a sigma instance or a running worker.
 */

import type { Network } from 'tallysim'
import { indexTrace } from '../core/trace-index.js'
import { buildGraph } from '../graph/model.js'
import { createGraphView, type GraphView } from '../graph/render.js'
import { runLayout, type LayoutController } from '../graph/layout.js'
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

/** The shell's live references — the current view and layout, torn down and replaced on each load. */
interface ShellState {
	theme: ThemeName
	view: GraphView | undefined
	layout: LayoutController | undefined
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

	const state: ShellState = { theme: initialTheme(), view: undefined, layout: undefined }

	const app = el('div', 'tsv-app')
	const topbar = el('div', 'tsv-topbar')
	const title = el('h1', 'tsv-title')
	title.textContent = 'TallySim Viewer'
	const themeButton = el('button', 'tsv-theme')
	topbar.append(title, themeButton)

	const body = el('div', 'tsv-body')
	const panel = el('div', 'tsv-panel')
	const graph = el('div', 'tsv-graph')
	body.append(panel, graph)
	app.append(topbar, body)
	root.append(app)

	// ── Source section: load a recorded trace file, or materialise the in-page sample. ──
	const sourceHost = panelSection(panel, 'Source')
	const fileInput = el('input', 'tsv-file')
	fileInput.type = 'file'
	fileInput.accept = '.ndjson,.jsonl,.json,.txt,application/json'
	const sampleButton = el('button', 'tsv-sample')
	sampleButton.textContent = 'Load sample'
	const status = el('div', 'tsv-status')
	sourceHost.append(fileInput, sampleButton, status)
	// SEAM: the live-run driver tab and the sweep-source tab mount here in later tickets.

	// ── Summary section: the loaded network at a glance. ──
	const summaryHost = panelSection(panel, 'Network')
	summaryHost.id = 'tsv-summary'

	// ── Search section: highlight + centre a node by entity id. ──
	const searchHost = panelSection(panel, 'Find entity')
	const searchInput = el('input', 'tsv-search')
	searchInput.type = 'text'
	searchInput.placeholder = 'entity id, e.g. 3'
	const searchMiss = el('div', 'tsv-search-miss')
	searchHost.append(searchInput, searchMiss)

	function setStatus(message: string): void {
		status.textContent = message
	}

	function teardown(): void {
		state.layout?.stop()
		state.layout = undefined
		state.view?.destroy()
		state.view = undefined
		graph.textContent = ''
	}

	function loadNetwork(network: Network, summary: NetworkSummary): void {
		teardown()
		const built = buildGraph(network)
		const view = createGraphView(graph, built, paletteFor(state.theme))
		state.view = view
		if (view.webglAvailable) {
			state.layout = runLayout(built, { seed: network.meta.seed })
		}
		renderSummary(summaryHost, summary)
		searchInput.value = ''
		searchMiss.textContent = ''
	}

	function loadTraceText(text: string): void {
		try {
			const index = indexTrace(text.split(/\r?\n/))
			setStatus('')
			loadNetwork(index.network, {
				generator: index.network.meta.generator,
				entityCount: index.network.entityCount,
				tallyCount: index.network.tallies.length,
				queryCount: index.sessions().length,
			})
		} catch (err) {
			// parseTrace throws a version/format error with a clear message — surface it, don't swallow it.
			setStatus(errorMessage(err))
		}
	}

	function loadSample(): void {
		const network = sampleNetwork()
		setStatus('')
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
		themeButton.textContent = next === 'dark' ? 'Light theme' : 'Dark theme'
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

	applyTheme(state.theme)
}
