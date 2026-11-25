/**
 * The **oracle**: code that sees the *whole* compiled graph ({@link GraphView}) and searches it directly to
 * answer whether a payment could get through, how much is payable, and how debt could clear around a loop.
 * It is the **ground truth** the later discovery tier measures the real `tallynet` routing protocol against
 * ("found vs. oracle") — so keeping it independent of the protocol is the whole point: when a lift fails,
 * the oracle says whether the *network* could ever have carried it, separate from whether the *protocol*
 * found it.
 *
 * An {@link Oracle} wraps one {@link GraphView} and reuses scratch buffers across queries (a generation-
 * stamped `visited` array avoids clearing an O(n) buffer per query), so a sweep of ~1,000 route-existence
 * queries over a 10,000-entity graph runs in seconds. Create one per network; call its queries many times.
 *
 * ── Queries ──────────────────────────────────────────────────────────────────────────────────────────
 * - {@link Oracle.routeExistence} — bounded BFS: does a payment of `amount` reach `to` within `maxDepth`
 *   hops, over edges with `capacity ≥ amount`, and at what shortest hop count. (A 1-hop path is length 1;
 *   `maxDepth` counts hops.)
 * - {@link Oracle.selfPayment} — `from === to` is a **cycle**, not a zero-length path: the shortest directed
 *   cycle through the node with every edge `capacity ≥ amount`, bounded by `maxDepth`.
 * - {@link Oracle.maxFlow} — Edmonds–Karp: the maximum value payable `from → to`. **Not depth-bounded**
 *   (depth-bounded max-flow is a different, harder problem, out of scope); the "ignoring depth, how much
 *   could flow" figure, complementary to the depth-aware route-existence query.
 * - {@link Oracle.clearingCycles} — how many directed cycles with spare capacity (`min edge ≥ amount`) pass
 *   through a node, up to `maxDepth`, with the count **capped** (cycle counts explode), plus the shortest.
 *
 * ── Amounts ──────────────────────────────────────────────────────────────────────────────────────────
 * All amounts/capacities compare as the model's integers (stored in `Float64Array`; see the 2^53 tripwire
 * in `graph-view.ts`). A non-positive `amount` is **rejected** (throws) rather than silently treated as
 * "any edge qualifies" — asking whether a payment of ≤ 0 routes is a programming error, not a query. With
 * `amount > 0` the `capacity ≥ amount` filter prunes zero-capacity directions automatically.
 *
 * ── Determinism ──────────────────────────────────────────────────────────────────────────────────────
 * Neighbours are iterated in CSR order; no result depends on unordered-key iteration. Same graph + same
 * query ⇒ identical result.
 */

import { buildGraphView, type GraphView } from './graph-view.js'
import type { Network } from './model.js'

/** Result of a route-existence / self-payment query. `shortestLength` is present iff `exists`. */
export interface RouteResult {
	/** Whether a qualifying route (or cycle) exists within the depth bound. */
	exists: boolean
	/** Shortest hop count of a qualifying route/cycle (`<= maxDepth`); omitted when none exists. */
	shortestLength?: number
}

/** Result of a clearing-cycle availability query. */
export interface ClearingResult {
	/** Number of qualifying directed cycles found through the node (`<= maxCount`). */
	count: number
	/** True if the search stopped at `maxCount` (more cycles may exist than were counted). */
	capped: boolean
	/** Shortest qualifying cycle length; omitted when none exists. */
	shortestLength?: number
}

/** Reject a non-positive or non-finite amount: a payment of ≤ 0 is not a query the oracle answers. */
function requirePositiveAmount(amount: number): void {
	if (!(amount > 0) || !Number.isFinite(amount)) {
		throw new Error(`oracle: amount must be a finite number > 0, got ${String(amount)}`)
	}
}

/** Reject a depth that is not a non-negative integer. `maxDepth` counts hops. */
function requireDepth(maxDepth: number): void {
	if (!Number.isInteger(maxDepth) || maxDepth < 0) {
		throw new Error(`oracle: maxDepth must be a non-negative integer, got ${String(maxDepth)}`)
	}
}

/** Reject a cycle-count cap that is not a positive integer. */
function requireMaxCount(maxCount: number): void {
	if (!Number.isInteger(maxCount) || maxCount <= 0) {
		throw new Error(`oracle: maxCount must be a positive integer, got ${String(maxCount)}`)
	}
}

export class Oracle {
	readonly graph: GraphView

	/** `visited[node] === visitGen` means "seen in the current BFS"; bumping `visitGen` clears it in O(1). */
	private readonly visited: Int32Array
	/** BFS level (hop count from the source) of a node, valid only while `visited[node] === visitGen`. */
	private readonly level: Int32Array
	/** BFS frontier queue (size `entityCount`; a node is enqueued at most once per query). */
	private readonly queue: Int32Array
	/** DFS "currently on the search path" marker for cycle enumeration; set on descend, cleared on unwind. */
	private readonly onPath: Uint8Array
	private visitGen = 0

