import {
	CLUSTERED_ID,
	SCALE_FREE_ID,
	SMALL_WORLD_ID,
	UNIFORM_ID,
	type CapacityDistribution,
	type ConditionsSpec,
} from 'tallysim'
import {
	DEFAULT_RUN_SEED,
	buildLiveRun,
	buildNetworkSource,
	buildQuery,
	buildScenario,
	buildWorkload,
	generatorIdOf,
	type LiveRunParams,
} from './build-scenario.js'

const UNLIMITED: CapacityDistribution = { kind: 'unlimited' }

/** A complete, runnable set of form values (scale-free, unlimited capacity); override any field per test. */
function baseParams(overrides: Partial<LiveRunParams> = {}): LiveRunParams {
	return {
		generator: 'scale-free',
		entityCount: 50,
		generatorParams: { edgesPerNode: 3 },
		capacity: UNLIMITED,
		seed: 7,
		amount: 100,
		depth: 6,
		...overrides,
	}
}

describe('buildNetworkSource', () => {
	it('folds entityCount into params beside the generator numeric (scale-free)', () => {
		const source = buildNetworkSource(baseParams())
		expect(source).toEqual({
			generator: 'scale-free',
			params: { entityCount: 50, edgesPerNode: 3 },
			capacity: UNLIMITED,
			seed: 7,
		})
	})

	it('passes an unlimited capacity through verbatim (the ∞ case)', () => {
		expect(buildNetworkSource(baseParams({ capacity: { kind: 'unlimited' } }))).toEqual({
			generator: 'scale-free',
			params: { entityCount: 50, edgesPerNode: 3 },
			capacity: { kind: 'unlimited' },
			seed: 7,
		})
	})

	it('passes a finite (lognormal) capacity through verbatim', () => {
		const capacity: CapacityDistribution = { kind: 'lognormal', mu: 4, sigma: 1 }
		expect(buildNetworkSource(baseParams({ capacity }))).toEqual({
			generator: 'scale-free',
			params: { entityCount: 50, edgesPerNode: 3 },
			capacity,
			seed: 7,
		})
	})
})

describe('buildWorkload', () => {
	it('builds the nominal single-query constant-amount payment workload at run seed 0', () => {
		const workload = buildWorkload(baseParams({ amount: 100, depth: 6 }))
		expect(workload).toEqual({
			kind: 'payment',
			queries: 1,
			amount: { dist: 'constant', params: { value: 100 } },
			depth: 6,
			seed: 0,
		})
	})
})

describe('buildScenario', () => {
	it('omits conditions, conditionsSeed and budget when absent', () => {
		const params = baseParams()
		const scenario = buildScenario(params)
		expect(scenario).toEqual({
			network: buildNetworkSource(params),
			workload: buildWorkload(params),
		})
		// Guard the optional keys are truly absent (not present-and-undefined), so a trace header stays clean.
		expect('conditions' in scenario).toBe(false)
		expect('conditionsSeed' in scenario).toBe(false)
		expect('budget' in scenario).toBe(false)
	})

	it('includes conditions, conditionsSeed and budget when present (ConditionsSpec round-trips)', () => {
		const conditions: ConditionsSpec = {
			latency: { kind: 'constant', value: 50 },
			dropFraction: 0.1,
			sleepingFraction: 0.05,
			lateFraction: 0.02,
			lateLatencyMs: 2000,
		}
		const scenario = buildScenario(
			baseParams({ conditions, conditionsSeed: 9, budget: { initialBudgetMs: 1000, perHopBudgetMs: 200 } }),
		)
		expect(scenario.conditions).toEqual(conditions)
		expect(scenario.conditionsSeed).toBe(9)
		expect(scenario.budget).toEqual({ initialBudgetMs: 1000, perHopBudgetMs: 200 })
	})
})

describe('buildQuery', () => {
	it('throws until both a payer and a payee are picked', () => {
		expect(() => buildQuery(baseParams())).toThrow()
		expect(() => buildQuery(baseParams({ from: 1 }))).toThrow()
		expect(() => buildQuery(baseParams({ to: 2 }))).toThrow()
	})

	it('returns { from, to, amount, depth } once both are picked', () => {
		const query = buildQuery(baseParams({ from: 1, to: 2, amount: 100, depth: 6 }))
		expect(query).toEqual({ from: 1, to: 2, amount: 100, depth: 6 })
	})

	it('allows from === to (a self-payment / closed clearing loop)', () => {
		const query = buildQuery(baseParams({ from: 3, to: 3 }))
		expect(query).toEqual({ from: 3, to: 3, amount: 100, depth: 6 })
	})
})

describe('generatorIdOf', () => {
	it('maps each form generator id to its canonical tallysim constant', () => {
		expect(generatorIdOf('uniform')).toBe(UNIFORM_ID)
		expect(generatorIdOf('scale-free')).toBe(SCALE_FREE_ID)
		expect(generatorIdOf('clustered')).toBe(CLUSTERED_ID)
		expect(generatorIdOf('small-world')).toBe(SMALL_WORLD_ID)
	})

	it('keeps the form id strings in lock-step with the tallysim constants', () => {
		// The form's GeneratorId strings ARE the tallysim ids; this guard fails loudly if either side drifts.
		expect(UNIFORM_ID).toBe('uniform')
		expect(SCALE_FREE_ID).toBe('scale-free')
		expect(CLUSTERED_ID).toBe('clustered')
		expect(SMALL_WORLD_ID).toBe('small-world')
	})
})

describe('buildLiveRun', () => {
	it('bundles the scenario, the query, and the fixed run seed (0)', () => {
		const params = baseParams({ from: 1, to: 2 })
		const run = buildLiveRun(params)
		expect(run.scenario).toEqual(buildScenario(params))
		expect(run.query).toEqual(buildQuery(params))
		expect(run.runSeed).toBe(DEFAULT_RUN_SEED)
		expect(run.runSeed).toBe(0)
	})
})
