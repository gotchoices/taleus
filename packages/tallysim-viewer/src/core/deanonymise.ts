/**
 * Map an anonymised trace nonce back to the exact tally edge it touched — the load-bearing decoder that lets
 * the viewer light up the graph.
 *
 * ── Why this is possible ───────────────────────────────────────────────────────────────────────────
 * A trace event carries an anonymised `nonce`, not a link/edge id: in `tallynet` a nonce is
 * `makeNonce(sessionCode, linkId)`, which hides a peer's link from relays by design (only the link's owner
 * holds the `linkId`). But the viewer sees the *whole* network, so it can invert the hash. For a given
 * `sessionCode` it recomputes `makeNonce(sessionCode, linkIdForTally(i))` for every tally `i` and builds the
 * reverse map `nonce → tally index`. The two ends of a tally derive the same nonce from the same function, so
 * the mapping is exact.
 *
 * With that map, every nonce-bearing event (`query-sent`, `query-received`, `candidate-pruned`,
 * `plan-returned`, `late-answer-folded`) resolves to an exact **edge**, and a found plan's `path` (a list of
 * link nonces) resolves to an exact **edge sequence**, which — walked from the known originator
 * (`query.from`) across each tally's two endpoints — yields the exact **node path**.
 *
 * ── Sentinels ──────────────────────────────────────────────────────────────────────────────────────
 * A nonce that does not resolve, or a plan path whose walk is non-contiguous, should never happen for a
 * well-formed trace of a network the viewer holds — it signals a bug. Both are surfaced as an explicit
 * sentinel (`undefined`), never silently dropped: {@link Deanonymiser.tallyOfNonce} returns `undefined` for an
 * unknown nonce, and {@link Deanonymiser.nodePathOfPlanPath} returns `undefined` for an unresolvable or
 * non-contiguous path.
 */

import { linkIdForTally, type Network } from 'tallysim'
import { makeNonce } from 'tallynet'

/** The decoder surface: resolve one nonce to a tally, or a whole plan path to a node sequence. */
export interface Deanonymiser {
	/** The tally index a nonce decodes to for `sessionCode`, or `undefined` if no tally produces that nonce. */
	tallyOfNonce(sessionCode: string, nonce: string): number | undefined
	/**
	 * Walk a found plan's link-nonce path from originator `from` to its end, returning the node (entity id)
	 * sequence `[from, …]`. Returns `undefined` (the sentinel) if any nonce does not resolve or the walk is
	 * non-contiguous (a tally whose endpoints do not include the current node) — either signals a bug, not a
	 * normal "no route" (an empty `linkNonces` yields `[from]`).
	 */
	nodePathOfPlanPath(sessionCode: string, from: number, linkNonces: readonly string[]): number[] | undefined
}

/**
 * Build a {@link Deanonymiser} over one network. The per-session reverse map is built **lazily** on first use
 * and cached (one map per session); sessions are few, so a map per session is cheap to hold.
 */
export function createDeanonymiser(network: Network): Deanonymiser {
	const mapsByCode = new Map<string, Map<string, number>>()

	function reverseMapFor(sessionCode: string): Map<string, number> {
		let map = mapsByCode.get(sessionCode)
		if (map === undefined) {
			map = new Map<string, number>()
			// NOTE: this reverse map is O(tallies) per session. Fine for planned viewer scales (few sessions,
			// tallies in the thousands) because it is built lazily and only for sessions actually viewed. If a
			// trace ever carries very many sessions over a huge graph, keep only the current session's map
			// (evict on switch) rather than precomputing all — do NOT eagerly build every session here.
			for (let i = 0; i < network.tallies.length; i++) {
				map.set(makeNonce(sessionCode, linkIdForTally(i)), i)
			}
			mapsByCode.set(sessionCode, map)
		}
		return map
	}

	function tallyOfNonce(sessionCode: string, nonce: string): number | undefined {
		return reverseMapFor(sessionCode).get(nonce)
	}

	function nodePathOfPlanPath(
		sessionCode: string,
		from: number,
		linkNonces: readonly string[],
	): number[] | undefined {
		const nodes: number[] = [from]
		let current = from
		for (const nonce of linkNonces) {
			const tally = tallyOfNonce(sessionCode, nonce)
			if (tally === undefined) {
				return undefined
			}
			const { stock, foil } = network.tallies[tally]
			// NOTE: a self-loop tally (stock === foil === current) walks back to the same node, yielding a
			// repeated entry rather than the sentinel. Generators never emit self-loops; only a hand-built trace
			// could. If self-loops ever become real, decide here whether that is a route or a sentinel.
			const next = stock === current ? foil : foil === current ? stock : undefined
			if (next === undefined) {
				return undefined
			}
			nodes.push(next)
			current = next
		}
		return nodes
	}

	return { tallyOfNonce, nodePathOfPlanPath }
}
