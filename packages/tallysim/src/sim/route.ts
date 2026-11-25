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
