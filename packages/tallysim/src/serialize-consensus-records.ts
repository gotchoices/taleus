/**
 * Output serialisers for consensus-sweep {@link ConsensusRunRecord}s — the consensus-tier counterpart to
 * `serialize-sim-records.ts`. Both share one provenance shape; only the `metrics` payload differs
 * ({@link ConsensusRunMetrics} here). Reuses the generic JSON-lines + CSV machinery from
 * `serialize-records.ts`; supplies only the consensus CSV column order. Pure string functions, no filesystem.
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
import type { ConsensusRunMetrics } from './sim/consensus-metrics.js'
import type { ConsensusRunRecord } from './sim/consensus-runner.js'

/** Canonical order for the consensus scalar metric columns; only those seen in the data are emitted. */
const CONSENSUS_METRIC_COLUMNS: readonly string[] = [
	'queryCount',
	'meanDegree',
	'largestComponentFraction',
	'liftCount',
	'commitCount',
	'voidCount',
	'pendingCount',
	'pCommitGivenFound',
	...distributionColumns('timeToSettleMs'),
	...distributionColumns('messagesPerLift'),
	'voidReasons.refused-promise',
	'voidReasons.voted-no-commit',
	'voidReasons.stalled',
	'voidReasons.expired',
	'cooperatingMemberTotal',
	'cooperatingCommittedTotal',
	'cooperatingCompletion',
	'recoveredTotal',
	...distributionColumns('pullMessagesPerLift'),
]

/** One {@link ConsensusRunRecord} as a single JSON line (no trailing newline). */
export function consensusRecordToJsonLine(record: ConsensusRunRecord): string {
	return metricsRecordToJsonLine(record)
}

/** A set of {@link ConsensusRunRecord}s as JSON-lines text (newline-separated; no trailing newline). */
export function consensusRecordsToJsonLines(records: readonly ConsensusRunRecord[]): string {
	return metricsRecordsToJsonLines(records)
}

/** Parse one JSON line back into a {@link ConsensusRunRecord}. */
export function parseConsensusJsonLine(line: string): ConsensusRunRecord {
	return parseMetricsJsonLine<ConsensusRunMetrics>(line)
}

/** Create a {@link CsvAccumulator} for consensus-sweep {@link ConsensusRunRecord}s. */
export function createConsensusCsvAccumulator(): CsvAccumulator<ConsensusRunMetrics> {
	return createSweepCsvAccumulator<ConsensusRunMetrics>(CONSENSUS_METRIC_COLUMNS)
}

/** A set of {@link ConsensusRunRecord}s as a CSV summary string (header + one row per run). */
export function consensusRecordsToCsv(records: readonly ConsensusRunRecord[]): string {
	return metricsRecordsToCsv(records, CONSENSUS_METRIC_COLUMNS)
}
