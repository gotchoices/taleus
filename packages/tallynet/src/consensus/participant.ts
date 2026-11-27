/**
 * The consensus participant: the per-node state machine that runs at every party on a lift route. It
 * ingests a transaction record (minted by ourselves to start, or pushed by a peer), merges it by
 * signature union, advances our own state (promise / vote / release), and pushes the record onward to
 * reachable peers until the lift settles.
 *
 * The record model, the canonical signed preimage, the sign/verify primitives and the durable store
 * live alongside it (`./types.ts`, `./digest.ts`, `./signature.ts`, `./store.ts`); the per-node
 * {@link TrxParticipant} is wrapped for hosts by the `ConsensusNode` bundle (`./engine.ts`), and
 * end-to-end multi-node scenarios drive it over the in-memory harness (`../testing/`). Everything here
 * is unit-testable against the in-memory store, an injected signer/verifier, and in-memory
 * {@link TrxParticipantResource} doubles.
 *
 * Every ChipNet transaction-module defect this chain must close is closed here (docs/chipnet-review.md
 * § Transaction module defects):
 *   - **Hold only after the gate decides** — `shouldPromise` runs before `promise` (`:75-77`).
 *   - **Expiry and missing hooks always refuse, never approve** — an expired code signs `NP`/`NC`
 *     before any gate runs (`:151-153,169-171`).
 *   - **No "majority of zero"** — an empty voter set is invalid at validation, so `isConsensus(0,0)`
 *     cannot arise (`:285-287`).
 *   - **Strict majority plus threshold** — a side settles only on a strict majority AND reaching the
 *     method's threshold; commit and void stay mutually exclusive, so an even split satisfies neither
 *     (the ChipNet even-split-and-reject-wins bug, `:285-287`). The default 1/2 threshold is a plain
 *     strict majority, byte-identical to before.
 *   - **A circular lift is valid** — our member appears once in `members` but may ride many `links`; the
 *     invalid case is a duplicate *member entry*, not a repeated address on links (`:105`).
 *   - **A failed push logs once** (`:133-134`).
 *   - **Terms are checked at transaction time** — handed to the host via `shouldPromise` (`:210-212`).
 *
 * Mirrors the discovery participant's shape (`../discovery/participant.ts`): a class built from
 * injected ports, a {@link RuleSet} for explainable new-record validation, all time through the
 * injected {@link Clock}, all events through a wrapped {@link TraceSink}.
 */

import { bytesToBase64url } from '../base64url.js'
import type { Clock, TimerHandle } from '../clock.js'
import type { Hasher, RandomSource, Signer, Verifier } from '../crypto.js'
import { Rule, RuleSet, type RuleResponse } from '../rule.js'
import { DEFAULT_MAX_TTL_MS, expiresAt, generate, isExpired, isValid } from '../session-code.js'
import { noopTraceSink, safeTraceSink, type TraceBase, type TraceSink } from '../trace.js'
import type { SessionCodeValidators } from '../discovery/participant.js'
import { consensusMethodError, MemberTypes, type Address, type DependentMember, type MemberType, type Plan, type UniQuery } from '../discovery/types.js'
import { recordDigest } from './digest.js'
import { mintRecord } from './mint.js'
import { signRecord, verifySignature } from './signature.js'
import type { OurLink, ResourceContext, TrxParticipantResource } from './resource.js'
import type { TrxStore } from './store.js'
import type { Signature, SignatureRejectReason, SignatureType, TrxRecord, TrxTopology } from './types.js'

/** A plain logger — `(message, ...args) => void`, matching `taleus-core`'s `lift/commit.ts`. */
export type Logger = (message: string, ...args: unknown[]) => void

/** Send the (merged) record to member `to` over the host's transport. */
export type UpdatePeerFunc<TTerms, TPayload> = (record: TrxRecord<TTerms, TPayload>, to: Address) => Promise<void>

/**
 * Host port for the **pull**: ask `from` for its current record for `transactionCode`, returning its merged
 * copy or `undefined` if it holds none. The responder end is {@link TrxParticipant.serveRecord} (safe to
 * serve anyone — the record is self-authenticating); the requester end is {@link TrxParticipant.fetchOutcome}.
 * See docs/design.md § Record availability.
 */
export type FetchRecordFunc<TTerms, TPayload> = (transactionCode: string, from: Address) => Promise<TrxRecord<TTerms, TPayload> | undefined>

/** The default session-code checks, wrapping `session-code.ts`. Used for BOTH the transaction and session codes. */
const defaultSessionCodeValidators: SessionCodeValidators = {
	isValid: (code, now) => isValid(code, now),
	isExpired: (code, now) => isExpired(code, now),
	expiresAt: (code) => expiresAt(code),
}

/** Everything the participant is constructed with. Ports default where sensible; the rest is host-supplied. */
export interface TrxParticipantConfig<TTerms, TPayload> {
	/** Our own party: the base64url key that identifies our member in `topology.members`. */
	self: Address
	/** Signs our promises/commits. Its `publicKey` must base64url-encode to `self.key`. */
	signer: Signer
	/** Verifies every signature we merge. A malformed input is a failed check, never a throw. */
	verifier: Verifier
	/** Durable record / peer-record / release-flag store. */
	store: TrxStore<TTerms, TPayload>
	/** Host port: holds/releases value, casts the voter vote. */
	resource: TrxParticipantResource<TTerms, TPayload>
	/** Host port: send the record to a peer over its transport. */
	updatePeer: UpdatePeerFunc<TTerms, TPayload>
	/**
	 * Host port: pull the current record for a `transactionCode` from a reachable peer (the record-availability
	 * requester, docs/design.md § Record availability). Default: a port that holds nothing (`undefined`), which
	 * makes {@link TrxParticipant.fetchOutcome} a no-op beyond reading our own stored outcome.
	 */
	fetchRecord?: FetchRecordFunc<TTerms, TPayload>
	/** Our discovery session's nonce→linkId map (`ParticipantStore.getNonceToLinkMap`). Identifies OUR links. */
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
	/** Session-code checks (validate BOTH `transactionCode` and `sessionCode`); default wraps `session-code.ts`. */
	sessionCodes?: SessionCodeValidators
	/**
	 * Minimum lift window (ms) this node needs before it will promise. Default {@link MIN_PROMISE_MARGIN_MS}.
	 * Per-node, not global (principle 0): the protocol enforces the check; each node sets its value.
	 */
	minPromiseMarginMs?: number
	/**
	 * Grace (ms) past the transaction-code expiry before this node fires its void timer. Default
	 * {@link SKEW_GRACE_MS}. Keep comfortably < minPromiseMarginMs. Per-node (principle 0).
	 */
	skewGraceMs?: number
	/** First recovery-loop backoff delay (ms) after the deadline. Default {@link RECOVERY_BASE_MS}. Per-node. */
	recoveryBaseMs?: number
	/** Ceiling the recovery-loop backoff doubles toward (ms). Default {@link RECOVERY_MAX_MS}. Per-node. */
	recoveryMaxMs?: number
	/** How long past the deadline the recovery loop polls before abandoning (ms). Default {@link RECOVERY_GIVEUP_MS}. Per-node. */
	recoveryGiveupMs?: number
}

/** What {@link TrxParticipant.proceed} needs to start a discovered lift. */
export interface ProceedArgs<TTerms, TPayload> {
	/** The ONE chosen plan. The caller picks it — `discover` returns plans best-first, so this is usually `plans[0]`. */
	plan: Plan<TTerms, TPayload>
	/** The originator's query: supplies `method`, optional `liftContract`, and the `sessionCode` to **reuse**. */
	query: UniQuery<TTerms>
	/** The opaque Taleus value stamped into the record once and carried, covered by the digest, to every node. */
	payload: TPayload
	/** Transaction-code lifetime in ms. Defaults to {@link DEFAULT_TTL}. */
	ttlMs?: number
}

/**
 * How the current record classifies for OUR member role. The two phases (promise, then commit) and
 * their outcomes, per docs/design.md § Protocol design (Consensus):
 *   - `ourPromiseNeeded` / `promising` — promise phase: we owe a promise, or we are waiting on others.
 *   - `ourCommitNeeded` / `propagating` — commit phase: we (a voter) owe a vote, or we are waiting on
 *     other voters / on a tie that cannot settle in-band (see the timeout seam below).
 *   - `consensus` — a strict commit majority: commit and release.
 *   - `rejected` — a refusal (any `NP`) or a strict void majority: void and release.
 */
type RecordState = 'ourPromiseNeeded' | 'promising' | 'ourCommitNeeded' | 'propagating' | 'consensus' | 'rejected'

/** The shared signature of every new-record validation rule, so one {@link RuleSet} types them all. */
type TrxRuleTest<TTerms, TPayload> = (record: TrxRecord<TTerms, TPayload>) => Promise<RuleResponse>

