/**
 * The discovery data model: the request/response shapes and plan/member structures a unidirectional
 * route search passes between nodes. Ported from ChipNet's `address`/`member`/`intent`/`plan`/
 * `target`/`query-struct`/`reentrance` and `unidirectional/{query,find-result}.ts`, with the
 * corrections docs/design.md § Protocol design calls for:
 *
 *   - **Generic over link terms and plan payload.** `TTerms` is whatever a host puts on a link for
 *     one intent code (a lift capacity, a comms descriptor, …); `TPayload` is whatever rides along a
 *     plan. TallyNet never inspects either -- it hands them to the host's callbacks and hooks.
 *   - **One link shape.** ChipNet had two (`PlanLink`'s `intents` record vs `Link`'s `Intent[]`);
 *     this collapses to one, {@link Link}, an intent-code → terms record.
 *   - **Extensible intent codes.** Codes are `string`, not ChipNet's `'L' | 'C'`.
 *   - **Address is key-only.** ChipNet's optional `cuid` narrowing is dropped; a party is exactly
 *     whoever holds the private key registered at a link.
 *
 * None of these types carries a live promise, a function, or a `sessionCode` smuggled onto a plan
 * (ChipNet's `participant.ts:167` bug) -- everything here round-trips through JSON/CBOR so a durable
 * (SQL) store can persist it. See `store.ts` for the durable/in-flight split.
 */

/** A party authorised at a link: whoever holds the private key registered there. */
export interface Address {
	/** base64url-encoded public key. (ChipNet's optional `cuid` narrowing is dropped.) */
	key: string
}

/**
 * Participant (must promise) or voter (votes at commit). All nodes can additionally relay. A
 * **referee** is simply a voter (`'V'`) that is not also a participant — it rides no tally edge and
 * only votes; there is no distinct wire code for it.
 */
export type MemberType = 'P' | 'V'

/** The member-type constants, so call sites read `MemberTypes.participant` rather than a bare `'P'`. */
export const MemberTypes = { participant: 'P', voter: 'V' } as const satisfies Record<string, MemberType>

export interface Member {
	types: MemberType[]
	/** Optional dial address (a multiaddr) the member can be reached at directly. */
	physical?: string
	/** Member's encrypted private data (e.g. an auth token), opaque to TallyNet. */
	secret?: string
	/** If true, don't cache this member's address -- it is likely ephemeral. Default: false. */
	noCache?: boolean
}

export interface IdentifiedMember extends Member {
	address: Address
}

export interface DependentMember extends IdentifiedMember {
	/** Other members this member nominates (voters or relays). */
	dependsOn?: Address[]
}

/**
 * One anonymised edge on a plan's path. `nonce` = {@link makeNonce} of the link id under the
 * session code, so only the edge's owner can map it back to a tally. `intents` maps each intent
 * code to that code's (negotiated) terms on this edge.
 */
export interface Link<TTerms> {
	nonce: string
	intents: Record<string, TTerms>
}

/**
 * A route under construction. `path` grows outward (one link per hop, toward the target); `members`
 * are prepended on the return trip (participants first, then any nominated voters/relays). The
 * optional `payload` is a host value carried end to end (e.g. a terminus→originator message).
 */
export interface Plan<TTerms, TPayload> {
	path: Link<TTerms>[]
	members: DependentMember[]
	payload?: TPayload
}

/** @returns a new plan with `link` appended to the path (the outward step). */
export function appendPath<TTerms, TPayload>(plan: Plan<TTerms, TPayload>, link: Link<TTerms>): Plan<TTerms, TPayload> {
	return { ...plan, path: [...plan.path, link] }
}

/** The search target: the address to reach, plus an optional dial hint and an encrypted secret for it. */
export interface Target {
	address: Address
	physical?: string
	secret?: string
}

/**
 * The rules a lift is proposed to run under: how votes are weighted and the threshold the winning side
 * must reach. Carried as explicit proposal parameters (on the {@link UniQuery} at discovery time and the
 * transaction record's immutable core at settlement time) so every node sees — and every signature binds —
 * the exact win condition. There are no global rules; a node accepts or refuses the method it is offered.
 */
export interface ConsensusMethod {
	/**
	 * How vote weight is assigned. v1 implements only `'distinct-voter'` (one vote per distinct voter;
	 * total weight = voter count). Reserved and validation-rejected until built: `'nominator-split'` and
	 * future weightings.
	 */
	weighting: 'distinct-voter'
	/**
	 * The winning side must REACH the rational fraction `thresholdNum / thresholdDen` of total vote
	 * weight, on top of always holding a strict majority. Default `1 / 2` (a plain strict majority).
	 * Integers only, so the comparison is exact and deterministic.
	 */
	thresholdNum: number
	thresholdDen: number
}

/** The default consensus method: `distinct-voter` weighting at a plain strict-majority threshold (1/2). */
export const DEFAULT_CONSENSUS_METHOD: ConsensusMethod = { weighting: 'distinct-voter', thresholdNum: 1, thresholdDen: 2 }

/**
 * Validate a {@link ConsensusMethod}'s shape, shared by the discovery query rules and the consensus
 * new-record rules so one vocabulary of failures serves both. Returns a human-readable message naming the
 * offending field, or `undefined` when the method is well-formed.
 *
 * A valid method: has `weighting === 'distinct-voter'` (the only v1 weighting); `thresholdNum`/
 * `thresholdDen` positive integers; and `1/2 ≤ thresholdNum/thresholdDen ≤ 1` — a threshold below the
 * strict-majority floor is meaningless (the floor already applies) and above 1 is unreachable.
 */
