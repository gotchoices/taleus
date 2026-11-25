/**
 * The per-node discovery bundle. A host constructs one {@link DiscoveryNode} per graph node and uses
 * it in both roles: as the **originator** of its own searches ({@link DiscoveryNode.discover}) and as
 * a **participant** that a neighbour's `queryPeer` reaches ({@link DiscoveryNode.query}). `discover`
 * wires the node's own `query` as the originator's local participant; `query` delegates to the
 * participant from the previous ticket. This is the end-to-end wiring that turns the originator loop
 * and the participant into a working route search.
 *
 * ── Adapter note for `tallynet-bind-taleus-core` (do NOT edit taleus-core here) ──────────────────
 *
 * `taleus-core` already defines, as injected ports tested against in-memory doubles:
 *
 *     DiscoveryEngine.discover(query: LiftQuery, callbacks: NegotiateCallbacks): Promise<CandidateRoute[]>
 *         // packages/taleus-core/src/lift/agent.ts:131, src/lift/discovery.ts:316
 *
 * The binding ticket wraps a {@link DiscoveryNode} to satisfy that port. The intended mapping, for
 * that ticket to verify against the real taleus-core shapes when it runs:
 *
 *   - `LiftQuery { sessionCode, amount, payeeDenom, payeeDivisor, maxDepth, kind }` maps to a tallynet
 *     {@link Target} (the payee address) plus `intents` -- one `'L'` intent code whose `TTerms` is a
 *     Taleus `LiftTerms`-shaped record (denomination, divisor, capacity, amount) -- plus `maxDepth`.
 *     A `circular` `kind` is the self-is-target case (originator = payee), which {@link discover}
 *     already handles (the local participant's entrance self-matches at round 0).
 *   - `NegotiateCallbacks.negotiateIntent(intent, edge)` maps onto tallynet
 *     `DiscoveryHooks.negotiateIntent`; `negotiatePlan` splits onto `planSatisfies` (does this whole
 *     plan satisfy the query?) plus `annotateReturn` (amend this node's in-edge on the return trip).
 *     The backward amount accumulation moves into `annotateReturn` under the multi-denomination
 *     ticket; until then taleus-core keeps its originator-side accumulation and `annotateReturn`
 *     stays identity.
 *   - `DiscoveryResult.plans` maps to `CandidateRoute[]`: each `Plan.path` becomes a `CandidateEdge[]`,
 *     and the originator owns the first edge's real `linkId` (it holds the nonce→linkId map for its
 *     own session, via its store's `getNonceToLinkMap`).
 *
 * The time-budget growth constants are coarse guesses (no adaptive tuning in v1), and the backward
 * accumulation note above is the one piece this file only *describes* -- the binding ticket implements
 * it after confirming the `LiftQuery` / `NegotiateCallbacks` / `CandidateRoute` shapes.
 */

import type { Clock } from '../clock.js'
import type { Hasher, RandomSource } from '../crypto.js'
import type { TraceSink } from '../trace.js'
import type { DiscoveryHooks } from './hooks.js'
import { Participant, type ParticipantOptions, type SessionCodeValidators } from './participant.js'
import { UniOriginator, type DiscoveryResult, type OriginatorOptions } from './originator.js'
import type { ParticipantStore } from './store.js'
import type { FindAddressFunc, QueryPeerFunc, QueryRequest, QueryResponse, Target } from './types.js'

/** Everything a {@link DiscoveryNode} is constructed with. Ports default where the participant/originator allow. */
export interface DiscoveryNodeDeps<TTerms, TPayload> {
	/** This node's id, stamped onto every trace event. */
	nodeId: string
	/** Durable per-(session, path) participant context store (one per node). */
	store: ParticipantStore<TTerms, TPayload>
	/** All time and timers. */
	clock: Clock
	/** Randomness for the originator's session codes. */
	random: RandomSource
	/** sha256, for deriving edge nonces. */
	hasher: Hasher
	/** Host callback: resolve this node's role for a query. */
	findAddress: FindAddressFunc<TTerms, TPayload>
	/** Negotiation hooks, shared by both roles (`defaultHooks` for single-unit behaviour). */
	hooks: DiscoveryHooks<TTerms, TPayload>
	/** Host callback: send a sub-request across a link. */
	queryPeer: QueryPeerFunc<TTerms, TPayload>
	/** Tuning overrides, merged over the participant's and originator's own defaults. */
	options?: Partial<OriginatorOptions & ParticipantOptions>
	/** Optional trace sink; wrapped so a throw can never break the engine. Default: no-op. */
	trace?: TraceSink
	/** Session-code checks; default wraps `session-code.ts`. */
	sessionCodes?: SessionCodeValidators
}

export class DiscoveryNode<TTerms, TPayload> {
	readonly nodeId: string
	private readonly participant: Participant<TTerms, TPayload>
	private readonly originator: UniOriginator<TTerms, TPayload>

	constructor(deps: DiscoveryNodeDeps<TTerms, TPayload>) {
		this.nodeId = deps.nodeId
		this.participant = new Participant<TTerms, TPayload>({
			store: deps.store,
			clock: deps.clock,
			random: deps.random,
			hasher: deps.hasher,
			nodeId: deps.nodeId,
			findAddress: deps.findAddress,
			hooks: deps.hooks,
			queryPeer: deps.queryPeer,
			options: deps.options,
			trace: deps.trace,
			sessionCodes: deps.sessionCodes,
		})
		this.originator = new UniOriginator<TTerms, TPayload>({
			nodeId: deps.nodeId,
			clock: deps.clock,
			random: deps.random,
			hooks: deps.hooks,
			// The originator drives this node's own participant with no inbound link.
			localQuery: (request) => this.participant.query(request),
			options: deps.options,
			trace: deps.trace,
		})
	}

	/** Originator role: run one unidirectional search. Never throws for "not found". */
	discover(
		target: Target,
		intents: Record<string, TTerms>,
		options?: Partial<OriginatorOptions>,
	): Promise<DiscoveryResult<TTerms, TPayload>> {
		return this.originator.discover(target, intents, options)
	}

	/** Participant role: what a peer's `queryPeer` calls to pass a request through this node. */
	query(request: QueryRequest<TTerms, TPayload>, inLinkId?: string): Promise<QueryResponse<TTerms, TPayload>> {
		return this.participant.query(request, inLinkId)
	}
}
