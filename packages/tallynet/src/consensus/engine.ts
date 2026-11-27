/**
 * The per-node consensus bundle. A host constructs one {@link ConsensusNode} per party on a lift
 * route and uses it in the two roles a lift needs: as the **originator** that seeds the transaction
 * with its own freshly-built record ({@link ConsensusNode.start}), and as a **participant** that a
 * peer's `updatePeer` reaches ({@link ConsensusNode.update}). It mirrors discovery's `DiscoveryNode`
 * (`../discovery/engine.ts`): a thin wrapper over the per-node state machine built from injected ports.
 *
 * Unlike discovery, consensus has **no originator round-loop** — it is push-driven. `start` is just
 * `update` on the originator's own record (all topology, no signatures yet); the state machine casts
 * our promise, pushes to reachable peers, and the record diffuses until the lift settles everywhere.
 * {@link ConsensusNode.outcome} reads the settled commit/void (or `pending`) from the stored record,
 * so a simulator can poll every node and assert the route committed or voided atomically.
 */

import type { Clock } from '../clock.js'
import type { Hasher, RandomSource, Signer, Verifier } from '../crypto.js'
import type { TraceSink } from '../trace.js'
import type { SessionCodeValidators } from '../discovery/participant.js'
import type { Address } from '../discovery/types.js'
import { TrxParticipant, type FetchRecordFunc, type Logger, type ProceedArgs, type UpdatePeerFunc } from './participant.js'
import type { TrxParticipantResource } from './resource.js'
import type { TrxStore } from './store.js'
import type { Signature, TrxRecord } from './types.js'

/** Everything a {@link ConsensusNode} is constructed with. Passed straight through to the state machine. */
export interface ConsensusNodeDeps<TTerms, TPayload> {
	/** Our own party: the base64url key that identifies our member in `topology.members`. */
	self: Address
	/** Signs our promises/commits. Its `publicKey` must base64url-encode to `self.key`. */
	signer: Signer
	/** Verifies every signature we merge. */
	verifier: Verifier
	/** Durable record / peer-record / release-flag store (one per node). */
	store: TrxStore<TTerms, TPayload>
	/** Host port: holds/releases value, casts the voter vote. */
	resource: TrxParticipantResource<TTerms, TPayload>
	/** Host port: send the record to a peer over its transport. */
	updatePeer: UpdatePeerFunc<TTerms, TPayload>
	/**
	 * Host port: pull the current record for a `transactionCode` from a reachable peer (the record-availability
	 * requester). Default: a port that holds nothing, making {@link ConsensusNode.fetchOutcome} a no-op beyond
	 * reading our own stored outcome.
	 */
	fetchRecord?: FetchRecordFunc<TTerms, TPayload>
	/** Our discovery session's nonce→linkId map; identifies the links we own. */
	nonceToLinkId: Record<string, string>
	/** All wall-clock time (for code-expiry checks, and the `now` a `proceed` transaction code expires from). */
	clock: Clock
	/** CSPRNG the originator's `proceed` mints the self-expiring transaction code from. */
	random: RandomSource
	/** sha256, for the canonical digest. Defaults to `@noble/hashes`. */
	hasher?: Hasher
	/** Optional trace sink; wrapped so a throw can never break the engine. Default: no-op. */
	trace?: TraceSink
	/** Optional logger for refusals, rejections and push failures. Default: no-op. */
	log?: Logger
	/** Session-code checks; default wraps `session-code.ts`. */
	sessionCodes?: SessionCodeValidators
	/** Minimum lift window (ms) this node needs before it will promise. Per-node (principle 0); default applies when omitted. */
	minPromiseMarginMs?: number
	/** Grace (ms) past the transaction-code expiry before this node fires its void timer. Per-node; default applies when omitted. */
	skewGraceMs?: number
	/** First recovery-loop backoff delay (ms) after the deadline. Per-node; default applies when omitted. */
	recoveryBaseMs?: number
	/** Ceiling the recovery-loop backoff doubles toward (ms). Per-node; default applies when omitted. */
	recoveryMaxMs?: number
	/** How long past the deadline the recovery loop polls before abandoning (ms). Per-node; default applies when omitted. */
	recoveryGiveupMs?: number
}

export class ConsensusNode<TTerms, TPayload> {
	/** Our member key, stamped onto every trace event (`self.key`). */
	readonly nodeId: string
	private readonly participant: TrxParticipant<TTerms, TPayload>

