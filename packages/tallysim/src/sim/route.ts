/**
 * Reconstruct the exact tally route a chosen {@link Plan} walks, inverting discovery's per-session edge
 * nonces back to real tallies. A found plan's `path` is a list of anonymised link **nonces** (a node only
 * ever puts a nonce on the wire — `makeNonce(sessionCode, linkId)` — so an intermediary cannot correlate a
 * tally across sessions). The simulator built the network it is decoding, so it holds every `linkId` and
 * can invert the hash: for the query's `sessionCode`, recompute `makeNonce(sessionCode, linkIdForTally(i))`
 * for every tally `i` to build `nonce → tally index`, then walk from the originator across each tally's
 * `{ stock, foil }` endpoints.
 *
 * This is the same inversion the viewer's `deanonymise.ts` does, with one deliberate difference: it
 * **throws** instead of returning a sentinel. The viewer decodes traces it did not build (a hand-made or
 * foreign trace could carry a nonce it cannot resolve), so it treats an unresolvable nonce as data. Here
 * the sim built the network *and* ran the discovery that produced the plan, so an unresolvable nonce or a
 * non-contiguous walk is a bug in this tier, not an input to tolerate — fail loudly.
 */

import { makeNonce } from 'tallynet'
import type { Plan } from 'tallynet'
import type { Network } from '../model.js'
import type { QueryOutcome } from './harness.js'
import { linkIdForTally } from './naming.js'
import type { LiftTerms } from './terms.js'

/** A reconstructed lift route: the tally index crossed at each hop, and the entity-id path `[from, …, to]`. */
export interface LiftRoute {
	/** The tally index of each hop, in order. Length = `route.length − 1`. Feeds `routeLinkIds`. */
	tallyPath: number[]
	/** The entity ids the route visits, `[from, …, to]`. A circular lift has `route[0] === route[last]`. */
	route: number[]
}

/**
 * Walk `plan.path`'s nonces back to a concrete {@link LiftRoute} over `network`, starting at entity `from`
 * (the discovery originator). Throws if a path nonce resolves to no tally for `sessionCode`, or if a tally
 * is not incident to the current entity (a non-contiguous walk) — either signals a route-reconstruction
 * bug, since the sim built this network and ran this very discovery.
 */
export function reconstructRoute(network: Network, sessionCode: string, from: number, plan: Plan<LiftTerms, unknown>): LiftRoute {
	const nonceToTally = buildNonceToTally(network, sessionCode)
	const tallyPath: number[] = []
	const route: number[] = [from]
	let current = from
	for (const link of plan.path) {
		const tally = nonceToTally.get(link.nonce)
		if (tally === undefined) {
			throw new Error(`reconstructRoute: nonce ${link.nonce} resolves to no tally for session ${sessionCode}`)
		}
		const { stock, foil } = network.tallies[tally]
		const next = stock === current ? foil : foil === current ? stock : undefined
		if (next === undefined) {
			throw new Error(
				`reconstructRoute: tally ${tally} (stock ${stock}, foil ${foil}) is not incident to entity ${current} — non-contiguous walk`,
			)
		}
		tallyPath.push(tally)
		route.push(next)
		current = next
	}
	return { tallyPath, route }
}

/** The `nonce → tally index` map for one session, recomputed from every tally's `linkIdForTally`. */
function buildNonceToTally(network: Network, sessionCode: string): Map<string, number> {
	const map = new Map<string, number>()
	for (let i = 0; i < network.tallies.length; i++) {
		map.set(makeNonce(sessionCode, linkIdForTally(i)), i)
	}
	return map
}

/**
 * Build a **circular** {@link QueryOutcome} directly from the known graph: find the shortest simple cycle
 * through `origin` and encode it as a one-plan outcome whose `path` nonces are this `sessionCode`'s, ready
 * for {@link reconstructRoute} + {@link runLiftForOutcome}. Returns `undefined` when `origin` is on no cycle.
 *
 * Real **clearing discovery** — a node *finding* a cycle back to itself over the decentralised protocol — is
 * deferred (`feat-tallysim-clearing-discovery`). Constructing the ring straight from the graph the simulator
 * already holds is the stand-in, so the circular *consensus* path (and "a ring routes around a non-relayer")
 * is exercisable now without waiting on that discovery work. The `from` passed to {@link reconstructRoute}
 * must equal `origin`.
 */
export function buildCircularOutcome(network: Network, sessionCode: string, origin: number): QueryOutcome | undefined {
	const cycle = findCycleThrough(network, origin)
	if (!cycle) {
		return undefined
	}
	const path = cycle.map((tally) => ({ nonce: makeNonce(sessionCode, linkIdForTally(tally)), intents: {} }))
	return { sessionCode, plans: [{ path, members: [] }], found: true }
}

/** One incident edge as an entity sees it: the tally index crossed and the entity on the far end. */
interface IncidentEdge {
	tally: number
	other: number
}

/**
 * Every entity's incident tallies, in **tally-array order** (so the cycle search is deterministic). A tally
 * `{ stock, foil }` is listed under both endpoints; a self-loop (`stock === foil`, which generators avoid)
 * is listed once and can never form a cycle (it would need a second distinct edge back).
 */
function incidentTallies(network: Network): IncidentEdge[][] {
	const incident: IncidentEdge[][] = Array.from({ length: network.entityCount }, () => [])
	network.tallies.forEach((tally, index) => {
		incident[tally.stock].push({ tally: index, other: tally.foil })
		if (tally.foil !== tally.stock) {
			incident[tally.foil].push({ tally: index, other: tally.stock })
		}
	})
	return incident
}

/**
 * The shortest simple cycle through `origin`, as an ordered list of tally indices (first found on a length
 * tie, iterating each entity's incident tallies in tally-array order). A cycle uses each edge at most once
 * and each interior entity at most once, needs at least two distinct edges (so it handles a 2-cycle over
 * **parallel** tallies between the same pair), and never passes back through `origin`. `undefined` when
 * `origin` lies on no cycle.
 *
 * NOTE: a depth-first search, bounded by `visited` to simple paths and pruned against the best cycle so far.
 * It is exponential on a dense graph — fine for the small hand-built rings this serves (the
 * clearing-discovery stand-in), but NOT for large generated networks; a real finder replaces it later.
 */
function findCycleThrough(network: Network, origin: number): number[] | undefined {
	const incident = incidentTallies(network)
	const visited = new Set<number>([origin])
	const pathTallies: number[] = []
	let best: number[] | undefined

	const visit = (current: number): void => {
		for (const { tally, other } of incident[current] ?? []) {
			if (pathTallies.includes(tally)) {
				continue // each edge at most once (also rules out retracing the arrival edge)
			}
			if (other === origin) {
				// Closing the loop: valid only with at least one prior edge (two distinct edges in all).
				if (pathTallies.length >= 1) {
					const cycle = [...pathTallies, tally]
					if (best === undefined || cycle.length < best.length) {
						best = cycle
					}
				}
				continue // never recurse through the origin
			}
			if (visited.has(other)) {
				continue // keep interior entities distinct (a simple cycle)
			}
			if (best !== undefined && pathTallies.length + 2 >= best.length) {
				continue // this branch's shortest possible cycle can't beat the incumbent
			}
			visited.add(other)
			pathTallies.push(tally)
			visit(other)
			pathTallies.pop()
			visited.delete(other)
		}
	}
	visit(origin)
	return best
}
