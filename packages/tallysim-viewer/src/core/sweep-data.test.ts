import { simRecordsToCsv, simRecordsToJsonLines, type SimRunRecord } from 'tallysim'
import {
	alignSeries,
	defaultSelection,
	distributionFamilies,
	meanPerCell,
	parseSweepCsv,
	parseSweepJsonl,
	readSweepCsv,
	readSweepJsonl,
	rowsToSeries,
	type SweepColumn,
} from './sweep-data.js'

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

/** The role of a named column, or undefined if absent — a small helper for the role-agreement assertions. */
function roleOf(columns: readonly SweepColumn[], name: string): string | undefined {
	return columns.find((column) => column.name === name)?.role
}

describe('readSweepJsonl / readSweepCsv column description', () => {
	it('classifies every column the same way from JSON-lines and CSV', () => {
		const fromJsonl = readSweepJsonl(jsonl).columns
		const fromCsv = readSweepCsv(csv).columns
		for (const name of ['generator', 'capacity', 'seed', 'network.params.meanDegree', 'pFoundGivenExists', 'timeToFirstPlanMs.mean']) {
			expect(roleOf(fromJsonl, name)).toBe(roleOf(fromCsv, name))
		}
		expect(roleOf(fromJsonl, 'generator')).toBe('dimension')
		expect(roleOf(fromJsonl, 'network.params.meanDegree')).toBe('param')
		expect(roleOf(fromJsonl, 'seed')).toBe('seed')
		expect(roleOf(fromJsonl, 'pFoundGivenExists')).toBe('metric')
		expect(roleOf(fromJsonl, 'timeToFirstPlanMs.mean')).toBe('metric')
	})

	it('marks a swept column varied and a constant one not', () => {
		const columns = readSweepJsonl(jsonl).columns
		const column = (name: string): SweepColumn | undefined => columns.find((c) => c.name === name)
		expect(column('network.params.meanDegree')?.varied).toBe(true) // 2 and 4
		expect(column('generator')?.varied).toBe(true) // uniform and scale-free
		expect(column('capacity')?.varied).toBe(false) // always constant
	})

	it('groups DistributionSummary columns into families, excluding numeric tallies', () => {
		const families = distributionFamilies(readSweepJsonl(jsonl).columns)
		expect(families.map((f) => f.family)).toEqual(['timeToFirstPlanMs'])
		expect(families[0].countColumn).toBe('timeToFirstPlanMs.count')
		expect(families[0].subFields).toContain('mean')
	})
})

describe('defaultSelection', () => {
	it('defaults x to the swept param, y to a headline metric, series to the dimensions', () => {
		const selection = defaultSelection(readSweepJsonl(jsonl))
		expect(selection.xColumn).toBe('network.params.meanDegree')
		expect(selection.metricColumn).toBe('pFoundGivenExists')
		// Dimensions come out alphabetically; the swept param is the x-axis so it is not also a series split.
		expect(selection.seriesBy).toEqual(['capacity', 'generator'])
	})
})

describe('rowsToSeries count-zero gap guard', () => {
	// A distribution with no samples serialises as count:0 with every scalar a finite 0 (summarizeDistribution's
	// contract) — so d.mean is a plottable 0 unless the count guard turns the cell into a gap.
	const gapRecords = [
		{ generator: 'u', capacity: 'c', seed: 1, params: { x: 1 }, metrics: { d: { count: 3, mean: 10, min: 5, max: 15, p50: 10, p90: 14, p99: 15 } } },
		{ generator: 'u', capacity: 'c', seed: 1, params: { x: 2 }, metrics: { d: { count: 0, mean: 0, min: 0, max: 0, p50: 0, p90: 0, p99: 0 } } },
	] as unknown as SimRunRecord[]
	const rows = parseSweepJsonl(simRecordsToJsonLines(gapRecords))

	it('drops a count:0 cell even though its mean is a finite 0', () => {
		const guarded = rowsToSeries(rows, { xColumn: 'x', metricColumn: 'd.mean', gapWhenZeroColumn: 'd.count' })
		expect(guarded).toEqual([{ seriesKey: '', points: [{ x: 1, y: 10 }] }])
	})

	it('without the guard the count:0 cell would wrongly plot as y=0 (why the guard exists)', () => {
		const unguarded = rowsToSeries(rows, { xColumn: 'x', metricColumn: 'd.mean' })
		expect(unguarded).toEqual([{ seriesKey: '', points: [{ x: 1, y: 10 }, { x: 2, y: 0 }] }])
	})
})

describe('meanPerCell / alignSeries', () => {
	it('averages repeated-seed points to one mean per (series, x) cell', () => {
		const series = [{ seriesKey: 's', points: [{ x: 1, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 30 }] }]
		expect(meanPerCell(series)).toEqual([{ seriesKey: 's', points: [{ x: 1, y: 15 }, { x: 2, y: 30 }] }])
	})

	it('aligns series onto a shared x-axis, filling a missing point with null (a line gap, never 0)', () => {
		const series = [
			{ seriesKey: 'a', points: [{ x: 1, y: 1 }, { x: 3, y: 3 }] },
			{ seriesKey: 'b', points: [{ x: 2, y: 2 }, { x: 3, y: 9 }] },
		]
		expect(alignSeries(series)).toEqual({
			x: [1, 2, 3],
			columns: [
				{ seriesKey: 'a', y: [1, null, 3] },
				{ seriesKey: 'b', y: [null, 2, 9] },
			],
		})
	})
})
