import type { RunRecord } from './runner.js'
import { parseJsonLine, recordToJsonLine, recordsToCsv, recordsToJsonLines } from './serialize-records.js'

const paymentRecord: RunRecord = {
	generator: 'uniform',
	capacity: 'unlimited',
	params: { 'network.params.meanDegree': 2, 'workload.depth': 4 },
	seed: 1,
	metrics: {
		queryCount: 10,
		meanDegree: 2,
		largestComponentFraction: 0.9,
		routeExistsCount: 7,
		pRouteExists: 0.7,
		pathLength: { count: 7, mean: 2.5, min: 1, max: 4, p50: 2, p90: 4, p99: 4 },
	},
}

const otherRecord: RunRecord = {
	generator: 'scale-free',
	capacity: 'uniform',
	params: { 'network.params.meanDegree': 3, 'workload.depth': 6 },
	seed: 2,
	metrics: {
		queryCount: 10,
		meanDegree: 4,
		largestComponentFraction: 1,
		routeExistsCount: 10,
		pRouteExists: 1,
		pathLength: { count: 10, mean: 1.8, min: 1, max: 3, p50: 2, p90: 3, p99: 3 },
	},
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
		expect(parseJsonLine(recordToJsonLine(paymentRecord))).toEqual(paymentRecord)
	})

	it('joins records newline-separated with no trailing newline', () => {
		const text = recordsToJsonLines([paymentRecord, otherRecord])
		const lines = text.split('\n')
		expect(lines).toHaveLength(2)
		expect(parseJsonLine(lines[1])).toEqual(otherRecord)
	})

	it('maps a non-finite number to JSON null', () => {
		const unbounded: RunRecord = {
			...paymentRecord,
			metrics: { ...paymentRecord.metrics, maxFlow: { count: 2, mean: Infinity, min: 5, max: Infinity, p50: Infinity, p90: Infinity, p99: Infinity } },
		}
		const parsed = parseJsonLine(recordToJsonLine(unbounded)) as unknown as { metrics: { maxFlow: { mean: number | null } } }
		expect(parsed.metrics.maxFlow.mean).toBeNull()
	})
})

describe('CSV summary', () => {
	it('emits a header and one row per record', () => {
		const { header, rows } = parseCsv(recordsToCsv([paymentRecord, otherRecord]))
		expect(rows).toHaveLength(2)
		expect(header.slice(0, 2)).toEqual(['generator', 'capacity'])
		// Varied param paths come after the two labels, sorted; then seed.
		expect(header).toContain('network.params.meanDegree')
		expect(header).toContain('workload.depth')
		expect(header.indexOf('network.params.meanDegree')).toBeLessThan(header.indexOf('workload.depth'))
		expect(header.indexOf('seed')).toBeLessThan(header.indexOf('pRouteExists'))
	})

	it('flattens a distribution into count/mean/min/max/p50/p90/p99 columns', () => {
		const { header, rows } = parseCsv(recordsToCsv([paymentRecord]))
		for (const suffix of ['count', 'mean', 'min', 'max', 'p50', 'p90', 'p99']) {
			expect(header).toContain(`pathLength.${suffix}`)
		}
		expect(rows[0]['pathLength.mean']).toBe('2.5')
		expect(rows[0]['pRouteExists']).toBe('0.7')
		expect(rows[0]['generator']).toBe('uniform')
	})

	it('writes an empty cell for a non-finite metric', () => {
		const unbounded: RunRecord = {
			...paymentRecord,
			metrics: { ...paymentRecord.metrics, maxFlow: { count: 1, mean: Infinity, min: Infinity, max: Infinity, p50: Infinity, p90: Infinity, p99: Infinity } },
		}
		const { rows } = parseCsv(recordsToCsv([unbounded]))
		expect(rows[0]['maxFlow.mean']).toBe('')
	})
})