export class TrxParticipant<TTerms, TPayload> {
	private readonly self: Address
	private readonly signer: Signer
	private readonly verifier: Verifier
	private readonly store: TrxStore<TTerms, TPayload>
	private readonly resource: TrxParticipantResource<TTerms, TPayload>
	private readonly updatePeer: UpdatePeerFunc<TTerms, TPayload>
	private readonly fetchRecord: FetchRecordFunc<TTerms, TPayload>
	private readonly nonceToLinkId: Record<string, string>
	private readonly clock: Clock
	private readonly random: RandomSource
	private readonly hasher?: Hasher
	private readonly traceSink: TraceSink
	private readonly log: Logger
	private readonly sessionCodes: SessionCodeValidators
	private readonly newRecordRules: RuleSet<TrxRuleTest<TTerms, TPayload>>
	private readonly minPromiseMarginMs: number
	private readonly skewGraceMs: number
	private readonly recoveryBaseMs: number
	private readonly recoveryMaxMs: number
	private readonly recoveryGiveupMs: number
	/** Per-transaction recovery timers (one live per tx). In-memory only (restart re-arm is a seam; see design.md). */
	private readonly recoveryTimers = new Map<string, TimerHandle>()
	/** Per-transaction current backoff delay (ms); reset to base on a tick that made progress, else doubles. */
	private readonly recoveryBackoff = new Map<string, number>()
	/** Per-transaction recovery-tick count (the `attempt` on each `recovery-tick` trace). */
	private readonly recoveryAttempts = new Map<string, number>()

	constructor(config: TrxParticipantConfig<TTerms, TPayload>) {
		this.self = config.self
		this.signer = config.signer
		this.verifier = config.verifier
		this.store = config.store
		this.resource = config.resource
		this.updatePeer = config.updatePeer
		this.fetchRecord = config.fetchRecord ?? (() => Promise.resolve(undefined))
		this.nonceToLinkId = config.nonceToLinkId
		this.clock = config.clock
		this.random = config.random
		this.hasher = config.hasher
		this.traceSink = safeTraceSink(config.trace ?? noopTraceSink)
		this.log = config.log ?? (() => {})
		this.sessionCodes = config.sessionCodes ?? defaultSessionCodeValidators
		this.minPromiseMarginMs = config.minPromiseMarginMs ?? MIN_PROMISE_MARGIN_MS
		this.skewGraceMs = config.skewGraceMs ?? SKEW_GRACE_MS
		this.recoveryBaseMs = config.recoveryBaseMs ?? RECOVERY_BASE_MS
		this.recoveryMaxMs = config.recoveryMaxMs ?? RECOVERY_MAX_MS
		this.recoveryGiveupMs = config.recoveryGiveupMs ?? RECOVERY_GIVEUP_MS
		this.newRecordRules = this.buildNewRecordRules()

		// A misconfigured signer (its key not matching our member key) would sign signatures no peer
		// accepts as ours — catch it at construction rather than at the first silent rejection.
		if (bytesToBase64url(this.signer.publicKey) !== this.self.key) {
			throw new Error('TrxParticipant: signer public key does not match self.key')
		}
	}

	/**
	 * Ingest a record — minted by us to start a lift, or pushed by `fromAddress`. Validate + merge it,
	 * advance our own state (if we are a member) until nothing more changes, then push to reachable
	 * peers. Returns the merged/advanced record.
	 */
	async update(record: TrxRecord<TTerms, TPayload>, fromAddress?: Address): Promise<TrxRecord<TTerms, TPayload>> {
		// Snapshot our signature sets before the merge so the recovery timer can tell genuine new info from a
		// plain re-delivery (one extra store read; `validateAndMerge` reads again — a minor dup, fine at lift scale).
		const prior = await this.store.getRecord(record.transactionCode)
		const priorKey = prior ? recordSignatureKey(prior) : ''
		const merged = await this.validateAndMerge(record, fromAddress)
		// If we are not a member, we are a pure relay: merge and push, but never promise/vote/release.
		if (this.memberByKey(merged.topology, this.self.key)) {
			await this.runAdvanceLoop(merged)
		}
		// `record` is the raw incoming copy (validateAndMerge never mutates incoming.promises/commits), so it
		// still classifies as "theirs" against our merged copy — surface a settled-outcome contradiction if any.
		await this.detectContradiction(record, merged)
		await this.push(merged)
		// Progress = the merge and/or our own advance added a signature. Post-deadline the recovery timer only
		// re-arms on progress (the storm guard); pre-deadline it always arms (6a's void-on-timeout tick).
		const progressed = priorKey !== recordSignatureKey(merged)
		await this.updateRecoveryTimer(merged, progressed)
		return merged
	}

	/**
	 * The settled outcome of `transactionCode` from our stored record: `'commit'` when the commit side
	 * settles (a strict majority that also reaches the method's threshold), `'void'` on any refusal or a
	 * settled void side, `'pending'` otherwise (and when the record has never been seen). Reuses the same
	 * classifier as the state machine ({@link getRecordState}); its **terminal** states (`consensus`/
	 * `rejected`) are role-independent — they are global properties of the record (any `NP`, or a side
	 * that settles under the record's method) — so a relay, or the simulator polling every node, reads the
	 * same commit/void a member does.
	 */
	async outcome(transactionCode: string): Promise<'commit' | 'void' | 'pending'> {
		const record = await this.store.getRecord(transactionCode)
		if (!record) {
			return 'pending'
		}
		return this.recordOutcome(record)
	}

	/** The settled outcome of an in-hand record (the classifier's terminal states), with no store read. */
	private async recordOutcome(record: TrxRecord<TTerms, TPayload>): Promise<'commit' | 'void' | 'pending'> {
		const state = await this.getRecordState(record)
		return state === 'consensus' ? 'commit' : state === 'rejected' ? 'void' : 'pending'
	}

	/* ── record availability (pull + responder) + contradiction ─────────────────────────── */

	/**
	 * Responder (the pull's serving end): our current merged record for `transactionCode`, or undefined if
	 * we hold none. Safe to serve anyone — the record is self-authenticating (every signature verifies on
	 * merge) and the requester's union merge makes a stale or duplicate reply harmless. See docs/design.md
	 * § Record availability.
	 */
	serveRecord(transactionCode: string): Promise<TrxRecord<TTerms, TPayload> | undefined> {
		return this.store.getRecord(transactionCode)
	}

	/**
	 * Requester (the pull's asking end): pull the record for `transactionCode` from every reachable peer and
	 * {@link update} each reply (an idempotent merge that cannot inject unverified state), then return our
	 * resulting outcome. With no stored record we return `pending` and pull nothing — without the record we
	 * hold no topology, so we cannot even address a pull; a never-seen record is caught up by its neighbour's
	 * re-push, not by this pull (the timer-driven recovery loop that drives this pull is {@link onRecoveryTick}).
	 * The reachable set is
	 * read once from our own stored record; topology is immutable, so it is stable across the merges the pull
	 * triggers. Each reply is merged with the peer as `fromAddress`, which primes the push skip-test so we do
	 * not echo it straight back.
	 */
	async fetchOutcome(transactionCode: string): Promise<'commit' | 'void' | 'pending'> {
		const record = await this.store.getRecord(transactionCode)
		if (!record) {
			return 'pending'
		}
		for (const peer of this.reachablePeers(record)) {
			const reply = await this.fetchRecord(transactionCode, peer)
			if (reply) {
				await this.update(reply, peer) // peer as fromAddress → primes the skip-test, no echo back
			}
			this.emitPulled(record, peer.key, reply !== undefined)
		}
		return this.outcome(transactionCode)
	}

	/**
	 * Surface a settled-outcome contradiction: our own settled outcome (`commit`/`void`) against a reachable
	 * copy that settled the opposite way — only possible when voters equivocated (a single node's union keeps
	 * one face per voter, so it is always self-consistent; two nodes that saw opposite faces first disagree).
	 * We flag it and trace it; the remedy is host policy (ChipNet § Lying referees), not built here. A no-op
	 * unless we are settled, the two outcomes genuinely contradict, and we have not already flagged it.
	 */
	private async detectContradiction(received: TrxRecord<TTerms, TPayload>, merged: TrxRecord<TTerms, TPayload>): Promise<void> {
		const ours = await this.recordOutcome(merged)
		if (ours !== 'commit' && ours !== 'void') {
			return
		}
		// NOTE: recordOutcome(received) reads the RAW incoming record. Its commit/void-by-majority signal is
		// verified (countVerifiedCommits re-verifies each commit), but its promise-phase void signal (an NP in
		// received.promises) is NOT verified here — a hostile peer could set this flag spuriously with a forged
		// NP. This is observational only (settlement is untouched; the flag's consumer is the future
		// feat-tallynet-hostile-peers); if that ticket ever acts on the flag, verify received's NP first.
		const theirs = await this.recordOutcome(received)
		const contradicts = (ours === 'commit' && theirs === 'void') || (ours === 'void' && theirs === 'commit')
		if (!contradicts || (await this.store.hasContradiction(merged.transactionCode))) {
			return
		}
		await this.store.setContradiction(merged.transactionCode)
		const peerOutcome: 'commit' | 'void' = ours === 'commit' ? 'void' : 'commit'
		this.traceSink({ ...this.traceBase(merged), type: 'contradiction-detected', transactionCode: merged.transactionCode, ourOutcome: ours, peerOutcome })
		this.log('tallynet consensus: settled-outcome contradiction on transaction %s (we %s, a peer %s)', merged.transactionCode, ours, peerOutcome)
	}

	/** Retained equivocation-proof faces for `signerKey` (both signed faces when it equivocated; `[]` otherwise). */
	equivocationProof(transactionCode: string, signerKey: string): Promise<Signature[]> {
		return this.store.getProof(transactionCode, signerKey)
	}

	/** Every signer key that retained equivocation proof on `transactionCode` (so a simulator can count equivocators). */
	equivocators(transactionCode: string): Promise<string[]> {
		return this.store.getProofSigners(transactionCode)
	}

