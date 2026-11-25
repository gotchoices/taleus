import { simRecordsToCsv, simRecordsToJsonLines, type SimRunRecord } from 'tallysim'
import { parseSweepCsv, parseSweepJsonl, rowsToSeries } from './sweep-data.js'

// Three hand-built runs. The second run's time-to-first-plan is non-finite (no plan was ever found), which
// the serialisers write as JSON `null` / an empty CSV cell.
const records: SimRunRecord[] = [
	{
		generator: 'uniform',
		capacity: 'constant',
		seed: 1,
		params: { 'network.params.meanDegree': 2 },
		metrics: {
			routeExistsCount: 5,
			pFoundGivenExists: 0.5,
			timeToFirstPlanMs: { count: 3, mean: 10, min: 5, max: 15, p50: 10, p90: 14, p99: 15 },
		},
	},
	{
		generator: 'uniform',
		capacity: 'constant',
		seed: 1,
		params: { 'network.params.meanDegree': 4 },
		metrics: {
			routeExistsCount: 8,
			pFoundGivenExists: 0.8,
			timeToFirstPlanMs: { count: 0, mean: Infinity, min: Infinity, max: Infinity, p50: Infinity, p90: Infinity, p99: Infinity },
		},
	},
	{
		generator: 'scale-free',
		capacity: 'constant',
		seed: 1,
		params: { 'network.params.meanDegree': 2 },
		metrics: {
			routeExistsCount: 6,
			pFoundGivenExists: 0.6,
			timeToFirstPlanMs: { count: 2, mean: 20, min: 18, max: 22, p50: 20, p90: 21, p99: 22 },
		},
	},
	// The real ProtocolRunMetrics has more fields; a partial payload exercises the flattener fine.
] as unknown as SimRunRecord[]

const jsonl = simRecordsToJsonLines(records)
const csv = simRecordsToCsv(records)

describe('parseSweepJsonl / parseSweepCsv → rowsToSeries', () => {
	it('produces identical series from JSON-lines and CSV for a finite metric', () => {
		const spec = { xColumn: 'network.params.meanDegree', metricColumn: 'pFoundGivenExists', seriesBy: ['generator', 'capacity'] }
		const fromJsonl = rowsToSeries(parseSweepJsonl(jsonl), spec)
		const fromCsv = rowsToSeries(parseSweepCsv(csv), spec)

		expect(fromJsonl).toEqual(fromCsv)
		expect(fromJsonl).toEqual([
			{ seriesKey: 'generator=scale-free,capacity=constant', points: [{ x: 2, y: 0.6 }] },
			{ seriesKey: 'generator=uniform,capacity=constant', points: [{ x: 2, y: 0.5 }, { x: 4, y: 0.8 }] },
		])
	})

	it('reads a non-finite (null/empty) metric as absent, not zero', () => {
		const spec = { xColumn: 'network.params.meanDegree', metricColumn: 'timeToFirstPlanMs.mean', seriesBy: ['generator'] }
		const fromJsonl = rowsToSeries(parseSweepJsonl(jsonl), spec)
		const fromCsv = rowsToSeries(parseSweepCsv(csv), spec)

		expect(fromJsonl).toEqual(fromCsv)
		// The uniform meanDegree=4 run (mean = Infinity) is omitted — only the finite meanDegree=2 point remains.
		expect(fromJsonl).toEqual([
			{ seriesKey: 'generator=scale-free', points: [{ x: 2, y: 20 }] },
			{ seriesKey: 'generator=uniform', points: [{ x: 2, y: 10 }] },
		])
	})

	it('parses quoted CSV fields (commas and escaped quotes) correctly', () => {
		const text = ['generator,capacity,seed', '"a,b","c""d",1'].join('\n')
		const rows = parseSweepCsv(text)
		expect(rows).toHaveLength(1)
		expect(rows[0].get('generator')).toBe('a,b')
		expect(rows[0].get('capacity')).toBe('c"d')
		expect(rows[0].get('seed')).toBe(1)
	})
})
