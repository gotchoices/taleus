import { FORMAT_VERSION, type Network, type Tally } from './model.js'
import { connectedComponents, degreeHistogram, degreeSequence, meanDegree } from './structure.js'

function net(entityCount: number, pairs: [number, number][]): Network {
	const tallies: Tally[] = pairs.map(([stock, foil]) => ({
		stock,
		foil,
		balance: 0,
		stockCreditLimit: 1,
		foilCreditLimit: 1,
	}))
	return {
		entityCount,
		tallies,
		meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION },
	}
}

describe('degree utilities', () => {
	it('counts both endpoints of every tally', () => {
		// 0—1, 0—2 : node 0 has degree 2, nodes 1 and 2 degree 1.
		const g = net(3, [[0, 1], [0, 2]])
		expect(degreeSequence(g)).toEqual([2, 1, 1])
		expect(meanDegree(g)).toBeCloseTo((2 * 2) / 3)
	})

	it('counts a parallel edge twice', () => {
		const g = net(2, [[0, 1], [0, 1]])
		expect(degreeSequence(g)).toEqual([2, 2])
	})

	it('returns 0 mean degree for an empty network', () => {
		expect(meanDegree(net(0, []))).toBe(0)
	})

	it('produces a sorted degree histogram', () => {
		const g = net(4, [[0, 1], [0, 2], [0, 3]]) // degrees: 3,1,1,1
		expect(degreeHistogram(g)).toEqual([
			[1, 3],
			[3, 1],
		])
	})
})

describe('connected components', () => {
	it('reports a single component (fraction 1) for a fully connected graph', () => {
		const g = net(4, [[0, 1], [1, 2], [2, 3]])
		const result = connectedComponents(g)
		expect(result.componentCount).toBe(1)
		expect(result.largestFraction).toBe(1)
	})

	it('reports fraction 0.5 for two equal disconnected halves', () => {
		const g = net(4, [[0, 1], [2, 3]])
		const result = connectedComponents(g)
		expect(result.componentCount).toBe(2)
		expect(result.largestSize).toBe(2)
		expect(result.largestFraction).toBe(0.5)
	})

	it('reports fraction 1/n when every entity is isolated', () => {
		const g = net(5, [])
		const result = connectedComponents(g)
		expect(result.componentCount).toBe(5)
		expect(result.largestSize).toBe(1)
		expect(result.largestFraction).toBeCloseTo(1 / 5)
	})

	it('puts every entity of a connected pair in the same component', () => {
		const g = net(4, [[0, 1], [1, 2], [2, 3]])
		const { componentOf } = connectedComponents(g)
		expect(new Set(componentOf).size).toBe(1)
	})

	it('handles an empty network without dividing by zero', () => {
		expect(connectedComponents(net(0, []))).toEqual({
			componentOf: [],
			componentCount: 0,
			largestSize: 0,
			largestFraction: 0,
		})
	})
})
