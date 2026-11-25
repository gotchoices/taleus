import { FORMAT_VERSION, type Network, type Tally } from './model.js'
import { Oracle } from './oracle.js'
import { runSweep, runSweepToArray } from './runner.js'
import type { EconomyStep, ScenarioSpec, SweepSpec } from './scenario.js'
import { recordsToJsonLines } from './serialize-records.js'

/** A materialised network: every distinct pair joined by one tally with the given symmetric credit limit. */
function completeNetwork(entityCount: number, limit: number): Network {
	const tallies: Tally[] = []
	for (let a = 0; a < entityCount; a++) {
		for (let b = a + 1; b < entityCount; b++) {
			tallies.push({ stock: a, foil: b, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
		}
	}
	return { entityCount, tallies, meta: { generator: 'test-complete', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** A materialised network of `entityCount` entities with no tallies (every entity isolated). */
function isolatedNetwork(entityCount: number): Network {
	return { entityCount, tallies: [], meta: { generator: 'test-isolated', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** A payment sweep over a single materialised network (no vary; one seed), for metrics assertions. */
function paymentSweepOver(network: Network, overrides: Partial<ScenarioSpec['workload']> = {}): SweepSpec {
	const base: ScenarioSpec = {
		network: { materialized: network },
		workload: { kind: 'payment', queries: 20, amount: { dist: 'constant', params: { value: 1 } }, depth: 3, seed: 7, ...overrides },
	}
	return { base, vary: [], seeds: [1] }
}

describe('runSweep — record shape', () => {
	it('yields one record per (cell × seed) with the documented fields and resolved coordinates', () => {
		const spec: SweepSpec = {
			base: {
				network: { generator: 'uniform', params: { entityCount: 50, meanDegree: 2 }, capacity: { kind: 'unlimited' }, seed: 100 },
				workload: { kind: 'payment', queries: 30, amount: { dist: 'constant', params: { value: 1 } }, depth: 4, seed: 200 },
			},
			vary: [{ path: 'network.params.meanDegree', values: [1, 3] }],
			seeds: [1, 2],
		}
		const records = runSweepToArray(spec)
		expect(records).toHaveLength(4) // 2 values × 2 seeds
		for (const record of records) {
			expect(record.generator).toBe('uniform')
			expect(record.capacity).toBe('unlimited')
			expect(typeof record.params['network.params.meanDegree']).toBe('number')
			expect([1, 2]).toContain(record.seed)
			expect(record.metrics.queryCount).toBe(30)
			expect(typeof record.metrics.pRouteExists).toBe('number')
			expect(typeof record.metrics.meanDegree).toBe('number')
		}
		expect(records.map((r) => r.params['network.params.meanDegree'])).toEqual([1, 1, 3, 3])
	})
})

describe('runSweep — determinism', () => {
	it('produces byte-identical JSON-lines across two runs of the same spec', () => {
		const spec: SweepSpec = {
			base: {
				network: { generator: 'scale-free', params: { entityCount: 80, edgesPerNode: 2 }, capacity: { kind: 'uniform', min: 5, max: 20 }, seed: 11 },
				workload: { kind: 'payment', queries: 25, amount: { dist: 'uniform', params: { min: 1, max: 5 } }, depth: 5, seed: 22 },
			},
			vary: [{ path: 'network.params.edgesPerNode', values: [2, 3] }],
			seeds: [1, 2, 3],
		}
		const first = recordsToJsonLines(runSweepToArray(spec))
		const second = recordsToJsonLines(runSweepToArray(spec))
		expect(second).toBe(first)
	})

	it('honours independent network and workload seeds (same cell, different seed ⇒ different draw)', () => {
		const spec: SweepSpec = {
			base: {
				network: { generator: 'uniform', params: { entityCount: 60, meanDegree: 1 }, capacity: { kind: 'unlimited' }, seed: 1 },
				workload: { kind: 'payment', queries: 40, amount: { dist: 'constant', params: { value: 1 } }, depth: 3, seed: 1 },
			},
			vary: [],
			seeds: [1, 2],
		}
		const [a, b] = runSweepToArray(spec)
		// Different run seeds offset both streams, so the generated network differs → metrics differ.
		expect(a.metrics.meanDegree === b.metrics.meanDegree && a.metrics.pRouteExists === b.metrics.pRouteExists).toBe(false)
	})
})

describe('runSweep — metrics correctness (cross-checked against the oracle)', () => {
	it('a complete unlimited network routes every query (P = 1, 1-hop paths)', () => {
		const network = completeNetwork(5, Infinity)
		// Direct oracle sanity: any pair is a 1-hop route.
		expect(Oracle.fromNetwork(network).routeExistence(0, 1, 1, 1)).toEqual({ exists: true, shortestLength: 1 })

		const [record] = runSweepToArray(paymentSweepOver(network))
		expect(record.metrics.pRouteExists).toBe(1)
		expect(record.metrics.pathLength?.mean).toBe(1)
		expect(record.metrics.largestComponentFraction).toBe(1)
		expect(record.metrics.meanDegree).toBe((2 * 10) / 5) // 10 tallies, 5 entities
	})

	it('an all-isolated network routes nothing (P = 0, not NaN; CC fraction = 1/n)', () => {
		const network = isolatedNetwork(5)
		const [record] = runSweepToArray(paymentSweepOver(network))
		expect(record.metrics.pRouteExists).toBe(0)
		expect(Number.isNaN(record.metrics.pRouteExists)).toBe(false)
		expect(record.metrics.pathLength?.count).toBe(0)
		expect(record.metrics.largestComponentFraction).toBeCloseTo(1 / 5)
		expect(record.metrics.meanDegree).toBe(0)
	})

	it('a one-entity network routes nothing without throwing (no distinct pair)', () => {
		const [record] = runSweepToArray(paymentSweepOver(isolatedNetwork(1)))
		expect(record.metrics.pRouteExists).toBe(0)
		expect(record.metrics.queryCount).toBe(20)
	})
})

describe('runSweep — multi-parameter sweeps', () => {
	it('a two-parameter sweep yields one record per (valueA, valueB, seed) cell', () => {
		const spec: SweepSpec = {
			base: {
				network: { generator: 'uniform', params: { entityCount: 40, meanDegree: 2 }, capacity: { kind: 'unlimited' }, seed: 1 },
				workload: { kind: 'payment', queries: 10, amount: { dist: 'constant', params: { value: 1 } }, depth: 3, seed: 1 },
			},
			vary: [
				{ path: 'network.params.meanDegree', values: [1, 2] },
				{ path: 'workload.depth', values: [2, 4, 6] },
			],
			seeds: [1, 2],
		}
		const records = runSweepToArray(spec)
		expect(records).toHaveLength(2 * 3 * 2)
		for (const record of records) {
			expect(record.params).toHaveProperty(['network.params.meanDegree'])
			expect(record.params).toHaveProperty(['workload.depth'])
		}
	})

	it('generalises beyond two dimensions (three varied params)', () => {
		const spec: SweepSpec = {
			base: {
				network: { generator: 'uniform', params: { entityCount: 30, meanDegree: 2 }, capacity: { kind: 'unlimited' }, seed: 1 },
				workload: { kind: 'payment', queries: 5, amount: { dist: 'constant', params: { value: 1 } }, depth: 3, seed: 1 },
			},
			vary: [
				{ path: 'network.params.entityCount', values: [20, 40] },
				{ path: 'network.params.meanDegree', values: [1, 2] },
				{ path: 'workload.depth', values: [2, 4] },
			],
			seeds: [1],
		}
		expect(runSweepToArray(spec)).toHaveLength(2 * 2 * 2)
	})
})

describe('runSweep — max-flow opt-in', () => {
	it('samples up to maxFlowSamples pairs when the metric is requested', () => {
		const network = completeNetwork(6, 50) // finite capacity ⇒ finite max-flow
		const spec = paymentSweepOver(network, { queries: 20, metrics: ['max-flow'], maxFlowSamples: 4 })
		const [record] = runSweepToArray(spec)
		expect(record.metrics.maxFlow?.count).toBe(4)
		expect(record.metrics.maxFlow?.mean).toBeGreaterThan(0)
		expect(Number.isFinite(record.metrics.maxFlow?.mean ?? Infinity)).toBe(true)
	})

	it('omits max-flow by default', () => {
		const [record] = runSweepToArray(paymentSweepOver(completeNetwork(5, 50)))
		expect(record.metrics.maxFlow).toBeUndefined()
	})
})

describe('runSweep — clearing workload', () => {
	it('reports clearing availability on a network with cycles', () => {
		const network = completeNetwork(4, 10) // K4 is rich in directed cycles
		const spec: SweepSpec = {
			base: {
				network: { materialized: network },
				workload: { kind: 'clearing', queries: 10, amount: { dist: 'constant', params: { value: 1 } }, depth: 4, seed: 3 },
			},
			vary: [],
			seeds: [1],
		}
		const [record] = runSweepToArray(spec)
		expect(record.metrics.sampledNodeCount).toBe(10)
		expect(record.metrics.clearingAvailability).toBeGreaterThan(0)
		expect(record.metrics.clearingCycleLength?.min).toBeGreaterThanOrEqual(2)
	})
})

describe('runSweep — economy seam', () => {
	it('calls the injected economy step once per run, before queries', () => {
		const calls: number[] = []
		const spy: EconomyStep = { step: (network) => calls.push(network.entityCount) }
		const spec: SweepSpec = {
			base: {
				network: { generator: 'uniform', params: { entityCount: 20, meanDegree: 2 }, capacity: { kind: 'unlimited' }, seed: 1 },
				workload: { kind: 'payment', queries: 5, amount: { dist: 'constant', params: { value: 1 } }, depth: 3, seed: 1 },
			},
			vary: [{ path: 'network.params.meanDegree', values: [1, 2] }],
			seeds: [1, 2],
		}
		runSweepToArray(spec, { economyStep: spy })
		expect(calls).toHaveLength(4) // once per (cell × seed)
		expect(calls.every((count) => count === 20)).toBe(true)
	})

	it('an economy step that zeroes capacity drops route existence to 0', () => {
		const zeroing: EconomyStep = {
			step: (network) => {
				for (const tally of network.tallies) {
					// Push the balance to the stock bound: cap(foil→stock)=0 and cap(stock→foil)=total swing,
					// but set both limits to 0 so every directed capacity is 0.
					tally.stockCreditLimit = 0
					tally.foilCreditLimit = 0
					tally.balance = 0
				}
			},
		}
		const spec = paymentSweepOver(completeNetwork(5, 10))
		const [withZeroing] = runSweepToArray(spec, { economyStep: zeroing })
		expect(withZeroing.metrics.pRouteExists).toBe(0)
	})
})

describe('runSweep — error handling', () => {
	it('rejects a vary path into a materialised network (must target workload.*)', () => {
		const spec: SweepSpec = {
			base: {
				network: { materialized: isolatedNetwork(3) },
				workload: { kind: 'payment', queries: 1, amount: { dist: 'constant', params: { value: 1 } }, depth: 1, seed: 1 },
			},
			vary: [{ path: 'network.params.meanDegree', values: [1] }],
			seeds: [1],
		}
		expect(() => runSweepToArray(spec)).toThrow(/path "network.params.meanDegree"/)
	})

	it('rejects a vary path reaching into a materialised network (would mutate the shared network)', () => {
		const spec: SweepSpec = {
			base: {
				network: { materialized: isolatedNetwork(3) },
				workload: { kind: 'payment', queries: 1, amount: { dist: 'constant', params: { value: 1 } }, depth: 1, seed: 1 },
			},
			vary: [{ path: 'network.materialized.entityCount', values: [5] }],
			seeds: [1],
		}
		expect(() => runSweepToArray(spec)).toThrow(/must target workload\.\* for a materialized network/)
	})

	it('rejects an empty seeds array', () => {
		const spec: SweepSpec = {
			base: {
				network: { generator: 'uniform', params: { entityCount: 10, meanDegree: 1 }, capacity: { kind: 'unlimited' }, seed: 1 },
				workload: { kind: 'payment', queries: 1, amount: { dist: 'constant', params: { value: 1 } }, depth: 1, seed: 1 },
			},
			vary: [],
			seeds: [],
		}
		expect(() => [...runSweep(spec)]).toThrow(/seeds/)
	})
})
