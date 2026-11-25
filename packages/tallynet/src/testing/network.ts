/**
 * The in-memory discovery network: one {@link DiscoveryNode} per graph node, wired to each other
 * directly over the {@link VirtualClock}, so a whole route search runs end to end in one process on
 * compressed, deterministic time. It mirrors ChipNet's `test/{test-network,uni-scenario}.ts` on the
 * injected ports. It ships behind the `tallynet/testing` subpath export because `tallysim` and the
 * viewer build on it; anything simulator-specific (richer graph generators, a scheduler, metrics,
 * the Taleus trading model) belongs in `tallysim`, not here.
 *
 * ── Shared link ids (not a shortcut) ────────────────────────────────────────────────────────────
 *
 * A link is an **undirected** edge `{ id, node1, node2, intents }` where `intents` are the terms as
 * seen from `node1 -> node2`. The **same link id** is used from both endpoints. That is correct, not
 * a shortcut: `makeNonce(session, linkId)` is computed identically by both ends of a tally (see
 * `nonce.ts`), so a neighbour reached over link L sees the same nonce the sender put on the plan
 * tail, and the participant's cycle check (prune a candidate whose nonce is already on the path)
 * fires on the back-link automatically. Terms are **inverted** for the `node2 -> node1` direction (a
 * credit balance flips sign across the edge, as ChipNet's `TestLink.invertedLink()` does). Inversion
 * is per-`TTerms`: pass `invertTerms` (default identity); {@link negateNumericTerms} covers the
 * `{ balance: number }` case.
 *
 * ── Driving a search ────────────────────────────────────────────────────────────────────────────
 *
 * `discover(...)` returns a promise that settles only once the search completes, and the search
 * waits on virtual timers -- so nothing progresses until you drive the clock. The pattern is:
 *
 *     const result = net.discover('A', { address: { key: 'Z' } }, { L: terms })
 *     await net.clock.runUntilIdle()   // fires every delivery + budget timer, in order
 *     const { plans } = await result
 *
 * All nodes share one `VirtualClock` and one `SeededRandom`. Session codes are drawn at `discover()`
 * call time, synchronously, in call order, so the run is reproducible; concurrent originators keep
 * independent stores and contexts, so they do not interfere.
 *
 * The link condition model is deliberately simple: `latencyMs` is the request leg only (the response
 * returns in the same virtual instant the neighbour's `query` resolves); `drop` is an
 * eternally-sleeping delivery that never resolves (no timer armed). A "sleeping node that wakes late"
 * is just a finite `latencyMs` spanning one or more round budgets -- the participant already folds a
 * late answer into a later round.
 */

import { nobleHasher, type Hasher } from '../crypto.js'
import type { TraceSink } from '../trace.js'
import { DiscoveryNode } from '../discovery/engine.js'
import { defaultHooks, type DiscoveryHooks } from '../discovery/hooks.js'
import type { DiscoveryResult, OriginatorOptions } from '../discovery/originator.js'
import type { ParticipantOptions, SessionCodeValidators } from '../discovery/participant.js'
import { MemoryParticipantStore } from '../discovery/store.js'
import {
	MemberTypes,
	type FindAddressFunc,
	type FindResult,
	type QueryPeerFunc,
	type QueryRequest,
	type QueryResponse,
	type Target,
} from '../discovery/types.js'
import { VirtualClock } from './clock.js'
import type { SeededRandom } from './random.js'

/** An undirected edge. `intents` are the terms seen from `node1 -> node2`; the reverse view is inverted. */
export interface NetworkLink<TTerms> {
	id: string
	node1: string
	node2: string
	intents: Record<string, TTerms>
}

/** A graph: node names and the links between them. */
export interface NetworkGraph<TTerms> {
	nodes: string[]
	links: NetworkLink<TTerms>[]
}

/** The three per-link delivery knobs, resolved per delivery. See the module doc for their exact meaning. */
export interface LinkCondition {
	/** Virtual ms before the request reaches the neighbour. The response returns in the same instant it resolves. */
	latencyMs?: number
	/** If true, deliveries over this link never resolve (an eternally-sleeping delivery; no timer armed). */
	drop?: boolean
}

