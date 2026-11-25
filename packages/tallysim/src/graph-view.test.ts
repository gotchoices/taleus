import { buildGraphView } from './graph-view.js'
import { FORMAT_VERSION, type Network, type Tally } from './model.js'

/** Wrap hand-built tallies in a minimal {@link Network} (meta is irrelevant to the graph view). */
function net(entityCount: number, tallies: Tally[]): Network {
	return {
		entityCount,
		tallies,
		meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION },
	}
}

/** A tally whose directed capacities are exactly `capStockToFoil` / `capFoilToStock` (balance 0). */
function tally(stock: number, foil: number, capStockToFoil: number, capFoilToStock: number): Tally {
	// cap(S→F) = balance + foilCreditLimit; cap(F→S) = stockCreditLimit − balance. With balance 0:
	return { stock, foil, balance: 0, stockCreditLimit: capFoilToStock, foilCreditLimit: capStockToFoil }
}

describe('buildGraphView — CSR layout', () => {
	it('turns one tally into two directed edges with the model capacities', () => {
		// Tally with balance 2, stockLimit 10, foilLimit 5 ⇒ cap(S→F)=2+5=7, cap(F→S)=10−2=8.
		const g = buildGraphView(net(2, [{ stock: 0, foil: 1, balance: 2, stockCreditLimit: 10, foilCreditLimit: 5 }]))
		expect(Array.from(g.offsets)).toEqual([0, 1, 2])
		expect(Array.from(g.targets)).toEqual([1, 0]) // 0→1, then 1→0
		expect(Array.from(g.capacities)).toEqual([7, 8]) // cap(S→F)=7, cap(F→S)=8
	})

	it('has exactly 2·tallies edges and offsets of length entityCount+1', () => {
		const g = buildGraphView(net(4, [tally(0, 1, 3, 0), tally(1, 2, 3, 0), tally(2, 3, 3, 0)]))
		expect(g.targets.length).toBe(6)
		expect(g.capacities.length).toBe(6)
		expect(g.offsets.length).toBe(5)
		expect(g.offsets[4]).toBe(6) // last offset = total edge count
	})

	it('groups a node’s out-edges into a contiguous slice', () => {
		// Node 0 is the stock of two tallies ⇒ two out-edges 0→1 and 0→2 in its slice.
		const g = buildGraphView(net(3, [tally(0, 1, 5, 0), tally(0, 2, 6, 0)]))
		const start = g.offsets[0]
		const end = g.offsets[1]
		const neighbours = Array.from(g.targets.subarray(start, end))
		expect(neighbours).toEqual([1, 2])
		expect(Array.from(g.capacities.subarray(start, end))).toEqual([5, 6])
	})

	it('keeps parallel tallies as parallel directed edges (capacities not merged)', () => {
		const g = buildGraphView(net(2, [tally(0, 1, 4, 0), tally(0, 1, 7, 0)]))
		// 0 has two out-edges to 1 (caps 4 and 7); 1 has two out-edges to 0 (caps 0 and 0).
		const zeroOut = Array.from(g.capacities.subarray(g.offsets[0], g.offsets[1]))
		expect(zeroOut).toEqual([4, 7])
	})

	it('represents an unlimited credit limit as Infinity capacity', () => {
		const g = buildGraphView(net(2, [{ stock: 0, foil: 1, balance: 0, stockCreditLimit: Infinity, foilCreditLimit: Infinity }]))
		expect(g.capacities[0]).toBe(Infinity)
		expect(g.capacities[1]).toBe(Infinity)
	})

	it('builds an empty network without edges', () => {
		const g = buildGraphView(net(3, []))
		expect(g.targets.length).toBe(0)
		expect(Array.from(g.offsets)).toEqual([0, 0, 0, 0])
	})

	it('is deterministic — same network ⇒ byte-identical typed arrays', () => {
		const n = net(3, [tally(0, 1, 5, 2), tally(2, 1, 3, 4), tally(0, 2, 1, 6)])
		const a = buildGraphView(n)
		const b = buildGraphView(n)
		expect(Array.from(a.offsets)).toEqual(Array.from(b.offsets))
		expect(Array.from(a.targets)).toEqual(Array.from(b.targets))
		expect(Array.from(a.capacities)).toEqual(Array.from(b.capacities))
	})

	it('uses typed arrays (Int32 targets/offsets, Float64 capacities)', () => {
		const g = buildGraphView(net(2, [tally(0, 1, 1, 1)]))
		expect(g.offsets).toBeInstanceOf(Int32Array)
		expect(g.targets).toBeInstanceOf(Int32Array)
		expect(g.capacities).toBeInstanceOf(Float64Array)
	})
})