	/** Whether a settled-outcome contradiction has been observed (the remedy is host policy, not built here). */
	contradicts(transactionCode: string): Promise<boolean> {
		return this.store.hasContradiction(transactionCode)
	}

	/* ── originate ──────────────────────────────────────────────────────────────────────── */

	/**
	 * Originator action: start a discovered lift. Mint a self-expiring transaction code (from our
	 * injected clock + CSPRNG), fold the ONE chosen plan into a transaction record ({@link mintRecord},
	 * reusing the query's session code so every edge nonce still resolves), then run it through
	 * {@link update} — which classifies `ourPromiseNeeded`, signs our own **P** and pushes to reachable
	 * peers. The record then diffuses until the lift settles everywhere. The caller picks the plan
	 * (`discover` returns them best-first); `proceed` never ranks, and mints nothing but the code.
	 */
	async proceed(args: ProceedArgs<TTerms, TPayload>): Promise<TrxRecord<TTerms, TPayload>> {
		// Clamp to DEFAULT_MAX_TTL_MS: a code minted beyond it is rejected by our OWN new-record
		// TransactionCode rule (isValid enforces the ceiling), which would throw from the update below.
		const ttlMs = Math.min(args.ttlMs ?? args.query.ttlMs ?? DEFAULT_TTL, DEFAULT_MAX_TTL_MS)
		const transactionCode = generate(ttlMs, { now: this.clock.now(), random: this.random })
		const record = mintRecord({ plan: args.plan, query: args.query, payload: args.payload, transactionCode })
		return this.update(record)
	}

	/**
	 * Originator action: void a lift we seeded but have **not yet promised on**. We sign our own `NP` —
	 * the sole promise-phase face we contribute — so it voids cleanly everywhere (any `NP` → `rejected`,
	 * applied the same by every node and relay), then run the record through {@link update} so we release
	 * our own (empty) hold as a failure and diffuse the void, exactly as a refusing participant does.
	 *
	 * A no-op in four cases, each logged: an unknown transaction, one already released (settled), one we
	 * are not a participant in, and one whose **promise phase is already complete** (principle 3 — no
	 * abort once every participant has promised). And it is **refused once we ourselves have signed any
	 * promise** (the atomicity guard): a later `NP` after our `P` would equivocate — `mergeSignature`
	 * keeps our first face (`P`) at every peer, so those peers would still commit while we voided locally.
	 * Since `proceed` signs our `P` immediately, a `proceed`-then-`abort` is correctly refused; `abort`
	 * is only effective on a record seeded without a promise from us. See docs/design.md § Protocol design.
	 */
	async abort(transactionCode: string): Promise<void> {
		const record = await this.store.getRecord(transactionCode)
		if (!record) {
			this.log('tallynet consensus: abort on unknown transaction %s (no-op)', transactionCode)
			return
		}
		if (await this.store.isReleased(transactionCode)) {
			this.log('tallynet consensus: abort after settlement on transaction %s (no-op)', transactionCode)
			return
		}
		if (!this.weAre(MemberTypes.participant, record)) {
			this.log('tallynet consensus: abort by a non-participant on transaction %s (no-op)', transactionCode)
			return
		}
		// NOTE: by here we are a confirmed participant, so a complete promise phase implies we hold a P —
		// this guard is subsumed behaviour-wise by `weHaveSigned` below (both no-op). It is kept distinct
		// to state principle 3 explicitly and log the past-abort case separately; don't treat it as the
		// sole thing stopping a post-promise abort — the weHaveSigned guard backstops it.
		if (this.promisePhaseComplete(record)) {
			this.log('tallynet consensus: abort refused — every participant has promised on transaction %s', transactionCode)
			return // principle 3: the lift is past the point an abort may void it
		}
		if (this.weHaveSigned(record.promises)) {
			this.log('tallynet consensus: abort refused — we already promised on transaction %s (NP would equivocate)', transactionCode)
			return // atomicity guard: signing NP after our own P equivocates; peers keep the P and commit
		}
		await this.sign(record, SignatureTypesLocal.noPromise, 'promises') // append + persist our sole promise-phase face
		await this.update(record) // release our own (empty) hold as a failure and diffuse the void
	}

	/* ── validate + merge ─────────────────────────────────────────────────────────────── */

	/**
	 * First sight: run the new-record {@link RuleSet} and adopt the record's immutable core with empty
	 * signature sets. Prior copy: assert the immutable core is unchanged (else `core-mismatch`, throw),
	 * then keep it. Either way, union every incoming signature with the per-signer phase rules, persist,
	 * and emit `record-received`.
	 */
	private async validateAndMerge(
		incoming: TrxRecord<TTerms, TPayload>,
		fromAddress: Address | undefined,
	): Promise<TrxRecord<TTerms, TPayload>> {
		const prior = await this.store.getRecord(incoming.transactionCode)
		let merged: TrxRecord<TTerms, TPayload>
		if (!prior) {
			await this.newRecordRules.runAndCheck(incoming) // throws, explainably, on an invalid new record
			merged = { ...incoming, promises: [], commits: [] }
		} else {
			if (!this.coreEqual(prior, incoming)) {
				this.traceSink({ ...this.traceBase(incoming), type: 'signature-rejected', transactionCode: incoming.transactionCode, reason: 'core-mismatch' })
				throw new Error('TrxParticipant: record core differs from the stored copy (core-mismatch)')
			}
			merged = prior
		}

		// Promises first, so a commit arriving in the same delivery sees the full promise set it was cast
		// over and can be verified deterministically (the two-phase invariant from `digest.ts`).
		for (const signature of incoming.promises) {
			await this.mergeSignature(merged, signature, 'promises')
		}

		// Commit-phase side pool: durable, keyed by transactionCode, never part of the wire record. Drain
		// any earlier-arrived (pooled) commits once the promise phase is complete — BEFORE the incoming
		// commits, so a pooled vote wins the "first face stands" ordering over a same-update arrival — then
		// merge the incoming commits (pooling the ones that still cannot be verified).
		const pending = await this.store.getPendingCommits(merged.transactionCode)
		const hadPending = pending.length > 0
		await this.drainPendingCommits(merged, pending)
		for (const signature of incoming.commits) {
			await this.mergeSignature(merged, signature, 'commits', pending)
		}

		await this.store.saveRecord(merged)
		if (pending.length > 0 || hadPending) {
			await this.store.savePendingCommits(merged.transactionCode, pending)
		}
		if (fromAddress) {
			// Prime the push skip-test with what the sender just gave us (ChipNet did the same, but with
			// the raw incoming record — we save the merged copy instead, which is never stale): an unchanged
			// record is never echoed straight back to the peer we just received it from.
			await this.store.savePeerRecord(merged.transactionCode, fromAddress.key, snapshotRecord(merged))
		}
		this.traceSink({
			...this.traceBase(merged),
			type: 'record-received',
			transactionCode: merged.transactionCode,
			...(fromAddress ? { from: fromAddress.key } : {}),
			promiseCount: merged.promises.length,
			commitCount: merged.commits.length,
		})
		return merged
	}

	/**
	 * Merge one incoming signature into the record. Both phases first pass the membership + role gate
	 * ({@link checkMemberAndRole}); then promises and commits diverge, because only a promise can be
	 * verified the instant it arrives.
	 *
	 * **Promise phase.** The already-have-one check runs **before** verification, and this is SAFE: a
	 * promise's preimage never depends on the promise set, so every promise is verified immediately. A
	 * forged promise with no prior entry fails verification and is dropped as `forged` — it is never
	 * stored, so it can never become the `existing` that shadows a genuine one. The first verified promise
	 * is authoritative: a genuine second *value* for the same phase is `changed`, a second *face* (P&NP)
	 * is `equivocation`, both keeping the first.
	 *
	 * **Commit phase.** A commit binds the full promise set, so it cannot be verified until the promise
	 * phase completes. Verifying before the dedupe is therefore impossible early — and dedupe-before-verify
	 * is exactly the forged-commit-shadows-vote hole (a garbage commit would occupy a voter's slot and
	 * block the genuine vote). So commits route through {@link mergeCommit}: unverifiable ones wait in a
	 * side pool and NEVER enter the authoritative `commits` set until they verify. See docs/design.md
	 * § Protocol design (Consensus).
	 */
	private async mergeSignature(
		merged: TrxRecord<TTerms, TPayload>,
		signature: Signature,
		bucket: 'promises' | 'commits',
		pending?: Signature[],
	): Promise<void> {
		if (!this.checkMemberAndRole(merged, signature)) {
			return
		}
		if (bucket === 'commits') {
			return this.mergeCommit(merged, signature, pending ?? [])
		}

		const existing = merged.promises.find((candidate) => candidate.address === signature.address)
		if (existing) {
			if (existing.type === signature.type && existing.value === signature.value) {
				return // identical re-delivery: dedupe silently (idempotent)
			}
			if (existing.type !== signature.type) {
				await this.retainEquivocationProof(merged, existing, signature) // a contradicting face (P&NP): keep both as proof
			}
			return this.rejectSignature(merged, existing.type === signature.type ? 'changed' : 'equivocation')
		}
		// A promise's preimage never depends on the promise set, so it verifies the same at any time.
		if (!(await verifySignature(this.verifier, signature, merged, this.hasher))) {
			return this.rejectSignature(merged, 'forged')
		}
		merged.promises = [...merged.promises, signature]
	}