/** Everything an {@link InMemoryNetwork} is built from. */
export interface InMemoryNetworkConfig<TTerms, TPayload> {
	graph: NetworkGraph<TTerms>
	/** Shared virtual clock; `discover` settles only once you drive it (see the module doc). */
	clock: VirtualClock
	/** Shared seeded randomness (session codes, and any host hook that draws). */
	random: SeededRandom
	/** Negotiation hooks, one object for all nodes or a per-node factory. Default: {@link defaultHooks}. */
	hooks?: DiscoveryHooks<TTerms, TPayload> | ((nodeId: string) => DiscoveryHooks<TTerms, TPayload>)
	/** Invert one edge's terms for the `node2 -> node1` view. Default: identity. See {@link negateNumericTerms}. */
	invertTerms?: (t: TTerms) => TTerms
	/** Per-link conditions, as a map or a function. Links with no entry deliver instantly and reliably. */
	conditions?: Record<string, LinkCondition> | ((linkId: string) => LinkCondition | undefined)
	/** Tuning overrides merged over the originator's and participant's defaults. */
	options?: Partial<OriginatorOptions & ParticipantOptions>
	/** Session-code checks; default wraps `session-code.ts`. */
	sessionCodes?: SessionCodeValidators
	/**
	 * Optional trace sink shared by every node. It is NOT a per-node factory: a `TraceSink` is itself
	 * a function, so a factory could not be told apart from a sink at runtime. Every {@link TraceEvent}
	 * already carries its emitting node's id, so a shared sink that switches on `event.nodeId` gives
	 * per-node behaviour without the ambiguity. Default: none.
	 */
	trace?: TraceSink
	/** Convenience override for the minted session code's lifetime, folded into `options.sessionTtlMs`. */
	sessionTtlMs?: number
	/** sha256 for deriving edge nonces; one shared hasher so both ends of a link agree. Default: `@noble/hashes`. */
	hasher?: Hasher
}

/** One side of a link as a node sees it: the shared link id, the neighbour, and this direction's terms. */
interface AdjacencyEntry<TTerms> {
	id: string
	neighbour: string
	terms: Record<string, TTerms>
}

export class InMemoryNetwork<TTerms, TPayload> {
	/** The shared virtual clock. Drive it (`runUntilIdle` / `advance`) to progress a `discover`. */
	readonly clock: VirtualClock

	private readonly random: SeededRandom
	private readonly hasher: Hasher
	private readonly invertTerms: (t: TTerms) => TTerms
	private readonly conditions?: Record<string, LinkCondition> | ((linkId: string) => LinkCondition | undefined)
	private readonly adjacency = new Map<string, AdjacencyEntry<TTerms>[]>()
	private readonly linkLookup = new Map<string, Map<string, string>>()
	private readonly nodeByName = new Map<string, DiscoveryNode<TTerms, TPayload>>()

	constructor(config: InMemoryNetworkConfig<TTerms, TPayload>) {
		this.clock = config.clock
		this.random = config.random
		this.hasher = config.hasher ?? nobleHasher
		this.invertTerms = config.invertTerms ?? ((t) => t)
		this.conditions = config.conditions

		const nodeSet = new Set(config.graph.nodes)
		for (const name of config.graph.nodes) {
			this.adjacency.set(name, [])
			this.linkLookup.set(name, new Map())
		}
		// NOTE: link ids are assumed unique across the graph; linkLookup keeps the last if an id repeats.
		// (The same id on both endpoints does NOT collide -- the lookup is keyed by node AND id.) If
		// parallel edges sharing an id are ever modelled, key the lookup differently.
		for (const link of config.graph.links) {
			if (!nodeSet.has(link.node1) || !nodeSet.has(link.node2)) {
				throw new Error(`link ${link.id} references a node not in the graph (${link.node1} -- ${link.node2})`)
			}
			this.addEdge(link.node1, link.id, link.node2, link.intents)
			this.addEdge(link.node2, link.id, link.node1, this.invertIntents(link.intents))
		}

		const options = this.mergeOptions(config)
		for (const name of config.graph.nodes) {
			this.nodeByName.set(name, this.buildNode(name, config, options))
		}
	}

