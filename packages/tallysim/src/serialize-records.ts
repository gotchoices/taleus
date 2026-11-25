/**
 * Output serialisers for run records — **pure string functions, no filesystem**, so they are testable
 * without Node and reusable in the browser. Two formats:
 *
 * - **JSON-lines** — one record per line, the full nested record. The CLI streams these as runs are produced.
 * - **CSV summary** — one row per run, columns flattened to scalars (varied params + seed + scalar metrics;
 *   each distribution expands to `count/mean/min/max/p50/p90/p99` columns, each nested numeric object to
 *   `object.key` columns). For spreadsheets and quick plots.
 *
 * Non-finite numbers (an unbounded max-flow is `Infinity`) serialise as JSON `null` / an empty CSV cell,
 * matching the model's `Infinity ↔ null` convention; finite records round-trip through JSON-lines exactly.
 * See `docs/design.md` § Output serialisation.
 *
 * ── Generic over the metrics shape ───────────────────────────────────────────────────────────────────
 * Every run record shares one provenance shape ({@link MetricsRecord}: `generator`, `capacity`, `params`,
 * `seed`, `metrics`) and differs only in the `metrics` payload — `RunMetrics` for the oracle sweep here,
 * `ProtocolRunMetrics` for the discovery sweep (`serialize-sim-records.ts`). The machinery below is generic
 * over that payload (`metricsRecordToJsonLine`, `createSweepCsvAccumulator(metricOrder)`, …); the oracle
 * functions at the bottom (`recordToJsonLine`, `createCsvAccumulator`, …) are thin `RunRecord`-typed wrappers
 * that pin the metrics type and the canonical CSV column order, so their byte output is unchanged.
 */

import type { RunMetrics } from './metrics.js'
import type { RunRecord } from './runner.js'

/**
 * The provenance shape every run record shares, generic over its `metrics` payload `M`. The oracle's
 * `RunRecord` is `MetricsRecord<RunMetrics>`; the sim's `SimRunRecord` is `MetricsRecord<ProtocolRunMetrics>`.
 * Both are structurally identical to this, so a wrapper can pass one straight to the generic serialisers.
 */
export interface MetricsRecord<M> {
	generator: string
	capacity: string
	params: Record<string, number>
	seed: number
	metrics: M
}

/** JSON replacer mapping non-finite numbers (`Infinity`, `-Infinity`, `NaN`) to `null`. */
function finiteReplacer(_key: string, value: unknown): unknown {
	return typeof value === 'number' && !Number.isFinite(value) ? null : value
}

/** One record as a single JSON line (no trailing newline). Shape-agnostic over the metrics payload. */
export function metricsRecordToJsonLine<M>(record: MetricsRecord<M>): string {
	return JSON.stringify(record, finiteReplacer)
}

/** A set of records as JSON-lines text (newline-separated; no trailing newline). */
export function metricsRecordsToJsonLines<M>(records: readonly MetricsRecord<M>[]): string {
	return records.map(metricsRecordToJsonLine).join('\n')
}

/** Parse one JSON line back into a {@link MetricsRecord} (round-trip partner of {@link metricsRecordToJsonLine}). */
export function parseMetricsJsonLine<M>(line: string): MetricsRecord<M> {
	return JSON.parse(line) as MetricsRecord<M>
}

/** The seven flattened column names for one distribution field. */
export function distributionColumns(prefix: string): string[] {
	return ['count', 'mean', 'min', 'max', 'p50', 'p90', 'p99'].map((suffix) => `${prefix}.${suffix}`)
}

/**
 * Flatten a metrics object into scalar `column → number` entries (only the present fields). A top-level number
 * maps to its own name; a nested object (a `DistributionSummary`, or a numeric tally like `pruneReasons`)
 * expands its scalar sub-fields as `key.sub`.
 */
function flattenMetrics<M>(metrics: M): Map<string, number> {
	const out = new Map<string, number>()
	const record = metrics as unknown as Record<string, unknown>
	// NOTE: descends exactly one level (number, or an object of numbers). Every metrics shape today is flat or
	// one-deep (DistributionSummary, pruneReasons); a future two-level-nested numeric object would be silently
	// dropped from the CSV — recurse here (and widen the column-order lists) if that shape ever appears.
	for (const key of Object.keys(record)) {
		const value = record[key]
		if (typeof value === 'number') {
			out.set(key, value)
		} else if (value !== null && typeof value === 'object') {
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
 * metric columns actually seen (in the canonical order given to {@link createSweepCsvAccumulator}).
 */
export interface CsvAccumulator<M> {
	add(record: MetricsRecord<M>): void
	toCsv(): string
}

/**
 * Create a {@link CsvAccumulator} for records whose metrics columns follow `metricOrder` (the canonical order;
 * only the columns actually seen in the data are emitted). The oracle and sim serialisers pass their own order.
 */
export function createSweepCsvAccumulator<M>(metricOrder: readonly string[]): CsvAccumulator<M> {
	const paramPaths = new Set<string>()
	const metricColumns = new Set<string>()
	const rows: Map<string, number | string>[] = []

	return {
		add(record: MetricsRecord<M>): void {
			const row = new Map<string, number | string>()
			row.set('generator', record.generator)
			row.set('capacity', record.capacity)
			for (const [path, value] of Object.entries(record.params)) {
				paramPaths.add(path)
				row.set(path, value)
			}
			row.set('seed', record.seed)
			for (const [column, value] of flattenMetrics(record.metrics)) {
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
				...metricOrder.filter((column) => metricColumns.has(column)),
			]
			const lines = [header.map(formatCell).join(',')]
			for (const row of rows) {
				lines.push(header.map((column) => formatCell(row.get(column))).join(','))
			}
			return lines.join('\n')
		},
	}
}

/** A set of records as a CSV summary string (header + one row per run) for the given metric-column order. */
export function metricsRecordsToCsv<M>(records: readonly MetricsRecord<M>[], metricOrder: readonly string[]): string {
	const accumulator = createSweepCsvAccumulator<M>(metricOrder)
	for (const record of records) {
		accumulator.add(record)
	}
	return accumulator.toCsv()
}

// ── Oracle RunRecord wrappers (byte-identical to the pre-refactor functions) ────────────────────────────

/** Canonical order for the oracle's scalar metric columns; only those seen in the data are emitted. */
const METRIC_COLUMNS: readonly string[] = [
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

/** One {@link RunRecord} as a single JSON line (no trailing newline). */
export function recordToJsonLine(record: RunRecord): string {
	return metricsRecordToJsonLine(record)
}

/** A set of {@link RunRecord}s as JSON-lines text (newline-separated; no trailing newline). */
export function recordsToJsonLines(records: readonly RunRecord[]): string {
	return metricsRecordsToJsonLines(records)
}

/** Parse one JSON line back into a {@link RunRecord} (the round-trip partner of {@link recordToJsonLine}). */
export function parseJsonLine(line: string): RunRecord {
	return parseMetricsJsonLine<RunMetrics>(line)
}

/** Create a {@link CsvAccumulator} for oracle {@link RunRecord}s. */
export function createCsvAccumulator(): CsvAccumulator<RunMetrics> {
	return createSweepCsvAccumulator<RunMetrics>(METRIC_COLUMNS)
}

/** A set of {@link RunRecord}s as a CSV summary string (header + one row per run). */
export function recordsToCsv(records: readonly RunRecord[]): string {
	return metricsRecordsToCsv(records, METRIC_COLUMNS)
}
