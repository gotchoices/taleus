/**
 * Metric aggregation: **raw per-query results in, a run summary out.** A pure module — no network, no
 * oracle, no filesystem — so it is testable with hand-built inputs and the runner can reuse it unchanged in
 * the browser. The runner (`runner.ts`) runs the oracle to produce the raw results, then calls one of the
 * summarisers here. See `docs/design.md` § Metrics.
 *
 * Every metric is guarded against the degenerate cases the runner can hand it (no queries, no successes, an
 * empty network): a fraction over zero trials is **0, never NaN**, and a distribution over zero samples
 * reports `count: 0` with zeroed scalars rather than throwing.
 */

/** A scalar summary of a set of numbers: count, mean, extremes, and three quantiles. */
export interface DistributionSummary {
	/** How many samples the summary is over. 0 ⇒ the other fields are 0 (no data). */
	count: number
	mean: number
	min: number
	max: number
	/** Median. */
	p50: number
	/** 90th percentile. */
	p90: number
	/** 99th percentile. */
	p99: number
}

/**
 * Per-run metrics. Which fields are present depends on the workload kind: `payment` fills the route-existence
 * and (opt-in) max-flow fields; `clearing` fills the clearing fields. `meanDegree` and
 * `largestComponentFraction` are structural and always present (one value per network).
 */
export interface RunMetrics {
	/** Number of queries the run drew. */
	queryCount: number
	/** Actual mean degree of the generated network (`2 · edges / entities`) — the headline x-axis. */
	meanDegree: number
	/** Largest-connected-component fraction of the network (reuses `structure.ts`). */
	largestComponentFraction: number
	/** `payment`: number of queries with a route within the depth bound. */
	routeExistsCount?: number
	/** `payment`: `routeExistsCount / queryCount` — the headline **P(route exists)** (0 if no queries). */
	pRouteExists?: number
	/** `payment`: distribution of shortest route length over the **successful** queries. */
	pathLength?: DistributionSummary
	/** `payment` + max-flow opt-in: distribution of max-flow over the sampled query pairs. */
	maxFlow?: DistributionSummary
	/** `clearing`: number of sampled nodes. */
	sampledNodeCount?: number
	/** `clearing`: fraction of sampled nodes with ≥ 1 usable cycle (0 if none sampled). */
	clearingAvailability?: number
	/** `clearing`: distribution of shortest cycle length over nodes that have a cycle. */
	clearingCycleLength?: DistributionSummary
}

/** One payment query's raw result, as the oracle returns it. */
export interface PaymentQueryResult {
	exists: boolean
	/** Shortest hop count; present iff `exists`. */
	shortestLength?: number
}

/** One clearing query's raw result at a sampled node. */
export interface ClearingQueryResult {
	/** Whether the node has ≥ 1 usable clearing cycle within the depth bound. */
	hasCycle: boolean
	/** Shortest qualifying cycle length; present iff `hasCycle`. */
	shortestLength?: number
}

/** Linear-interpolated quantile of an already-sorted ascending array. `q ∈ [0, 1]`. */
function quantileSorted(sorted: number[], q: number): number {
	if (sorted.length === 0) {
		return 0
	}
	if (sorted.length === 1) {
		return sorted[0]
	}
	const pos = q * (sorted.length - 1)
	const lo = Math.floor(pos)
	const hi = Math.ceil(pos)
	if (lo === hi) {
		return sorted[lo]
	}
	const frac = pos - lo
	return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

/**
 * Summarise a bag of numbers into a {@link DistributionSummary}. Copies and sorts (ascending) so the caller's
 * array is untouched and quantiles are exact. An empty bag yields an all-zero summary with `count: 0` — the
 * caller distinguishes "no data" by that count, never by a NaN.
 */
export function summarizeDistribution(values: readonly number[]): DistributionSummary {
	const count = values.length
	if (count === 0) {
		return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p90: 0, p99: 0 }
	}
	const sorted = [...values].sort((a, b) => a - b)
	let sum = 0
	for (const value of sorted) {
		sum += value
	}
	return {
		count,
		mean: sum / count,
		min: sorted[0],
		max: sorted[count - 1],
		p50: quantileSorted(sorted, 0.5),
		p90: quantileSorted(sorted, 0.9),
		p99: quantileSorted(sorted, 0.99),
	}
}

/** Structural metrics every run carries, independent of workload kind. */
export interface StructuralMetrics {
	meanDegree: number
	largestComponentFraction: number
}

/**
 * Summarise a payment workload: P(route exists) and the path-length distribution over successful queries,
 * plus the structural metrics and (when sampled) the max-flow distribution. `maxFlows` is `undefined` when
 * max-flow was not requested; an empty array means it was requested but no pairs were sampled.
 */
export function summarizePaymentMetrics(
	results: readonly PaymentQueryResult[],
	structural: StructuralMetrics,
	maxFlows?: readonly number[],
): RunMetrics {
	const queryCount = results.length
	let routeExistsCount = 0
	const successfulLengths: number[] = []
	for (const result of results) {
		if (result.exists) {
			routeExistsCount++
			if (result.shortestLength !== undefined) {
				successfulLengths.push(result.shortestLength)
			}
		}
	}
	const metrics: RunMetrics = {
		queryCount,
		meanDegree: structural.meanDegree,
		largestComponentFraction: structural.largestComponentFraction,
		routeExistsCount,
		pRouteExists: queryCount > 0 ? routeExistsCount / queryCount : 0,
		pathLength: summarizeDistribution(successfulLengths),
	}
	if (maxFlows !== undefined) {
		metrics.maxFlow = summarizeDistribution(maxFlows)
	}
	return metrics
}

/**
 * Summarise a clearing workload: the fraction of sampled nodes with ≥ 1 usable cycle, and the distribution
 * of shortest cycle length over nodes that have one, plus the structural metrics.
 */
export function summarizeClearingMetrics(
	results: readonly ClearingQueryResult[],
	structural: StructuralMetrics,
): RunMetrics {
	const sampledNodeCount = results.length
	let withCycle = 0
	const shortestLengths: number[] = []
	for (const result of results) {
		if (result.hasCycle) {
			withCycle++
			if (result.shortestLength !== undefined) {
				shortestLengths.push(result.shortestLength)
			}
		}
	}
	return {
		queryCount: sampledNodeCount,
		meanDegree: structural.meanDegree,
		largestComponentFraction: structural.largestComponentFraction,
		sampledNodeCount,
		clearingAvailability: sampledNodeCount > 0 ? withCycle / sampledNodeCount : 0,
		clearingCycleLength: summarizeDistribution(shortestLengths),
	}
}