	/** The node named `name`. Throws if there is none. */
	node(name: string): DiscoveryNode<TTerms, TPayload> {
		const node = this.nodeByName.get(name)
		if (!node) {
			throw new Error(`no node named ${name}`)
		}
		return node
	}

	/** Convenience: run a search from node `from`. Drive {@link clock} to settle the returned promise. */
	discover(
		from: string,
		target: Target,
		intents: Record<string, TTerms>,
		options?: Partial<OriginatorOptions>,
	): Promise<DiscoveryResult<TTerms, TPayload>> {
		return this.node(from).discover(target, intents, options)
	}

	/**
	 * Deliver one sub-request from `from` across link `linkId`, exactly as a node's own wired
	 * `queryPeer` does -- honouring the link's condition. A harness-level primitive (discovery uses
	 * the per-node `queryPeer` wired internally); exposed so a test can exercise one hop directly.
	 */
	deliver(from: string, request: QueryRequest<TTerms, TPayload>, linkId: string): Promise<QueryResponse<TTerms, TPayload>> {
		return this.send(from, request, linkId)
	}

	private addEdge(from: string, id: string, neighbour: string, terms: Record<string, TTerms>): void {
		this.adjacency.get(from)!.push({ id, neighbour, terms })
		this.linkLookup.get(from)!.set(id, neighbour)
	}

	private invertIntents(intents: Record<string, TTerms>): Record<string, TTerms> {
		const inverted: Record<string, TTerms> = {}
		for (const [code, terms] of Object.entries(intents)) {
			inverted[code] = this.invertTerms(terms)
		}
		return inverted
	}

	private mergeOptions(config: InMemoryNetworkConfig<TTerms, TPayload>): Partial<OriginatorOptions & ParticipantOptions> | undefined {
		if (config.sessionTtlMs === undefined) {
			return config.options
		}
		return { ...config.options, sessionTtlMs: config.sessionTtlMs }
	}

	private buildNode(
		name: string,
		config: InMemoryNetworkConfig<TTerms, TPayload>,
		options: Partial<OriginatorOptions & ParticipantOptions> | undefined,
	): DiscoveryNode<TTerms, TPayload> {
		const adjacency = this.adjacency.get(name) ?? []
		return new DiscoveryNode<TTerms, TPayload>({
			nodeId: name,
			store: new MemoryParticipantStore<TTerms, TPayload>(),
			clock: this.clock,
			random: this.random,
			hasher: this.hasher,
			findAddress: this.makeFindAddress(name, adjacency),
			hooks: this.resolveHooks(config.hooks, name),
			queryPeer: this.makeQueryPeer(name),
			options,
			trace: config.trace,
			sessionCodes: config.sessionCodes,
		})
	}

	/** Resolve this node's role for a query from its adjacency, in O(degree). Mirrors ChipNet's `uni-scenario`. */
	private makeFindAddress(name: string, adjacency: AdjacencyEntry<TTerms>[]): FindAddressFunc<TTerms, TPayload> {
		return (query, _inLinkId) =>
			Promise.resolve<FindResult<TTerms, TPayload>>({
				self: { member: { types: [MemberTypes.participant], address: { key: name } } },
				selfIsMatch: query.target.address.key === name,
				peerMatch: adjacency
					.filter((edge) => edge.neighbour === query.target.address.key)
					.map((edge) => ({
						match: { member: { types: [MemberTypes.participant], address: { key: edge.neighbour } } },
						link: { id: edge.id, intents: edge.terms },
					})),
				candidates: adjacency.map((edge) => ({ id: edge.id, intents: edge.terms })),
			})
	}

	private makeQueryPeer(name: string): QueryPeerFunc<TTerms, TPayload> {
		return (request, linkId) => this.send(name, request, linkId)
	}

