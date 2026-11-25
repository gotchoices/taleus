/**
 * The sweep charts' uPlot renderer — the one browser-only module of the sweeps view (canvas + DOM, so it is
 * covered by `vite build` + a manual check, not jest; the series maths it draws is the pure, tested
 * `core/sweep-data.ts`). It takes already-tidied {@link TidySeries} (mean-per-cell, gaps where a cell had no
 * data) and draws one line per series: palette-driven colour-blind-safe colours, light/dark from the shared
 * palette, axis labels, a live legend that reads back `(x, y)` per series at the cursor, and **gaps** — a
 * `null` in a series breaks the line rather than dropping to `0`.
 *
 * ── Layout ─────────────────────────────────────────────────────────────────────────────────────────
 * The host is a flex column: a plotting area that flexes to fill, and a legend strip below it (uPlot's legend
 * is relocated into it via `legend.mount`, so the plot area is sized to the space left over, never squeezed by
 * a tall legend). uPlot is rebuilt on a data change and merely resized (`setSize`) on a container resize; a
 * `ResizeObserver` (rAF-debounced) keeps it fitted, including when the view is first shown after being hidden.
 */

import uPlot from 'uplot'
import { alignSeries, type TidySeries } from '../core/sweep-data.js'
import type { Palette } from '../app/theme.js'

/** The axis titles for a chart: the metric on y, the swept parameter on x. */
export interface SweepChartLabels {
	x: string
	y: string
}

/** A mounted sweep chart: feed it series + labels, re-theme it, resize it, tear it down. */
export interface SweepChart {
	/** Draw these series (empty ⇒ a "nothing to plot" message). `labels` title the axes. */
	render(series: readonly TidySeries[], labels: SweepChartLabels): void
	/** Re-theme the chart in place (colours only — no data recompute). */
	setPalette(palette: Palette): void
	/** Re-fit the chart to its host (call after the host becomes visible or changes size). */
	resize(): void
	/** Destroy the uPlot instance, the observer and the DOM. */
	destroy(): void
}

/** uPlot needs its own stylesheet for the legend table + cursor; inject it once (vendored, see below). */
function injectUplotStyles(): void {
	if (document.getElementById('tsv-uplot-style') !== null) {
		return
	}
	const style = document.createElement('style')
	style.id = 'tsv-uplot-style'
	style.textContent = UPLOT_CSS
	document.head.append(style)
}

/** The series colour for slot `index`, cycling the palette's categorical scale past its length. */
function seriesColor(palette: Palette, index: number): string {
	const scale = palette.seriesScale
	return scale[index % scale.length]
}

