/**
 * The live-run **panel** — the one browser-only driver of the live-run tier. It builds the generate → pick →
 * run → download form, owns the single {@link Worker} that generates a network and runs the real `tallynet`
 * discovery search off the main thread, and feeds the streamed trace envelope into the **same**
 * `trace-index → timeline → replay` pipeline a loaded trace file uses. So a live run animates identically to
 * the trace you could download from it, and "download this run" produces a byte-compatible trace.
 *
 * It touches `document`, `Worker` and `URL.createObjectURL`, so — like the renderer and the replay transport —
 * its gate is `vite build` + a manual check, not jest; the pure translation it drives (`build-scenario.ts`,
 * `sim-run.ts`) is unit-tested with no browser.
 *
 * ── The host contract ──────────────────────────────────────────────────────────────────────────────
 * The panel does not own the graph or the replay panel — the shell does. This module defines the
 * {@link LiveRunHost} the shell implements: render a generated network (returning the view to wire clicks to),
 * mount the replay panel for a finished run (or the disabled panel for a degenerate zero-event run), and hand
 * over the active palette. The panel keeps only the worker, the form, and the per-run index.
 *
 * ── One worker, one run at a time ───────────────────────────────────────────────────────────────────
 * The {@link MainToWorker}/{@link WorkerToMain} contract carries no run-correlation id, so the panel drives one
 * run to its `done`/`error` before issuing the next. Generate materialises the network once (kept in worker
 * scope); each Run searches one picked payment over it. Cancel is a hard {@link Worker.terminate} + a fresh
 * worker (which loses the kept network), followed by a **silent** re-generate that refreshes the worker's
 * network scope without re-drawing the graph — so the drawn graph and the picked payer/payee survive a cancel.
 */

import {
	compileConditions,
	entityName,
	networkFromSerialized,
	serializeTraceLine,
	type CapacityDistribution,
	type ConditionsSpec,
	type Network,
	type QuerySpec,
	type SimScenario,
	type TraceHeader,
	type TraceNetworkSnapshot,
} from 'tallysim'
import type { TraceEvent } from 'tallynet'
import { buildQuery, buildScenario, DEFAULT_RUN_SEED, type BudgetParams, type GeneratorId, type LiveRunParams } from './build-scenario.js'
import type { MainToWorker, WorkerToMain } from './sim-protocol.js'
import { createTraceIndex, type TraceIndex, type TraceIndexBuilder } from '../core/trace-index.js'
import { createDeanonymiser, type Deanonymiser } from '../core/deanonymise.js'
import type { CompiledConditions } from 'tallysim'
import type { ReplayRouteSource } from '../replay/controls.js'
import type { GraphView } from '../graph/render.js'
import type { Palette } from '../app/theme.js'

/**
 * What the live-run panel needs from the shell. The shell owns the graph view and the replay panel; the panel
 * owns the worker and the form. `renderNetwork` draws the generated network (computing the one-line summary)
 * and returns the view so the panel can wire click-to-pick; `mountReplay`/`mountDisabledReplay` swap the
 * replay panel for a finished (or degenerate) run; `palette` hands over the active theme palette.
 */
export interface LiveRunHost {
	/** Render the generated network's summary + graph and return the mounted view (or `undefined` on failure). */
	renderNetwork(network: Network): GraphView | undefined
	/** Mount the live replay panel for a finished run over the current view. */
	mountReplay(p: {
		index: TraceIndex
		deanon: Deanonymiser
		conditions: CompiledConditions
		routeSource: ReplayRouteSource
		autoplay: boolean
	}): void
	/** Mount the disabled replay panel (a zero-event degenerate run: nothing to animate). */
	mountDisabledReplay(): void
	/** The shell's active palette (kept per the host contract; the shell re-palettes the view/replay itself). */
	palette(): Palette
}

/** The mounted live-run panel handle. */
export interface LiveControls {
	/** The shell calls this when a file/sample load replaces the drawn view out from under the live tab. */
	invalidate(): void
	/** Terminate the worker and clear the panel DOM. */
	destroy(): void
}

