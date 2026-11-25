/**
 * The sweeps view's **source loader** — a pure, browser-free bridge from a picked file's `(name, text)` to a
 * {@link SweepTable}. It decides the format (by extension, else by sniffing the text) and dispatches to the
 * right reader in `core/sweep-data.ts`. It also carries a small **embedded sample sweep** so the view is
 * exercisable with no file at hand.
 *
 * ── Error policy ───────────────────────────────────────────────────────────────────────────────────
 * A malformed JSON-lines line makes `JSON.parse` throw inside `readSweepJsonl`; that error is **let through**
 * so the view surfaces it in its status line rather than swallowing it. A *valid but empty* file is **not** an
 * error — it reads to an empty table, and the chart then shows its "nothing to plot" message. This keeps the
 * one genuine failure (a broken file) loud and the benign empty case quiet.
 */

import { readSweepCsv, readSweepJsonl, type SweepTable } from '../core/sweep-data.js'

/** The two sweep serialisations `tallysim`'s CLI writes (and this view reads back to the same table). */
export type SweepFormat = 'csv' | 'jsonl'

/** The first non-blank line of `text` (used to sniff a format when the file name does not settle it). */
function firstNonBlankLine(text: string): string {
	for (const line of text.split('\n')) {
		if (line.trim() !== '') {
			return line
		}
	}
	return ''
}

/**
 * Decide a file's sweep format. The extension wins first (`.csv` → CSV; `.jsonl` / `.ndjson` / `.json` →
 * JSON-lines); otherwise the text is sniffed: a first non-blank character of `{` is a JSON record, and a first
 * non-blank line naming `generator` is the CSV header. A still-ambiguous first line with a comma is read as
 * CSV, else JSON-lines (so a broken file fails loudly in whichever reader, never silently mis-read).
 */
export function detectSweepFormat(fileName: string, text: string): SweepFormat {
	const lower = fileName.toLowerCase()
	if (lower.endsWith('.csv')) {
		return 'csv'
	}
	if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson') || lower.endsWith('.json')) {
		return 'jsonl'
	}
	const first = firstNonBlankLine(text)
	if (first.trimStart().startsWith('{')) {
		return 'jsonl'
	}
	if (first.includes('generator')) {
		return 'csv'
	}
	return first.includes(',') ? 'csv' : 'jsonl'
}

/**
 * Load a picked file's text into a {@link SweepTable}, dispatching on {@link detectSweepFormat}. A malformed
 * JSON-lines line throws (caller shows the message); an empty file reads to an empty table (not an error).
 */
export function loadSweepText(fileName: string, text: string): SweepTable {
	return detectSweepFormat(fileName, text) === 'csv' ? readSweepCsv(text) : readSweepJsonl(text)
}

/** The file name the embedded {@link SAMPLE_SWEEP} is loaded under (so {@link detectSweepFormat} reads it JSONL). */
export const SAMPLE_SWEEP_NAME = 'sample-sweep.jsonl'

/**
 * A small embedded oracle-style sweep: two generators × `edgesPerNode` {1,2,3} × two seeds. It exercises the
 * common chart (pRouteExists vs. a connectivity parameter, one line per generator) and — at `edgesPerNode = 1`,
 * `uniform`, seed 1 — a `pathLength.count === 0` cell, so the distribution-metric `count: 0 → gap` guard is
 * visible without a file. Generated headlessly (see `tickets` / `docs/design.md` § Sweeps view).
 */
