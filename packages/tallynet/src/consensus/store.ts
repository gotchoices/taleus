/**
 * The durable consensus state: the transaction record this node holds, the last copy it successfully
 * pushed to each peer, and a release-once flag. Mirrors `../discovery/store.ts` — a serialisable
 * interface plus an in-memory reference implementation — so a host can back it with real persistence
 * (Quereus, SQL, …). It persists only JSON/DAG-CBOR-round-trippable data: no promises, functions, or
 * class instances.
 *
 * What it deliberately does **not** hold:
 *   - **The merge/advance/push logic.** That is the participant ticket (`tallynet-consensus-participant`);
 *     the store is pure persistence.
 *   - **Loggers.** ChipNet kept three loggers inside `TrxParticipantState`. As discovery moved
 *     `reportCycles`/timing off the store and onto the `TraceSink`, logging here rides the `TraceSink`
 *     (`../trace.js`) plus an injected `Logger` (the same `(message, ...args) => void` shape as
 *     `taleus-core/src/lift/commit.ts`) in the participant ticket — never the store.
 *
 * The peer-record methods back the reachability skip test the participant adds next ticket: before
 * pushing to `address`, compare the record against the last copy we pushed there and skip an identical
 * one. The release flag is idempotent across restarts so resources are released exactly once.
 */

import type { TrxRecord } from './types.js'

/**
 * The durable store a consensus participant reads and writes, keyed by `transactionCode`. A host backs
 * it with its real persistence; {@link MemoryTrxStore} is the reference in-memory implementation.
 */
export interface TrxStore<TTerms, TPayload> {
	/** Our current merged record for `transactionCode`, or undefined if none seen yet. */
	getRecord(transactionCode: string): Promise<TrxRecord<TTerms, TPayload> | undefined>
	/** Persist `record` as our current copy (under its own `transactionCode`). */
	saveRecord(record: TrxRecord<TTerms, TPayload>): Promise<void>
	/** The last copy we successfully pushed to `address` (the reachability skip test, next ticket). */
	getPeerRecord(transactionCode: string, address: string): Promise<TrxRecord<TTerms, TPayload> | undefined>
	/** Record the copy we just pushed to `address`, so an unchanged re-push can be skipped. */
	savePeerRecord(transactionCode: string, address: string, record: TrxRecord<TTerms, TPayload>): Promise<void>
	/** Whether resources for `transactionCode` have been released — the release-once flag. */
	isReleased(transactionCode: string): Promise<boolean>
	/** Mark `transactionCode`'s resources released, idempotent across restarts. */
	setReleased(transactionCode: string): Promise<void>
}

/**
 * Reference in-memory {@link TrxStore} for tests and the simulator. Holds the record objects the
 * participant hands it by reference; the participant's contract is that those objects are already
 * serialisable (plain, no live promise), and `store.test.ts` proves a record survives JSON and
 * DAG-CBOR encoding.
 */
export class MemoryTrxStore<TTerms, TPayload> implements TrxStore<TTerms, TPayload> {
	private readonly records = new Map<string, TrxRecord<TTerms, TPayload>>()
	private readonly peerRecords = new Map<string, TrxRecord<TTerms, TPayload>>()
	private readonly released = new Set<string>()

	getRecord(transactionCode: string): Promise<TrxRecord<TTerms, TPayload> | undefined> {
		return Promise.resolve(this.records.get(transactionCode))
	}

	saveRecord(record: TrxRecord<TTerms, TPayload>): Promise<void> {
		this.records.set(record.transactionCode, record)
		return Promise.resolve()
	}

	getPeerRecord(transactionCode: string, address: string): Promise<TrxRecord<TTerms, TPayload> | undefined> {
		return Promise.resolve(this.peerRecords.get(peerKey(transactionCode, address)))
	}

	savePeerRecord(transactionCode: string, address: string, record: TrxRecord<TTerms, TPayload>): Promise<void> {
		// NOTE: stores the record by reference (as the discovery store does). The reachability skip test
		// (next ticket) compares a peer's last-pushed copy against the current record; if the participant
		// mutates a record object in place after saving it here, the "last pushed" copy mutates with it
		// and the skip test misreads. The participant must save a distinct object per push, not mutate.
		this.peerRecords.set(peerKey(transactionCode, address), record)
		return Promise.resolve()
	}

	isReleased(transactionCode: string): Promise<boolean> {
		return Promise.resolve(this.released.has(transactionCode))
	}

	setReleased(transactionCode: string): Promise<void> {
		this.released.add(transactionCode)
		return Promise.resolve()
	}
}

/**
 * The peer-record key. A NUL byte (`\u0000`) separates the transaction code from the peer address so
 * no `(transactionCode, address)` pair can collide with another (both are base64url, hence NUL-free).
 */
function peerKey(transactionCode: string, address: string): string {
	return `${transactionCode}\u0000${address}`
}