/** One numeric generator param: its exact `tallysim` key, a human label, a default, and input hints. */
interface ParamSpec {
	key: string
	label: string
	value: number
	min?: number
	step?: number
}

/** The generator-specific numeric params, keyed by the exact `tallysim` generator param names. */
const GENERATOR_PARAMS: Record<GeneratorId, readonly ParamSpec[]> = {
	uniform: [{ key: 'meanDegree', label: 'mean degree', value: 4, min: 0, step: 0.5 }],
	'scale-free': [{ key: 'edgesPerNode', label: 'edges per node', value: 2, min: 1, step: 1 }],
	clustered: [
		{ key: 'communityCount', label: 'communities', value: 4, min: 1, step: 1 },
		{ key: 'meanIntraDegree', label: 'mean intra-degree', value: 4, min: 0, step: 0.5 },
		{ key: 'bridgeCount', label: 'bridges', value: 8, min: 0, step: 1 },
	],
	'small-world': [
		{ key: 'neighbors', label: 'neighbors (k)', value: 4, min: 0, step: 2 },
		{ key: 'rewireProbability', label: 'rewire probability', value: 0.1, min: 0, step: 0.05 },
	],
}

/** The capacity-distribution kind and its numeric params (keyed by the exact `CapacityDistribution` fields). */
type CapacityKind = CapacityDistribution['kind']
const CAPACITY_PARAMS: Record<CapacityKind, readonly ParamSpec[]> = {
	unlimited: [],
	constant: [{ key: 'limit', label: 'limit', value: 100, min: 0, step: 1 }],
	uniform: [
		{ key: 'min', label: 'min', value: 10, min: 0, step: 1 },
		{ key: 'max', label: 'max', value: 100, min: 0, step: 1 },
	],
	lognormal: [
		{ key: 'mu', label: 'mu', value: 3, step: 0.1 },
		{ key: 'sigma', label: 'sigma', value: 1, min: 0, step: 0.1 },
	],
}

/** The human message for a caught value. */
function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

/** A labelled field row (label left, control right), matching the `.tsv-live-*` CSS conventions. */
function fieldRow(label: string, control: HTMLElement): HTMLDivElement {
	const row = document.createElement('div')
	row.className = 'tsv-live-field'
	const labelEl = document.createElement('label')
	labelEl.className = 'tsv-live-label'
	labelEl.textContent = label
	row.append(labelEl, control)
	return row
}

/** A numeric input field. `value === undefined` leaves it blank (an optional field). */
function numberField(label: string, value: number | undefined, opts: { min?: number; step?: number } = {}): { row: HTMLDivElement; input: HTMLInputElement } {
	const input = document.createElement('input')
	input.type = 'number'
	input.className = 'tsv-live-input'
	if (value !== undefined) {
		input.value = String(value)
	}
	if (opts.min !== undefined) {
		input.min = String(opts.min)
	}
	if (opts.step !== undefined) {
		input.step = String(opts.step)
	}
	return { row: fieldRow(label, input), input }
}

/** A `<select>` field over `{ value, label }` options. */
function selectField(label: string, options: readonly { value: string; label: string }[]): { row: HTMLDivElement; select: HTMLSelectElement } {
	const select = document.createElement('select')
	select.className = 'tsv-live-input'
	for (const option of options) {
		const node = document.createElement('option')
		node.value = option.value
		node.textContent = option.label
		select.append(node)
	}
	return { row: fieldRow(label, select), select }
}

/** A sub-section label inside the form (reuses the panel's section-title style). */
function sectionLabel(text: string): HTMLDivElement {
	const el = document.createElement('div')
	el.className = 'tsv-section-title'
	el.textContent = text
	return el
}

/** A panel button. */
function buttonEl(text: string): HTMLButtonElement {
	const button = document.createElement('button')
	button.textContent = text
	return button
}

/** Read a numeric input, falling back when blank / not a number (populated fields, so the fallback is rare). */
function readNum(input: HTMLInputElement, fallback: number): number {
	const value = Number(input.value)
	return input.value.trim() === '' || Number.isNaN(value) ? fallback : value
}

