/**
 * The consensus data model: the promise/commit transaction record every node merges by union and
 * pushes toward settlement, plus the signature shape that carries a party's vote on it. Ported from
 * ChipNet's `transaction/record.ts` and `signature`, with the corrections docs/design.md
 * § Protocol design (Consensus) and docs/chipnet-review.md § Transaction module defects call for.
 *
 * This ticket builds the record, the signed preimage, the sign/verify helpers and the store. It does
 * **not** build the merge/advance/push state machine — that is `tallynet-consensus-participant`.
 *
 * Member and address types are **reused** from discovery (`../discovery/types.js`), not redefined: a
 * transaction-time route is the same membership model the search produced. Only the consensus-specific
 * shapes are new here.
 *
 * Nothing here carries a live promise, a function, or an explicit `undefined`-valued key: every record
 * must round-trip through JSON and through TallyNet's DAG-CBOR `canonicalEncode` so a durable (SQL)
 * store can persist it and so the digest is a safe preimage. Follow the discovery store's "omit, don't
 * undefine" discipline — leave an optional field absent, never set it to `undefined`.
 */

import type { ConsensusMethod, DependentMember } from '../discovery/types.js'

/**
 * The kind of a signature. A **promise** (`P`) / **no-promise** (`NP`) is cast by a participant; a
 * **commit** (`C`) / **no-commit** i.e. void (`NC`) is cast by a voter. The kind is bound INTO the
 * signed preimage (see `digest.ts`), so a signature cannot be relabelled from one kind to another
 * without failing verification — the fix for ChipNet's type-substitution hole.
 */
export type SignatureType = 'P' | 'NP' | 'C' | 'NC'

/** The signature-type constants, so call sites read `SignatureTypes.promise` rather than a bare `'P'`. */
export const SignatureTypes = { promise: 'P', noPromise: 'NP', commit: 'C', noCommit: 'NC' } as const satisfies Record<string, SignatureType>

/**
 * One signature on a record.
 *
 * - `address` is the signer's key, base64url-encoded — it equals a topology member's `address.key`.
 * - `value` is the base64url signature bytes over the canonical preimage (see {@link recordDigest}).
 * - `attachment` is OPAQUE host data a signer may ride alongside its signature. At commit a Taleus
 *   voter attaches its per-edge settlement signatures here (see docs/design.md § The commit
 *   attachment seam). TallyNet never inspects, digests, or validates `attachment`; it travels by
 *   union with the signature and is deliberately **not** part of the signed preimage. Promise-phase
 *   signatures never carry one; omit the field rather than setting it to `undefined`.
 */
export interface Signature {
	type: SignatureType
	address: string
	value: string
	attachment?: unknown
}

/**
 * One directed edge of the transaction-time route. `source`/`target` are member keys (the same
 * base64url key an {@link Address} carries); `intents` maps each intent code to that code's terms on
 * this edge. In the topology these links are keyed by the edge's per-session nonce (see
 * {@link TrxTopology}), so DAG-CBOR's sorted map keys make the set of links order-independent.
 */
export interface TrxLink<TTerms> {
	source: string
	target: string
	intents: Record<string, TTerms>
}

/**
 * The transaction-time view of the route.
 *
 * - `members` is an **array** whose order the originator fixes once; it is part of the immutable core,
 *   so a reordering reads as a core mismatch (checked in the participant ticket). Each member carries
 *   its `types` (`'P'` participant / `'V'` voter) and may nominate voters/relays via `dependsOn`.
 * - `links` is a **map keyed by the edge's per-session nonce**, so link order is irrelevant under
 *   DAG-CBOR's sorted map keys.
 */
export interface TrxTopology<TTerms> {
	members: DependentMember[]
	links: Record<string, TrxLink<TTerms>>
}

/**
 * The self-describing transaction record — the single object every node merges by union and pushes to
 * reachable members until it settles.
 *
 * - `transactionCode` and `sessionCode` are self-expiring codes in `session-code.ts` format (reuse
 *   `isValid` / `isExpired` / `expiresAt` for **both**): the transaction code bounds the whole lift,
 *   the session code salts the edge nonces.
 * - `payload` is the opaque Taleus value and MUST canonically encode — it is covered by the digest, so
 *   a signing host must supply a `DigestValue`-compatible payload (see {@link recordDigest}).
 * - `method` and the optional `liftContract` are part of the immutable, promise-signed core: every
 *   signature binds them (see {@link recordDigest}), so a peer cannot alter the win condition or the
 *   referenced contract. `method` carries the vote weighting and threshold settlement reads; omit
 *   `liftContract` when absent (never set it to `undefined` — DAG-CBOR rejects it).
 * - `promises` and `commits` each accumulate by **union** as the record propagates; the signed
 *   preimage binds enough of the record (and, for commits, the promise set) that a merge can detect a
 *   forged, replayed, or equivocating signature (see {@link SignatureRejectReason}).
 */
export interface TrxRecord<TTerms, TPayload> {
	transactionCode: string
	sessionCode: string
	payload: TPayload
	topology: TrxTopology<TTerms>
	/** The vote weighting + threshold the lift settles under (part of the immutable, signed core). */
	method: ConsensusMethod
	/** Optional reference (a Stroc CID) to the lift's written contract. Omit when absent — never `undefined`. */
	liftContract?: string
	promises: Signature[]
	commits: Signature[]
}

/**
 * Why a signature was refused when merging or verifying a record. Carried on the `signature-rejected`
 * trace event (`../trace.js`). Defined here so the participant ticket inherits one vocabulary.
 */
export type SignatureRejectReason =
	| 'forged'        // verification failed against a determined preimage (covers type-substitution)
	| 'non-member'    // signer address is not in topology.members
	| 'wrong-role'    // a non-P member signed P/NP, or a non-V member signed C/NC
	| 'replay'        // a valid signature for a DIFFERENT (tx, session) with the same topology
	| 'changed'       // the signer already contributed a different value for this phase
	| 'equivocation'  // the signer contributed both faces of a phase (P&NP, or C&NC)
	| 'core-mismatch' // the record's immutable core differs from the stored copy
	| 'expired'       // transaction or session code expired
	| 'pool-full'     // the pending-commit side pool cap was reached for this signer (an unverifiable commit, dropped)