	/**
	 * Membership + role gate, shared by both phases. Returns the member on success, or `undefined` after
	 * tracing+logging the rejection (`non-member` / `wrong-role`). The required role is derived from the
	 * signature's own type (`P`/`NP` → participant, `C`/`NC` → voter).
	 */
	private checkMemberAndRole(merged: TrxRecord<TTerms, TPayload>, signature: Signature): DependentMember | undefined {
		const member = this.memberByKey(merged.topology, signature.address)
		if (!member) {
			this.rejectSignature(merged, 'non-member')
			return undefined
		}
		const isPromisePhase = signature.type === 'P' || signature.type === 'NP'
		const requiredRole: MemberType = isPromisePhase ? MemberTypes.participant : MemberTypes.voter
		if (!member.types.includes(requiredRole)) {
			this.rejectSignature(merged, 'wrong-role')
			return undefined
		}
		return member
	}

	/**
	 * Merge one incoming commit (membership + role already checked). The authoritative `commits` set holds
	 * **only verified** signatures, so the `changed`/`equivocation` dedupe can never be triggered by — nor
	 * a genuine vote shadowed by — an unverified one (the forged-commit-shadows-vote fix):
	 *
	 * - A **void** (`NC`), OR a commit (`C`) once the promise phase is **complete** → verify now and, on
	 *   success, promote into the authoritative set with the dedupe/equivocation check ({@link promoteCommit});
	 *   a failure is `forged`. A void binds only the immutable core (never the promise set, see `digest.ts`),
	 *   so it verifies the instant it arrives, with or without a complete set — it is never pooled.
	 * - A commit (`C`) while the promise phase is **incomplete** → it cannot be verified yet (its preimage
	 *   binds the still-filling promise set). Hold it in the durable side pool ({@link poolCommit}), never in
	 *   `merged.commits`. {@link drainPendingCommits} promotes or drops it once the promise set fills. The pool
	 *   therefore holds **only** `C` faces.
	 */
	private async mergeCommit(merged: TrxRecord<TTerms, TPayload>, signature: Signature, pending: Signature[]): Promise<void> {
		if (signature.type === 'NC' || this.promisePhaseComplete(merged)) {
			return this.promoteCommit(merged, signature)
		}
		this.poolCommit(merged, signature, pending)
	}

	/**
	 * Promote a commit into the authoritative `commits` set once it verifies against the complete promise
	 * set. Verification runs **first**; only a verified commit reaches the dedupe/equivocation check, so an
	 * unverified one can never occupy a voter's slot. A verification failure is `forged`; an identical
	 * re-delivery is deduped silently; a different value for the same signer is `changed` (same face) or
	 * `equivocation` (opposite face), keeping the first (earlier) verified face. Used for both an incoming
	 * complete-phase commit and a pooled commit on drain.
	 */
	private async promoteCommit(merged: TrxRecord<TTerms, TPayload>, signature: Signature): Promise<void> {
		if (!(await verifySignature(this.verifier, signature, merged, this.hasher))) {
			return this.rejectSignature(merged, 'forged')
		}
		const existing = merged.commits.find((candidate) => candidate.address === signature.address)
		if (existing) {
			if (existing.type === signature.type && existing.value === signature.value) {
				return // identical re-delivery: dedupe silently (idempotent)
			}
			if (existing.type !== signature.type) {
				await this.retainEquivocationProof(merged, existing, signature) // a contradicting face (C&NC): keep both as proof
			}
			return this.rejectSignature(merged, existing.type === signature.type ? 'changed' : 'equivocation')
		}
		merged.commits = [...merged.commits, signature]
	}

	/**
	 * Hold an unverifiable (promise-phase-incomplete) commit in the side `pending` pool. Idempotent on an
	 * identical re-delivery; capped at {@link MAX_PENDING_COMMITS_PER_VOTER} entries **per signer** so a
	 * peer cannot grow the pool without bound (the overflow drops as `pool-full`). The pool is side state:
	 * never merged into the record, never pushed, never digested. Appends to `pending` in place (the caller
	 * persists it via `savePendingCommits`).
	 */
	private poolCommit(merged: TrxRecord<TTerms, TPayload>, signature: Signature, pending: Signature[]): void {
		const identical = pending.some(
			(candidate) => candidate.address === signature.address && candidate.type === signature.type && candidate.value === signature.value,
		)
		if (identical) {
			return // already pooled: idempotent
		}
		const forThisSigner = pending.reduce((count, candidate) => (candidate.address === signature.address ? count + 1 : count), 0)
		if (forThisSigner >= MAX_PENDING_COMMITS_PER_VOTER) {
			return this.rejectSignature(merged, 'pool-full')
		}
		pending.push(signature)
	}

	/**
	 * Drain the pending-commit pool once the promise phase is complete: run each pooled commit through
	 * {@link promoteCommit} (verify → promote or drop), in insertion order so the earliest genuine face of
	 * a true equivocation is the one that stands. The pool is emptied in place — every entry is either
	 * promoted into `merged.commits` or dropped (`forged`). A no-op while the promise phase is incomplete
	 * or the pool is empty.
	 */
	private async drainPendingCommits(merged: TrxRecord<TTerms, TPayload>, pending: Signature[]): Promise<void> {
		if (!this.promisePhaseComplete(merged) || pending.length === 0) {
			return
		}
		const toDrain = pending.splice(0, pending.length) // empty the pool; each entry is promoted or dropped
		for (const signature of toDrain) {
			await this.promoteCommit(merged, signature)
		}
	}

	/**
	 * Drain the durable side pool against the store once the promise phase is complete: load it, promote or
	 * drop each pooled commit ({@link drainPendingCommits}), and persist the emptied pool and the updated
	 * record. A no-op while the promise phase is incomplete or the pool is empty. Called after we cast our
	 * own promise — the only point our action can complete the phase; a peer's completing promise is drained
	 * inline in {@link validateAndMerge}.
	 */
	private async drainPendingFromStore(record: TrxRecord<TTerms, TPayload>): Promise<void> {
		if (!this.promisePhaseComplete(record)) {
			return
		}
		const pending = await this.store.getPendingCommits(record.transactionCode)
		if (pending.length === 0) {
			return
		}
		await this.drainPendingCommits(record, pending)
		await this.store.saveRecord(record)
		await this.store.savePendingCommits(record.transactionCode, pending)
	}

	/** Trace + log a dropped signature. The record is otherwise unharmed; the merge continues. */
	private rejectSignature(merged: TrxRecord<TTerms, TPayload>, reason: SignatureRejectReason): void {
		this.traceSink({ ...this.traceBase(merged), type: 'signature-rejected', transactionCode: merged.transactionCode, reason })
		this.log('tallynet consensus: dropped signature (%s) on transaction %s', reason, merged.transactionCode)
	}

	/**
	 * Retain an equivocation as proof: `existing` (the authoritative first face, already verified) plus
	 * `incoming` (the opposite face) — but only when `incoming` itself VERIFIES (a forged opposite face is not
	 * proof; the signer never signed it). Pure side state: it is stored in the equivocation proof store, never
	 * merged into the authoritative sets, never pushed, never digested, so settlement is unchanged. Emits
	 * `equivocation-proof-kept`. See docs/design.md § Equivocation proof kept.
	 */
	private async retainEquivocationProof(merged: TrxRecord<TTerms, TPayload>, existing: Signature, incoming: Signature): Promise<void> {
		if (!(await verifySignature(this.verifier, incoming, merged, this.hasher))) {
			return // a forged opposite face is not evidence of equivocation
		}
		await this.store.saveProof(merged.transactionCode, existing)
		await this.store.saveProof(merged.transactionCode, incoming)
		this.traceSink({ ...this.traceBase(merged), type: 'equivocation-proof-kept', transactionCode: merged.transactionCode, signer: incoming.address })
	}

	/* ── classify ─────────────────────────────────────────────────────────────────────── */

