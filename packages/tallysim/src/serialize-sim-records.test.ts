import type { DistributionSummary } from './metrics.js'
import type { ProtocolRunMetrics } from './sim/protocol-metrics.js'
import type { SimRunRecord } from './sim/sim-runner.js'
import {
	createSimCsvAccumulator,
	parseSimJsonLine,
	simRecordToJsonLine,
	simRecordsToCsv,
	simRecordsToJsonLines,
} from './serialize-sim-records.js'

/** A distribution summary over `count` samples, all seven fields distinct so column mapping is testable. */
function dist(count: number, mean: number): DistributionSummary {
	return { count, mean, min: 0, max: mean * 2, p50: mean, p90: mean * 1.5, p99: mean * 2 }
}

const metrics: ProtocolRunMetrics = {
	queryCount: 10,
	meanDegree: 2.4,
	largestComponentFraction: 0.9,
	routeExistsCount: 7,
	foundCount: 6,
	foundAndExistsCount: 6,
	pFoundGivenExists: 6 / 7,
	falseFoundCount: 0,
	timeToFirstPlanMs: dist(6, 120),
	timeToCompletionMs: dist(10, 300),
	messages: dist(10, 42),
	nodesTouched: dist(10, 8),
	roundsUsed: dist(10, 3),
	plansFound: dist(10, 1),
	pruneReasons: { cycle: 2, failed: 1, 'timed-out': 0, 'max-depth': 4, expired: 0, 'no-reentrance': 3 },
}

const record: SimRunRecord = {
	generator: 'uniform',
	capacity: 'unlimited',
	params: { 'network.params.meanDegree': 2, 'workload.depth': 4 },
	seed: 1,
	metrics,
}

const otherRecord: SimRunRecord = {
	generator: 'scale-free',
	capacity: 'uniform',
	params: { 'network.params.meanDegree': 3, 'workload.depth': 6 },
	seed: 2,
	metrics: { ...metrics, routeExistsCount: 10, foundCount: 10, foundAndExistsCount: 10, pFoundGivenExists: 1 },
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
		expect(parseSimJsonLine(simRecordToJsonLine(record))).toEqual(record)
	})

	it('joins records newline-separated with no trailing newline', () => {
		const text = simRecordsToJsonLines([record, otherRecord])
		const lines = text.split('\n')
		expect(lines).toHaveLength(2)
		expect(parseSimJsonLine(lines[1])).toEqual(otherRecord)
	})

	it('maps a non-finite number to JSON null', () => {
		const unbounded: SimRunRecord = {
			...record,
			metrics: { ...metrics, timeToCompletionMs: dist(1, Infinity) },
		}
		const parsed = parseSimJsonLine(simRecordToJsonLine(unbounded)) as unknown as {
			metrics: { timeToCompletionMs: { mean: number | null } }
		}
		expect(parsed.metrics.timeToCompletionMs.mean).toBeNull()
	})
})

describe('CSV summary', () => {
	it('emits a header and one row per record', () => {
		const { header, rows } = parseCsv(simRecordsToCsv([record, otherRecord]))
		expect(rows).toHaveLength(2)
		expect(header.slice(0, 2)).toEqual(['generator', 'capacity'])
		// Varied param paths come after the two labels, sorted; then seed, then the metric columns.
		expect(header.indexOf('network.params.meanDegree')).toBeLessThan(header.indexOf('workload.depth'))
		expect(header.indexOf('seed')).toBeLessThan(header.indexOf('pFoundGivenExists'))
		expect(header.indexOf('pFoundGivenExists')).toBeLessThan(header.indexOf('timeToFirstPlanMs.count'))
	})

	it('flattens each distribution into count/mean/min/max/p50/p90/p99 columns', () => {
		const { header, rows } = parseCsv(simRecordsToCsv([record]))
		for (const field of ['timeToFirstPlanMs', 'timeToCompletionMs', 'messages', 'nodesTouched', 'roundsUsed', 'plansFound']) {
			for (const suffix of ['count', 'mean', 'min', 'max', 'p50', 'p90', 'p99']) {
				expect(header).toContain(`${field}.${suffix}`)
			}
		}
		expect(rows[0]['messages.mean']).toBe('42')
		expect(rows[0]['pFoundGivenExists']).toBe(String(6 / 7))
		expect(rows[0]['foundCount']).toBe('6')
		expect(rows[0]['generator']).toBe('uniform')
	})

	it('expands the nested pruneReasons tally into pruneReasons.<reason> columns', () => {
		const { header, rows } = parseCsv(simRecordsToCsv([record]))
		for (const reason of ['cycle', 'failed', 'timed-out', 'max-depth', 'expired', 'no-reentrance']) {
			expect(header).toContain(`pruneReasons.${reason}`)
		}
		expect(rows[0]['pruneReasons.cycle']).toBe('2')
		expect(rows[0]['pruneReasons.max-depth']).toBe('4')
		expect(rows[0]['pruneReasons.no-reentrance']).toBe('3')
		expect(rows[0]['pruneReasons.timed-out']).toBe('0')
	})

	it('writes an empty cell for a non-finite metric', () => {
		const unbounded: SimRunRecord = {
			...record,
			metrics: { ...metrics, timeToFirstPlanMs: dist(1, Infinity) },
		}
		const { rows } = parseCsv(simRecordsToCsv([unbounded]))
		expect(rows[0]['timeToFirstPlanMs.mean']).toBe('')
	})

	it('builds the same CSV through the streaming accumulator as the one-shot helper', () => {
		const accumulator = createSimCsvAccumulator()
		accumulator.add(record)
		accumulator.add(otherRecord)
		expect(accumulator.toCsv()).toBe(simRecordsToCsv([record, otherRecord]))
	})
})
