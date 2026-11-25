/**
 * The sweeps view — the panel + chart that plot a parameter-sweep's output as "a measured metric vs. a varied
 * parameter, one line per series". It is the browser-only glue over three tested pure pieces: the source loader
 * (`source.ts`), the series maths (`core/sweep-data.ts`), and the uPlot renderer (`chart.ts`). It touches
 * `document` only; every transform it drives is pure, so its gate is `vite build` + a manual check, not jest.
 *
 * ── The panel ──────────────────────────────────────────────────────────────────────────────────────
 * A file loader (accepts `.jsonl/.ndjson/.csv/.json/.txt`, with an in-UI parse-error status + a sample button)
 * over three pickers seeded from {@link defaultSelection}:
 *   - **x-axis** — any numeric column that is not the `seed` (a swept *param* **or** a *metric* like `meanDegree`
 *     is a valid headline x).
 *   - **metric (y)** — the scalar metric columns, plus one entry per distribution family (`pathLength`, …). When
 *     a family is picked, a **sub-field** select appears (default `mean`); the effective metric column is then
 *     `${family}.${sub}`, with the `count: 0 → gap` guard set to `${family}.count` — *unless* the sub-field *is*
 *     `count`, where `0` is a real value, not "no data".
 *   - **series-by** — checkboxes over the string dimensions + the other varied params; each ticked column splits
 *     the data into one line.
 *
 * On any change the view assembles a {@link SeriesSpec}, runs `rowsToSeries → meanPerCell`, and hands the result
 * to the chart. Repeated seeds in a cell are averaged to one point (mean-per-cell); the note under the pickers
 * says so. `relayout()` re-fits the chart (the shell calls it when the Sweep tab becomes visible — uPlot
 * measures 0×0 while its tab is `display:none`); `setPalette` re-themes the chart; `destroy` tears it down.
 */

import { createSweepChart, type SweepChart } from './chart.js'
import {
	defaultSelection,
	distributionFamilies,
	meanPerCell,
	rowsToSeries,
	type DistributionFamily,
	type SeriesSpec,
	type SweepTable,
} from '../core/sweep-data.js'
import { loadSweepText, SAMPLE_SWEEP, SAMPLE_SWEEP_NAME } from './source.js'
import type { Palette } from '../app/theme.js'

/** The mounted sweeps view: re-theme it, re-fit it when shown, or tear it down. */
export interface SweepView {
	/** Re-theme the chart (colours only). */
	setPalette(palette: Palette): void
	/** Re-fit the chart to its host — the shell calls this when the Sweep tab becomes visible. */
	relayout(): void
	/** Destroy the chart and clear the panel DOM. */
	destroy(): void
}

/** The select-value prefix marking a distribution-family metric entry (vs. a plain scalar column name). */
const DIST_PREFIX = 'dist:'

/** The human message for a caught value (a malformed-JSONL `JSON.parse` error carries a clear `.message`). */
function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

/** One `{value,label}` option. */
interface Option {
	value: string
	label: string
}

/** Fill a `<select>` with options, selecting `selected` (idempotent — clears first). */
function fillOptions(select: HTMLSelectElement, options: readonly Option[], selected: string): void {
	select.textContent = ''
	for (const option of options) {
		const node = document.createElement('option')
		node.value = option.value
		node.textContent = option.label
		if (option.value === selected) {
			node.selected = true
		}
		select.append(node)
	}
}

/** A labelled control row (a label over a host the caller fills with the control). */
function controlRow(labelText: string): { row: HTMLDivElement; body: HTMLDivElement } {
	const row = document.createElement('div')
	row.className = 'tsv-sweep-row'
	const label = document.createElement('div')
	label.className = 'tsv-sweep-label'
	label.textContent = labelText
	const body = document.createElement('div')
	body.className = 'tsv-sweep-control'
	row.append(label, body)
	return { row, body }
}

/**
 * Mount the sweeps view: the pickers into `panelHost`, the chart into `chartHost`. Returns a handle the shell
 * uses to re-theme, re-fit (on tab show) and tear down. No file is loaded until the developer picks one (or the
 * sample button); the chart shows its "nothing to plot" message until then.
 */