	/**
	 * Classify the record for our member role across the two phases (strict-majority rule, docs/design.md
	 * § Protocol design (Consensus)).
	 */
	private async getRecordState(record: TrxRecord<TTerms, TPayload>): Promise<RecordState> {
		// ── Any refusal voids immediately (checked first, before any phase gate) ──
		if (record.promises.some((signature) => signature.type === 'NP')) {
			return 'rejected' // any refusal voids the lift — it can never form
		}

		// ── Void settles regardless of promise-set completeness ──
		// A void (`NC`) binds only the immutable core (see digest.ts), so it verifies standalone — a voter
		// majority of `NC` proves the lift can never commit whether or not every participant promised. So
		// this void check runs BEFORE the promise-phase gate: a lift whose promises never complete (a needed
		// party died before promising) still closes once its voters vote `NC` at their deadlines.
		const voters = this.membersWithRole(record.topology, MemberTypes.voter)
		if (voters.length === 0) {
			// Unreachable after validation (an empty voter set is rejected there); guarded so a stray
			// record can never settle on a "majority of zero" (ChipNet's isConsensus(0,0), review :285-287).
			this.log('tallynet consensus: empty voter set on transaction %s (invalid)', record.transactionCode)
			return 'propagating'
		}
		// A side settles when it holds a strict majority AND reaches the method's threshold. The
		// strict-majority floor (`count*2 > W`) keeps commit and void mutually exclusive for any
		// threshold (two strict majorities over distinct voters would sum to more than W); the threshold
		// only ever raises the bar. Integer arithmetic throughout, so the comparison is exact and
		// deterministic. With the default 1/2, `count*thresholdDen >= thresholdNum*W` becomes `count*2 >=
		// W`, which combined with the floor is just `count*2 > W` — byte-identical to a plain strict majority.
		const totalWeight = voters.length // the only v1 weighting is distinct-voter: total weight = voter count
		const { thresholdNum, thresholdDen } = record.method
		const settles = (count: number): boolean => count * 2 > totalWeight && count * thresholdDen >= thresholdNum * totalWeight
		const noCommitCount = await this.countVerifiedCommits(record, 'NC', voters)
		if (settles(noCommitCount)) {
			return 'rejected' // a strict void majority — settles even on an incomplete promise set
		}

		// ── Promise phase incomplete ──
		if (!this.promisePhaseComplete(record)) {
			// Participant-promise branch FIRST (order is load-bearing): a `P`+`V` member that never promised
			// must sign its `NP` here before it can vote `NC` below, so its refusal voids the lift as an `NP`
			// (any-refusal rule, applied the same by every node) rather than as a lone deadline void.
			if (this.weAre(MemberTypes.participant, record) && !this.weHaveSigned(record.promises)) {
				return 'ourPromiseNeeded'
			}
			// Then the voter-void branch: an un-voted voter whose code has EXPIRED votes `NC` at its deadline
			// even on an incomplete promise set (castCommit's expired path casts `NC`). Raw expiry
			// (anyCodeExpired), not expiry+skewGrace: the skew grace governs only when the recovery timer
			// FIRES, never how a delivery past expiry classifies — matching the complete-set deadline-NC path.
			if (this.weAre(MemberTypes.voter, record) && !this.weHaveSigned(record.commits) && this.anyCodeExpired(record)) {
				return 'ourCommitNeeded'
			}
			// A pure participant (not a voter) never voids on its own on an incomplete set — it waits for and
			// pulls the voters' decision. Pre-deadline, every member here is simply waiting on the promises.
			return 'promising'
		}

		// ── Commit phase (every participant has promised; the full promise set is present) ──
		const commitCount = await this.countVerifiedCommits(record, 'C', voters)
		if (settles(commitCount)) {
			return 'consensus'
		}
		if (this.weAre(MemberTypes.voter, record) && !this.weHaveSigned(record.commits)) {
			return 'ourCommitNeeded'
		}
		// NOTE: a stuck commit phase (a tie, or voters still to vote) stays `propagating` and does NOT
		// settle from classification alone. The recovery timer ({@link onRecoveryTick} / {@link onDeadline})
		// re-runs the advance loop once the transaction code's own expiry passes (decision 1): an un-voted
		// voter then votes `NC` (void-on-timeout, decision 3) through the expired-code path in
		// {@link castCommit}, so a voter majority (commit OR void) is always eventually reached and every
		// hold releases — on a complete set here, or on an incomplete set via the void branch above. A tie
		// of voters that have ALL already voted still cannot settle (a documented limit); periodic
		// re-push/pull recovery for a genuinely stalled transaction is the recovery loop (6.2).
		return 'propagating'
	}

	/** Whether every participant member holds a verified `P` (merge already verified each promise). */
	private promisePhaseComplete(record: TrxRecord<TTerms, TPayload>): boolean {
		const participants = this.membersWithRole(record.topology, MemberTypes.participant)
		return participants.length > 0 && participants.every(
			(member) => record.promises.some((signature) => signature.type === 'P' && signature.address === member.address.key),
		)
	}

	/**
	 * Count distinct voters whose `type` commit signature verifies. A commit (`C`) verifies against the
	 * record's (now complete) promise set; a void (`NC`) binds only the immutable core (see digest.ts) and
	 * so verifies independent of the promise set — which is why the void count is meaningful even before the
	 * promise phase completes. The merge now admits only already-verified commits into `commits` (an
	 * unverified out-of-order `C` waits in the side pool, never here; an `NC` promotes on arrival), so this
	 * re-verification is **defensive** — it cannot admit a forged vote; a signature that somehow fails to
	 * verify is simply not counted.
	 */
	private async countVerifiedCommits(
		record: TrxRecord<TTerms, TPayload>,
		type: 'C' | 'NC',
		voters: DependentMember[],
	): Promise<number> {
		// NOTE: re-verifies every commit on each classification pass, and getRecordState runs in a loop.
		// Fine at lift scale (a handful of voters); if voter sets ever grow large, cache verification
		// per (record promise-set, signature) for `C`, and per (record core, signature) for `NC`.
		const voterKeys = new Set(voters.map((member) => member.address.key))
		const counted = new Set<string>()
		for (const signature of record.commits) {
			if (signature.type !== type || counted.has(signature.address) || !voterKeys.has(signature.address)) {
				continue
			}
			if (await verifySignature(this.verifier, signature, record, this.hasher)) {
				counted.add(signature.address)
			}
		}
		return counted.size
	}

	/* ── act ──────────────────────────────────────────────────────────────────────────── */

	/**
	 * Take one state-advancing step. Returns true if it signed something (so the caller re-classifies),
	 * false if it waited or settled (release is terminal; the loop stops). Only ever called when we are
	 * a member.
	 */
	private async advanceState(record: TrxRecord<TTerms, TPayload>): Promise<boolean> {
		const state = await this.getRecordState(record)
		switch (state) {
			case 'ourPromiseNeeded': {
				await this.castPromise(record)
				// Our own promise may have just completed the promise phase. Commits pooled earlier (held
				// because they could not be verified while the phase was still open) can now be verified —
				// drain them before the loop re-classifies, so a commit that arrived before we promised is
				// counted in THIS update rather than only on some later delivery. (The incoming-promise case —
				// a peer's promise completing the phase — is drained inline in validateAndMerge.)
				await this.drainPendingFromStore(record)
				return true
			}
			case 'ourCommitNeeded': {
				await this.castCommit(record)
				return true
			}
			case 'consensus': {
				await this.releaseOnce(record, true)
				return false
			}
			case 'rejected': {
				await this.releaseOnce(record, false)
				return false
			}
			default: {
				return false // promising / propagating — nothing to do until more signatures arrive
			}
		}
	}

	/**
	 * Cast our promise: decide `P` vs `NP` (via {@link promiseDecision}), sign it, and trace it. The
	 * `promise-signed` trace already carries the `'P'`/`'NP'` face, so the refusal is observable without
	 * a new trace field.
	 */
	private async castPromise(record: TrxRecord<TTerms, TPayload>): Promise<void> {
		const context = this.resourceContext(record)
		const decision = await this.promiseDecision(record, context)
		await this.sign(record, decision, 'promises')
		this.traceSink({ ...this.traceBase(record), type: 'promise-signed', transactionCode: record.transactionCode, signatureType: decision })
	}

	/**
	 * `P` vs `NP`: expiry first, then {@link TrxParticipantResource.acceptsProposal} (the proposal
	 * gate), then {@link TrxParticipantResource.shouldPromise} (the terms gate), then the hold
	 * (`promise`). The first refusal — a `false` result OR a throw from either gate, or a throwing hold
	 * — signs `NP` and holds nothing. A gate throw is caught here (a declined promise must never leave
	 * value held, nor propagate), logged, and treated as `NP`.
	 */
	private async promiseDecision(record: TrxRecord<TTerms, TPayload>, context: ResourceContext<TTerms, TPayload>): Promise<'P' | 'NP'> {
		if (this.anyCodeExpired(record)) {
			return SignatureTypesLocal.noPromise
		}
		// Not enough of the lift window left to promise safely (decision 1's protocol pre-gate). Codes are
		// well-formed here (anyCodeExpired returned false), so expiresAt cannot throw.
		if (this.sessionCodes.expiresAt(record.transactionCode) - this.clock.now() < this.minPromiseMarginMs) {
			this.log('tallynet consensus: too little time left to promise on transaction %s (pre-gate)', record.transactionCode)
			return SignatureTypesLocal.noPromise
		}
		try {
			if (!(await (this.resource.acceptsProposal?.(context) ?? true))) {
				this.log('tallynet consensus: proposal refused (voter set / method / contract) on transaction %s', record.transactionCode)
				return SignatureTypesLocal.noPromise
			}
			if (!(await (this.resource.shouldPromise?.(context) ?? true))) {
				return SignatureTypesLocal.noPromise
			}
		} catch (error) {
			this.log('tallynet consensus: a promise gate threw on transaction %s; signing NP: %o', record.transactionCode, error)
			return SignatureTypesLocal.noPromise
		}
		try {
			await this.resource.promise(context)
		} catch (error) {
			this.log('tallynet consensus: promise refused on transaction %s: %o', record.transactionCode, error)
			return SignatureTypesLocal.noPromise
		}
		return SignatureTypesLocal.promise
	}

	/**
	 * Cast our voter vote. Expiry votes `NC` first (never approve). Else the host's `shouldCommit`
	 * gate (default true): true → `C`, false → `NC`. The host's opaque per-edge attachment rides along.
	 */
	private async castCommit(record: TrxRecord<TTerms, TPayload>): Promise<void> {
		const context = this.resourceContext(record)
		let decision: 'C' | 'NC'
		if (this.anyCodeExpired(record)) {
			decision = 'NC'
		} else {
			decision = (await (this.resource.shouldCommit?.(context) ?? true)) ? 'C' : 'NC'
		}
		const attachment = await this.resource.resolveAttachment?.(decision, context)
		await this.sign(record, decision, 'commits', attachment)
		this.traceSink({ ...this.traceBase(record), type: 'voter-vote', transactionCode: record.transactionCode, decision })
	}

