/**
 * The `clustered` generator — communities that are dense within and sparse between. Entities are split
 * into `communityCount` (`c`) contiguous blocks. Within each community, Erdős–Rényi edges are placed to
 * hit `meanIntraDegree`. Then exactly `bridgeCount` edges are added between entities in **different**
 * communities. Models a network of tightly knit groups loosely tied together.
 *
 * Edge cases: a single community (`c = 1`) ⇒ all intra-community edges, no bridges. Bridges need at least
 * two non-empty communities; with fewer, none are placed. Communities of size < 2 host no intra edges.
 */

import type { SeededRandom } from 'tallynet/testing'
import { type Network } from '../model.js'
import {
	type GeneratorParamsBase,
	type Pair,
	materialize,
	requireEntityCount,
	rngFor,
} from './shared.js'

export const CLUSTERED_ID = 'clustered'

export interface ClusteredParams extends GeneratorParamsBase {
	/** Number of communities (`c`). Must be a positive integer. */
	communityCount: number
	/** Mean intra-community degree within each community. Must be `>= 0`. */
	meanIntraDegree: number
	/** Exact number of inter-community bridge tallies to add. Must be a non-negative integer. */
	bridgeCount: number
}

/** Split `0 .. n-1` into `c` contiguous blocks, as even as possible (earlier blocks take the remainder). */
function partition(n: number, c: number): number[][] {
	const base = Math.floor(n / c)
	const remainder = n % c
	const communities: number[][] = []
	let next = 0
	for (let community = 0; community < c; community++) {
		const size = base + (community < remainder ? 1 : 0)
		communities.push(Array.from({ length: size }, (_unused, i) => next + i))
		next += size
	}
	return communities
}

/** Place `edgeCount` random intra-community edges (distinct endpoints, parallel edges allowed). */
function intraEdges(members: number[], edgeCount: number, rng: SeededRandom, out: Pair[]): void {
	if (members.length < 2) {
		return
	}
	for (let i = 0; i < edgeCount; i++) {
		const a = rng.nextInt(members.length)
		let b = rng.nextInt(members.length)
		while (b === a) {
			b = rng.nextInt(members.length)
		}
		out.push([members[a], members[b]])
	}
}

/**
 * Generate a clustered network. `rng` defaults to a fresh {@link SeededRandom} seeded from `params.seed`.
 */
export function clustered(params: ClusteredParams, rng: SeededRandom = rngFor(params.seed)): Network {
	requireEntityCount(params.entityCount)
	if (!Number.isInteger(params.communityCount) || params.communityCount <= 0) {
		throw new Error(`clustered: communityCount must be a positive integer, got ${String(params.communityCount)}`)
	}
	if (!(params.meanIntraDegree >= 0) || !Number.isFinite(params.meanIntraDegree)) {
		throw new Error(`clustered: meanIntraDegree must be a finite number >= 0, got ${String(params.meanIntraDegree)}`)
	}
	if (!Number.isInteger(params.bridgeCount) || params.bridgeCount < 0) {
		throw new Error(`clustered: bridgeCount must be a non-negative integer, got ${String(params.bridgeCount)}`)
	}

	const n = params.entityCount
	const communities = partition(n, params.communityCount)
	const pairs: Pair[] = []

	for (const members of communities) {
		const edgeCount = Math.round((members.length * params.meanIntraDegree) / 2)
		intraEdges(members, edgeCount, rng, pairs)
	}

	// Bridges connect two distinct non-empty communities. With fewer than two, none can be placed.
	const nonEmpty = communities.filter((members) => members.length > 0)
	if (nonEmpty.length >= 2) {
		for (let i = 0; i < params.bridgeCount; i++) {
			const ci = rng.nextInt(nonEmpty.length)
			let cj = rng.nextInt(nonEmpty.length)
			while (cj === ci) {
				cj = rng.nextInt(nonEmpty.length)
			}
			const a = nonEmpty[ci][rng.nextInt(nonEmpty[ci].length)]
			const b = nonEmpty[cj][rng.nextInt(nonEmpty[cj].length)]
			pairs.push([a, b])
		}
	}

	const metaParams = {
		entityCount: n,
		communityCount: params.communityCount,
		meanIntraDegree: params.meanIntraDegree,
		bridgeCount: params.bridgeCount,
	}
	return materialize(n, pairs, params.capacity, rng, CLUSTERED_ID, metaParams, params.seed)
}