/** Read an optional numeric input: blank (or not-a-number) ⇒ `undefined`. */
function readOptionalNum(input: HTMLInputElement): number | undefined {
	const trimmed = input.value.trim()
	if (trimmed === '') {
		return undefined
	}
	const value = Number(trimmed)
	return Number.isNaN(value) ? undefined : value
}

/**
 * Mount the live-run panel into `host`, driving the shell via `liveHost`. Creates the worker eagerly (so an
 * unsupported environment surfaces a clear error at once, not on the first Generate). Returns a
 * {@link LiveControls} the shell uses to invalidate (on a file/sample load) and tear down.
 */
export function mountLiveControls(host: HTMLElement, liveHost: LiveRunHost): LiveControls {
	// ── Worker + run state ──
	let worker: Worker | undefined
	let workerBroken = false
	let generating = false
	let generated = false
	let running = false
	/** The next `network` message is a silent post-cancel regen: refresh scope only, do not re-render. */
	let silentRegen = false
	let view: GraphView | undefined
	/** The exact scenario the current network was generated from (Run reuses its network source). */
	let generatedScenario: SimScenario | undefined
	/** The worker's network snapshot (byte-identical for download) and the Network it decodes to. */
	let keptSnapshot: TraceNetworkSnapshot | undefined
	let materializedNetwork: Network | undefined
	/** The scenario + query the current run used (for conditions compilation + the self-payment status). */
	let runScenario: SimScenario | undefined
	let runQuerySpec: QuerySpec | undefined
	/** The index being built from the current run's streamed events (header → events → done). */
	let runIndex: TraceIndexBuilder | undefined
	/** Which picked slot a node click fills next (toggles payer → payee → payer …). */
	let pickTarget: 'from' | 'to' = 'from'
	/** The last completed run, kept for download (header + kept snapshot + recorded events). */
	let lastRun: { header: TraceHeader; snapshot: TraceNetworkSnapshot; events: readonly TraceEvent[] } | undefined

	// ── DOM ──
	host.textContent = ''
	const wrap = document.createElement('div')
	wrap.className = 'tsv-live'

	const generatorField = selectField('generator', [
		{ value: 'scale-free', label: 'scale-free' },
		{ value: 'uniform', label: 'uniform' },
		{ value: 'clustered', label: 'clustered' },
		{ value: 'small-world', label: 'small-world' },
	])
	const genSelect = generatorField.select
	const entityCountField = numberField('entities', 200, { min: 1, step: 1 })
	const seedField = numberField('seed', 1, { step: 1 })
	const genParamsHost = document.createElement('div')
	const genParamInputs = new Map<string, HTMLInputElement>()

	const capacityField = selectField('capacity', [
		{ value: 'constant', label: 'constant' },
		{ value: 'unlimited', label: 'unlimited' },
		{ value: 'uniform', label: 'uniform' },
		{ value: 'lognormal', label: 'lognormal' },
	])
	const capSelect = capacityField.select
	const capParamsHost = document.createElement('div')
	const capParamInputs = new Map<string, HTMLInputElement>()

	const sleepingField = numberField('sleeping fraction', undefined, { min: 0, step: 0.05 })
	const lateField = numberField('late fraction', undefined, { min: 0, step: 0.05 })
	const dropField = numberField('drop fraction', undefined, { min: 0, step: 0.05 })
	const lateLatencyField = numberField('late latency (ms)', undefined, { min: 0, step: 100 })
	const latencyField = numberField('latency (ms)', undefined, { min: 0, step: 10 })
	const conditionsSeedField = numberField('conditions seed', undefined, { step: 1 })

	const initialBudgetField = numberField('initial budget (ms)', undefined, { min: 0, step: 100 })
	const perHopBudgetField = numberField('per-hop budget (ms)', undefined, { min: 0, step: 100 })

	const amountField = numberField('amount', 1, { min: 0, step: 1 })
	const depthField = numberField('depth', 6, { min: 1, step: 1 })
	const fromField = numberField('payer (from)', undefined, { min: 0, step: 1 })
	const toField = numberField('payee (to)', undefined, { min: 0, step: 1 })
	const fromInput = fromField.input
	const toInput = toField.input

	const readout = document.createElement('div')
	readout.className = 'tsv-live-readout'

	const buttons = document.createElement('div')
	buttons.className = 'tsv-live-buttons'
	const generateButton = buttonEl('Generate')
	const runButton = buttonEl('Run')
	const cancelButton = buttonEl('Cancel')
	const downloadButton = buttonEl('Download trace')
	buttons.append(generateButton, runButton, cancelButton, downloadButton)

	const statusEl = document.createElement('div')
	statusEl.className = 'tsv-live-status'
	const errorEl = document.createElement('div')
	errorEl.className = 'tsv-live-error'

	wrap.append(
		sectionLabel('Generator'),
		generatorField.row,
		entityCountField.row,
		seedField.row,
		genParamsHost,
		sectionLabel('Capacity'),
		capacityField.row,
		capParamsHost,
		sectionLabel('Conditions (optional)'),
		sleepingField.row,
		lateField.row,
		dropField.row,
		lateLatencyField.row,
		latencyField.row,
		conditionsSeedField.row,
		sectionLabel('Budget (optional)'),
		initialBudgetField.row,
		perHopBudgetField.row,
		sectionLabel('Query'),
		amountField.row,
		depthField.row,
		fromField.row,
		toField.row,
		readout,
		buttons,
		statusEl,
		errorEl,
	)
	host.append(wrap)

	function setStatus(message: string): void {
		statusEl.textContent = message
	}

	function setError(message: string): void {
		errorEl.textContent = message
	}

	function clearError(): void {
		errorEl.textContent = ''
	}

	// ── Form rebuild (dynamic per-generator / per-capacity params) ──

	/** Rebuild the generator-specific param inputs for the chosen generator; a change invalidates the network. */
	function rebuildGenParams(): void {
		genParamsHost.textContent = ''
		genParamInputs.clear()
		for (const spec of GENERATOR_PARAMS[genSelect.value as GeneratorId]) {
			const { row, input } = numberField(spec.label, spec.value, { min: spec.min, step: spec.step })
			input.addEventListener('input', invalidateGenerated)
			genParamInputs.set(spec.key, input)
			genParamsHost.append(row)
		}
	}

	/** Rebuild the capacity param inputs for the chosen capacity kind; a change invalidates the network. */
	function rebuildCapParams(): void {
		capParamsHost.textContent = ''
		capParamInputs.clear()
		for (const spec of CAPACITY_PARAMS[capSelect.value as CapacityKind]) {
			const { row, input } = numberField(spec.label, spec.value, { min: spec.min, step: spec.step })
			input.addEventListener('input', invalidateGenerated)
			capParamInputs.set(spec.key, input)
			capParamsHost.append(row)
		}
	}

	// ── Reading the form ──

	/** The capacity distribution for the current kind + its param inputs. */
	function readCapacity(): CapacityDistribution {
		const kind = capSelect.value as CapacityKind
		const num = (key: string, fallback: number): number => {
			const input = capParamInputs.get(key)
			return input === undefined ? fallback : readNum(input, fallback)
		}
		switch (kind) {
			case 'unlimited': {
				return { kind: 'unlimited' }
			}
			case 'constant': {
				return { kind: 'constant', limit: num('limit', 100) }
			}
			case 'uniform': {
				return { kind: 'uniform', min: num('min', 10), max: num('max', 100) }
			}
			case 'lognormal': {
				return { kind: 'lognormal', mu: num('mu', 3), sigma: num('sigma', 1) }
			}
		}
	}

	/** Build a `ConditionsSpec` from only the filled condition fields; none filled ⇒ no conditions (ideal net). */
	function readConditions(): { conditions?: ConditionsSpec; conditionsSeed?: number } {
		const spec: ConditionsSpec = {}
		const sleeping = readOptionalNum(sleepingField.input)
		if (sleeping !== undefined) {
			spec.sleepingFraction = sleeping
		}
		const late = readOptionalNum(lateField.input)
		if (late !== undefined) {
			spec.lateFraction = late
		}
		const drop = readOptionalNum(dropField.input)
		if (drop !== undefined) {
			spec.dropFraction = drop
		}
		const lateLatency = readOptionalNum(lateLatencyField.input)
		if (lateLatency !== undefined) {
			spec.lateLatencyMs = lateLatency
		}
		const latency = readOptionalNum(latencyField.input)
		if (latency !== undefined) {
			spec.latency = { kind: 'constant', value: latency }
		}
		if (Object.keys(spec).length === 0) {
			return {}
		}
		// Any condition set ⇒ default the conditions seed to 0 (so the compiled sleeping/late sets are stable).
		return { conditions: spec, conditionsSeed: readOptionalNum(conditionsSeedField.input) ?? 0 }
	}

	/** The optional discovery budget, from the two budget fields (omitted when both blank). */
	function readBudget(): BudgetParams | undefined {
		const initial = readOptionalNum(initialBudgetField.input)
		const perHop = readOptionalNum(perHopBudgetField.input)
		if (initial === undefined && perHop === undefined) {
			return undefined
		}
		const budget: BudgetParams = {}
		if (initial !== undefined) {
			budget.initialBudgetMs = initial
		}
		if (perHop !== undefined) {
			budget.perHopBudgetMs = perHop
		}
		return budget
	}

	/** The picked payer/payee, read from the (source-of-truth) number inputs. */
	function readPicked(): { from: number | undefined; to: number | undefined } {
		return { from: readOptionalNum(fromInput), to: readOptionalNum(toInput) }
	}

	/** Read the whole form into {@link LiveRunParams}. */
	function readParams(): LiveRunParams {
		const generatorParams: Record<string, number> = {}
		for (const [key, input] of genParamInputs) {
			generatorParams[key] = Number(input.value)
		}
		const { conditions, conditionsSeed } = readConditions()
		const { from, to } = readPicked()
		const params: LiveRunParams = {
			generator: genSelect.value as GeneratorId,
			entityCount: readNum(entityCountField.input, 200),
			generatorParams,
			capacity: readCapacity(),
			seed: readNum(seedField.input, 0),
			amount: readNum(amountField.input, 1),
			depth: readNum(depthField.input, 6),
		}
		if (conditions !== undefined) {
			params.conditions = conditions
		}
		if (conditionsSeed !== undefined) {
			params.conditionsSeed = conditionsSeed
		}
		const budget = readBudget()
		if (budget !== undefined) {
			params.budget = budget
		}
		if (from !== undefined) {
			params.from = from
		}
		if (to !== undefined) {
			params.to = to
		}
		return params
	}

	// ── Picking ──

	/** Reflect the picked payer/payee onto the graph marks + readout, and refresh the buttons. */
	function syncPicked(): void {
		const { from, to } = readPicked()
		view?.setPicked(from !== undefined ? entityName(from) : undefined, to !== undefined ? entityName(to) : undefined)
		readout.textContent = `payer ${from ?? '—'} → payee ${to ?? '—'}`
		updateButtons()
	}

	/** A node click fills the next picked slot (payer, then payee), writing into the source-of-truth input. */
	function pick(nodeKey: string): void {
		const target = pickTarget === 'from' ? fromInput : toInput
		target.value = String(Number(nodeKey))
		pickTarget = pickTarget === 'from' ? 'to' : 'from'
		syncPicked()
	}

	// ── Worker ──

	/** Create the worker, guarding an unsupported environment (never leave the page blank — show an error). */
	function makeWorker(): Worker | undefined {
		if (typeof Worker === 'undefined') {
			workerBroken = true
			setError('This browser does not support Web Workers, so live runs cannot run here.')
			return undefined
		}
		try {
			// `.ts` so Vite resolves + bundles the worker; it is a plain string to `new URL`, so `tsc` NodeNext
			// does not apply its extension rules here.
			const created = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' })
			created.onmessage = (event: MessageEvent<WorkerToMain>): void => {
				handleMessage(event.data)
			}
			created.onerror = (event): void => {
				console.error('sim-worker error', event)
				workerBroken = true
				setError('The live-run worker failed in this environment.')
				updateButtons()
			}
			return created
		} catch (err) {
			console.error('sim-worker creation failed', err)
			workerBroken = true
			setError('This environment cannot start the live-run worker (module workers unsupported).')
			return undefined
		}
	}

	function post(message: MainToWorker): void {
		worker?.postMessage(message)
	}

	// ── Worker message handling ──

	function handleMessage(message: WorkerToMain): void {
		switch (message.type) {
			case 'network': {
				onNetwork(message)
				break
			}
			case 'header': {
				onHeader(message)
				break
			}
			case 'event': {
				runIndex?.add(message.event)
				break
			}
			case 'done': {
				onDone(message)
				break
			}
			case 'error': {
				onError(message)
				break
			}
		}
	}

	function onNetwork(message: Extract<WorkerToMain, { type: 'network' }>): void {
		keptSnapshot = message.snapshot
		materializedNetwork = networkFromSerialized(message.snapshot.network)
		generating = false
		if (silentRegen) {
			// A post-cancel regen only refreshes the worker's network scope; the drawn graph + picks are untouched.
			silentRegen = false
			updateButtons()
			return
		}
		generated = true
		view = liveHost.renderNetwork(materializedNetwork)
		if (view !== undefined) {
			view.onNodeClick(pick)
			syncPicked()
		}
		setStatus('Network ready. Pick a payer and a payee, then Run.')
		updateButtons()
	}

	function onHeader(message: Extract<WorkerToMain, { type: 'header' }>): void {
		if (materializedNetwork === undefined) {
			return
		}
		runIndex = createTraceIndex(message.header, materializedNetwork)
	}

	function onDone(message: Extract<WorkerToMain, { type: 'done' }>): void {
		running = false
		// `view === undefined` means the shell replaced the drawn view mid-run (a file/sample load called
		// invalidate()); the run is now orphaned, so drop it rather than mount its replay over the new graph.
		if (view === undefined || materializedNetwork === undefined || runIndex === undefined || runScenario === undefined || runQuerySpec === undefined || keptSnapshot === undefined) {
			updateButtons()
			return
		}
		const index = runIndex
		const query = runQuerySpec
		const deanon = createDeanonymiser(materializedNetwork)
		const conditions = compileConditions(materializedNetwork, runScenario.conditions ?? {}, runScenario.conditionsSeed ?? 0)
		const routeSource: ReplayRouteSource = {
			routesForSession: (code) => (code === message.sessionCode ? message.routes : undefined),
		}
		if (index.timeBounds() !== undefined) {
			liveHost.mountReplay({ index, deanon, conditions, routeSource, autoplay: true })
		} else {
			// A degenerate run emitted zero events (e.g. < 2 entities / an edge-less net): nothing to animate.
			liveHost.mountDisabledReplay()
		}
		lastRun = { header: index.header, snapshot: keptSnapshot, events: index.allEvents() }
		setStatus(doneStatus(message, query))
		updateButtons()
	}

	/** The terse per-run status: a self-payment loop, a not-found, or a route count. */
	function doneStatus(message: Extract<WorkerToMain, { type: 'done' }>, query: QuerySpec): string {
		const count = message.routes.length
		if (query.from === query.to) {
			return `Self-payment loop: ${count} route${count === 1 ? '' : 's'}.`
		}
		if (!message.found || count === 0) {
			return 'No route found.'
		}
		return `Found ${count} route${count === 1 ? '' : 's'}.`
	}

	function onError(message: Extract<WorkerToMain, { type: 'error' }>): void {
		if (message.phase === 'generate') {
			generating = false
			generated = false
		} else {
			running = false
		}
		setError(`${message.phase} failed: ${message.message}`)
		updateButtons()
	}

	// ── Buttons ──

	function onGenerate(): void {
		if (worker === undefined) {
			return
		}
		const scenario = buildScenario(readParams())
		generatedScenario = scenario
		generating = true
		generated = false
		silentRegen = false
		clearError()
		setStatus('Generating network…')
		updateButtons()
		post({ type: 'generate', scenario, runSeed: DEFAULT_RUN_SEED })
	}

	function onRun(): void {
		if (worker === undefined || generatedScenario === undefined) {
			return
		}
		let scenario: SimScenario
		let query: QuerySpec
		try {
			const params = readParams()
			scenario = buildScenario(params)
			// Reuse the exact generated network source, so the run's header provenance matches the drawn network.
			scenario.network = generatedScenario.network
			query = buildQuery(params)
		} catch (err) {
			setError(errorMessage(err))
			return
		}
		runScenario = scenario
		runQuerySpec = query
		runIndex = undefined
		running = true
		clearError()
		setStatus('Running search…')
		updateButtons()
		post({ type: 'run', scenario, query })
	}

	function onCancel(): void {
		if (worker === undefined) {
			return
		}
		// A hard terminate drops the worker's kept network, so a fresh worker needs the network re-generated.
		worker.terminate()
		worker = makeWorker()
		running = false
		if (worker !== undefined && generatedScenario !== undefined) {
			// Silently re-generate: refresh the worker's network scope without re-drawing (keeps graph + picks).
			silentRegen = true
			setStatus('Run cancelled.')
			post({ type: 'generate', scenario: generatedScenario, runSeed: DEFAULT_RUN_SEED })
		}
		updateButtons()
	}

	function onDownload(): void {
		if (lastRun === undefined) {
			return
		}
		// Reuse the kept snapshot (byte-identical to the worker's) so a reload via the File tab animates identically.
		const text =
			[
				serializeTraceLine(lastRun.header),
				serializeTraceLine(lastRun.snapshot),
				...lastRun.events.map((event) => serializeTraceLine({ kind: 'event', event })),
			].join('\n') + '\n'
		const blob = new Blob([text], { type: 'application/x-ndjson' })
		const url = URL.createObjectURL(blob)
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.download = 'live-run.ndjson'
		anchor.click()
		// NOTE: revoke is synchronous after click() — fine in the Chrome dev target; if a browser is ever seen
		// aborting the download, defer the revoke (e.g. setTimeout) until after the download has started.
		URL.revokeObjectURL(url)
	}

	/** Enable/disable the buttons from the current phase + pick state. */
	function updateButtons(): void {
		const { from, to } = readPicked()
		const ready = !workerBroken && worker !== undefined
		// Generate is blocked while a run is in flight: re-generating mid-run would tear down the running
		// view/replay out from under the still-streaming run (one-run-at-a-time). Cancel first to re-generate.
		generateButton.disabled = !ready || generating || running
		runButton.disabled = !ready || !generated || running || from === undefined || to === undefined
		cancelButton.disabled = !ready || !running
		downloadButton.disabled = lastRun === undefined
	}

	// ── Invalidation ──

	/** A local structural-field change: the drawn network no longer matches the form; keep the view, force re-Generate. */
	function invalidateGenerated(): void {
		generated = false
		updateButtons()
	}

	/** The shell replaced the drawn view (a file/sample load): drop our stale view reference, force re-Generate. */
	function invalidate(): void {
		generated = false
		view = undefined
		updateButtons()
	}

	// ── Wiring ──
	genSelect.addEventListener('change', () => {
		rebuildGenParams()
		invalidateGenerated()
	})
	entityCountField.input.addEventListener('input', invalidateGenerated)
	seedField.input.addEventListener('input', invalidateGenerated)
	capSelect.addEventListener('change', () => {
		rebuildCapParams()
		invalidateGenerated()
	})
	fromInput.addEventListener('input', syncPicked)
	toInput.addEventListener('input', syncPicked)
	generateButton.addEventListener('click', onGenerate)
	runButton.addEventListener('click', onRun)
	cancelButton.addEventListener('click', onCancel)
	downloadButton.addEventListener('click', onDownload)

	// ── Init ──
	rebuildGenParams()
	rebuildCapParams()
	worker = makeWorker()
	syncPicked()
	updateButtons()

	return {
		invalidate,
		destroy(): void {
			worker?.terminate()
			worker = undefined
			host.textContent = ''
		},
	}
}