	/**
	 * Release held value exactly once. Gated on the store's release flag: if already released, do
	 * nothing (re-delivery after settlement, or a restart). The flag is set only **after** `release`
	 * resolves, so a throwing release leaves it unset and is retried on the next `update`, never
	 * double-releasing. A release throw is logged and re-thrown (not swallowed); the push model tolerates
	 * the throw and the caller logs.
	 */
	private async releaseOnce(record: TrxRecord<TTerms, TPayload>, success: boolean): Promise<void> {
		const transactionCode = record.transactionCode
		if (await this.store.isReleased(transactionCode)) {
			return
		}
		this.traceSink({ ...this.traceBase(record), type: 'settled', transactionCode, decision: success ? 'commit' : 'void' })
		try {
			await this.resource.release({ ...this.resourceContext(record), success })
		} catch (error) {
			this.log('tallynet consensus: release threw on transaction %s; flag left unset, will retry: %o', transactionCode, error)
			throw error
		}
		await this.store.setReleased(transactionCode)
		this.traceSink({ ...this.traceBase(record), type: 'resources-released', transactionCode, success })
	}

	/**
	 * Produce our signature of `kind`, attach the host's opaque data if any, self-verify it (a cheap
	 * guard that our own preimage matches what a peer will check), append it to `bucket`, and persist.
	 */
	private async sign(
		record: TrxRecord<TTerms, TPayload>,
		kind: SignatureType,
		bucket: 'promises' | 'commits',
		attachment?: unknown,
	): Promise<void> {
		const signature = await signRecord(this.signer, kind, record, this.hasher)
		if (attachment !== undefined) {
			signature.attachment = attachment
		}
		if (!(await verifySignature(this.verifier, signature, record, this.hasher))) {
			throw new Error(`TrxParticipant: self-verification failed for our own ${kind} signature on transaction ${record.transactionCode}`)
		}
		record[bucket] = [...record[bucket], signature]
		await this.store.saveRecord(record)
	}

	/* ── recovery timer (6a one-shot deadline + 6.2 periodic recovery loop) ─────────────── */

	/** Run the state-advance loop; returns true if any step signed something (drove a vote/promise). */
	private async runAdvanceLoop(record: TrxRecord<TTerms, TPayload>): Promise<boolean> {
		let acted = false
		while (await this.advanceState(record)) {
			acted = true
		}
		return acted
	}

	/**
	 * Arm or clear our recovery timer after adopting a record. Members only (a pure relay holds no stake).
	 * A settled/released record clears all recovery state; a still-`pending` one (re-)arms the timer via
	 * {@link scheduleRecoveryTick}, which gates the post-deadline re-arm on `progressed` (the storm guard).
	 */
	private async updateRecoveryTimer(record: TrxRecord<TTerms, TPayload>, progressed: boolean): Promise<void> {
		if (!this.memberByKey(record.topology, this.self.key)) {
			return
		}
		// NOTE: one extra classification per update (recordOutcome re-verifies commits). Fine at lift
		// scale; if voter sets grow, cache verification (see countVerifiedCommits NOTE).
		const settled = (await this.recordOutcome(record)) !== 'pending'
		if (settled || (await this.store.isReleased(record.transactionCode))) {
			this.clearRecoveryState(record.transactionCode)
			return
		}
		this.scheduleRecoveryTick(record, progressed)
	}

	/**
	 * Arm (or leave armed) the recovery timer for a non-terminal record. Idempotent: a code that already
	 * has a live timer keeps it (never stack one per delivery).
	 *
	 * **Pre-deadline** it arms the 6a one-shot at the transaction code's embedded expiry (decision 1)
	 * judged against OUR clock (decision 6), a `skewGraceMs` grace past expiry so a modestly-fast clock
	 * does not prematurely void. **Post-deadline** it (re-)arms the periodic recovery loop at the current
	 * backoff delay — but **only when `progressed`**: a plain re-delivery (e.g. a peer's forced re-push of
	 * a record we already hold) must not revive a loop that has backed off or abandoned, or two fully-
	 * connected stuck nodes would re-arm each other forever (the timer storm). Genuine new info
	 * (connectivity returned, fresh votes) is progress → the loop resumes, so abandonment is never final.
	 */
	private scheduleRecoveryTick(record: TrxRecord<TTerms, TPayload>, progressed: boolean): void {
		const transactionCode = record.transactionCode
		if (this.recoveryTimers.has(transactionCode)) {
			return
		}
		const expiry = this.safeExpiry(transactionCode)
		if (expiry === undefined) {
			return // a malformed code cannot be scheduled against (validation should already have refused it)
		}
		const now = this.clock.now()
		if (now < expiry) {
			this.armRecoveryTimer(transactionCode, expiry + this.skewGraceMs - now)
			return
		}
		if (!progressed) {
			return // post-deadline with no new info: do not revive a backing-off / abandoned loop (storm guard)
		}
		this.armRecoveryTimer(transactionCode, this.recoveryBackoff.get(transactionCode) ?? this.recoveryBaseMs)
	}

	/**
	 * Arm the recovery timer `delayMs` out. The fired callback deletes its own handle **first** (so a fire
	 * is one-shot and the tick can re-arm cleanly), then runs {@link onRecoveryTick}. A fire-and-forget
	 * callback has no caller to catch a rejection — `realClock` discards the returned promise — so a throw
	 * is caught and logged here, the same "never eat an exception unlogged" rule every other engine entry
	 * point obeys. Direct callers of `onRecoveryTick` / `onDeadline` still see the throw.
	 */
	private armRecoveryTimer(transactionCode: string, delayMs: number): void {
		const handle = this.clock.setTimer(async () => {
			this.recoveryTimers.delete(transactionCode)
			try {
				await this.onRecoveryTick(transactionCode)
			} catch (error) {
				this.log('tallynet consensus: recovery tick threw on transaction %s: %o', transactionCode, error)
			}
		}, Math.max(0, delayMs))
		this.recoveryTimers.set(transactionCode, handle)
	}

	/** The transaction code's embedded expiry, or undefined if it is malformed (cannot be scheduled against). */
	private safeExpiry(transactionCode: string): number | undefined {
		try {
			return this.sessionCodes.expiresAt(transactionCode)
		} catch {
			return undefined
		}
	}

	/** Cancel and forget the recovery timer for `transactionCode` (idempotent); leaves backoff/attempt state. */
	private clearRecoveryTimer(transactionCode: string): void {
		const handle = this.recoveryTimers.get(transactionCode)
		if (handle === undefined) {
			return
		}
		this.recoveryTimers.delete(transactionCode)
		this.clock.clearTimer(handle)
	}

	/** Clear the recovery timer **and** the per-transaction backoff/attempt state (on settle, abandon, non-member). */
	private clearRecoveryState(transactionCode: string): void {
		this.clearRecoveryTimer(transactionCode)
		this.recoveryBackoff.delete(transactionCode)
		this.recoveryAttempts.delete(transactionCode)
	}

	/**
	 * The 6a one-shot deadline action, driven **directly** (a test or host calls it). The armed timer now
	 * calls {@link onRecoveryTick} instead, which subsumes this; `onDeadline` is kept so a host can fire a
	 * single deadline tick on demand. Reload the stored record and, if we are still a member of a
	 * non-terminal, unreleased lift, re-run the advance loop now the code has expired: an un-voted voter
	 * over a COMPLETE promise set votes `NC` (void-on-timeout, decision 3); a holding-but-un-promised
	 * participant signs `NP` (wake-from-sleep). A node with nothing to do signs nothing and stays `pending`
	 * (decision 5: no unilateral void from silence). One-shot: does NOT re-arm.
	 */
	async onDeadline(transactionCode: string): Promise<void> {
		// NOTE: shares the read-merge-save non-atomicity the engine.ts re-entrancy NOTE describes — the
		// timer fires on its own schedule, so it can interleave with an in-flight `update` of the SAME
		// transaction at an await boundary. The in-memory harness serializes deliveries (one callback at a
		// time off the VirtualClock) so it never trips in-repo; a real host serializes recovery ticks through
		// the same per-transaction queue as `update` (see engine.ts and docs/design.md § recovery loop).
		const record = await this.store.getRecord(transactionCode)
		if (!record || !this.memberByKey(record.topology, this.self.key) || (await this.store.isReleased(transactionCode))) {
			this.clearRecoveryTimer(transactionCode)
			return
		}
		const acted = await this.runAdvanceLoop(record)
		this.traceSink({ ...this.traceBase(record), type: 'deadline-reached', transactionCode, acted })
		await this.push(record)
		if ((await this.recordOutcome(record)) !== 'pending') {
			this.clearRecoveryTimer(transactionCode) // a timeout NC may have settled us
		}
	}

