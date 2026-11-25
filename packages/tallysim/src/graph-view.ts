/**
 * The compiled graph view: a {@link Network} turned into a **directed capacity graph** the oracle can
 * search fast. The serialisable `Network` is convenient to build and store but slow to search (each query
 * would re-walk `tallies` and recompute capacities); {@link buildGraphView} compiles it once into a
 * CSR (compressed-sparse-row) adjacency over typed arrays, then the oracle runs every query against that.
 *
 * ── Edge derivation ──────────────────────────────────────────────────────────────────────────────────
 * Each tally becomes **two directed capacity edges**:
 *   - `stock → foil` with capacity `cap(S→F)` ({@link capStockToFoil}), and
 *   - `foil → stock` with capacity `cap(F→S)` ({@link capFoilToStock}).
 * So a graph view has exactly `2 · tallies.length` directed edges. Parallel tallies between a pair become
 * parallel directed edges (the oracle sums their capacities for max-flow; route existence needs only one).
 *
 * ── CSR layout ───────────────────────────────────────────────────────────────────────────────────────
 * For each source entity `u`, its out-edges occupy the contiguous slice
 * `targets[offsets[u] .. offsets[u + 1]]` (and the matching slice of `capacities`). `offsets` has length
 * `entityCount + 1`; `offsets[entityCount]` equals the total directed-edge count. Targets and offsets are
 * `Int32Array` (entity ids and edge indices are small integers); capacities are a `Float64Array` so the
 * `Infinity` of an unlimited credit limit is representable directly.
 *
 * ── Determinism ──────────────────────────────────────────────────────────────────────────────────────
 * The build is deterministic: edges are emitted in tally order, and within each source's slice the
 * neighbours appear in the order the incident tallies occur in `network.tallies`. Same network ⇒
 * byte-identical arrays. No result depends on unordered-key iteration.
 */

import { capFoilToStock, capStockToFoil } from './capacity.js'
import type { Network } from './model.js'

/**
 * A directed capacity graph in CSR form. Treat the typed arrays as read-only after {@link buildGraphView}
 * returns — the oracle never mutates them (max-flow copies the capacities into a residual of its own).
 */
export interface GraphView {
	/** Number of entities (nodes); valid source/target ids are `0 .. entityCount - 1`. */
	readonly entityCount: number
	/** CSR row offsets, length `entityCount + 1`. Node `u`'s edges are `[offsets[u], offsets[u + 1])`. */
	readonly offsets: Int32Array
	/** Edge targets, length `2 · tallies.length`, grouped by source per {@link offsets}. */
	readonly targets: Int32Array
	/** Edge capacities (parallel to {@link targets}); `Infinity` for an unlimited credit limit. */
	readonly capacities: Float64Array
}

/**
 * Compile a {@link Network} into a {@link GraphView}. Two passes: count each node's out-degree, prefix-sum
 * into `offsets`, then place each tally's two directed edges at a per-source write cursor. O(entities +
 * tallies); allocates only the three result arrays plus a scratch cursor.
 */
export function buildGraphView(network: Network): GraphView {
	const n = network.entityCount
	const edgeCount = 2 * network.tallies.length

	const offsets = new Int32Array(n + 1)
	const targets = new Int32Array(edgeCount)
	// NOTE (tripwire): capacities are `number` (Float64Array), so a simulated capacity above 2^53 would
	// lose integer precision. Fine for all planned scenarios (simulated units stay small). If a scenario
	// ever needs capacities beyond 2^53, switch this store to BigInt64Array and the oracle arithmetic to
	// bigint. Not work now — a conditional. See docs/design.md § Oracle.
	const capacities = new Float64Array(edgeCount)

	// Pass 1: out-degree per node. Each tally gives its stock and its foil one out-edge apiece.
	const outCount = new Int32Array(n)
	for (const tally of network.tallies) {
		outCount[tally.stock]++
		outCount[tally.foil]++
	}

	// Prefix-sum the out-degrees into row offsets; offsets[n] ends up as the total edge count.
	let acc = 0
	for (let u = 0; u < n; u++) {
		offsets[u] = acc
		acc += outCount[u]
	}
	offsets[n] = acc

	// Pass 2: place each tally's two directed edges at its source's write cursor (starts at offsets[u]).
	const cursor = offsets.slice(0, n)
	for (const tally of network.tallies) {
		const stockEdge = cursor[tally.stock]++
		targets[stockEdge] = tally.foil
		capacities[stockEdge] = capStockToFoil(tally)

		const foilEdge = cursor[tally.foil]++
		targets[foilEdge] = tally.stock
		capacities[foilEdge] = capFoilToStock(tally)
	}

	return { entityCount: n, offsets, targets, capacities }
}
