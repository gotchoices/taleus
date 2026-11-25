/**
 * The durable discovery state, and the one correction that most shaped this port: ChipNet stored
 * **live `Pending<QueryResponse>` promises inside the context it handed to `saveContext`**
 * (`query-context.ts:12`, `active-query.ts:14`). A SQL-backed store cannot persist a promise. So
 * TallyNet splits the state in two:
 *
 *   - **Durable** -- everything here. A {@link StoredContext} holds only serialisable data (query,
 *     plan so far, candidates with their nonce/depth/last-response, the nonce→linkId map, concluding
 *     plans). It round-trips through JSON and through TallyNet's DAG-CBOR `digest` validation. No
 *     promise, no function, no class instance.
 *   - **In-flight** -- the live `Pending` sub-requests. These live in an in-memory table the
 *     participant holds (see `participant.ts`), keyed by (session, path, linkId). A restart loses
 *     the table, which is fine: a candidate with no stored response is simply re-queried next round,
 *     and a candidate's durable `lastResponse` is the single source of truth for plans found.
 *
 * ChipNet's `reportCycles` / `reportTimingViolation` / `getPeerOverhead` / `reportOverhead` store
 * methods are dropped: cycle pruning is now a trace event (`candidate-pruned` / `cycle`) and peer
 * timing is no longer trusted, so there is nothing to report. A learned-overhead hint, if ever
 * wanted, is a backlog concern, not a store method.
 */

import type { Match, Plan, QueryResponse, UniQuery } from './types.js'

/** A candidate edge under consideration. Fully serialisable -- the live request lives in the in-flight table. */
export interface StoredCandidate<TTerms, TPayload> {
	linkId: string
	nonce: string
	/** The round at which this candidate's most recent sub-request was issued (0 = never requested). */
	depth: number
	/** Negotiated outbound terms for this candidate, per intent code. */
	intents: Record<string, TTerms>
	/** The most recent completed answer from this candidate, if any. Durable single source of truth. */
	lastResponse?: QueryResponse<TTerms, TPayload>
}

/** The durable per-(session, path) query context. Everything here round-trips through JSON/CBOR. */
export interface StoredContext<TTerms, TPayload> {
	query: UniQuery<TTerms>
	/** The under-construction plan as this node received it (its path ends at this node's inbound link). */
	plan: Plan<TTerms, TPayload>
	self: Match
	candidates: StoredCandidate<TTerms, TPayload>[]
	/** Maps every nonce this node minted (candidates, peer-matches, inbound) back to its real link id. */
	nonceToLinkId: Record<string, string>
	/** Concluding plans accumulated at this node (self already prepended, deduped). */
	plans?: Plan<TTerms, TPayload>[]
	/** This node's current round number (1 after the first visit, incremented per advancing reenter). */
	depth: number
	/** True once a concluding response was given -- no further reenter is possible for this context. */
	complete: boolean
}

/**
 * The durable store a participant reads and writes. A host backs it with its real persistence
 * (Quereus, etc.); {@link MemoryParticipantStore} is the reference in-memory implementation.
 *
 * The critical keying invariant: `validateNewQuery`, `getContext` and `saveContext` must all key a
 * context by the **same** (sessionCode, path) tuple. ChipNet's in-memory state checked a flat
 * `session:path` key in `validateNewQuery` against a map nested by session in `getContext`/
 * `saveContext` (`memory-participant-state.ts:25,32`), so the duplicate-query check never matched
 * and never fired. Here one {@link contextKey} serves all three.
 */
export interface ParticipantStore<TTerms, TPayload> {
	/** Reject (reject the returned promise) iff a context already exists for (sessionCode, path). */
	validateNewQuery(sessionCode: string, path: string[]): Promise<void>
	/** The stored context for (sessionCode, path), or undefined if none. */
	getContext(sessionCode: string, path: string[]): Promise<StoredContext<TTerms, TPayload> | undefined>
	/** Persist `context` under (`context.query.sessionCode`, path). Once the session expires it may be dropped. */
	saveContext(context: StoredContext<TTerms, TPayload>, path: string[]): Promise<void>
	/** Union of every stored context's `nonceToLinkId` for this session (used by the later commit engine). */
	getNonceToLinkMap(sessionCode: string): Promise<Record<string, string>>
}

/**
 * The context key. A NUL byte (`\u0000`) separates the session code from the path, and the path's
 * nonces are already comma-free base64url, so no (session, path) pair can collide with another.
 * Used identically by all three store operations -- this is the fix for ChipNet's nesting bug.
 */
export function contextKey(sessionCode: string, path: string[]): string {
	return `${sessionCode}\u0000${path.join(',')}`
}

/**
 * Reference in-memory {@link ParticipantStore} for tests and the simulator. Stores each context by
 * the single {@link contextKey}. It holds the context objects the participant hands it by reference;
 * the participant's contract is that those objects are already serialisable (no live `Pending`), and
 * `store.test.ts` proves a `StoredContext` survives JSON and DAG-CBOR encoding.
 */
export class MemoryParticipantStore<TTerms, TPayload> implements ParticipantStore<TTerms, TPayload> {
	private readonly contexts = new Map<string, StoredContext<TTerms, TPayload>>()

	validateNewQuery(sessionCode: string, path: string[]): Promise<void> {
		if (this.contexts.has(contextKey(sessionCode, path))) {
			return Promise.reject(new Error(`Query already in progress for this session and path`))
		}
		return Promise.resolve()
	}

	getContext(sessionCode: string, path: string[]): Promise<StoredContext<TTerms, TPayload> | undefined> {
		return Promise.resolve(this.contexts.get(contextKey(sessionCode, path)))
	}

	saveContext(context: StoredContext<TTerms, TPayload>, path: string[]): Promise<void> {
		this.contexts.set(contextKey(context.query.sessionCode, path), context)
		return Promise.resolve()
	}

	getNonceToLinkMap(sessionCode: string): Promise<Record<string, string>> {
		const merged: Record<string, string> = {}
		for (const context of this.contexts.values()) {
			if (context.query.sessionCode === sessionCode) {
				Object.assign(merged, context.nonceToLinkId)
			}
		}
		return Promise.resolve(merged)
	}
}