	/**
	 * One periodic recovery tick (the armed timer fires this). A stalled, non-terminal lift re-contacts its
	 * peers so a decision reached in one corner of the network eventually reaches every cooperating member:
	 *
	 *  1. reload; a terminal / released / non-member record clears all recovery state and stops;
	 *  2. **pull** every reachable peer's merged copy ({@link fetchOutcome}, idempotent union — injects no
	 *     unverified state); if the pull settled us, inform peers and stop;
	 *  3. **advance** — the expired-code path casts our deadline `NC`/`NP`, so a node asleep through its
	 *     deadline both votes AND recovers in this one tick; if that settled us, push and stop;
	 *  4. past {@link recoveryGiveupMs} beyond expiry, **abandon** (emit `recovery-abandoned`, stop
	 *     re-arming, leave the record `pending` — resources stay held, the genuinely-stuck case). The
	 *     abandoning tick does NO force-push, so it revives nobody. Abandonment is not final: a later
	 *     inbound delivery that merges new info re-arms the loop via {@link updateRecoveryTimer};
	 *  5. else **force re-push** the current record (bypassing the skip-test — a silent peer's ack may have
	 *     been to a stale copy, or it restarted), emit `recovery-tick`, and re-arm with exponential backoff:
	 *     base on a tick that made progress, doubling toward {@link recoveryMaxMs} on a quiet one.
	 *
	 * Independently callable so a unit test can drive the loop against a seeded store.
	 */
	async onRecoveryTick(transactionCode: string): Promise<void> {
		const record = await this.store.getRecord(transactionCode)
		if (!record || !this.memberByKey(record.topology, this.self.key) || (await this.store.isReleased(transactionCode))) {
			this.clearRecoveryState(transactionCode)
			return
		}
		const beforeKey = recordSignatureKey(record)
		await this.fetchOutcome(transactionCode) // PULL: merge each reachable peer's reply (may settle us)
		const current = await this.store.getRecord(transactionCode)
		if (!current || (await this.store.isReleased(transactionCode)) || (await this.recordOutcome(current)) !== 'pending') {
			this.clearRecoveryState(transactionCode) // the pull settled us (or we were released mid-tick)
			return
		}
		// NOTE: load-bearing ordering — the advance loop (which casts the deadline `NC`, incl. on an incomplete
		// set) MUST run before the abandon check below. If reordered, a reachable voter whose first post-expiry
		// tick already sits past the give-up ceiling (a small `recoveryGiveupMs`) would abandon `pending` without
		// ever voting, instead of voiding. Covered by consensus-timeout.test.ts § incomplete-set-voids.
		const acted = await this.runAdvanceLoop(current) // the expired-code path casts our deadline NC/NP
		if ((await this.recordOutcome(current)) !== 'pending') {
			await this.push(current) // settled this tick: inform peers (it changed, so a normal push suffices)
			this.clearRecoveryState(transactionCode)
			return
		}
		const changed = acted || beforeKey !== recordSignatureKey(current)
		const attempt = (this.recoveryAttempts.get(transactionCode) ?? 0) + 1
		this.recoveryAttempts.set(transactionCode, attempt)
		const expiry = this.safeExpiry(transactionCode)
		if (expiry !== undefined && this.clock.now() > expiry + this.recoveryGiveupMs) {
			// GIVE UP: stop polling a permanently-stuck lift. No force-push here, so this revives no peer.
			this.traceSink({ ...this.traceBase(current), type: 'recovery-abandoned', transactionCode })
			this.clearRecoveryState(transactionCode)
			return
		}
		await this.push(current, true) // FORCED re-push: re-send even to a peer whose last ack matched
		this.traceSink({ ...this.traceBase(current), type: 'recovery-tick', transactionCode, attempt, changed })
		// Re-arm exactly one timer: the pull's `update` may have armed a fresh one mid-tick (the fired handle
		// was already deleted), so clear before arming. Backoff resets to base on progress, else doubles to the ceiling.
		const next = changed ? this.recoveryBaseMs : Math.min((this.recoveryBackoff.get(transactionCode) ?? this.recoveryBaseMs) * 2, this.recoveryMaxMs)
		this.recoveryBackoff.set(transactionCode, next)
		this.clearRecoveryTimer(transactionCode)
		this.armRecoveryTimer(transactionCode, next)
	}

	/* ── push ─────────────────────────────────────────────────────────────────────────── */

	/**
	 * Push the current record to reachable peers: members with a dialable `physical` address, plus the
	 * member at the other end of each of our links. A peer whose last-acked copy equals what we would
	 * push is skipped — **unless `force`**, the recovery path's forced re-send: a silent peer's earlier ack
	 * may have been to a stale copy, or it may have restarted, so recovery re-sends even an unchanged record.
	 * The happy-path callers pass no `force`, keeping the skip optimisation. A failed push logs **once** and
	 * emits `record-pushed` `ok:false`; it is not retried in-band (retry is the push-wake transport's concern).
	 */
	private async push(record: TrxRecord<TTerms, TPayload>, force = false): Promise<void> {
		for (const peer of this.reachablePeers(record)) {
			const last = await this.store.getPeerRecord(record.transactionCode, peer.key)
			if (!force && last && sameSignatureSets(last, record)) {
				continue // unchanged since our last push to this peer — suppress the re-push (recovery forces a re-send)
			}
			// Snapshot per push: the live record keeps mutating across updates, and the store holds the
			// peer copy by reference, so the skip test must compare against a frozen copy, not an alias.
			const snapshot = snapshotRecord(record)
			try {
				await this.updatePeer(snapshot, peer)
				await this.store.savePeerRecord(record.transactionCode, peer.key, snapshot)
				this.emitPushed(record, peer.key, true)
			} catch (error) {
				this.log('tallynet consensus: push to %s failed on transaction %s: %o', peer.key, record.transactionCode, error)
				this.emitPushed(record, peer.key, false)
			}
		}
	}

	private emitPushed(record: TrxRecord<TTerms, TPayload>, to: string, ok: boolean): void {
		this.traceSink({
			...this.traceBase(record),
			type: 'record-pushed',
			transactionCode: record.transactionCode,
			to,
			promiseCount: record.promises.length,
			commitCount: record.commits.length,
			ok,
		})
	}

	private emitPulled(record: TrxRecord<TTerms, TPayload>, from: string, ok: boolean): void {
		this.traceSink({ ...this.traceBase(record), type: 'record-pulled', transactionCode: record.transactionCode, from, ok })
	}

	/** Reachable peers: every member with a `physical` address, plus the far end of each of our links. */
	private reachablePeers(record: TrxRecord<TTerms, TPayload>): Address[] {
		const byKey = new Map<string, Address>()
		for (const member of record.topology.members) {
			if (member.address.key !== this.self.key && member.physical) {
				byKey.set(member.address.key, member.address)
			}
		}
		const { inLinks, outLinks } = this.ourLinks(record.topology)
		for (const link of [...inLinks, ...outLinks]) {
			const otherKey = link.source === this.self.key ? link.target : link.source
			if (otherKey === this.self.key) {
				continue
			}
			const member = this.memberByKey(record.topology, otherKey)
			if (member) {
				byKey.set(otherKey, member.address)
			}
		}
		return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
	}

	/* ── membership / links ─────────────────────────────────────────────────────────────── */

	/** The single member entry for `key`, or undefined. (Validation forbids a duplicate member key.) */
	private memberByKey(topology: TrxTopology<TTerms>, key: string): DependentMember | undefined {
		return topology.members.find((member) => member.address.key === key)
	}

	/** Every member whose `types` include `role`. */
	private membersWithRole(topology: TrxTopology<TTerms>, role: MemberType): DependentMember[] {
		return topology.members.filter((member) => member.types.includes(role))
	}

	/** Whether our member's `types` include `role`. */
	private weAre(role: MemberType, record: TrxRecord<TTerms, TPayload>): boolean {
		const member = this.memberByKey(record.topology, this.self.key)
		return Boolean(member) && member!.types.includes(role)
	}

	/** Whether we have already contributed any signature to `signatures` (by our key). */
	private weHaveSigned(signatures: Signature[]): boolean {
		return signatures.some((signature) => signature.address === this.self.key)
	}

	/**
	 * Our links: every link whose `source` or `target` is us, split into `outLinks` (we are the source)
	 * and `inLinks` (we are the target), with the real `linkId` resolved from `nonceToLinkId` where we
	 * own it. A circular lift puts us on more than one link, so both lists can hold several. Sorted by
	 * nonce for deterministic ordering.
	 */
	private ourLinks(topology: TrxTopology<TTerms>): { inLinks: OurLink<TTerms>[]; outLinks: OurLink<TTerms>[] } {
		const inLinks: OurLink<TTerms>[] = []
		const outLinks: OurLink<TTerms>[] = []
		for (const [nonce, link] of Object.entries(topology.links)) {
			if (link.source !== this.self.key && link.target !== this.self.key) {
				continue
			}
			const linkId = this.nonceToLinkId[nonce]
			const our: OurLink<TTerms> = { nonce, source: link.source, target: link.target, intents: link.intents, ...(linkId ? { linkId } : {}) }
			if (link.source === this.self.key) {
				outLinks.push(our)
			}
			if (link.target === this.self.key) {
				inLinks.push(our)
			}
		}
		const byNonce = (a: OurLink<TTerms>, b: OurLink<TTerms>) => (a.nonce < b.nonce ? -1 : a.nonce > b.nonce ? 1 : 0)
		return { inLinks: inLinks.sort(byNonce), outLinks: outLinks.sort(byNonce) }
	}

	/** Build the {@link ResourceContext} for the host hooks. Only called when we are a member. */
	private resourceContext(record: TrxRecord<TTerms, TPayload>): ResourceContext<TTerms, TPayload> {
		const member = this.memberByKey(record.topology, this.self.key)
		if (!member) {
			throw new Error('TrxParticipant: resourceContext requested while not a member')
		}
		const { inLinks, outLinks } = this.ourLinks(record.topology)
		return { member, inLinks, outLinks, record }
	}

	/* ── codes / core ───────────────────────────────────────────────────────────────────── */