	constructor(deps: ConsensusNodeDeps<TTerms, TPayload>) {
		this.nodeId = deps.self.key
		this.participant = new TrxParticipant<TTerms, TPayload>({
			self: deps.self,
			signer: deps.signer,
			verifier: deps.verifier,
			store: deps.store,
			resource: deps.resource,
			updatePeer: deps.updatePeer,
			fetchRecord: deps.fetchRecord,
			nonceToLinkId: deps.nonceToLinkId,
			clock: deps.clock,
			random: deps.random,
			hasher: deps.hasher,
			trace: deps.trace,
			log: deps.log,
			sessionCodes: deps.sessionCodes,
			minPromiseMarginMs: deps.minPromiseMarginMs,
			skewGraceMs: deps.skewGraceMs,
			recoveryBaseMs: deps.recoveryBaseMs,
			recoveryMaxMs: deps.recoveryMaxMs,
			recoveryGiveupMs: deps.recoveryGiveupMs,
		})
	}

	/** Originator role: seed the transaction with our own freshly-built record (our first update). */
	start(record: TrxRecord<TTerms, TPayload>): Promise<TrxRecord<TTerms, TPayload>> {
		return this.participant.update(record)
	}

	/**
	 * Originator role: start a discovered lift from the chosen plan. Mints the self-expiring transaction
	 * code, folds the plan into a record (reusing the query's session code), signs our promise and pushes.
	 * The caller chooses the plan (`discover` returns them best-first); this delegate never ranks.
	 */
	proceed(args: ProceedArgs<TTerms, TPayload>): Promise<TrxRecord<TTerms, TPayload>> {
		return this.participant.proceed(args)
	}

	/**
	 * Originator role: void a lift we seeded but have not yet promised on — signs our `NP`, releases our
	 * own (empty) hold as a failure, and diffuses the void. A no-op once we have promised or the lift has
	 * settled (see {@link TrxParticipant.abort}).
	 */
	abort(transactionCode: string): Promise<void> {
		return this.participant.abort(transactionCode)
	}

	/** Drive the 6a one-shot deadline tick for `transactionCode` (exposed for host/tests; the loop uses {@link onRecoveryTick}). */
	onDeadline(transactionCode: string): Promise<void> {
		return this.participant.onDeadline(transactionCode)
	}

	/** Drive one periodic recovery tick for `transactionCode` (the armed recovery timer fires this; exposed for host/tests). */
	onRecoveryTick(transactionCode: string): Promise<void> {
		return this.participant.onRecoveryTick(transactionCode)
	}

	// NOTE: `update` is not re-entrancy-safe per node — it reads the stored record, merges, then saves
	// across await points, so two deliveries of the SAME transaction arriving concurrently at one node
	// (a host fanning in pushes without awaiting the first) can lose a first-sight record or duplicate a
	// signature. The in-memory harness serializes deliveries (one callback at a time off the VirtualClock),
	// so this never trips in-repo; a real host must serialize update() per transactionCode (a per-tx queue).
	/** Participant role: what a peer's `updatePeer` delivers into us (`from` = the pushing member). */
	update(record: TrxRecord<TTerms, TPayload>, from?: Address): Promise<TrxRecord<TTerms, TPayload>> {
		return this.participant.update(record, from)
	}

	/** Read the settled outcome of a transaction (commit / void / pending) from our store. */
	outcome(transactionCode: string): Promise<'commit' | 'void' | 'pending'> {
		return this.participant.outcome(transactionCode)
	}

	/** Responder: our current merged record for `transactionCode`, or undefined — the pull's serving end. */
	serveRecord(transactionCode: string): Promise<TrxRecord<TTerms, TPayload> | undefined> {
		return this.participant.serveRecord(transactionCode)
	}

	/** Requester: pull the record from every reachable peer, merge each reply, and return our resulting outcome. */
	fetchOutcome(transactionCode: string): Promise<'commit' | 'void' | 'pending'> {
		return this.participant.fetchOutcome(transactionCode)
	}

	/** Retained equivocation-proof faces for `signerKey` on `transactionCode` (both faces when it equivocated). */
	equivocationProof(transactionCode: string, signerKey: string): Promise<Signature[]> {
		return this.participant.equivocationProof(transactionCode, signerKey)
	}

	/** Every signer key that retained equivocation proof on `transactionCode`. */
	equivocators(transactionCode: string): Promise<string[]> {
		return this.participant.equivocators(transactionCode)
	}

	/** Whether a settled-outcome contradiction has been observed on `transactionCode`. */
	contradicts(transactionCode: string): Promise<boolean> {
		return this.participant.contradicts(transactionCode)
	}
}
