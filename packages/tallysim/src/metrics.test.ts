import {
	summarizeClearingMetrics,
	summarizeDistribution,
	summarizePaymentMetrics,
	type ClearingQueryResult,
	type PaymentQueryResult,
} from './metrics.js'

describe('summarizeDistribution', () => {
	it('returns an all-zero summary with count 0 for an empty bag (no NaN)', () => {
		expect(summarizeDistribution([])).toEqual({ count: 0, mean: 0, min: 0, max: 0, p50: 0, p90: 0, p99: 0 })
	})

	it('summarises a single value as that value everywhere', () => {
		expect(summarizeDistribution([7])).toEqual({ count: 1, mean: 7, min: 7, max: 7, p50: 7, p90: 7, p99: 7 })
	})

	it('computes mean, extremes and interpolated quantiles, unaffected by input order', () => {
		const summary = summarizeDistribution([4, 1, 3, 2])
		expect(summary.count).toBe(4)
		expect(summary.mean).toBe(2.5)
		expect(summary.min).toBe(1)
		expect(summary.max).toBe(4)
		expect(summary.p50).toBe(2.5) // midpoint of [1,2,3,4]
	})

	it('does not mutate the caller array', () => {
		const values = [3, 1, 2]
		summarizeDistribution(values)
		expect(values).toEqual([3, 1, 2])
	})
})

describe('summarizePaymentMetrics', () => {
	const structural = { meanDegree: 2, largestComponentFraction: 0.8 }

	it('counts route existence and summarises path length over successful queries only', () => {
		const results: PaymentQueryResult[] = [
			{ exists: true, shortestLength: 2 },
			{ exists: false },
			{ exists: true, shortestLength: 4 },
			{ exists: true, shortestLength: 3 },
		]
		const metrics = summarizePaymentMetrics(results, structural)
		expect(metrics.queryCount).toBe(4)
		expect(metrics.routeExistsCount).toBe(3)
		expect(metrics.pRouteExists).toBeCloseTo(0.75)
		expect(metrics.meanDegree).toBe(2)
		expect(metrics.largestComponentFraction).toBe(0.8)
		expect(metrics.pathLength?.count).toBe(3)
		expect(metrics.pathLength?.mean).toBeCloseTo(3)
		expect(metrics.pathLength?.min).toBe(2)
		expect(metrics.pathLength?.max).toBe(4)
		expect(metrics.maxFlow).toBeUndefined()
	})

	it('guards divide-by-zero: no queries ⇒ P = 0 and an empty path-length summary', () => {
		const metrics = summarizePaymentMetrics([], structural)
		expect(metrics.pRouteExists).toBe(0)
		expect(metrics.routeExistsCount).toBe(0)
		expect(metrics.pathLength?.count).toBe(0)
	})

	it('includes a max-flow summary when sampled values are supplied', () => {
		const results: PaymentQueryResult[] = [{ exists: true, shortestLength: 1 }]
		const metrics = summarizePaymentMetrics(results, structural, [10, 20, 30])
		expect(metrics.maxFlow?.count).toBe(3)
		expect(metrics.maxFlow?.mean).toBeCloseTo(20)
	})
})

describe('summarizeClearingMetrics', () => {
	const structural = { meanDegree: 3, largestComponentFraction: 1 }

	it('computes availability and shortest-cycle distribution over nodes with a cycle', () => {
		const results: ClearingQueryResult[] = [
			{ hasCycle: true, shortestLength: 3 },
			{ hasCycle: false },
			{ hasCycle: true, shortestLength: 2 },
			{ hasCycle: false },
		]
		const metrics = summarizeClearingMetrics(results, structural)
		expect(metrics.sampledNodeCount).toBe(4)
		expect(metrics.clearingAvailability).toBeCloseTo(0.5)
		expect(metrics.clearingCycleLength?.count).toBe(2)
		expect(metrics.clearingCycleLength?.min).toBe(2)
		expect(metrics.clearingCycleLength?.max).toBe(3)
	})

	it('guards divide-by-zero: no sampled nodes ⇒ availability 0', () => {
		const metrics = summarizeClearingMetrics([], structural)
		expect(metrics.clearingAvailability).toBe(0)
		expect(metrics.clearingCycleLength?.count).toBe(0)
	})
})