	constructor(graph: GraphView) {
		this.graph = graph
		const n = graph.entityCount
		this.visited = new Int32Array(n)
		this.level = new Int32Array(n)
		this.queue = new Int32Array(n)
		this.onPath = new Uint8Array(n)
	}

	/** Compile a {@link Network} into a {@link GraphView} and wrap it in an oracle. */
	static fromNetwork(network: Network): Oracle {
		return new Oracle(buildGraphView(network))
	}

	/** Throw if `node` is not a valid entity id for this graph. */
	private requireNode(node: number): void {
		if (!Number.isInteger(node) || node < 0 || node >= this.graph.entityCount) {
			throw new Error(`oracle: entity id out of range [0, ${this.graph.entityCount}), got ${String(node)}`)
		}
	}

	/**
	 * Bounded BFS route existence + shortest length for a payment of `amount` from `from` to `to` within
	 * `maxDepth` hops, over directed edges with `capacity >= amount`. BFS visits nodes in increasing hop
	 * count, so the first time `to` is reached is the shortest route. `from === to` is a self-payment and is
	 * delegated to {@link selfPayment} (a payment to oneself is a cycle, never a length-0 path).
	 */
	routeExistence(from: number, to: number, amount: number, maxDepth: number): RouteResult {
		this.requireNode(from)
		this.requireNode(to)
		requirePositiveAmount(amount)
		requireDepth(maxDepth)
		if (from === to) {
			return this.selfPayment(from, amount, maxDepth)
		}

		const { offsets, targets, capacities } = this.graph
		const gen = ++this.visitGen
		this.visited[from] = gen
		this.level[from] = 0
		this.queue[0] = from
		let head = 0
		let tail = 1

		while (head < tail) {
			const u = this.queue[head++]
			const lu = this.level[u]
			if (lu === maxDepth) {
				continue // at the depth bound; expanding would exceed maxDepth hops
			}
			const end = offsets[u + 1]
			for (let e = offsets[u]; e < end; e++) {
				if (capacities[e] < amount) {
					continue
				}
				const v = targets[e]
				if (v === to) {
					return { exists: true, shortestLength: lu + 1 }
				}
				if (this.visited[v] !== gen) {
					this.visited[v] = gen
					this.level[v] = lu + 1
					this.queue[tail++] = v
				}
			}
		}
		return { exists: false }
	}

	/**
	 * Shortest directed cycle through `node` with every edge `capacity >= amount`, bounded by `maxDepth`
	 * hops. A self-payment is a cycle, not a zero-length path, so the result is never length 0 (the shortest
	 * possible cycle is length 2: `node → v → node`). See {@link shortestCycleLength} for the method.
	 */
	selfPayment(node: number, amount: number, maxDepth: number): RouteResult {
		this.requireNode(node)
		requirePositiveAmount(amount)
		requireDepth(maxDepth)
		const shortest = this.shortestCycleLength(node, amount, maxDepth)
		return shortest === undefined ? { exists: false } : { exists: true, shortestLength: shortest }
	}

	/**
	 * Bounded BFS for the shortest directed cycle through `node` (`undefined` if none within `maxDepth`). The
	 * shortest cycle length equals `min over u of (dist(node, u) + 1)` across nodes `u` with a qualifying
	 * edge back to `node`; BFS processes nodes in increasing distance, so the first edge found back to `node`
	 * closes the shortest cycle. Separated from the cycle **count** so the shortest is always exact, even
	 * when {@link clearingCycles} stops counting at its cap. Callers validate inputs.
	 */
	private shortestCycleLength(node: number, amount: number, maxDepth: number): number | undefined {
		const { offsets, targets, capacities } = this.graph
		const gen = ++this.visitGen
		this.visited[node] = gen
		this.level[node] = 0
		this.queue[0] = node
		let head = 0
		let tail = 1

		while (head < tail) {
			const u = this.queue[head++]
			const lu = this.level[u]
			if (lu === maxDepth) {
				continue
			}
			const end = offsets[u + 1]
			for (let e = offsets[u]; e < end; e++) {
				if (capacities[e] < amount) {
					continue
				}
				const v = targets[e]
				if (v === node) {
					// Closing edge back to the start: BFS order ⇒ this is the shortest cycle.
					return lu + 1
				}
				if (this.visited[v] !== gen) {
					this.visited[v] = gen
					this.level[v] = lu + 1
					this.queue[tail++] = v
				}
			}
		}
		return undefined
	}