export function mountSweepView(params: { panelHost: HTMLElement; chartHost: HTMLElement; palette: Palette }): SweepView {
	const { panelHost, chartHost } = params
	const chart: SweepChart = createSweepChart(chartHost, params.palette)

	let table: SweepTable | undefined
	let families: DistributionFamily[] = []
	// The chosen series-split columns, by name; rebuilt from `defaultSelection` on load, edited by the checkboxes.
	let seriesBySet = new Set<string>()

	// ── DOM: source loader ──
	panelHost.textContent = ''
	const source = controlRow('Sweep file')
	const fileInput = document.createElement('input')
	fileInput.type = 'file'
	fileInput.className = 'tsv-sweep-file'
	fileInput.accept = '.jsonl,.ndjson,.csv,.json,.txt'
	const sampleButton = document.createElement('button')
	sampleButton.className = 'tsv-sweep-sample'
	sampleButton.textContent = 'Load sample sweep'
	const status = document.createElement('div')
	status.className = 'tsv-sweep-status'
	source.body.append(fileInput, sampleButton, status)

	// ── DOM: pickers ──
	const xRow = controlRow('x-axis')
	const xSelect = document.createElement('select')
	xRow.body.append(xSelect)

	const metricRow = controlRow('metric (y)')
	const metricSelect = document.createElement('select')
	metricRow.body.append(metricSelect)

	const subRow = controlRow('sub-field')
	const subSelect = document.createElement('select')
	subRow.body.append(subSelect)
	subRow.row.style.display = 'none'

	const seriesRow = controlRow('series by')
	const seriesByBox = document.createElement('div')
	seriesByBox.className = 'tsv-sweep-series'
	seriesRow.body.append(seriesByBox)

	const note = document.createElement('div')
	note.className = 'tsv-sweep-note'
	note.textContent = 'Load a sweep file, or the sample, to chart a metric against a swept parameter.'

	panelHost.append(source.row, xRow.row, metricRow.row, subRow.row, seriesRow.row, note)

	function setStatus(message: string): void {
		status.textContent = message
	}

	/** The columns offerable as an x-axis: every numeric column except the repeat `seed`. */
	function xOptions(loaded: SweepTable): Option[] {
		// NOTE: this offers EVERY numeric metric too (a metric like meanDegree is a valid headline x, per the
		// spec), so a discovery sweep's ~50 distribution sub-field columns all appear in this list. Fine today; if
		// a sweep ever carries so many metric columns that the picker reads as noise, restrict to params + scalar
		// metrics (exclude distribution sub-fields) or group them under an optgroup.
		return loaded.columns
			.filter((column) => column.kind === 'number' && column.role !== 'seed')
			.map((column) => ({ value: column.name, label: column.name }))
	}

	/** The metric picker's options: the scalar metric columns, then one `dist:<family>` entry per distribution. */
	function metricOptions(loaded: SweepTable): Option[] {
		const familySubColumns = new Set<string>()
		for (const family of families) {
			for (const sub of family.subFields) {
				familySubColumns.add(`${family.family}.${sub}`)
			}
		}
		const scalars = loaded.columns
			.filter((column) => column.role === 'metric' && !familySubColumns.has(column.name))
			.map((column) => ({ value: column.name, label: column.name }))
		const dists = families.map((family) => ({ value: `${DIST_PREFIX}${family.family}`, label: `${family.family} (distribution)` }))
		return [...scalars, ...dists]
	}

	/** The columns offerable as a series split: the string dimensions + the varied params, minus `xColumn`. */
	function seriesByOptions(loaded: SweepTable, xColumn: string): string[] {
		const dimensions = loaded.columns.filter((column) => column.role === 'dimension').map((column) => column.name)
		const variedParams = loaded.columns.filter((column) => column.role === 'param' && column.varied).map((column) => column.name)
		return [...dimensions, ...variedParams].filter((name) => name !== xColumn)
	}

	/** The distribution family a metric *column* belongs to (its prefix is a known family), or undefined. */
	function familyOf(metricColumn: string): DistributionFamily | undefined {
		const dot = metricColumn.lastIndexOf('.')
		if (dot < 0) {
			return undefined
		}
		const family = metricColumn.slice(0, dot)
		return families.find((candidate) => candidate.family === family)
	}

	/** The metric *select value* for a default metric column: a `dist:<family>` for a family sub-field, else the name. */
	function metricValueFor(metricColumn: string): string {
		const family = familyOf(metricColumn)
		return family === undefined ? metricColumn : `${DIST_PREFIX}${family.family}`
	}

	/** Show/populate the sub-field select iff a distribution family is the current metric; `preferred` wins if present. */
	function updateSubField(preferred?: string): void {
		const value = metricSelect.value
		if (!value.startsWith(DIST_PREFIX)) {
			subRow.row.style.display = 'none'
			return
		}
		const family = families.find((candidate) => candidate.family === value.slice(DIST_PREFIX.length))
		if (family === undefined) {
			subRow.row.style.display = 'none'
			return
		}
		const sub = preferred !== undefined && family.subFields.includes(preferred)
			? preferred
			: family.subFields.includes('mean')
				? 'mean'
				: family.subFields[0]
		fillOptions(subSelect, family.subFields.map((field) => ({ value: field, label: field })), sub)
		subRow.row.style.display = ''
	}

	/** The effective metric column + count-zero gap guard for the current metric / sub-field choice. */
	function effectiveMetric(): { metricColumn: string; gapWhenZeroColumn?: string } {
		const value = metricSelect.value
		if (!value.startsWith(DIST_PREFIX)) {
			return { metricColumn: value }
		}
		const family = value.slice(DIST_PREFIX.length)
		const sub = subSelect.value === '' ? 'mean' : subSelect.value
		// `count: 0` means "no samples", so every other sub-field's 0 is spurious — gap it. But `count` itself is a
		// real 0 there, so it takes no guard.
		return { metricColumn: `${family}.${sub}`, gapWhenZeroColumn: sub === 'count' ? undefined : `${family}.count` }
	}

	/** Rebuild the series-by checkboxes for the current table + x choice, reflecting the live `seriesBySet`. */
	function buildSeriesBy(): void {
		seriesByBox.textContent = ''
		if (table === undefined) {
			return
		}
		const options = seriesByOptions(table, xSelect.value)
		if (options.length === 0) {
			const none = document.createElement('div')
			none.className = 'tsv-sweep-note'
			none.textContent = '(no series split available)'
			seriesByBox.append(none)
			return
		}
		for (const name of options) {
			const label = document.createElement('label')
			label.className = 'tsv-sweep-check'
			const input = document.createElement('input')
			input.type = 'checkbox'
			input.checked = seriesBySet.has(name)
			input.addEventListener('change', () => {
				if (input.checked) {
					seriesBySet.add(name)
				} else {
					seriesBySet.delete(name)
				}
				render()
			})
			label.append(input, document.createTextNode(` ${name}`))
			seriesByBox.append(label)
		}
	}

	/** Assemble the spec from the current pickers and redraw the chart. */
	function render(): void {
		if (table === undefined) {
			chart.render([], { x: '', y: '' })
			return
		}
		const xColumn = xSelect.value
		const { metricColumn, gapWhenZeroColumn } = effectiveMetric()
		// Preserve the dimension-then-param option order (stable, readable series keys); drop x if it is ticked.
		const seriesBy = seriesByOptions(table, xColumn).filter((name) => seriesBySet.has(name))
		const spec: SeriesSpec = { xColumn, metricColumn, seriesBy, gapWhenZeroColumn }
		chart.render(meanPerCell(rowsToSeries(table.rows, spec)), { x: xColumn, y: metricColumn })
		note.textContent = 'Each plotted point is the mean over the seeds in that (series, x) cell.'
	}

	/** Seed the pickers + chart from a freshly-loaded table. */
	function applyTable(next: SweepTable): void {
		table = next
		families = distributionFamilies(next.columns)
		const selection = defaultSelection(next)
		seriesBySet = new Set(selection.seriesBy)
		fillOptions(xSelect, xOptions(next), selection.xColumn)
		fillOptions(metricSelect, metricOptions(next), metricValueFor(selection.metricColumn))
		updateSubField(familyOf(selection.metricColumn) === undefined ? undefined : selection.metricColumn.slice(selection.metricColumn.lastIndexOf('.') + 1))
		buildSeriesBy()
		render()
	}

	/** Load sweep text (format detected by name), seeding the view; a parse error shows in the status line. */
	function loadFromText(fileName: string, text: string): void {
		try {
			const next = loadSweepText(fileName, text)
			setStatus('')
			applyTable(next)
		} catch (err) {
			setStatus(errorMessage(err))
		}
	}

	// ── Wiring ──
	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0]
		if (file === undefined) {
			return
		}
		void file
			.text()
			.then((text) => {
				loadFromText(file.name, text)
			})
			.catch((err: unknown) => {
				setStatus(errorMessage(err))
			})
	})
	sampleButton.addEventListener('click', () => {
		loadFromText(SAMPLE_SWEEP_NAME, SAMPLE_SWEEP)
	})
	xSelect.addEventListener('change', () => {
		// An x column that was ticked as a series split is no longer offerable — drop it and rebuild the options.
		seriesBySet.delete(xSelect.value)
		buildSeriesBy()
		render()
	})
	metricSelect.addEventListener('change', () => {
		updateSubField()
		render()
	})
	subSelect.addEventListener('change', render)

	return {
		setPalette(next: Palette): void {
			chart.setPalette(next)
		},
		relayout(): void {
			chart.resize()
		},
		destroy(): void {
			chart.destroy()
			panelHost.textContent = ''
		},
	}
}
