/**
 * Output serialisers for discovery-sweep {@link SimRunRecord}s — the sim-tier counterpart to
 * `serialize-records.ts`. Both record kinds share one provenance shape (`generator`, `capacity`, `params`,
 * `seed`, `metrics`); only the `metrics` payload differs (`ProtocolRunMetrics` here vs the oracle's
 * `RunMetrics`). So this module reuses the generic JSON-lines + CSV machinery from `serialize-records.ts`
 * and only supplies the sim's canonical CSV column order. **Pure string functions, no filesystem** — testable
 * without Node and reusable in the browser. See `docs/design.md` § Output serialisation.
 *
 * Non-finite numbers serialise as JSON `null` / an empty CSV cell, exactly as the oracle serialiser does.
 * The CSV flattens each `DistributionSummary` to `count/mean/min/max/p50/p90/p99` columns and the nested
 * `pruneReasons` tally to `pruneReasons.cycle`, `pruneReasons.timed-out`, … under the same generic logic.
 */

import {
	createSweepCsvAccumulator,
	distributionColumns,
	metricsRecordToJsonLine,
	metricsRecordsToCsv,
	metricsRecordsToJsonLines,
	parseMetricsJsonLine,
	type CsvAccumulator,
} from './serialize-records.js'
import type { ProtocolRunMetrics } from './sim/protocol-metrics.js'
import type { SimRunRecord } from './sim/sim-runner.js'

/**
 * Canonical order for the sim's scalar metric columns; only those seen in the data are emitted. The scalar
 * found-vs-oracle fields first, then each cost distribution's seven sub-columns, then the six prune-reason
 * tallies in {@link zeroPruneReasons} order.
 */
const SIM_METRIC_COLUMNS: readonly string[] = [
	'queryCount',
	'meanDegree',
	'largestComponentFraction',
	'routeExistsCount',
	'foundCount',
	'foundAndExistsCount',
	'pFoundGivenExists',
	'falseFoundCount',
	...distributionColumns('timeToFirstPlanMs'),
	...distributionColumns('timeToCompletionMs'),
	...distributionColumns('messages'),
	...distributionColumns('nodesTouched'),
	...distributionColumns('roundsUsed'),
	...distributionColumns('plansFound'),
	'pruneReasons.cycle',
	'pruneReasons.failed',
	'pruneReasons.timed-out',
	'pruneReasons.max-depth',
	'pruneReasons.expired',
	'pruneReasons.no-reentrance',
]

/** One {@link SimRunRecord} as a single JSON line (no trailing newline). */
export function simRecordToJsonLine(record: SimRunRecord): string {
	return metricsRecordToJsonLine(record)
}

/** A set of {@link SimRunRecord}s as JSON-lines text (newline-separated; no trailing newline). */
export function simRecordsToJsonLines(records: readonly SimRunRecord[]): string {
	return metricsRecordsToJsonLines(records)
}

/** Parse one JSON line back into a {@link SimRunRecord} (the round-trip partner of {@link simRecordToJsonLine}). */
export function parseSimJsonLine(line: string): SimRunRecord {
	return parseMetricsJsonLine<ProtocolRunMetrics>(line)
}

/** Create a {@link CsvAccumulator} for discovery-sweep {@link SimRunRecord}s. */
export function createSimCsvAccumulator(): CsvAccumulator<ProtocolRunMetrics> {
	return createSweepCsvAccumulator<ProtocolRunMetrics>(SIM_METRIC_COLUMNS)
}

/** A set of {@link SimRunRecord}s as a CSV summary string (header + one row per run). */
export function simRecordsToCsv(records: readonly SimRunRecord[]): string {
	return metricsRecordsToCsv(records, SIM_METRIC_COLUMNS)
}
