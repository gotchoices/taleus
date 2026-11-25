import { capFoilToStock, capStockToFoil, totalSwing } from './capacity.js'
import type { Tally } from './model.js'

function tally(balance: number, stockCreditLimit: number, foilCreditLimit: number): Tally {
	return { stock: 0, foil: 1, balance, stockCreditLimit, foilCreditLimit }
}

describe('capacity model', () => {
	it('splits the total swing between the two directions, independent of balance', () => {
		for (const balance of [-5, -1, 0, 2, 10]) {
			const t = tally(balance, 10, 5)
			expect(capFoilToStock(t) + capStockToFoil(t)).toBe(totalSwing(t))
			expect(totalSwing(t)).toBe(15)
		}
	})

	it('keeps both directions non-negative for an in-range balance', () => {
		const t = tally(3, 10, 5)
		expect(capFoilToStock(t)).toBe(7) // 10 - 3
		expect(capStockToFoil(t)).toBe(8) // 3 + 5
	})

	it('reports zero capacity in the direction whose bound the balance sits at', () => {
		const atStockBound = tally(10, 10, 5)
		expect(capFoilToStock(atStockBound)).toBe(0)
		expect(capStockToFoil(atStockBound)).toBe(15)

		const atFoilBound = tally(-5, 10, 5)
		expect(capStockToFoil(atFoilBound)).toBe(0)
		expect(capFoilToStock(atFoilBound)).toBe(15)
	})

	it('yields Infinity capacities for unlimited credit limits', () => {
		const t = tally(0, Infinity, Infinity)
		expect(capFoilToStock(t)).toBe(Infinity)
		expect(capStockToFoil(t)).toBe(Infinity)
		expect(totalSwing(t)).toBe(Infinity)
	})

	it('yields one finite and one infinite direction for a one-sided unlimited tally', () => {
		const t = tally(2, Infinity, 5)
		expect(capFoilToStock(t)).toBe(Infinity) // Infinity - 2
		expect(capStockToFoil(t)).toBe(7) // 2 + 5
	})
})
