/**
 * The viewer shell's stylesheet, as a TypeScript **string** injected via a `<style>` element (see
 * `shell.ts`). It is a string rather than an imported `.css` file on purpose: under `NodeNext` + `tsc` a
 * `import './x.css'` needs a module `.d.ts` shim, and a plain string sidesteps that with no build plumbing.
 *
 * ── Layout ─────────────────────────────────────────────────────────────────────────────────────────
 * A column: a fixed-height top bar over a row of a fixed-width left panel and the two main containers — the
 * graph and the sweep chart — of which the view-mode toggle shows exactly one, filling the rest. Both main
 * containers are `position: relative` so an absolutely-positioned child (the renderer's tooltip / WebGL-missing
 * message) anchors to it. The panel likewise holds two control groups, one per mode.
 *
 * ── Theming ────────────────────────────────────────────────────────────────────────────────────────
 * Chrome colours come from CSS custom properties (`--tsv-*`) that the shell sets from the active palette on
 * every theme switch; the graph surface itself is painted by the renderer (`container.style.background`), so
 * a re-theme touches only variables + one renderer call, never the layout.
 */

/** The shell stylesheet. Injected once by {@link import('./shell.js').mountShell}. */
export const SHELL_CSS = `
:root {
	--tsv-surface: #ffffff;
	--tsv-page: #f9f9f9;
	--tsv-text: #191919;
	--tsv-text-secondary: #666666;
	--tsv-border: rgba(11, 11, 11, 0.1);
}

* {
	box-sizing: border-box;
}

html, body, #app {
	margin: 0;
	height: 100%;
}

#tsv-app {
	display: flex;
	flex-direction: column;
	height: 100%;
	font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
	color: var(--tsv-text);
	background: var(--tsv-page);
}

#tsv-topbar {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.5rem 1rem;
	border-bottom: 1px solid var(--tsv-border);
	background: var(--tsv-page);
}

#tsv-title {
	font-size: 1rem;
	font-weight: 600;
	margin: 0;
	flex: 1;
}

#tsv-body {
	display: flex;
	flex: 1;
	min-height: 0;
}

#tsv-panel {
	width: 18rem;
	flex: 0 0 18rem;
	padding: 1rem;
	border-right: 1px solid var(--tsv-border);
	background: var(--tsv-page);
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

#tsv-graph {
	position: relative;
	flex: 1;
	min-width: 0;
	background: var(--tsv-surface);
}

.tsv-section-title {
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--tsv-text-secondary);
	margin: 0 0 0.25rem;
}

.tsv-field {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

#tsv-app button {
	font: inherit;
	color: var(--tsv-text);
	background: var(--tsv-surface);
	border: 1px solid var(--tsv-border);
	border-radius: 4px;
	padding: 0.35rem 0.6rem;
	cursor: pointer;
}

#tsv-app button:hover {
	border-color: var(--tsv-text-secondary);
}

#tsv-app input[type='text'] {
	font: inherit;
	color: var(--tsv-text);
	background: var(--tsv-surface);
	border: 1px solid var(--tsv-border);
	border-radius: 4px;
	padding: 0.35rem 0.5rem;
}

#tsv-app select {
	font: inherit;
	color: var(--tsv-text);
	background: var(--tsv-surface);
	border: 1px solid var(--tsv-border);
	border-radius: 4px;
	padding: 0.3rem 0.4rem;
	max-width: 100%;
}

/* ── View-mode toggle (Graph | Sweep) ── */
#tsv-mode {
	display: flex;
	gap: 0.25rem;
}

#tsv-app #tsv-mode button.tsv-mode-active {
	background: var(--tsv-text);
	color: var(--tsv-surface);
	border-color: var(--tsv-text);
}

/* ── Per-mode panel control groups ── */
#tsv-graph-controls,
#tsv-sweep-controls {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

/* ── Sweep chart main container ── */
#tsv-chart {
	position: relative;
	flex: 1;
	min-width: 0;
	background: var(--tsv-surface);
}

.tsv-chart-host {
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	padding: 0.75rem;
}

.tsv-chart-plot {
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
}

.tsv-chart-legend {
	flex: 0 0 auto;
	max-height: 9rem;
	overflow-y: auto;
	margin-top: 0.5rem;
}

.tsv-chart-empty {
	flex: 1;
	display: none;
	align-items: center;
	justify-content: center;
	text-align: center;
	padding: 2rem;
	color: var(--tsv-text-secondary);
}

/* uPlot's legend/axis colours ride the shell theme variables (the chart injects only structural CSS). */
#tsv-chart .u-legend,
#tsv-chart .u-legend .u-value {
	color: var(--tsv-text);
}

#tsv-chart .u-axis {
	color: var(--tsv-text-secondary);
}

/* ── Sweep panel controls ── */
.tsv-sweep-row {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
}

.tsv-sweep-label {
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--tsv-text-secondary);
}

.tsv-sweep-control {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.tsv-sweep-series {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
}

.tsv-sweep-check {
	font-size: 0.85rem;
	display: flex;
	align-items: center;
	gap: 0.3rem;
}

.tsv-sweep-note {
	color: var(--tsv-text-secondary);
	font-size: 0.8rem;
	line-height: 1.4;
}

.tsv-sweep-status {
	color: #c0392b;
	font-size: 0.85rem;
	min-height: 1rem;
	white-space: pre-wrap;
}

#tsv-status {
	color: #c0392b;
	font-size: 0.85rem;
	min-height: 1rem;
	white-space: pre-wrap;
}

#tsv-summary {
	font-size: 0.85rem;
	color: var(--tsv-text-secondary);
	line-height: 1.5;
}

#tsv-summary dl {
	margin: 0;
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 0.15rem 0.75rem;
}

#tsv-summary dt {
	color: var(--tsv-text-secondary);
}

#tsv-summary dd {
	margin: 0;
	color: var(--tsv-text);
	font-variant-numeric: tabular-nums;
}

#tsv-search-miss {
	color: #c0392b;
	font-size: 0.8rem;
	min-height: 1rem;
}

.tsv-tooltip {
	background: var(--tsv-surface);
	color: var(--tsv-text);
	border: 1px solid var(--tsv-border);
	border-radius: 4px;
	padding: 0.35rem 0.5rem;
	font-size: 0.8rem;
	line-height: 1.4;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
	max-width: 16rem;
}

.tsv-webgl-missing {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	text-align: center;
	padding: 2rem;
	color: var(--tsv-text-secondary);
}

.tsv-replay {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	font-size: 0.85rem;
}

.tsv-replay-disabled {
	opacity: 0.55;
}

.tsv-transport {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	flex-wrap: wrap;
}

.tsv-replay-scrub {
	flex: 1 1 100%;
}

.tsv-replay-time {
	color: var(--tsv-text-secondary);
	font-variant-numeric: tabular-nums;
}

.tsv-replay-sessions {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.tsv-replay-colour {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	color: var(--tsv-text-secondary);
}

.tsv-replay-found-state {
	font-weight: 600;
}

.tsv-replay-routes,
.tsv-replay-markers {
	list-style: none;
	margin: 0.25rem 0 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

#tsv-app .tsv-replay-route {
	width: 100%;
	text-align: left;
}

#tsv-app .tsv-replay-route-active {
	border-color: var(--tsv-text);
}

.tsv-replay-note,
.tsv-replay-hint {
	color: var(--tsv-text-secondary);
	font-size: 0.8rem;
	line-height: 1.4;
}
`
