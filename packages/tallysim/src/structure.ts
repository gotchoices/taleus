/**
 * Pure structural graph utilities over a {@link Network}, treated as an **undirected multigraph** (each
 * tally is one undirected edge; direction and capacity are ignored here). Used now for generator-fidelity
 * tests, and reused later by the runner's metrics. Everything iterates in a defined order (entity index,
 * then tally array order) so results are deterministic and never depend on unordered-key iteration.
 */

import type { Network } from './model.js'

/** The degree of every entity (count of tally endpoints incident to it), indexed by entity id. */
export function degreeSequence(network: Network): number[] {
	const degrees = new Array<number>(network.entityCount).fill(0)
	for (const tally of network.tallies) {
		degrees[tally.stock]++
		degrees[tally.foil]++
	}
	return degrees
}

/** Mean degree over the undirected multigraph: `2 · edges / entities` (0 for an empty network). */
export function meanDegree(network: Network): number {
	if (network.entityCount === 0) {
		return 0
	}
	return (2 * network.tallies.length) / network.entityCount
}

/**
 * Degree histogram: a sorted array of `[degree, count]` pairs, ascending by degree. Sorted (not a raw
 * `Map` iteration) so the output order is deterministic regardless of insertion order.
 */
export function degreeHistogram(network: Network): [number, number][] {
	const counts = new Map<number, number>()
	for (const degree of degreeSequence(network)) {
		counts.set(degree, (counts.get(degree) ?? 0) + 1)
	}
	return [...counts.entries()].sort((a, b) => a[0] - b[0])
}

/** The result of a connected-components analysis over the undirected multigraph. */
export interface ComponentAnalysis {
	/** Component id for each entity (ids are small integers, not necessarily contiguous). */
	componentOf: number[]
	/** Number of distinct connected components. */
	componentCount: number
	/** Size (entity count) of the largest component. */
	largestSize: number
	/** `largestSize / entityCount` — the giant-component fraction. 0 for an empty network. */
	largestFraction: number
}

/** Union-find (disjoint-set) with path compression and union by size. */
class UnionFind {
	private readonly parent: number[]
	private readonly size: number[]

	constructor(count: number) {
		this.parent = Array.from({ length: count }, (_unused, i) => i)
		this.size = new Array<number>(count).fill(1)
	}

	find(x: number): number {
		let root = x
		while (this.parent[root] !== root) {
			root = this.parent[root]
		}
		// Path compression: point every node on the walk straight at the root.
		let node = x
		while (this.parent[node] !== root) {
			const next = this.parent[node]
			this.parent[node] = root
			node = next
		}
		return root
	}

	union(a: number, b: number): void {
		const rootA = this.find(a)
		const rootB = this.find(b)
		if (rootA === rootB) {
			return
		}
		// Attach the smaller tree under the larger; tie broken by lower index for determinism.
		const [big, small] =
			this.size[rootA] > this.size[rootB] || (this.size[rootA] === this.size[rootB] && rootA < rootB)
				? [rootA, rootB]
				: [rootB, rootA]
		this.parent[small] = big
		this.size[big] += this.size[small]
	}
}

/**
 * Connected components via union-find over the undirected edges, iterated in tally-array order. Isolated
 * entities (degree 0) are their own singleton components, so an all-isolated network of `n` entities has
 * `n` components and `largestFraction = 1/n`; a fully connected network has `largestFraction = 1`.
 */
export function connectedComponents(network: Network): ComponentAnalysis {
	const n = network.entityCount
	if (n === 0) {
		return { componentOf: [], componentCount: 0, largestSize: 0, largestFraction: 0 }
	}
	const uf = new UnionFind(n)
	for (const tally of network.tallies) {
		uf.union(tally.stock, tally.foil)
	}

	const componentOf = new Array<number>(n)
	const sizeByRoot = new Map<number, number>()
	for (let entity = 0; entity < n; entity++) {
		const root = uf.find(entity)
		componentOf[entity] = root
		sizeByRoot.set(root, (sizeByRoot.get(root) ?? 0) + 1)
	}

	let largestSize = 0
	for (const size of sizeByRoot.values()) {
		if (size > largestSize) {
			largestSize = size
		}
	}

	return {
		componentOf,
		componentCount: sizeByRoot.size,
		largestSize,
		largestFraction: largestSize / n,
	}
}
