import { FORMAT_VERSION, type Network, type Tally } from '../model.js'
import { compileConditions, compileConsensusConditions, type ConditionsSpec } from './conditions.js'
import { linkIdForTally } from './naming.js'

/** A line network `0 - 1 - … - (n-1)` with one tally per consecutive pair, symmetric credit limits. */
function lineNetwork(n: number, limit = 100): Network {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return { entityCount: n, tallies, meta: { generator: 'test-line', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** True iff a tally index's incident endpoints include a given entity. */
function incident(network: Network, index: number, entity: number): boolean {
	const t = network.tallies[index]
	return t.stock === entity || t.foil === entity
}

describe('compileConditions — determinism', () => {
	it('same (network, spec, seed) ⇒ identical conditions and sleeping/late sets', () => {
		const network = lineNetwork(10)
		const spec: ConditionsSpec = { latency: { kind: 'uniform', min: 10, max: 50 }, sleepingFraction: 0.3, lateFraction: 0.2, lateLatencyMs: 5000, dropFraction: 0.2 }
		const a = compileConditions(network, spec, 42)
		const b = compileConditions(network, spec, 42)
		expect(a.conditions).toEqual(b.conditions)
		expect([...a.sleeping].sort((x, y) => x - y)).toEqual([...b.sleeping].sort((x, y) => x - y))
		expect([...a.late].sort((x, y) => x - y)).toEqual([...b.late].sort((x, y) => x - y))
	})

	it('a different seed generally changes the selection', () => {
		const network = lineNetwork(20)
		const spec: ConditionsSpec = { sleepingFraction: 0.3 }
		const a = compileConditions(network, spec, 1)
		const b = compileConditions(network, spec, 2)
		expect([...a.sleeping].sort((x, y) => x - y)).not.toEqual([...b.sleeping].sort((x, y) => x - y))
	})
})

describe('compileConditions — count-based selection', () => {
	it('selects exactly round(fraction · entityCount) sleeping nodes', () => {
		const network = lineNetwork(10)
		expect(compileConditions(network, { sleepingFraction: 0.3 }, 7).sleeping.size).toBe(3) // round(3.0)
		expect(compileConditions(network, { sleepingFraction: 0.25 }, 7).sleeping.size).toBe(3) // round(2.5) → 3
		expect(compileConditions(network, { sleepingFraction: 0 }, 7).sleeping.size).toBe(0)
		expect(compileConditions(network, { sleepingFraction: 1 }, 7).sleeping.size).toBe(10)
	})

	it('selects exactly round(fraction · entityCount) late nodes, independently of sleeping', () => {
		const network = lineNetwork(10)
		expect(compileConditions(network, { lateFraction: 0.2, lateLatencyMs: 5000 }, 7).late.size).toBe(2) // round(2.0)
		expect(compileConditions(network, { lateFraction: 0.25, lateLatencyMs: 5000 }, 7).late.size).toBe(3) // round(2.5) → 3
		expect(compileConditions(network, { lateFraction: 0 }, 7).late.size).toBe(0)
		// Drawn over all entities independently of sleeping — a full late fraction selects every node even when
		// some are also sleeping (resolution lets sleeping win per link, but the late SET still reports them).
		expect(compileConditions(network, { sleepingFraction: 0.5, lateFraction: 1, lateLatencyMs: 5000 }, 7).late.size).toBe(10)
	})
})

describe('compileConditions — incidence and precedence', () => {
	it('every link incident to a sleeping node drops', () => {
		const network = lineNetwork(10)
		const { conditions, sleeping } = compileConditions(network, { sleepingFraction: 0.3 }, 7)
		for (let i = 0; i < network.tallies.length; i++) {
			const touchesSleeper = [...sleeping].some((entity) => incident(network, i, entity))
			if (touchesSleeper) {
				expect(conditions[linkIdForTally(i)]).toEqual({ drop: true })
			}
		}
	})

	it('sleeping wins over late: with every node both sleeping and late, every link drops (none late-latency)', () => {
		const network = lineNetwork(6)
		const spec: ConditionsSpec = { sleepingFraction: 1, lateFraction: 1, lateLatencyMs: 5000 }
		const { conditions } = compileConditions(network, spec, 7)
		for (let i = 0; i < network.tallies.length; i++) {
			expect(conditions[linkIdForTally(i)]).toEqual({ drop: true })
		}
	})

	it('late nodes (no sleeping) make every incident link carry the late latency', () => {
		const network = lineNetwork(6)
		const { conditions } = compileConditions(network, { lateFraction: 1, lateLatencyMs: 4000 }, 7)
		for (let i = 0; i < network.tallies.length; i++) {
			expect(conditions[linkIdForTally(i)]).toEqual({ latencyMs: 4000 })
		}
	})

	it('dropFraction over clean links, then base latency on the rest', () => {
		const network = lineNetwork(10)
		const dropAll = compileConditions(network, { dropFraction: 1 }, 7)
		for (let i = 0; i < network.tallies.length; i++) {
			expect(dropAll.conditions[linkIdForTally(i)]).toEqual({ drop: true })
		}
		const baseOnly = compileConditions(network, { latency: { kind: 'constant', value: 25 } }, 7)
		for (let i = 0; i < network.tallies.length; i++) {
			expect(baseOnly.conditions[linkIdForTally(i)]).toEqual({ latencyMs: 25 })
		}
	})

	it('an empty spec imposes no conditions', () => {
		const network = lineNetwork(5)
		const { conditions, sleeping } = compileConditions(network, {}, 7)
		expect(Object.keys(conditions)).toHaveLength(0)
		expect(sleeping.size).toBe(0)
	})
})

describe('compileConsensusConditions — refuser selection', () => {
	it('selects exactly round(refuserFraction · entityCount) refusers', () => {
		const network = lineNetwork(10)
		expect(compileConsensusConditions(network, { refuserFraction: 0.3 }, 7).refusers.size).toBe(3) // round(3.0)
		expect(compileConsensusConditions(network, { refuserFraction: 0.25 }, 7).refusers.size).toBe(3) // round(2.5) → 3
		expect(compileConsensusConditions(network, { refuserFraction: 1 }, 7).refusers.size).toBe(10)
	})

	it('refuserFraction 0 / undefined ⇒ empty set', () => {
		const network = lineNetwork(10)
		expect(compileConsensusConditions(network, { refuserFraction: 0 }, 7).refusers.size).toBe(0)
		expect(compileConsensusConditions(network, {}, 7).refusers.size).toBe(0)
	})

	it('same (network, spec, seed) ⇒ identical refuser set; a different seed generally differs', () => {
		const network = lineNetwork(20)
		const spec = { refuserFraction: 0.3 }
		const a = compileConsensusConditions(network, spec, 11)
		const b = compileConsensusConditions(network, spec, 11)
		expect([...a.refusers].sort((x, y) => x - y)).toEqual([...b.refusers].sort((x, y) => x - y))
		const c = compileConsensusConditions(network, spec, 12)
		expect([...a.refusers].sort((x, y) => x - y)).not.toEqual([...c.refusers].sort((x, y) => x - y))
	})
})