export const SAMPLE_SWEEP: string = [
	'{"generator":"uniform","capacity":"lognormal","params":{"network.params.edgesPerNode":1,"network.params.entityCount":100},"seed":1,"metrics":{"queryCount":100,"meanDegree":1.9,"largestComponentFraction":1,"routeExistsCount":0,"pRouteExists":0,"pathLength":{"count":0,"mean":0,"min":0,"max":0,"p50":0,"p90":0,"p99":0}}}',
	'{"generator":"uniform","capacity":"lognormal","params":{"network.params.edgesPerNode":1,"network.params.entityCount":100},"seed":2,"metrics":{"queryCount":100,"meanDegree":2,"largestComponentFraction":1,"routeExistsCount":2,"pRouteExists":0.03,"pathLength":{"count":2,"mean":1.9,"min":1,"max":3,"p50":1.4,"p90":2,"p99":3}}}',
	'{"generator":"uniform","capacity":"lognormal","params":{"network.params.edgesPerNode":2,"network.params.entityCount":100},"seed":1,"metrics":{"queryCount":100,"meanDegree":3.8,"largestComponentFraction":1,"routeExistsCount":14,"pRouteExists":0.28,"pathLength":{"count":14,"mean":2.3,"min":1,"max":4,"p50":1.8,"p90":3,"p99":4}}}',
	'{"generator":"uniform","capacity":"lognormal","params":{"network.params.edgesPerNode":2,"network.params.entityCount":100},"seed":2,"metrics":{"queryCount":100,"meanDegree":3.9,"largestComponentFraction":1,"routeExistsCount":17,"pRouteExists":0.33,"pathLength":{"count":17,"mean":2.3,"min":1,"max":4,"p50":1.8,"p90":3,"p99":4}}}',
	'{"generator":"uniform","capacity":"lognormal","params":{"network.params.edgesPerNode":3,"network.params.entityCount":100},"seed":1,"metrics":{"queryCount":100,"meanDegree":5.7,"largestComponentFraction":1,"routeExistsCount":28,"pRouteExists":0.56,"pathLength":{"count":28,"mean":2.7,"min":1,"max":5,"p50":2.2,"p90":4,"p99":5}}}',
	'{"generator":"uniform","capacity":"lognormal","params":{"network.params.edgesPerNode":3,"network.params.entityCount":100},"seed":2,"metrics":{"queryCount":100,"meanDegree":5.8,"largestComponentFraction":1,"routeExistsCount":31,"pRouteExists":0.61,"pathLength":{"count":31,"mean":2.7,"min":1,"max":5,"p50":2.2,"p90":4,"p99":5}}}',
	'{"generator":"scale-free","capacity":"lognormal","params":{"network.params.edgesPerNode":1,"network.params.entityCount":100},"seed":1,"metrics":{"queryCount":100,"meanDegree":1.9,"largestComponentFraction":1,"routeExistsCount":5,"pRouteExists":0.1,"pathLength":{"count":5,"mean":1.9,"min":1,"max":3,"p50":1.4,"p90":2,"p99":3}}}',
	'{"generator":"scale-free","capacity":"lognormal","params":{"network.params.edgesPerNode":1,"network.params.entityCount":100},"seed":2,"metrics":{"queryCount":100,"meanDegree":2,"largestComponentFraction":1,"routeExistsCount":8,"pRouteExists":0.15,"pathLength":{"count":8,"mean":1.9,"min":1,"max":3,"p50":1.4,"p90":2,"p99":3}}}',
	'{"generator":"scale-free","capacity":"lognormal","params":{"network.params.edgesPerNode":2,"network.params.entityCount":100},"seed":1,"metrics":{"queryCount":100,"meanDegree":3.8,"largestComponentFraction":1,"routeExistsCount":22,"pRouteExists":0.44,"pathLength":{"count":22,"mean":2.3,"min":1,"max":4,"p50":1.8,"p90":3,"p99":4}}}',
	'{"generator":"scale-free","capacity":"lognormal","params":{"network.params.edgesPerNode":2,"network.params.entityCount":100},"seed":2,"metrics":{"queryCount":100,"meanDegree":3.9,"largestComponentFraction":1,"routeExistsCount":25,"pRouteExists":0.49,"pathLength":{"count":25,"mean":2.3,"min":1,"max":4,"p50":1.8,"p90":3,"p99":4}}}',
	'{"generator":"scale-free","capacity":"lognormal","params":{"network.params.edgesPerNode":3,"network.params.entityCount":100},"seed":1,"metrics":{"queryCount":100,"meanDegree":5.7,"largestComponentFraction":1,"routeExistsCount":36,"pRouteExists":0.72,"pathLength":{"count":36,"mean":2.7,"min":1,"max":5,"p50":2.2,"p90":4,"p99":5}}}',
	'{"generator":"scale-free","capacity":"lognormal","params":{"network.params.edgesPerNode":3,"network.params.entityCount":100},"seed":2,"metrics":{"queryCount":100,"meanDegree":5.8,"largestComponentFraction":1,"routeExistsCount":39,"pRouteExists":0.77,"pathLength":{"count":39,"mean":2.7,"min":1,"max":5,"p50":2.2,"p90":4,"p99":5}}}',
].join('\n')
