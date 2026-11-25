import type { TraceEvent } from 'tallynet'
import { buildGraphView } from '../graph-view.js'
import { FORMAT_VERSION, type Network, type Tally } from '../model.js'
import { Oracle } from '../oracle.js'
import type { SimScenario, SimSweepSpec, WorkloadSpec } from '../scenario.js'
import { buildSimNetwork, runQuery } from './harness.js'
import { analyzeQuery } from './protocol-metrics.js'
import { runSimSweep, runSimSweepToArray } from './sim-runner.js'

/** A materialised network from a tally list. */
function makeNetwork(entityCount: number, tallies: Tally[]): Network {
	return { entityCount, tallies, meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** A line `0 - 1 - … - (n-1)`: one tally per consecutive pair, ample symmetric credit, square balance. */
function line(n: number, limit = 1000): Network {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return makeNetwork(n, tallies)
}

/** Every distinct pair joined by one tally with a symmetric credit limit, square balance. */
function completeNetwork(n: number, limit: number): Network {
	const tallies: Tally[] = []
	for (let a = 0; a < n; a++) {
		for (let b = a + 1; b < n; b++) {
			tallies.push({ stock: a, foil: b, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
		}
	}
	return makeNetwork(n, tallies)
}

/** A network of `n` entities with no tallies (every entity isolated). */
function isolatedNetwork(n: number): Network {
	return makeNetwork(n, [])
}

/** A payment workload with sensible defaults, overridable per field. */
function payment(over: Partial<WorkloadSpec> = {}): WorkloadSpec {
	return { kind: 'payment', queries: 20, amount: { dist: 'constant', params: { value: 1 } }, depth: 3, seed: 7, ...over }
}

/** A single-cell sweep over a scenario (no vary, one seed). */
function sweepOf(scenario: SimScenario, seeds = [1]): SimSweepSpec {
	return { base: scenario, vary: [], seeds }
}

describe('runSimSweep — record shape and provenance', () => {
	it('yields one record per (cell × seed) with provenance resolved from the network source', async () => {
		const spec: SimSweepSpec = {
			base: {
				network: { generator: 'uniform', params: { entityCount: 20, meanDegree: 3 }, capacity: { kind: 'unlimited' }, seed: 100 },
				workload: payment({ queries: 10, depth: 4, seed: 200 }),
			},
			vary: [{ path: 'network.params.meanDegree', values: [2, 4] }],
			seeds: [1, 2],
		}
		const records = await runSimSweepToArray(spec)
		expect(records).toHaveLength(4) // 2 values × 2 seeds
		for (const record of records) {
			expect(record.generator).toBe('uniform')
			expect(record.capacity).toBe('unlimited')
			expect(typeof record.params['network.params.meanDegree']).toBe('number')
			expect([1, 2]).toContain(record.seed)
			expect(record.metrics.queryCount).toBe(10)
			expect(record.metrics.falseFoundCount).toBe(0)
		}
		expect(records.map((r) => r.params['network.params.meanDegree'])).toEqual([2, 2, 4, 4])
	})

	it('resolves provenance for a materialised network (generator from meta, capacity "materialized")', async () => {
		// Exactly as runner.ts does: a materialised network reports its meta.generator (here "test") and a
		// capacity of "materialized" (the concrete distribution is already baked into the tallies).
		const [record] = await runSimSweepToArray(sweepOf({ network: { materialized: completeNetwork(4, 1000) }, workload: payment() }))
		expect(record.generator).toBe('test')
		expect(record.capacity).toBe('materialized')
	})
})

describe('runSimSweep — single-route graph, ideal conditions (pFoundGivenExists = 1)', () => {
	it('a complete unlimited network finds every route the oracle confirms, with no false finds', async () => {
		const [record] = await runSimSweepToArray(sweepOf({ network: { materialized: completeNetwork(5, 1000) }, workload: payment({ queries: 20, depth: 3 }) }))
		const m = record.metrics
		expect(m.queryCount).toBe(20)
		expect(m.routeExistsCount).toBe(20) // every pair is a 1-hop route
		expect(m.foundCount).toBe(20)
		expect(m.foundAndExistsCount).toBe(20)
		expect(m.pFoundGivenExists).toBe(1)
		expect(m.falseFoundCount).toBe(0)
		expect(m.plansFound.min).toBeGreaterThanOrEqual(1)
	})

	it('a hand-traced 2-hop query reports messages/nodesTouched/roundsUsed from its real trace', async () => {
		// line(3) 0 - 1 - 2; the 2-hop route 0→2 at depth 3: one sub-query from the originator, resolved by a
		// peer-match at relay 1 (the target 2 never emits an event, so only nodes {0,1} are touched).
		const network = line(3)
		const events: TraceEvent[] = []
		const sim = buildSimNetwork(network, {}, 0, (event) => events.push(event))
		const startMs = sim.net.clock.now()
		const outcome = await runQuery(sim, { from: 0, to: 2, amount: 1, depth: 3 })
		const endMs = sim.net.clock.now()
		const routeExists = new Oracle(buildGraphView(network)).routeExistence(0, 2, 1, 3).exists
		const result = analyzeQuery(events, outcome, routeExists, { startMs, endMs })

		expect(result.found).toBe(true)
		expect(result.plansFound).toBe(1)
		expect(result.routeExists).toBe(true)
		expect(result.messages).toBe(1) // exactly one query-sent
		expect(result.nodesTouched).toBe(2) // nodes 0 and 1 only
		expect(result.roundsUsed).toBe(1)
		// The extracted message count equals the raw query-sent count — never deliveries.
		expect(result.messages).toBe(events.filter((event) => event.type === 'query-sent').length)
	})
})

describe('runSimSweep — found ⊆ oracle on a seeded graph', () => {
	it('every found query is an oracle-confirmed route (foundCount === foundAndExistsCount, no false finds)', async () => {
		const [record] = await runSimSweepToArray(
			sweepOf({
				network: { generator: 'uniform', params: { entityCount: 12, meanDegree: 4 }, capacity: { kind: 'uniform', min: 1, max: 10 }, seed: 99 },
				workload: payment({ queries: 20, depth: 5, amount: { dist: 'constant', params: { value: 2 } } }),
			}),
		)
		const m = record.metrics
		expect(m.falseFoundCount).toBe(0)
		expect(m.foundCount).toBe(m.foundAndExistsCount) // found ⊆ oracle ⇒ no found query lacks an oracle route
		expect(m.foundAndExistsCount).toBeLessThanOrEqual(m.routeExistsCount)
		expect(m.foundCount).toBeGreaterThan(0) // the graph is connected enough to route some queries
	})
})

describe('runSimSweep — the degradation gap (a sleeping relay)', () => {
	it('the protocol misses routes the undegraded oracle still confirms (0 < pFoundGivenExists < 1)', async () => {
		// line(4) 0-1-2-3 with sleepingFraction 0.25, conditionsSeed 0 ⇒ relay node 1 asleep (its incident
		// links drop), isolating {0} from {2,3}. The oracle runs on the undegraded line, so every pair is a
		// route; the protocol finds only the pairs within {2,3}, so a gap opens.
		const [record] = await runSimSweepToArray(
			sweepOf(
				{ network: { materialized: line(4) }, workload: payment({ queries: 20, depth: 6, seed: 1 }), conditions: { sleepingFraction: 0.25 }, conditionsSeed: 0 },
				[0], // runSeed 0 so the conditions seed stays 0 and selects node 1 (matches the harness test)
			),
		)
		const m = record.metrics
		expect(m.routeExistsCount).toBe(20) // the connected line routes every pair within depth 6
		expect(m.falseFoundCount).toBe(0)
		expect(m.foundCount).toBeLessThan(m.routeExistsCount) // the sleeping relay blocks some routes
		expect(m.foundCount).toBeGreaterThan(0) // pairs within {2,3} still route
		expect(m.pFoundGivenExists).toBeGreaterThan(0)
		expect(m.pFoundGivenExists).toBeLessThan(1)
	})

	it('a specific blocked query is routeExists=true but found=false', async () => {
		// The per-query facts behind the aggregate gap: 0→3 needs relay 1, which is asleep.
		const network = line(4)
		const events: TraceEvent[] = []
		const sim = buildSimNetwork(network, { sleepingFraction: 0.25 }, 0, (event) => events.push(event))
		const startMs = sim.net.clock.now()
		const outcome = await runQuery(sim, { from: 0, to: 3, amount: 1, depth: 6 })
		const endMs = sim.net.clock.now()
		const routeExists = new Oracle(buildGraphView(network)).routeExistence(0, 3, 1, 6).exists
		const result = analyzeQuery(events, outcome, routeExists, { startMs, endMs })
		expect(result.routeExists).toBe(true) // the undegraded oracle confirms the route
		expect(result.found).toBe(false) // the sleeping relay blocked the protocol
	})
})

describe('runSimSweep — a folded late answer is not double-counted', () => {
	it('with late-answer-folded events present, messages/roundsUsed read the sent/round counters only', async () => {
		// line(4) 0→3, every node late by 5000ms, depth 6: the search still completes, folding two late answers
		// into later rounds. Those folds must inflate neither the message count nor the round count.
		const network = line(4)
		const events: TraceEvent[] = []
		const sim = buildSimNetwork(network, { lateFraction: 1, lateLatencyMs: 5000 }, 0, (event) => events.push(event), { maxDepth: 6, sessionTtlMs: 600_000 })
		const startMs = sim.net.clock.now()
		const outcome = await runQuery(sim, { from: 0, to: 3, amount: 1, depth: 6 })
		const endMs = sim.net.clock.now()
		const result = analyzeQuery(events, outcome, true, { startMs, endMs })

		const rawQuerySent = events.filter((event) => event.type === 'query-sent').length
		const rawFolds = events.filter((event) => event.type === 'late-answer-folded').length
		const rawMaxRound = Math.max(
			0,
			...events
				.filter((event) => event.type === 'query-sent' || event.type === 'round-started')
				.map((event) => (event.type === 'query-sent' || event.type === 'round-started' ? event.round : 0)),
		)
		expect(rawFolds).toBeGreaterThan(0) // the scenario really does exercise the fold path
		expect(result.found).toBe(true)
		expect(result.messages).toBe(rawQuerySent) // not rawQuerySent + rawFolds
		expect(result.messages).toBe(3)
		expect(result.roundsUsed).toBe(rawMaxRound) // not raised by the folded answers
		expect(result.roundsUsed).toBe(4)
		expect(result.nodesTouched).toBe(3)
	})
})

describe('runSimSweep — concurrent and sequential agree, both deterministic', () => {
	const spec: SimSweepSpec = {
		base: { network: { materialized: completeNetwork(6, 1000) }, workload: payment({ queries: 15, depth: 4, seed: 3 }) },
		vary: [],
		seeds: [1, 2],
	}

	it('produces identical per-query metrics in both modes (≥ 2 originators)', async () => {
		const sequential = await runSimSweepToArray(spec)
		const concurrent = await runSimSweepToArray(spec, { concurrent: true })
		expect(JSON.stringify(concurrent)).toBe(JSON.stringify(sequential))
	})

	it('is byte-deterministic across two runs in each mode', async () => {
		expect(JSON.stringify(await runSimSweepToArray(spec))).toBe(JSON.stringify(await runSimSweepToArray(spec)))
		const first = JSON.stringify(await runSimSweepToArray(spec, { concurrent: true }))
		const second = JSON.stringify(await runSimSweepToArray(spec, { concurrent: true }))
		expect(second).toBe(first)
	})
})

describe('runSimSweep — degenerate guards (no NaN, no throw)', () => {
	it('zero queries: queryCount 0, pFoundGivenExists 0 (not NaN)', async () => {
		const [record] = await runSimSweepToArray(sweepOf({ network: { materialized: completeNetwork(5, 1000) }, workload: payment({ queries: 0 }) }))
		expect(record.metrics.queryCount).toBe(0)
		expect(record.metrics.pFoundGivenExists).toBe(0)
		expect(Number.isNaN(record.metrics.pFoundGivenExists)).toBe(false)
		expect(record.metrics.timeToCompletionMs.count).toBe(0)
	})

	it('zero existing routes (all-isolated, but ≥ 2 entities): pFoundGivenExists 0, no false finds', async () => {
		const [record] = await runSimSweepToArray(sweepOf({ network: { materialized: isolatedNetwork(5) }, workload: payment({ queries: 10 }) }))
		const m = record.metrics
		expect(m.queryCount).toBe(10)
		expect(m.routeExistsCount).toBe(0)
		expect(m.foundCount).toBe(0)
		expect(m.falseFoundCount).toBe(0)
		expect(m.pFoundGivenExists).toBe(0)
		expect(Number.isNaN(m.pFoundGivenExists)).toBe(false)
	})

	it('entityCount < 2: degenerate results, all zero, no throw', async () => {
		const [record] = await runSimSweepToArray(sweepOf({ network: { materialized: isolatedNetwork(1) }, workload: payment({ queries: 8 }) }))
		const m = record.metrics
		expect(m.queryCount).toBe(8)
		expect(m.routeExistsCount).toBe(0)
		expect(m.foundCount).toBe(0)
		expect(m.falseFoundCount).toBe(0)
		expect(m.pFoundGivenExists).toBe(0)
		expect(m.messages.max).toBe(0)
		expect(m.roundsUsed.max).toBe(0)
	})
})

describe('runSimSweep — validation', () => {
	it('rejects an empty seeds array', async () => {
		const spec = sweepOf({ network: { materialized: completeNetwork(3, 10) }, workload: payment() }, [])
		await expect(runSimSweepToArray(spec)).rejects.toThrow(/seeds/)
	})

	it('rejects a vary path into a materialised network (must target workload.*)', async () => {
		const spec: SimSweepSpec = {
			base: { network: { materialized: completeNetwork(3, 10) }, workload: payment() },
			vary: [{ path: 'network.params.meanDegree', values: [1] }],
			seeds: [1],
		}
		await expect(runSimSweepToArray(spec)).rejects.toThrow(/must target workload\.\* for a materialized network/)
	})

	it('rejects a vary dimension with no values', async () => {
		const spec: SimSweepSpec = {
			base: { network: { generator: 'uniform', params: { entityCount: 10, meanDegree: 2 }, capacity: { kind: 'unlimited' }, seed: 1 }, workload: payment() },
			vary: [{ path: 'workload.depth', values: [] }],
			seeds: [1],
		}
		await expect(runSimSweepToArray(spec)).rejects.toThrow(/non-empty values array/)
	})

	it('varies workload.depth over a materialised network (a legal materialised vary)', async () => {
		const spec: SimSweepSpec = {
			base: { network: { materialized: line(3) }, workload: payment({ queries: 6 }) },
			vary: [{ path: 'workload.depth', values: [1, 3] }],
			seeds: [1],
		}
		const records = []
		for await (const record of runSimSweep(spec)) {
			records.push(record)
		}
		expect(records).toHaveLength(2)
		// Depth 1 cannot reach a 2-hop route; depth 3 can — so the deeper cell finds at least as many.
		const [shallow, deep] = records
		expect(deep.metrics.foundCount).toBeGreaterThanOrEqual(shallow.metrics.foundCount)
	})
})