export function consensusMethodError(method: ConsensusMethod | undefined): string | undefined {
	if (!method || typeof method !== 'object') {
		return 'Missing consensus method'
	}
	if (method.weighting !== 'distinct-voter') {
		return `Unsupported consensus weighting '${String(method.weighting)}' (only 'distinct-voter' is implemented)`
	}
	const { thresholdNum, thresholdDen } = method
	if (!Number.isInteger(thresholdNum) || !Number.isInteger(thresholdDen) || thresholdNum <= 0 || thresholdDen <= 0) {
		return 'Consensus threshold must be a ratio of positive integers'
	}
	if (2 * thresholdNum < thresholdDen) {
		return 'Consensus threshold must be at least 1/2'
	}
	if (thresholdNum > thresholdDen) {
		return 'Consensus threshold must be at most 1 (a threshold of 1 means unanimity)'
	}
	return undefined
}

/**
 * The originator's query, carried unchanged to every node a search reaches. `maxDepth` rides on the
 * query so every node agrees on the ceiling (it is authoritative per-search; a node's own options
 * only supply a default when minting a query).
 */
export interface UniQuery<TTerms> {
	target: Target
	sessionCode: string
	intents: Record<string, TTerms>
	maxDepth: number
	/** The consensus method the eventual lift will settle under, so a node can refuse one it dislikes during the search. */
	method: ConsensusMethod
	/** Optional reference (a Stroc CID) to the lift's written contract. Omit when absent — never set `undefined`. */
	liftContract?: string
	/**
	 * Optional lift-window hint (ms): the transaction-code lifetime the originator intends. A node may
	 * refuse a too-short window via `acceptsQuery` (host policy). `proceed` mints the code from it.
	 */
	ttlMs?: number
}

/** A ticket a node returns while a search through it can still go deeper; feed it back to reenter. */
export interface Reentrance {
	sessionCode: string
	path: string[]
}

/**
 * Minimal, informational round timing. **NOT trusted for control flow** -- ChipNet drove its time
 * budget off a peer's self-reported stats (`originator.ts:62` never validated them); TallyNet does
 * not. Carried only so a simulator/viewer can show a round's shape. See docs/design.md § Time budget.
 */
export interface QueryStats {
	/** ms from query receipt to the earliest sub-query answer this round (gross if none). */
	earliest: number
	/** ms from query receipt to the latest sub-query answer this round (gross if none). */
	latest: number
	/** ms from query receipt to the response given. */
	gross: number
	/** count of sub-queries still outstanding when the response was given. */
	outstanding: number
}

/**
 * A request to a participant: either an `entrance` (first visit -- carries the query and the plan so
 * far) or a `reentrance` (continue a prior visit one level deeper), never both, plus the time budget
 * for this round.
 */
export interface QueryRequest<TTerms, TPayload> {
	entrance?: { query: UniQuery<TTerms>; plan: Plan<TTerms, TPayload> }
	reentrance?: Reentrance
	budgetMs: number
}

/**
 * A participant's answer: any concluding plans found so far, a reentrance ticket iff a deeper search
 * is still possible, and informational stats. No plans and no reentrance means the search via this
 * node has ended.
 */
export interface QueryResponse<TTerms, TPayload> {
	plans?: Plan<TTerms, TPayload>[]
	reentrance?: Reentrance
	stats: QueryStats
}

/** A host's real edge, as its `findAddress` returns it: the real link id and that link's terms per code. */
export interface PrivateLink<TTerms> {
	id: string
	intents: Record<string, TTerms>
}

/** A matched member and whom it depends on (nominated voters/relays). */
export interface Match {
	member: IdentifiedMember
	dependsOn?: IdentifiedMember[]
}

/** A neighbour that IS the target, with the link to it. A list: there may be more than one link to it. */
export interface PeerMatch<TTerms> {
	match: Match
	link: PrivateLink<TTerms>
}

/** What a host's {@link FindAddressFunc} returns for one node. */
export interface FindResult<TTerms, TPayload> {
	/** This participant's own member details. */
	self: Match
	/** Whether this participant is itself the target (e.g. a circular lift where originator = payee). */
	selfIsMatch: boolean
	/** Neighbours that ARE the target (populated even when self matches, in case intents don't satisfy). */
	peerMatch?: PeerMatch<TTerms>[]
	/** Links worth searching further. Populated even on a match, in case the match's intents don't satisfy. */
	candidates?: PrivateLink<TTerms>[]
	/** A host value to carry back along any plan (e.g. a terminus→originator message). */
	payload?: TPayload
}

/** Send a discovery request to the peer across link `linkId`. Supplied by the host (over its transport). */
export type QueryPeerFunc<TTerms, TPayload> =
	(request: QueryRequest<TTerms, TPayload>, linkId: string) => Promise<QueryResponse<TTerms, TPayload>>

/** Resolve this node's role for a query: is it the target, is a neighbour, what links to search. Host-supplied. */
export type FindAddressFunc<TTerms, TPayload> =
	(query: UniQuery<TTerms>, inLinkId?: string) => Promise<FindResult<TTerms, TPayload>>

/** True iff two addresses denote the same party (key-only; ChipNet's `cuid` is gone). */
export function addressesMatch(a: Address, b: Address): boolean {
	return a.key === b.key
}