	/**
	 * Maximum value payable `from → to` via Edmonds–Karp (BFS-augmenting-path Ford–Fulkerson) on the
	 * directed capacity graph. Parallel edges between a pair add (each tally contributes its own edge).
	 * Returns `Infinity` when an all-unlimited augmenting path exists (capacity never constrains the flow).
	 *
	 * **Not depth-bounded** — this is the "ignoring depth, how much could flow" figure. `from === to` has no
	 * distinct sink, so it returns 0 (self-clearing is {@link clearingCycles}, not an s–t max-flow).
	 *
	 * Cost is `O(V · E^2)`, far above BFS; the runner tier must compute it on a **sampled** subset of
	 * queries (or only on request), never on every query in a large sweep. See `docs/design.md` § Oracle.
	 */
	maxFlow(from: number, to: number): number {
		this.requireNode(from)
		this.requireNode(to)
		if (from === to) {
			return 0
		}

		const n = this.graph.entityCount
		const { offsets, targets, capacities } = this.graph
		const directedEdges = targets.length

		// Residual network: each directed edge becomes a forward slot + a paired reverse slot (XOR-1
		// partners). Built fresh per call — max-flow is sampled, so this O(E) allocation is acceptable.
		const flowTo = new Int32Array(2 * directedEdges)
		const flowCap = new Float64Array(2 * directedEdges)
		const adjacency: number[][] = Array.from({ length: n }, () => [])
		let slot = 0
		for (let u = 0; u < n; u++) {
			const end = offsets[u + 1]
			for (let e = offsets[u]; e < end; e++) {
				const v = targets[e]
				flowTo[slot] = v
				flowCap[slot] = capacities[e]
				adjacency[u].push(slot)
				slot++
				flowTo[slot] = u
				flowCap[slot] = 0
				adjacency[v].push(slot)
				slot++
			}
		}

		const parentEdge = new Int32Array(n)
		const seen = new Uint8Array(n)
		const bfsQueue = new Int32Array(n)
		let total = 0

		for (;;) {
			seen.fill(0)
			seen[from] = 1
			bfsQueue[0] = from
			let head = 0
			let tail = 1
			let reached = false
			while (head < tail && !reached) {
				const u = bfsQueue[head++]
				for (const idx of adjacency[u]) {
					const v = flowTo[idx]
					if (flowCap[idx] > 0 && seen[v] === 0) {
						seen[v] = 1
						parentEdge[v] = idx
						if (v === to) {
							reached = true
							break
						}
						bfsQueue[tail++] = v
					}
				}
			}
			if (!reached) {
				break
			}

			// Bottleneck along the found augmenting path (walk predecessors via reverse edges).
			let bottleneck = Infinity
			for (let v = to; v !== from; ) {
				const idx = parentEdge[v]
				if (flowCap[idx] < bottleneck) {
					bottleneck = flowCap[idx]
				}
				v = flowTo[idx ^ 1]
			}
			if (bottleneck === Infinity) {
				return Infinity // an all-unlimited path ⇒ unbounded flow
			}

			// Augment: push the bottleneck forward, credit the reverse residual.
			for (let v = to; v !== from; ) {
				const idx = parentEdge[v]
				flowCap[idx] -= bottleneck
				flowCap[idx ^ 1] += bottleneck
				v = flowTo[idx ^ 1]
			}
			total += bottleneck
		}
		return total
	}

	/**
	 * Clearing-cycle availability: how many directed cycles through `node` have spare capacity (every edge
	 * `capacity >= amount`), up to `maxDepth` hops. A bounded DFS from the node seeking a return to the
	 * start; cycle counts explode, so the count is **capped** at `maxCount` (`capped` reports whether the
	 * cap was hit). The shortest qualifying cycle's length is also returned. Cycles are **directed** — the
	 * two ways round a loop are two distinct cycles — and counted by distinct edge-sequence, so parallel
	 * tallies yield distinct cycles. Feeds the runner's clearing metric.
	 */
	clearingCycles(node: number, amount: number, maxDepth: number, maxCount: number): ClearingResult {
		this.requireNode(node)
		requirePositiveAmount(amount)
		requireDepth(maxDepth)
		requireMaxCount(maxCount)

		// Exact shortest first (cheap BFS, independent of the count cap), then the capped DFS count.
		const shortest = this.shortestCycleLength(node, amount, maxDepth)

		const { offsets, targets, capacities } = this.graph
		const onPath = this.onPath
		let count = 0
		let capped = false

		const visit = (u: number, len: number): void => {
			const end = offsets[u + 1]
			for (let e = offsets[u]; e < end; e++) {
				if (capacities[e] < amount) {
					continue
				}
				const v = targets[e]
				if (v === node) {
					if (len + 1 >= 2) {
						count++
						if (count >= maxCount) {
							capped = true
							return
						}
					}
					continue
				}
				// Extend only if there is room for a closing edge within maxDepth and v is not already
				// on the current path (keep the cycle simple: distinct intermediate nodes).
				if (len + 1 <= maxDepth - 1 && onPath[v] === 0) {
					onPath[v] = 1
					visit(v, len + 1)
					onPath[v] = 0
					if (capped) {
						return
					}
				}
			}
		}

		visit(node, 0)

		const result: ClearingResult = { count, capped }
		if (shortest !== undefined) {
			result.shortestLength = shortest
		}
		return result
	}
}
