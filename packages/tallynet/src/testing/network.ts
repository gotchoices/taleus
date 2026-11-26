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

import { bytesToBase64url } from '../base64url.js'
import { nobleHasher, type Hasher, type RandomSource, type Signer, type Verifier } from '../crypto.js'
import { makeNonce } from '../nonce.js'
import { generate } from '../session-code.js'
import type { TraceSink } from '../trace.js'
import { ConsensusNode } from '../consensus/engine.js'
import type { Logger } from '../consensus/participant.js'
import type { TrxParticipantResource } from '../consensus/resource.js'
import { MemoryTrxStore } from '../consensus/store.js'
import type { TrxLink, TrxRecord } from '../consensus/types.js'
import { DiscoveryNode } from '../discovery/engine.js'
import { defaultHooks, type DiscoveryHooks } from '../discovery/hooks.js'
import type { DiscoveryResult, OriginatorOptions } from '../discovery/originator.js'
import type { ParticipantOptions, SessionCodeValidators } from '../discovery/participant.js'
import { MemoryParticipantStore } from '../discovery/store.js'
import {
	MemberTypes,
	type Address,
	type DependentMember,
	type FindAddressFunc,
	type FindResult,
	type MemberType,
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
	/**
	 * Per-node ed25519 signer factory. **Consensus is built only when both this and {@link verifier} are
	 * given** — otherwise the harness is discovery-only (so the large discovery scale tests pay no keygen).
	 * Called exactly once per node; its `publicKey` becomes that node's consensus **member key** (see the
	 * addressing note on the class). tallynet ships no curve, so a test injects one (`@noble/curves`).
	 */
	signerFor?: (nodeId: string) => Signer
	/** Shared signature verifier for every consensus node. Required (with {@link signerFor}) to build consensus. */
	verifier?: Verifier
	/** Per-node resource port. Default: a cooperative holder (promises and releases, holds nothing real). */
	resourceFor?: (nodeId: string) => TrxParticipantResource<TTerms, TPayload>
	/** Per-node consensus logger (refusals, rejections, push failures). Default: no-op. */
	consensusLog?: (nodeId: string) => Logger
}

/** One member of a lift, by node name: its roles (`[P]` / `[R]` / `[P,R]`) and whether it publishes a dial address. */
export interface LiftMemberSpec {
	name: string
	roles: MemberType[]
	/** If true, the member gets a `physical` dial address, so every node pushes to it directly (not only over links). */
	physical?: boolean
}

/**
 * A lift to build over the consensus nodes. `route` is an ordered node-name path whose consecutive pairs
 * are the tally links of the lift chain; `extraLinks` adds any further links the topology needs (a
 * diamond's second path, a referee hung off a participant). Both resolve to real graph edges — a pair
 * with no graph edge throws. Codes are minted deterministically from the network's seeded random (or
 * supplied) so two runs with the same seed build identical records.
 */
export interface LiftSpec<TPayload> {
	/** The members, in the immutable array order the originator fixes once. */
	members: LiftMemberSpec[]
	/** Ordered node names; each consecutive pair is one lift link. The originator is `route[0]`. */
	route: string[]
	/**
	 * Optional exact link id per **route** hop, in order — length `route.length - 1` (throws on mismatch).
	 * Each consecutive route pair then resolves to the graph edge carrying this id (the neighbour is still
	 * checked), so a lift over **parallel tallies** between the same pair picks the intended tally rather
	 * than whichever edge is found first. Omit for the default (first edge to the named neighbour).
	 * `extraLinks` always use the name-pair fallback.
	 */
	routeLinkIds?: string[]
	/** Further links beyond the route path, as node-name pairs (e.g. a diamond's other arm). */
	extraLinks?: Array<[string, string]>
	/** The opaque Taleus value carried end to end. */
	payload: TPayload
	/** Override the minted session code. */
	sessionCode?: string
	/** Override the minted transaction code. */
	transactionCode?: string
	/** Code lifetime when minting (default 600_000 ms; keep under the session-code max-TTL ceiling). */
	ttlMs?: number
	/** "now" the codes are minted against (default `clock.now()`). */
	now?: number
	/** Random source for minting (default the network's seeded random; pass a fresh seed for a reproducible mint). */
	random?: RandomSource
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

