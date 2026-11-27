import type { DistributionSummary } from './metrics.js'
import type { ConsensusRunMetrics } from './sim/consensus-metrics.js'
import type { ConsensusRunRecord } from './sim/consensus-runner.js'
import {
	createConsensusCsvAccumulator,
	parseConsensusJsonLine,
	consensusRecordToJsonLine,
	consensusRecordsToCsv,
	consensusRecordsToJsonLines,
} from './serialize-consensus-records.js'

/** A distribution summary over `count` samples, all seven fields distinct so column mapping is testable. */
function dist(count: number, mean: number): DistributionSummary {
	return { count, mean, min: 0, max: mean * 2, p50: mean, p90: mean * 1.5, p99: mean * 2 }
}

const metrics: ConsensusRunMetrics = {
	queryCount: 10,
	meanDegree: 2.4,
	largestComponentFraction: 0.9,
	liftCount: 8,
	commitCount: 5,
	voidCount: 2,
	pendingCount: 1,
	pCommitGivenFound: 5 / 8,
	timeToSettleMs: dist(7, 300),
	messagesPerLift: dist(8, 6),
	voidReasons: { 'refused-promise': 1, 'voted-no-commit': 1, stalled: 1, expired: 0 },
	cooperatingMemberTotal: 20,
	cooperatingCommittedTotal: 18,
	cooperatingCompletion: 18 / 20,
	pullMessagesPerLift: dist(8, 2),
	recoveredTotal: 3,
}

const record: ConsensusRunRecord = {
	generator: 'uniform',
	capacity: 'unlimited',
	params: { 'network.params.meanDegree': 2, 'workload.depth': 4 },
	seed: 1,
	metrics,
}

const otherRecord: ConsensusRunRecord = {
	generator: 'scale-free',
	capacity: 'uniform',
	params: { 'network.params.meanDegree': 3, 'workload.depth': 6 },
	seed: 2,
	metrics: { ...metrics, liftCount: 10, commitCount: 10, voidCount: 0, pendingCount: 0, pCommitGivenFound: 1 },
}

/** Parse a CSV string into a header + array of row objects. */
function parseCsv(csv: string): { header: string[]; rows: Record<string, string>[] } {
	const lines = csv.split('\n')
	const header = lines[0].split(',')
	const rows = lines.slice(1).map((line) => {
		const cells = line.split(',')
		const row: Record<string, string> = {}
		header.forEach((column, i) => (row[column] = cells[i]))
		return row
	})
	return { header, rows }
}

describe('JSON-lines', () => {
	it('round-trips a finite record exactly', () => {
		expect(parseConsensusJsonLine(consensusRecordToJsonLine(record))).toEqual(record)
	})

	it('joins records newline-separated with no trailing newline', () => {
		const text = consensusRecordsToJsonLines([record, otherRecord])
		const lines = text.split('\n')
		expect(lines).toHaveLength(2)
		expect(parseConsensusJsonLine(lines[1])).toEqual(otherRecord)
	})

	it('maps a non-finite number to JSON null', () => {
		const unbounded: ConsensusRunRecord = {
			...record,
			metrics: { ...metrics, timeToSettleMs: dist(1, Infinity) },
		}
		const parsed = parseConsensusJsonLine(consensusRecordToJsonLine(unbounded)) as unknown as {
			metrics: { timeToSettleMs: { mean: number | null } }
		}
		expect(parsed.metrics.timeToSettleMs.mean).toBeNull()
	})
})

describe('CSV summary', () => {
	it('emits a header and one row per record', () => {
		const { header, rows } = parseCsv(consensusRecordsToCsv([record, otherRecord]))
		expect(rows).toHaveLength(2)
		expect(header.slice(0, 2)).toEqual(['generator', 'capacity'])
		// Varied param paths come after the two labels, sorted; then seed, then the metric columns.
		expect(header.indexOf('network.params.meanDegree')).toBeLessThan(header.indexOf('workload.depth'))
		expect(header.indexOf('seed')).toBeLessThan(header.indexOf('pCommitGivenFound'))
		expect(header.indexOf('pCommitGivenFound')).toBeLessThan(header.indexOf('timeToSettleMs.count'))
	})

	it('flattens each distribution into count/mean/min/max/p50/p90/p99 columns', () => {
		const { header, rows } = parseCsv(consensusRecordsToCsv([record]))
		for (const field of ['timeToSettleMs', 'messagesPerLift']) {
			for (const suffix of ['count', 'mean', 'min', 'max', 'p50', 'p90', 'p99']) {
				expect(header).toContain(`${field}.${suffix}`)
			}
		}
		expect(rows[0]['messagesPerLift.mean']).toBe('6')
		expect(rows[0]['pCommitGivenFound']).toBe(String(5 / 8))
		expect(rows[0]['commitCount']).toBe('5')
		expect(rows[0]['generator']).toBe('uniform')
	})

	it('emits the principle-3 completion + pull columns in canonical order (after voidReasons)', () => {
		const { header, rows } = parseCsv(consensusRecordsToCsv([record]))
		for (const column of ['cooperatingMemberTotal', 'cooperatingCommittedTotal', 'cooperatingCompletion', 'recoveredTotal']) {
			expect(header).toContain(column)
		}
		for (const suffix of ['count', 'mean', 'min', 'max', 'p50', 'p90', 'p99']) {
			expect(header).toContain(`pullMessagesPerLift.${suffix}`)
		}
		// Canonical order: the void-reason tally, then the completion scalars, then the pull distribution.
		expect(header.indexOf('voidReasons.expired')).toBeLessThan(header.indexOf('cooperatingMemberTotal'))
		expect(header.indexOf('cooperatingMemberTotal')).toBeLessThan(header.indexOf('recoveredTotal'))
		expect(header.indexOf('recoveredTotal')).toBeLessThan(header.indexOf('pullMessagesPerLift.count'))
		expect(rows[0]['cooperatingMemberTotal']).toBe('20')
		expect(rows[0]['cooperatingCompletion']).toBe(String(18 / 20))
		expect(rows[0]['recoveredTotal']).toBe('3')
		expect(rows[0]['pullMessagesPerLift.mean']).toBe('2')
	})

	it('expands the nested voidReasons tally into voidReasons.<reason> columns', () => {
		const { header, rows } = parseCsv(consensusRecordsToCsv([record]))
		for (const reason of ['refused-promise', 'voted-no-commit', 'stalled', 'expired']) {
			expect(header).toContain(`voidReasons.${reason}`)
		}
		expect(rows[0]['voidReasons.refused-promise']).toBe('1')
		expect(rows[0]['voidReasons.voted-no-commit']).toBe('1')
		expect(rows[0]['voidReasons.stalled']).toBe('1')
		expect(rows[0]['voidReasons.expired']).toBe('0')
	})

	it('writes an empty cell for a non-finite metric', () => {
		const unbounded: ConsensusRunRecord = {
			...record,
			metrics: { ...metrics, timeToSettleMs: dist(1, Infinity) },
		}
		const { rows } = parseCsv(consensusRecordsToCsv([unbounded]))
		expect(rows[0]['timeToSettleMs.mean']).toBe('')
	})

	it('builds the same CSV through the streaming accumulator as the one-shot helper', () => {
		const accumulator = createConsensusCsvAccumulator()
		accumulator.add(record)
		accumulator.add(otherRecord)
		expect(accumulator.toCsv()).toBe(consensusRecordsToCsv([record, otherRecord]))
	})
})