	/** Whether the transaction or session code is expired (or malformed) at now — either refuses. */
	private anyCodeExpired(record: TrxRecord<TTerms, TPayload>): boolean {
		const now = this.clock.now()
		try {
			return this.sessionCodes.isExpired(record.transactionCode, now) || this.sessionCodes.isExpired(record.sessionCode, now)
		} catch {
			return true // a malformed code cannot be approved against
		}
	}

	/** Whether two records share the same immutable core (tx, sc, payload, topology incl. member order). */
	private coreEqual(a: TrxRecord<TTerms, TPayload>, b: TrxRecord<TTerms, TPayload>): boolean {
		// recordDigest over kind 'P' covers exactly the immutable core (never the signature sets), so
		// equal cores hash equal and any payload/topology/code difference (including member reordering)
		// changes the bytes.
		return bytesEqual(recordDigest('P', a, undefined, this.hasher), recordDigest('P', b, undefined, this.hasher))
	}

	/* ── validation rules ─────────────────────────────────────────────────────────────── */

	private buildNewRecordRules(): RuleSet<TrxRuleTest<TTerms, TPayload>> {
		type Test = TrxRuleTest<TTerms, TPayload>
		return new RuleSet<Test>([
			new Rule<Test>('TransactionCode', (record) =>
				Promise.resolve({ passed: this.sessionCodes.isValid(record.transactionCode, this.clock.now()), message: 'Invalid or expired transaction code' }),
			),
			new Rule<Test>('SessionCode', (record) =>
				Promise.resolve({ passed: this.sessionCodes.isValid(record.sessionCode, this.clock.now()), message: 'Invalid or expired session code' }),
			),
			new Rule<Test>('NoDuplicateMembers', (record) =>
				Promise.resolve({ passed: !hasDuplicateMemberKey(record.topology), message: 'Duplicate member entry in topology' }),
			),
			new Rule<Test>('LinksReferenceMembers', (record) =>
				Promise.resolve({ passed: allLinksReferenceMembers(record.topology), message: 'A link references a non-member' }),
			),
			new Rule<Test>('NonEmptyParticipantSet', (record) =>
				Promise.resolve({ passed: this.membersWithRole(record.topology, MemberTypes.participant).length > 0, message: 'No participant members' }),
			),
			new Rule<Test>('NonEmptyVoterSet', (record) =>
				Promise.resolve({ passed: this.membersWithRole(record.topology, MemberTypes.voter).length > 0, message: 'Empty voter set' }),
			),
			new Rule<Test>('ConsensusMethod', (record) => {
				const error = consensusMethodError(record.method)
				return Promise.resolve({ passed: error === undefined, message: error ?? 'Consensus method is valid' })
			}),
			new Rule<Test>('LiftContract', (record) =>
				Promise.resolve({
					passed: record.liftContract === undefined || (typeof record.liftContract === 'string' && record.liftContract.length > 0),
					message: 'liftContract, when present, must be a non-empty Stroc CID string',
				}),
			),
			new Rule<Test>('SelfConsistent', (record) =>
				Promise.resolve({ passed: this.selfConsistent(record.topology), message: 'Our member/links are inconsistent' }),
			),
			new Rule<Test>('CoreEncodable', (record) => Promise.resolve(this.coreEncodable(record))),
		])
	}

	/**
	 * Our membership is consistent with our links: if we are a participant member we must ride at least
	 * one link, and if we ride any link we must be a member. A voter-only member rides no tally edge
	 * and is exempt from the link requirement.
	 */
	private selfConsistent(topology: TrxTopology<TTerms>): boolean {
		const member = this.memberByKey(topology, this.self.key)
		const onSomeLink = Object.values(topology.links).some((link) => link.source === this.self.key || link.target === this.self.key)
		if (onSomeLink && !member) {
			return false // we ride a link but are not a member
		}
		if (member && member.types.includes(MemberTypes.participant) && !onSomeLink) {
			return false // we are a participant but ride no link
		}
		return true
	}

	/** Whether the record's immutable core canonically encodes (payload/topology are digest-safe). */
	private coreEncodable(record: TrxRecord<TTerms, TPayload>): RuleResponse {
		try {
			recordDigest('P', record, undefined, this.hasher)
			return { passed: true, message: 'Core is canonically encodable' }
		} catch (error) {
			return { passed: false, message: `Record core is not canonically encodable: ${error instanceof Error ? error.message : String(error)}` }
		}
	}

	/* ── trace ──────────────────────────────────────────────────────────────────────────── */

	/** The common trace envelope. `nodeId` is our own key — public in the route, so no disclosure. */
	private traceBase(record: TrxRecord<TTerms, TPayload>): TraceBase {
		return { time: this.clock.now(), nodeId: this.self.key, sessionCode: record.sessionCode }
	}
}

/* ── module-local helpers ──────────────────────────────────────────────────────────────── */

/** The signature-kind constants, locally named so call sites read `promise`/`noPromise` not `'P'`/`'NP'`. */
const SignatureTypesLocal = { promise: 'P', noPromise: 'NP' } as const satisfies Record<string, SignatureType>

/**
 * Default transaction-code lifetime for {@link TrxParticipant.proceed} (10 minutes). Matches the harness's
 * `buildLift` default and the end-to-end tests; a lift session is short-lived, so the code self-expires
 * well inside the session-code max-TTL ceiling. Override per call via {@link ProceedArgs.ttlMs}.
 */
export const DEFAULT_TTL = 600_000

/**
 * Cap on unverified (promise-phase-incomplete) commits held **per voter** in the side pool before the
 * overflow is dropped as `pool-full`. Small by design: a genuine voter contributes at most two faces
 * (`C` and `NC`), so 4 leaves slack for out-of-order re-delivery while denying a peer unbounded growth.
 */
export const MAX_PENDING_COMMITS_PER_VOTER = 4

/**
 * Default grace (ms) past the transaction-code expiry before a node fires its void timer (decision 6:
 * trust only our own clock). Small, and < {@link MIN_PROMISE_MARGIN_MS}. Per-node default.
 */
export const SKEW_GRACE_MS = 5_000

/**
 * Default minimum lift window (ms) a node requires before it will promise (decision 1's pre-gate).
 * Comfortably > {@link SKEW_GRACE_MS}: a node that DID promise must still have margin to vote before its
 * own void timer fires. Per-node default.
 */
export const MIN_PROMISE_MARGIN_MS = 30_000

/**
 * First recovery-loop backoff delay (ms) after the deadline: the gap before a stalled node's first retry
 * once past expiry, and the delay a tick that made progress resets to. Short, so a lift the network is
 * still carrying heals quickly. Per-node default (principle 0).
 */
export const RECOVERY_BASE_MS = 5_000

/**
 * Ceiling (ms) the recovery-loop backoff doubles toward on each quiet tick (5 min). A genuinely stuck lift
 * backs off to this instead of hammering its peers. Per-node default.
 */
export const RECOVERY_MAX_MS = 300_000

/**
 * How long past the transaction code's expiry the recovery loop keeps polling before it abandons (1 hour).
 * Past this a node stops re-arming and leaves the record `pending` (resources stay held — the genuinely-
 * stuck case; the out-of-band release is `feat-lift-timeout-release`). Abandonment is not final: a later
 * inbound delivery that merges new info re-arms the loop. Per-node default.
 */
export const RECOVERY_GIVEUP_MS = 3_600_000

/** A shallow copy with copied signature arrays — enough to freeze a push snapshot (the core is immutable). */
function snapshotRecord<TTerms, TPayload>(record: TrxRecord<TTerms, TPayload>): TrxRecord<TTerms, TPayload> {
	return { ...record, promises: [...record.promises], commits: [...record.commits] }
}

/** Two records carry the same promise and commit signature sets (by signed content, ignoring attachment). */
function sameSignatureSets<TTerms, TPayload>(a: TrxRecord<TTerms, TPayload>, b: TrxRecord<TTerms, TPayload>): boolean {
	return signatureSetKey(a.promises) === signatureSetKey(b.promises) && signatureSetKey(a.commits) === signatureSetKey(b.commits)
}

/** A set-identity string for a signature list: sorted `type|address|value` tuples (attachment is opaque, excluded). */
function signatureSetKey(signatures: Signature[]): string {
	return signatures
		.map((signature) => `${signature.type}|${signature.address}|${signature.value}`)
		.sort()
		.join('\n')
}

/** A set-identity string over a record's BOTH signature sets — the recovery loop's "did this tick add anything?" key. */
function recordSignatureKey<TTerms, TPayload>(record: TrxRecord<TTerms, TPayload>): string {
	return `${signatureSetKey(record.promises)}\u0000${signatureSetKey(record.commits)}`
}

/** Whether any member key appears more than once in the members array. */
function hasDuplicateMemberKey<TTerms>(topology: TrxTopology<TTerms>): boolean {
	const seen = new Set<string>()
	for (const member of topology.members) {
		if (seen.has(member.address.key)) {
			return true
		}
		seen.add(member.address.key)
	}
	return false
}

/** Whether every link's source and target is a member key. */
function allLinksReferenceMembers<TTerms>(topology: TrxTopology<TTerms>): boolean {
	const keys = new Set(topology.members.map((member) => member.address.key))
	return Object.values(topology.links).every((link) => keys.has(link.source) && keys.has(link.target))
}

/** Constant-work-not-required byte comparison (preimages here are not secrets; a plain compare is fine). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) {
		return false
	}
	for (let index = 0; index < a.length; index++) {
		if (a[index] !== b[index]) {
			return false
		}
	}
	return true
}
