import { SeededRandom } from 'tallynet/testing'
import { type CapacityDistribution, drawCapacity } from './distributions.js'

function drawN(dist: CapacityDistribution, seed: number, count: number) {
	const rng = new SeededRandom(seed)
	return Array.from({ length: count }, () => drawCapacity(dist, rng))
}

describe('capacity distributions', () => {
	it('unlimited yields Infinity limits and a zero balance, consuming no randomness', () => {
		const rng = new SeededRandom(1)
		const draw = drawCapacity({ kind: 'unlimited' }, rng)
		expect(draw).toEqual({ stockCreditLimit: Infinity, foilCreditLimit: Infinity, balance: 0 })
		// No draw consumed: a fresh rng at the same seed yields the same next float.
		expect(rng.nextFloat()).toBe(new SeededRandom(1).nextFloat())
	})

	it('constant yields the fixed limit on both sides, balance defaulting to 0', () => {
		const rng = new SeededRandom(1)
		expect(drawCapacity({ kind: 'constant', limit: 42 }, rng)).toEqual({
			stockCreditLimit: 42,
			foilCreditLimit: 42,
			balance: 0,
		})
		expect(drawCapacity({ kind: 'constant', limit: 42, balance: -3 }, rng).balance).toBe(-3)
	})

	it('uniform draws integer limits within [min, max] and a zero balance by default', () => {
		const draws = drawN({ kind: 'uniform', min: 5, max: 15 }, 2026, 500)
		for (const d of draws) {
			expect(Number.isInteger(d.stockCreditLimit)).toBe(true)
			expect(Number.isInteger(d.foilCreditLimit)).toBe(true)
			expect(d.stockCreditLimit).toBeGreaterThanOrEqual(5)
			expect(d.stockCreditLimit).toBeLessThanOrEqual(15)
			expect(d.foilCreditLimit).toBeGreaterThanOrEqual(5)
			expect(d.foilCreditLimit).toBeLessThanOrEqual(15)
			expect(d.balance).toBe(0)
		}
		// The range should actually be exercised, not a constant.
		const stocks = new Set(draws.map((d) => d.stockCreditLimit))
		expect(stocks.size).toBeGreaterThan(1)
	})

	it('uniform with randomizeBalance keeps balance within [-foilCreditLimit, +stockCreditLimit]', () => {
		const draws = drawN({ kind: 'uniform', min: 1, max: 20, randomizeBalance: true }, 99, 500)
		for (const d of draws) {
			expect(Number.isInteger(d.balance)).toBe(true)
			expect(d.balance).toBeGreaterThanOrEqual(-d.foilCreditLimit)
			expect(d.balance).toBeLessThanOrEqual(d.stockCreditLimit)
		}
	})

	it('lognormal draws non-negative integer limits', () => {
		const draws = drawN({ kind: 'lognormal', mu: 3, sigma: 1 }, 5, 500)
		for (const d of draws) {
			expect(Number.isInteger(d.stockCreditLimit)).toBe(true)
			expect(Number.isInteger(d.foilCreditLimit)).toBe(true)
			expect(d.stockCreditLimit).toBeGreaterThanOrEqual(0)
			expect(d.foilCreditLimit).toBeGreaterThanOrEqual(0)
		}
	})

	it('is deterministic — the same seed replays the same draws', () => {
		const dist: CapacityDistribution = { kind: 'uniform', min: 0, max: 100, randomizeBalance: true }
		expect(drawN(dist, 1234, 50)).toEqual(drawN(dist, 1234, 50))
	})

	it('rejects an inverted uniform range', () => {
		expect(() => drawCapacity({ kind: 'uniform', min: 10, max: 1 }, new SeededRandom(1))).toThrow()
	})
})
