import { FORMAT_VERSION, entityName, type Network, type Tally } from 'tallysim'
import { buildGraph, edgeKeyForTally } from './model.js'

/** A minimal network wrapper so each test states only the tallies it cares about. */
function networkOf(entityCount: number, tallies: Tally[]): Network {
	return { entityCount, tallies, meta: { generator: 'test', params: {}, seed: 1, formatVersion: FORMAT_VERSION } }
}

/** A finite tally with the given endpoints and symmetric limits/balance. */
function tally(stock: number, foil: number, over: Partial<Tally> = {}): Tally {
	return { stock, foil, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100, ...over }
}

describe('buildGraph', () => {
	it('makes one node per entity and one edge per tally', () => {
		const graph = buildGraph(networkOf(3, [tally(0, 1), tally(1, 2)]))
		expect(graph.order).toBe(3)
		expect(graph.size).toBe(2)
		expect(graph.hasNode(entityName(0))).toBe(true)
		expect(graph.hasNode(entityName(2))).toBe(true)
	})

	it('orients each edge stock → foil and records both endpoints', () => {
		const graph = buildGraph(networkOf(2, [tally(1, 0)]))
		const key = edgeKeyForTally(0)
		expect(graph.source(key)).toBe(entityName(1)) // stock
		expect(graph.target(key)).toBe(entityName(0)) // foil
		const attrs = graph.getEdgeAttributes(key)
		expect(attrs.stock).toBe(1)
		expect(attrs.foil).toBe(0)
		expect(attrs.tallyIndex).toBe(0)
	})

	it('stores both directed capacities verbatim from the capacity model', () => {
		// balance 30, stockLimit 100, foilLimit 40 ⇒ capFoilToStock = 100 - 30 = 70; capStockToFoil = 30 + 40 = 70.
		const graph = buildGraph(networkOf(2, [tally(0, 1, { balance: 30, stockCreditLimit: 100, foilCreditLimit: 40 })]))
		const attrs = graph.getEdgeAttributes(edgeKeyForTally(0))
		expect(attrs.capFoilToStock).toBe(70)
		expect(attrs.capStockToFoil).toBe(70)
	})

	it('carries an Infinity capacity through unchanged (unlimited credit limit)', () => {
		const graph = buildGraph(
			networkOf(2, [tally(0, 1, { balance: 0, stockCreditLimit: Infinity, foilCreditLimit: 100 })]),
		)
		const attrs = graph.getEdgeAttributes(edgeKeyForTally(0))
		// capFoilToStock = stockCreditLimit - balance = Infinity - 0 = Infinity.
		expect(attrs.capFoilToStock).toBe(Infinity)
		// capStockToFoil = balance + foilCreditLimit = 0 + 100 = 100 (still finite).
		expect(attrs.capStockToFoil).toBe(100)
	})

	it('represents a zero-capacity direction as 0, not a missing value', () => {
		// balance at the stock bound: capFoilToStock = 100 - 100 = 0; capStockToFoil = 100 + 100 = 200.
		const graph = buildGraph(
			networkOf(2, [tally(0, 1, { balance: 100, stockCreditLimit: 100, foilCreditLimit: 100 })]),
		)
		const attrs = graph.getEdgeAttributes(edgeKeyForTally(0))
		expect(attrs.capFoilToStock).toBe(0)
		expect(attrs.capStockToFoil).toBe(200)
	})

	it('keeps two tallies between the same pair as distinct parallel edges', () => {
		const graph = buildGraph(networkOf(2, [tally(0, 1), tally(0, 1)]))
		expect(graph.size).toBe(2)
		expect(graph.hasEdge(edgeKeyForTally(0))).toBe(true)
		expect(graph.hasEdge(edgeKeyForTally(1))).toBe(true)
		expect(graph.getEdgeAttributes(edgeKeyForTally(0)).tallyIndex).toBe(0)
		expect(graph.getEdgeAttributes(edgeKeyForTally(1)).tallyIndex).toBe(1)
	})

	it('builds an empty network without throwing (0 nodes, 0 edges)', () => {
		const graph = buildGraph(networkOf(0, []))
		expect(graph.order).toBe(0)
		expect(graph.size).toBe(0)
	})

	it('builds a single-entity network with no edges', () => {
		const graph = buildGraph(networkOf(1, []))
		expect(graph.order).toBe(1)
		expect(graph.size).toBe(0)
	})

	it('permits a self-loop tally (hand-built networks only)', () => {
		const graph = buildGraph(networkOf(1, [tally(0, 0)]))
		expect(graph.order).toBe(1)
		expect(graph.size).toBe(1)
		expect(graph.source(edgeKeyForTally(0))).toBe(entityName(0))
		expect(graph.target(edgeKeyForTally(0))).toBe(entityName(0))
	})

	it('exposes node degree for hover details', () => {
		// Node 1 sits between two tallies ⇒ degree 2.
		const graph = buildGraph(networkOf(3, [tally(0, 1), tally(1, 2)]))
		expect(graph.degree(entityName(1))).toBe(2)
		expect(graph.degree(entityName(0))).toBe(1)
	})
})