	/**
	 * Receiver-side errors a consensus record push threw after delivery. A clean run leaves this `[]`;
	 * a test asserts that, or asserts an expected injected failure. (The push itself is fire-and-forget,
	 * so a receiver throw cannot propagate back to the sender — it lands here.)
	 */
	readonly deliveryErrors: Error[] = []

	private readonly random: SeededRandom
	private readonly hasher: Hasher
	private readonly invertTerms: (t: TTerms) => TTerms
	private readonly conditions?: Record<string, LinkCondition> | ((linkId: string) => LinkCondition | undefined)
	private readonly adjacency = new Map<string, AdjacencyEntry<TTerms>[]>()
	private readonly linkLookup = new Map<string, Map<string, string>>()
	private readonly nodeByName = new Map<string, DiscoveryNode<TTerms, TPayload>>()
	private readonly storeByName = new Map<string, MemoryParticipantStore<TTerms, TPayload>>()

	// ── Consensus (built only when signerFor + verifier are configured) ──────────────────────────────
	//
	// Addressing differs from discovery. Discovery keys a node by its NAME ("A", "N1"); consensus keys it
	// by its base64url ed25519 **public key** (the TrxParticipant constructor rejects a self.key that is
	// not its signer's key). ed25519 keys are 32 bytes — node names are not valid keys — so the two
	// addressing spaces are distinct and the harness keeps a name↔key bijection to route `updatePeer`.
	private consensusConfigured = false
	private readonly consensusByName = new Map<string, ConsensusNode<TTerms, TPayload>>()
	private readonly consensusStoreByName = new Map<string, MemoryTrxStore<TTerms, TPayload>>()
	private readonly consensusSignerByName = new Map<string, Signer>()
	private readonly memberKeyByName = new Map<string, string>()
	private readonly nameByMemberKey = new Map<string, string>()
	/** Each node's live nonce→linkId map; the same object reference the node holds, filled by {@link buildLift}. */
	private readonly nonceToLinkIdByName = new Map<string, Record<string, string>>()

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

