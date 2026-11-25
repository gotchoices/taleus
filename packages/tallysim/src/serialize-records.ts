/**
 * Output serialisers for {@link RunRecord}s — **pure string functions, no filesystem**, so they are testable
 * without Node and reusable in the browser. Two formats:
 *
 * - **JSON-lines** — one record per line, the full nested record. The CLI streams these as runs are produced.
 * - **CSV summary** — one row per run, columns flattened to scalars (varied params + seed + scalar metrics;
 *   each distribution expands to `count/mean/min/max/p50/p90/p99` columns). For spreadsheets and quick plots.
 *
 * Non-finite numbers (an unbounded max-flow is `Infinity`) serialise as JSON `null` / an empty CSV cell,
 * matching the model's `Infinity ↔ null` convention; finite records round-trip through JSON-lines exactly.
 * See `docs/design.md` § Output serialisation.
 */

import type { RunRecord } from './runner.js'

/** JSON replacer mapping non-finite numbers (`Infinity`, `-Infinity`, `NaN`) to `null`. */
function finiteReplacer(_key: string, value: unknown): unknown {
	return typeof value === 'number' && !Number.isFinite(value) ? null : value
}

/** One record as a single JSON line (no trailing newline). */
export function recordToJsonLine(record: RunRecord): string {
	return JSON.stringify(record, finiteReplacer)
}

/** A set of records as JSON-lines text (newline-separated; no trailing newline). */
export function recordsToJsonLines(records: readonly RunRecord[]): string {
	return records.map(recordToJsonLine).join('\n')
}

/** Parse one JSON line back into a {@link RunRecord} (the round-trip partner of {@link recordToJsonLine}). */
export function parseJsonLine(line: string): RunRecord {
	return JSON.parse(line) as RunRecord
}

/** Canonical order for the scalar metric columns; only those seen in the data are emitted. */
const METRIC_COLUMNS: string[] = [
	'queryCount',
	'meanDegree',
	'largestComponentFraction',
	'routeExistsCount',
	'pRouteExists',
	...distributionColumns('pathLength'),
	...distributionColumns('maxFlow'),
	'sampledNodeCount',
	'clearingAvailability',
	...distributionColumns('clearingCycleLength'),
]

/** The seven flattened column names for one distribution field. */
function distributionColumns(prefix: string): string[] {
	return ['count', 'mean', 'min', 'max', 'p50', 'p90', 'p99'].map((suffix) => `${prefix}.${suffix}`)
}

/** Flatten a record's metrics into scalar `column → number` entries (only the present fields). */
function flattenMetrics(record: RunRecord): Map<string, number> {
	const out = new Map<string, number>()
	const metrics = record.metrics as unknown as Record<string, unknown>
	for (const key of Object.keys(metrics)) {
		const value = metrics[key]
		if (typeof value === 'number') {
			out.set(key, value)
		} else if (value !== null && typeof value === 'object') {
			// A DistributionSummary: expand its scalar sub-fields as `key.sub`.
			for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
				if (typeof subValue === 'number') {
					out.set(`${key}.${sub}`, subValue)
				}
			}
		}
	}
	return out
}

/** Format one CSV cell: non-finite / missing → empty; strings escaped per RFC 4180. */
function formatCell(value: number | string | undefined): string {
	if (value === undefined) {
		return ''
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : ''
	}
	return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Accumulates records and emits a CSV summary, so the CLI can build the CSV **during the same streaming pass**
 * it writes JSON-lines (keeping only lightweight per-row scalars, never the full record set). The column set
 * grows as records arrive: `generator`, `capacity`, every varied param path (sorted), `seed`, then the scalar
 * metric columns actually seen (in canonical order).
 */
export interface CsvAccumulator {
	add(record: RunRecord): void
	toCsv(): string
}

/** Create a {@link CsvAccumulator}. */
export function createCsvAccumulator(): CsvAccumulator {
	const paramPaths = new Set<string>()
	const metricColumns = new Set<string>()
	const rows: Map<string, number | string>[] = []

	return {
		add(record: RunRecord): void {
			const row = new Map<string, number | string>()
			row.set('generator', record.generator)
			row.set('capacity', record.capacity)
			for (const [path, value] of Object.entries(record.params)) {
				paramPaths.add(path)
				row.set(path, value)
			}
			row.set('seed', record.seed)
			for (const [column, value] of flattenMetrics(record)) {
				metricColumns.add(column)
				row.set(column, value)
			}
			rows.push(row)
		},
		toCsv(): string {
			const header = [
				'generator',
				'capacity',
				...[...paramPaths].sort(),
				'seed',
				...METRIC_COLUMNS.filter((column) => metricColumns.has(column)),
			]
			const lines = [header.map(formatCell).join(',')]
			for (const row of rows) {
				lines.push(header.map((column) => formatCell(row.get(column))).join(','))
			}
			return lines.join('\n')
		},
	}
}

/** A set of records as a CSV summary string (header + one row per run). */
export function recordsToCsv(records: readonly RunRecord[]): string {
	const accumulator = createCsvAccumulator()
	for (const record of records) {
		accumulator.add(record)
	}
	return accumulator.toCsv()
}