/** Create a sweep chart mounted into `host`. */
export function createSweepChart(host: HTMLElement, initialPalette: Palette): SweepChart {
	injectUplotStyles()
	let palette = initialPalette
	let series: readonly TidySeries[] = []
	let labels: SweepChartLabels = { x: '', y: '' }
	let plot: uPlot | undefined

	host.classList.add('tsv-chart-host')
	const plotHost = document.createElement('div')
	plotHost.className = 'tsv-chart-plot'
	const legendHost = document.createElement('div')
	legendHost.className = 'tsv-chart-legend'
	const empty = document.createElement('div')
	empty.className = 'tsv-chart-empty'
	host.append(plotHost, legendHost, empty)

	function showEmpty(message: string): void {
		empty.textContent = message
		empty.style.display = 'flex'
		plotHost.style.display = 'none'
		legendHost.style.display = 'none'
	}

	function showPlot(): void {
		empty.style.display = 'none'
		plotHost.style.display = ''
		legendHost.style.display = ''
	}

	/** Measure the plotting area (CSS px). Returns 0×0 while the host is hidden — the caller then defers. */
	function measure(): { width: number; height: number } {
		return { width: Math.floor(plotHost.clientWidth), height: Math.floor(plotHost.clientHeight) }
	}

	function destroyPlot(): void {
		plot?.destroy()
		plot = undefined
		legendHost.textContent = ''
	}

	function options(width: number, height: number): uPlot.Options {
		const aligned = alignSeries(series)
		const axisStyle = { stroke: palette.textSecondary, grid: { stroke: palette.border }, ticks: { stroke: palette.border } }
		return {
			width,
			height,
			// x is a plain number axis (a swept parameter), not a timestamp — uPlot defaults x to time.
			scales: { x: { time: false } },
			axes: [
				{ ...axisStyle, label: labels.x, labelSize: 28 },
				{ ...axisStyle, label: labels.y, labelSize: 44 },
			],
			legend: { live: true, mount: (_self: uPlot, element: HTMLElement) => legendHost.append(element) },
			cursor: { points: { size: 7 } },
			series: [
				{},
				...aligned.columns.map((column, index) => ({
					label: column.seriesKey === '' ? labels.y : column.seriesKey,
					stroke: seriesColor(palette, index),
					width: 2,
					points: { show: true, size: 6 },
				})),
			],
		}
	}

	function draw(): void {
		const { width, height } = measure()
		if (width <= 0 || height <= 0) {
			return // hidden (display:none) — a later resize() redraws once it has a size.
		}
		destroyPlot()
		const aligned = alignSeries(series)
		if (aligned.columns.length === 0 || aligned.x.length === 0) {
			showEmpty('Nothing to plot — no finite points for this axis / metric choice.')
			return
		}
		showPlot()
		const data: uPlot.AlignedData = [aligned.x, ...aligned.columns.map((column) => column.y)]
		plot = new uPlot(options(width, height), data, plotHost)
	}

	let pending = 0
	function scheduleResize(): void {
		if (pending !== 0) {
			return
		}
		pending = requestAnimationFrame(() => {
			pending = 0
			const { width, height } = measure()
			if (width <= 0 || height <= 0) {
				return
			}
			if (plot === undefined) {
				draw()
			} else {
				plot.setSize({ width, height })
			}
		})
	}

	const observer = new ResizeObserver(scheduleResize)
	observer.observe(plotHost)

	return {
		render(nextSeries: readonly TidySeries[], nextLabels: SweepChartLabels): void {
			series = nextSeries
			labels = nextLabels
			draw()
		},
		setPalette(nextPalette: Palette): void {
			palette = nextPalette
			draw()
		},
		resize(): void {
			scheduleResize()
		},
		destroy(): void {
			observer.disconnect()
			if (pending !== 0) {
				cancelAnimationFrame(pending)
				pending = 0
			}
			destroyPlot()
			host.textContent = ''
			host.classList.remove('tsv-chart-host')
		},
	}
}

/**
 * uPlot's stylesheet, vendored as a string (the project injects CSS as strings rather than `import './x.css'`,
 * which under `NodeNext` + `tsc` would need a module `.d.ts` shim — see `app/styles.ts`). Verbatim from
 * `uplot@1.6.32` `dist/uPlot.min.css`; refresh it if the dependency is bumped. Legend/axis **colours** are
 * driven from the palette via CSS variables in `app/styles.ts`, not here.
 */
const UPLOT_CSS = `.uplot, .uplot *, .uplot *::before, .uplot *::after {box-sizing: border-box;}
.uplot {font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;line-height: 1.5;width: min-content;}
.u-title {text-align: center;font-size: 18px;font-weight: bold;}
.u-wrap {position: relative;user-select: none;}
.u-over, .u-under {position: absolute;}
.u-under {overflow: hidden;}
.uplot canvas {display: block;position: relative;width: 100%;height: 100%;}
.u-axis {position: absolute;}
.u-legend {font-size: 14px;margin: auto;text-align: center;}
.u-inline {display: block;}
.u-inline * {display: inline-block;}
.u-inline tr {margin-right: 16px;}
.u-legend th {font-weight: 600;}
.u-legend th > * {vertical-align: middle;display: inline-block;}
.u-legend .u-marker {width: 1em;height: 1em;margin-right: 4px;background-clip: padding-box !important;}
.u-inline.u-live th::after {content: ":";vertical-align: middle;}
.u-inline:not(.u-live) .u-value {display: none;}
.u-series > * {padding: 4px;}
.u-series th {cursor: pointer;}
.u-legend .u-off > * {opacity: 0.3;}
.u-select {background: rgba(0,0,0,0.07);position: absolute;pointer-events: none;}
.u-cursor-x, .u-cursor-y {position: absolute;left: 0;top: 0;pointer-events: none;will-change: transform;}
.u-hz .u-cursor-x, .u-vt .u-cursor-y {height: 100%;border-right: 1px dashed #607D8B;}
.u-hz .u-cursor-y, .u-vt .u-cursor-x {width: 100%;border-bottom: 1px dashed #607D8B;}
.u-cursor-pt {position: absolute;top: 0;left: 0;border-radius: 50%;border: 0 solid;pointer-events: none;will-change: transform;background-clip: padding-box !important;}
.u-axis.u-off, .u-select.u-off, .u-cursor-x.u-off, .u-cursor-y.u-off, .u-cursor-pt.u-off {display: none;}`