		if (config.signerFor && config.verifier) {
			this.buildConsensus(config)
		}
	}

	/**
	 * Build one {@link ConsensusNode} per graph node. Two passes: first derive every node's member key
	 * (its signer's public key) and the name↔key maps, so `updatePeer` can route; then construct the
	 * nodes (each getting the live nonce→linkId object {@link buildLift} later fills).
	 */
	private buildConsensus(config: InMemoryNetworkConfig<TTerms, TPayload>): void {
		this.consensusConfigured = true
		const signerFor = config.signerFor!
		for (const name of this.nodeByName.keys()) {
			const signer = signerFor(name)
			const key = bytesToBase64url(signer.publicKey)
			this.consensusSignerByName.set(name, signer)
			this.memberKeyByName.set(name, key)
			this.nameByMemberKey.set(key, name)
		}
		for (const name of this.nodeByName.keys()) {
			this.consensusByName.set(name, this.buildConsensusNode(name, config))
		}
	}

	private buildConsensusNode(name: string, config: InMemoryNetworkConfig<TTerms, TPayload>): ConsensusNode<TTerms, TPayload> {
		const store = new MemoryTrxStore<TTerms, TPayload>()
		this.consensusStoreByName.set(name, store)
		const nonceToLinkId: Record<string, string> = {}
		this.nonceToLinkIdByName.set(name, nonceToLinkId)
		return new ConsensusNode<TTerms, TPayload>({
			self: { key: this.memberKeyByName.get(name)! },
			signer: this.consensusSignerByName.get(name)!,
			verifier: config.verifier!,
			store,
			resource: config.resourceFor ? config.resourceFor(name) : cooperativeResource<TTerms, TPayload>(),
			updatePeer: this.makeUpdatePeer(name),
			nonceToLinkId,
			clock: this.clock,
			hasher: this.hasher,
			trace: config.trace,
			log: config.consensusLog ? config.consensusLog(name) : undefined,
			sessionCodes: config.sessionCodes,
		})
	}

	/** The node named `name`. Throws if there is none. */
	node(name: string): DiscoveryNode<TTerms, TPayload> {
		const node = this.nodeByName.get(name)
		if (!node) {
			throw new Error(`no node named ${name}`)
		}
		return node
	}

	/**
	 * The participant store backing node `name` -- the originator can read its own session's
	 * `getNonceToLinkMap` through it (as a host would via its real store). Throws if there is no such node.
	 */
	storeOf(name: string): MemoryParticipantStore<TTerms, TPayload> {
		const store = this.storeByName.get(name)
		if (!store) {
			throw new Error(`no node named ${name}`)
		}
		return store
	}

	/**
	 * Merge every node's nonce->linkId map for `session` into one lookup. A test/sim helper for
	 * resolving a returned plan's anonymised path nonces back to real link ids (to check the route is a
	 * valid chain). Its cost is O(nodes) and it is NEVER used in discovery control flow -- a node only
	 * ever reads its own store (the per-query scale invariant).
	 */
	async nonceToLinkMap(session: string): Promise<Record<string, string>> {
		const merged: Record<string, string> = {}
		for (const store of this.storeByName.values()) {
			Object.assign(merged, await store.getNonceToLinkMap(session))
		}
		return merged
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

	/* ── consensus ──────────────────────────────────────────────────────────────────────── */

	/** The consensus node named `name`. Throws if consensus was not configured, or there is no such node. */
	consensusNode(name: string): ConsensusNode<TTerms, TPayload> {
		this.requireConsensus()
		const node = this.consensusByName.get(name)
		if (!node) {
			throw new Error(`no consensus node named ${name}`)
		}
		return node
	}

	/** The consensus store backing node `name` (for a test that asserts the stored record directly). */
	consensusStoreOf(name: string): MemoryTrxStore<TTerms, TPayload> {
		this.requireConsensus()
		const store = this.consensusStoreByName.get(name)
		if (!store) {
			throw new Error(`no consensus node named ${name}`)
		}
		return store
	}

	/** The base64url member key the node `name` signs with (its consensus address). */
	memberKey(name: string): string {
		return this.memberKeyFor(name)
	}

	/**
	 * Build a lift record over the consensus nodes from a {@link LiftSpec}: resolve each route/extra link
	 * to its real graph edge, derive the per-session nonce for it, assemble the immutable topology, and
	 * populate every involved node's live nonce→linkId map so its resource context resolves real link
	 * ids. Returns the record (with empty signature sets) plus the minted/supplied codes. Feed the record
	 * to the originator's {@link ConsensusNode.start} and drive the clock.
	 */
	buildLift(spec: LiftSpec<TPayload>): { record: TrxRecord<TTerms, TPayload>; sessionCode: string; transactionCode: string } {
		this.requireConsensus()
		const now = spec.now ?? this.clock.now()
		const random = spec.random ?? this.random
		const ttlMs = spec.ttlMs ?? 600_000
		const sessionCode = spec.sessionCode ?? generate(ttlMs, { now, random })
		const transactionCode = spec.transactionCode ?? generate(ttlMs, { now, random })

		const members: DependentMember[] = spec.members.map((member) => ({
			types: member.roles,
			address: { key: this.memberKeyFor(member.name) },
			...(member.physical ? { physical: `dial:${member.name}` } : {}),
		}))

		const links: Record<string, TrxLink<TTerms>> = {}
		const hopCount = Math.max(spec.route.length - 1, 0)
		if (spec.routeLinkIds && spec.routeLinkIds.length !== hopCount) {
			throw new Error(`buildLift: routeLinkIds has ${spec.routeLinkIds.length} ids but the route has ${hopCount} hops`)
		}
		for (let i = 0; i + 1 < spec.route.length; i++) {
			this.addLiftLink(links, sessionCode, spec.route[i], spec.route[i + 1], spec.routeLinkIds?.[i])
		}
		for (const [a, b] of spec.extraLinks ?? []) {
			this.addLiftLink(links, sessionCode, a, b)
		}

		const record: TrxRecord<TTerms, TPayload> = {
			transactionCode,
			sessionCode,
			payload: spec.payload,
			topology: { members, links },
			promises: [],
			commits: [],
		}
		return { record, sessionCode, transactionCode }
	}

	/**
	 * Resolve one lift link to its graph edge, key it by nonce, and record the nonce→linkId both ends own.
	 * With `linkId` the edge must match both that id **and** the neighbour `b` (so a stale/foreign id throws
	 * rather than silently selecting a parallel tally); without it, the first edge to `b` is taken.
	 */
	private addLiftLink(links: Record<string, TrxLink<TTerms>>, sessionCode: string, a: string, b: string, linkId?: string): void {
		const adjacency = this.adjacency.get(a) ?? []
		const edge =
			linkId !== undefined
				? adjacency.find((candidate) => candidate.id === linkId && candidate.neighbour === b)
				: adjacency.find((candidate) => candidate.neighbour === b)
		if (!edge) {
			throw new Error(
				linkId !== undefined
					? `buildLift: no graph link ${linkId} between ${a} and ${b}`
					: `buildLift: no graph link between ${a} and ${b}`,
			)
		}
		const nonce = makeNonce(sessionCode, edge.id, this.hasher)
		links[nonce] = { source: this.memberKeyFor(a), target: this.memberKeyFor(b), intents: edge.terms }
		this.nonceToLinkIdByName.get(a)![nonce] = edge.id
		this.nonceToLinkIdByName.get(b)![nonce] = edge.id
	}

	/**
	 * Wire one node's consensus `updatePeer`. **Fire-and-forget**: it schedules the delivery on the clock
	 * and resolves immediately. It must NOT await the neighbour's `update` — consensus reachability has a
	 * 2-cycle on every tally link (both ends push to each other), so awaiting would re-enter a node before
	 * its own `savePeerRecord` ran and recurse unboundedly. The sender's `push` saves the peer snapshot
	 * right after this resolves; the record diffuses as each scheduled `update` fires. A `drop` link
	 * resolves immediately and schedules nothing (the neighbour never receives this copy); a receiver-side
	 * throw is caught into {@link deliveryErrors}, not propagated to the sender.
	 */
	private makeUpdatePeer(fromName: string): (record: TrxRecord<TTerms, TPayload>, to: Address) => Promise<void> {
		return (record, to) => {
			const toName = this.nameByMemberKey.get(to.key)
			if (!toName) {
				return Promise.reject(new Error(`no consensus node for member ${to.key}`))
			}
			const condition = this.pushCondition(fromName, toName)
			if (condition?.drop) {
				return Promise.resolve() // dropped: schedule no delivery; the record must arrive another way or stall
			}
			const fromKey = this.memberKeyFor(fromName)
			// Fire-and-forget: the VirtualClock's macrotask drain flushes the whole `update` — including the
			// onward pushes it schedules only at its end — before firing the next timer, so the promise needs
			// no tracking here. A receiver-side throw is caught into deliveryErrors, never propagated back to
			// the fire-and-forget sender (see the method doc).
			this.clock.setTimer(
				() => {
					void this.consensusByName
						.get(toName)!
						.update(record, { key: fromKey })
						.then(
							() => {},
							(error: unknown) => {
								this.deliveryErrors.push(error instanceof Error ? error : new Error(String(error)))
							},
						)
				},
				condition?.latencyMs ?? 0,
			)
			return Promise.resolve()
		}
	}

	/**
	 * The link condition governing a push from `fromName` to `toName`: the condition on the direct graph
	 * edge between them, or `undefined` (instant, reliable) when there is no such edge — the case for a
	 * referee-only member reached by a `physical` dial address rather than a tally link.
	 */
	private pushCondition(fromName: string, toName: string): LinkCondition | undefined {
		const edge = (this.adjacency.get(fromName) ?? []).find((candidate) => candidate.neighbour === toName)
		return edge ? this.resolveCondition(edge.id) : undefined
	}

	private requireConsensus(): void {
		if (!this.consensusConfigured) {
			throw new Error('consensus is not configured on this network: pass signerFor + verifier to the constructor')
		}
	}

	private memberKeyFor(name: string): string {
		this.requireConsensus()
		const key = this.memberKeyByName.get(name)
		if (!key) {
			throw new Error(`no consensus node named ${name}`)
		}
		return key
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
		const store = new MemoryParticipantStore<TTerms, TPayload>()
		this.storeByName.set(name, store)
		return new DiscoveryNode<TTerms, TPayload>({
			nodeId: name,
			store,
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
 * The default consensus resource: a cooperative holder. It promises and releases without error and
 * holds nothing real (a test that needs a refuser, a sleeper, or an attachment injects its own via
 * `resourceFor`). No curve or platform dependency — it ships inside this platform-neutral module.
 */
function cooperativeResource<TTerms, TPayload>(): TrxParticipantResource<TTerms, TPayload> {
	return {
		promise: () => {},
		release: () => {},
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
