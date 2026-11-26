/**
 * Mint a transaction record from a discovered route: the pure step that turns the ONE chosen
 * {@link Plan} (design.md § "One plan per record (v1)") into the {@link TrxRecord} the whole network
 * promises and votes on. The originator runs this once, at the moment it decides to proceed with a
 * found route; every downstream node then merges the same record by union and pushes it toward
 * settlement.
 *
 * **Pure by construction.** `mintRecord` reads the clock and the CSPRNG for nothing: the
 * transaction code is passed in (the node's `proceed` mints it with its injected clock+random) and
 * the **session code is reused from the query** — never minted fresh. Reuse matters: every edge nonce
 * on the plan's path is `makeNonce(sessionCode, linkId)` (see `../nonce.js`), so a fresh session code
 * would make every participant's `nonceToLinkId` map miss and no node could resolve its own tally.
 *
 * **The member set is already folded.** `plan.members` is the folded membership the discovery return
 * trip produced: participants in route order (origin-first, target-last), each participant's self-vote
 * and every nominated voter already present and de-duplicated by key (see `prependMatch` in
 * `../discovery/participant.js`). `mintRecord` carries it through as-is — it never invents, reorders,
 * or de-duplicates members. A `[P,V]` node is one member with both roles; a circular lift's originator
 * is one member though it rides two links.
 */

import { MemberTypes, type DependentMember, type Link, type Plan, type UniQuery } from '../discovery/types.js'
import type { TrxLink, TrxRecord } from './types.js'

/** The inputs `mintRecord` stamps into a transaction record. */
export interface MintRecordArgs<TTerms, TPayload> {
	/** The single chosen plan whose folded members + path become the record's topology. */
	plan: Plan<TTerms, TPayload>
	/** The originator's query: supplies `method`, optional `liftContract`, `intents`, `maxDepth`, and the `sessionCode` to **reuse**. */
	query: UniQuery<TTerms>
	/** The opaque Taleus value the originator sets once; carried end to end and covered by the digest. */
	payload: TPayload
	/** The self-expiring transaction code the caller minted (kept out of here so `mintRecord` stays pure). */
	transactionCode: string
}

/**
 * Fold a chosen plan into the transaction record every node settles.
 *
 * Throws when the plan cannot yield a settleable lift — an empty participant set, an empty voter set
 * (a voterless lift can never reach consensus; `NonEmptyVoterSet` at `../consensus/participant.ts`
 * would reject it at the first `update` anyway, so fail early and explainably at mint), or a path whose
 * link count fits neither a linear (`participants − 1`) nor a circular (`participants`) route.
 *
 * The result is primed for `update`'s new-record rules: a non-duplicate member set (already folded),
 * links whose every endpoint is a member, a valid `method`, `liftContract` omitted when absent, and
 * empty `promises`/`commits` — all signing flows through the verified `update`/`sign` path, so mint
 * introduces no unverified-input path.
 */
export function mintRecord<TTerms, TPayload>(args: MintRecordArgs<TTerms, TPayload>): TrxRecord<TTerms, TPayload> {
	const { plan, query, payload, transactionCode } = args

	const participants = plan.members.filter((member) => member.types.includes(MemberTypes.participant))
	if (participants.length === 0) {
		throw new Error('mintRecord: plan has no participant members — a lift needs at least one tally edge')
	}
	if (!plan.members.some((member) => member.types.includes(MemberTypes.voter))) {
		throw new Error('mintRecord: plan has no voter members — a voterless lift can never settle')
	}

	return {
		transactionCode,
		sessionCode: query.sessionCode, // REUSE — fresh session code would break every edge nonce
		payload,
		// NOTE: shallow copy — the record's member array is its own, but the member objects are shared
		// with the plan. Safe while nothing mutates a member in place (the codebase treats them as
		// immutable); deep-clone here if a caller ever starts mutating plan members after minting.
		topology: { members: [...plan.members], links: buildLinks(plan.path, participants) },
		method: query.method,
		// Omit `liftContract` when absent — DAG-CBOR rejects an `undefined`-valued key.
		...(query.liftContract !== undefined ? { liftContract: query.liftContract } : {}),
		promises: [],
		commits: [],
	}
}

/**
 * Key each path link by its (session-salted) nonce with the member keys of its source and target.
 *
 * One modular formula serves linear and circular routes: the source of path link `i` is participant
 * `i`, its target participant `(i + 1) mod n`. The `mod` only ever wraps on a circular lift's closing
 * link (`participants[last] → participants[0]`); a linear path never reaches the wrap. Keying by the
 * link's own nonce — the same nonce both endpoints derived from the shared link id, since the session
 * code is reused — keeps every participant's `nonceToLinkId` resolving.
 */
function buildLinks<TTerms>(path: Link<TTerms>[], participants: DependentMember[]): Record<string, TrxLink<TTerms>> {
	const count = participants.length
	if (path.length !== count - 1 && path.length !== count) {
		throw new Error(`mintRecord: path has ${path.length} link(s) but ${count} participant(s) — expected ${count - 1} (linear) or ${count} (circular)`)
	}
	const links: Record<string, TrxLink<TTerms>> = {}
	for (let i = 0; i < path.length; i++) {
		const link = path[i]
		links[link.nonce] = {
			source: participants[i].address.key,
			target: participants[(i + 1) % count].address.key,
			intents: link.intents,
		}
	}
	return links
}