	/** The one delivery primitive both `queryPeer` and `deliver` use. */
	private send(from: string, request: QueryRequest<TTerms, TPayload>, linkId: string): Promise<QueryResponse<TTerms, TPayload>> {
		const neighbour = this.linkLookup.get(from)?.get(linkId)
		if (neighbour === undefined) {
			// A linkId with no neighbour is the error case: the sub-query rejects (pruned `failed`), never a crash.
			return Promise.reject(new Error(`link ${linkId} has no neighbour at ${from}`))
		}
		const condition = this.resolveCondition(linkId)
		if (condition?.drop) {
			return new Promise<QueryResponse<TTerms, TPayload>>(() => {
				// Dropped link: an eternally-sleeping delivery. No timer armed, so it never resolves; the
				// sender's budget skips it every round and it is pruned when the depth ceiling is reached.
			})
		}
		return new Promise<QueryResponse<TTerms, TPayload>>((resolve, reject) => {
			this.clock.setTimer(() => {
				void this.node(neighbour).query(request, linkId).then(resolve, reject)
			}, condition?.latencyMs ?? 0)
		})
	}

	private resolveCondition(linkId: string): LinkCondition | undefined {
		if (!this.conditions) {
			return undefined
		}
		return typeof this.conditions === 'function' ? this.conditions(linkId) : this.conditions[linkId]
	}

	private resolveHooks(
		hooks: DiscoveryHooks<TTerms, TPayload> | ((nodeId: string) => DiscoveryHooks<TTerms, TPayload>) | undefined,
		name: string,
	): DiscoveryHooks<TTerms, TPayload> {
		if (!hooks) {
			return defaultHooks<TTerms, TPayload>()
		}
		return typeof hooks === 'function' ? hooks(name) : hooks
	}
}

/**
 * Negate every numeric field of a `{ [code]: number }` terms record -- the standard `invertTerms`
 * for a `{ balance: number }` edge, where a credit balance flips sign across the link.
 */
export function negateNumericTerms<T extends Record<string, number>>(terms: T): T {
	const out: Record<string, number> = {}
	for (const key of Object.keys(terms)) {
		out[key] = -terms[key]
	}
	return out as T
}

/**
 * A basic seeded random graph: node names `N0..N{nodeCount-1}` and `linkCount` edges between random
 * node pairs (self-loops avoided when more than one node exists), each carrying one `'L'` intent code
 * whose terms come from `makeTerms` (default a `{ balance }` record in [-500, 500)). Deterministic for
 * a given `random`. Mirrors ChipNet's `TestNetwork.generate`, but seeded. Anything richer belongs in
 * `tallysim`.
 */
export function randomGraph<TTerms>(
	nodeCount: number,
	linkCount: number,
	random: SeededRandom,
	makeTerms?: (random: SeededRandom) => TTerms,
): NetworkGraph<TTerms> {
	if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
		throw new Error(`randomGraph: nodeCount must be a positive integer, got ${String(nodeCount)}`)
	}
	if (!Number.isInteger(linkCount) || linkCount < 0) {
		throw new Error(`randomGraph: linkCount must be a non-negative integer, got ${String(linkCount)}`)
	}
	// The default balance factory only type-checks against an arbitrary TTerms via a cast; a caller
	// whose TTerms is not `{ balance: number }`-shaped must pass its own `makeTerms`.
	const terms: (r: SeededRandom) => TTerms = makeTerms ?? ((r) => ({ balance: r.nextFloat() * 1000 - 500 }) as unknown as TTerms)

	const nodes: string[] = []
	for (let i = 0; i < nodeCount; i++) {
		nodes.push(`N${i}`)
	}
	const links: NetworkLink<TTerms>[] = []
	for (let i = 0; i < linkCount; i++) {
		const a = random.nextInt(nodeCount)
		let b = random.nextInt(nodeCount)
		if (nodeCount > 1) {
			while (b === a) {
				b = random.nextInt(nodeCount)
			}
		}
		links.push({ id: `L${i}`, node1: nodes[a], node2: nodes[b], intents: { L: terms(random) } })
	}
	return { nodes, links }
}
