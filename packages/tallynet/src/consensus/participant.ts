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
 *   - **No "majority of zero"** — an empty referee set is invalid at validation, so `isConsensus(0,0)`
 *     cannot arise (`:285-287`).
 *   - **Strict majority both ways** — commit and void each need `> R/2`; they are mutually exclusive, so
 *     an even split satisfies neither (the ChipNet even-split-and-reject-wins bug, `:285-287`).
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
import type { Clock } from '../clock.js'
import type { Hasher, Signer, Verifier } from '../crypto.js'
import { Rule, RuleSet, type RuleResponse } from '../rule.js'
import { expiresAt, isExpired, isValid } from '../session-code.js'
import { noopTraceSink, safeTraceSink, type TraceBase, type TraceSink } from '../trace.js'
import type { SessionCodeValidators } from '../discovery/participant.js'
import { MemberTypes, type Address, type DependentMember, type MemberType } from '../discovery/types.js'
import { recordDigest } from './digest.js'
import { signRecord, verifySignature } from './signature.js'
import type { OurLink, ResourceContext, TrxParticipantResource } from './resource.js'
import type { TrxStore } from './store.js'
import type { Signature, SignatureRejectReason, SignatureType, TrxRecord, TrxTopology } from './types.js'

/** A plain logger — `(message, ...args) => void`, matching `taleus-core`'s `lift/commit.ts`. */
export type Logger = (message: string, ...args: unknown[]) => void

/** Send the (merged) record to member `to` over the host's transport. */
export type UpdatePeerFunc<TTerms, TPayload> = (record: TrxRecord<TTerms, TPayload>, to: Address) => Promise<void>

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
	/** Host port: holds/releases value, casts the referee vote. */
	resource: TrxParticipantResource<TTerms, TPayload>
	/** Host port: send the record to a peer over its transport. */
	updatePeer: UpdatePeerFunc<TTerms, TPayload>
	/** Our discovery session's nonce→linkId map (`ParticipantStore.getNonceToLinkMap`). Identifies OUR links. */
	nonceToLinkId: Record<string, string>
	/** All wall-clock time (for code-expiry checks). */
	clock: Clock
	/** sha256, for the canonical digest. Defaults to `@noble/hashes`. */
	hasher?: Hasher
	/** Optional trace sink; wrapped so a throw can never break the engine. Default: no-op. */
	trace?: TraceSink
	/** Optional logger for refusals, rejections and push failures. Default: no-op. */
	log?: Logger
	/** Session-code checks (validate BOTH `transactionCode` and `sessionCode`); default wraps `session-code.ts`. */
	sessionCodes?: SessionCodeValidators
}

/**
 * How the current record classifies for OUR member role. The two phases (promise, then commit) and
 * their outcomes, per docs/design.md § Protocol design (Consensus):
 *   - `ourPromiseNeeded` / `promising` — promise phase: we owe a promise, or we are waiting on others.
 *   - `ourCommitNeeded` / `propagating` — commit phase: we (a referee) owe a vote, or we are waiting on
 *     other referees / on a tie that cannot settle in-band (see the timeout seam below).
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
	private readonly nonceToLinkId: Record<string, string>
	private readonly clock: Clock
	private readonly hasher?: Hasher
	private readonly traceSink: TraceSink
	private readonly log: Logger
	private readonly sessionCodes: SessionCodeValidators
	private readonly newRecordRules: RuleSet<TrxRuleTest<TTerms, TPayload>>

	constructor(config: TrxParticipantConfig<TTerms, TPayload>) {
		this.self = config.self
		this.signer = config.signer
		this.verifier = config.verifier
		this.store = config.store
		this.resource = config.resource
		this.updatePeer = config.updatePeer
		this.nonceToLinkId = config.nonceToLinkId
		this.clock = config.clock
		this.hasher = config.hasher
		this.traceSink = safeTraceSink(config.trace ?? noopTraceSink)
		this.log = config.log ?? (() => {})
		this.sessionCodes = config.sessionCodes ?? defaultSessionCodeValidators
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
		const merged = await this.validateAndMerge(record, fromAddress)
		// If we are not a member, we are a pure relay: merge and push, but never promise/vote/release.
		if (this.memberByKey(merged.topology, this.self.key)) {
			// Loop one state-advancing step at a time until a step takes no action (a solo node can
			// cascade promise → vote → release in one update; a many-party lift advances one step here).
			while (await this.advanceState(merged)) {
				/* keep advancing */
			}
		}
		await this.push(merged)
		return merged
	}

	/**
	 * The settled outcome of `transactionCode` from our stored record: `'commit'` on a strict commit
	 * majority, `'void'` on any refusal or strict void majority, `'pending'` otherwise (and when the
	 * record has never been seen). Reuses the same classifier as the state machine ({@link getRecordState});
	 * its **terminal** states (`consensus`/`rejected`) are role-independent — they are global properties
	 * of the record (any `NP`, or a strict commit/void majority) — so a relay, or the simulator polling
	 * every node, reads the same commit/void a member does.
	 */
	async outcome(transactionCode: string): Promise<'commit' | 'void' | 'pending'> {
		const record = await this.store.getRecord(transactionCode)
		if (!record) {
			return 'pending'
		}
		const state = await this.getRecordState(record)
		return state === 'consensus' ? 'commit' : state === 'rejected' ? 'void' : 'pending'
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
	 * is exactly the forged-commit-shadows-vote hole (a garbage commit would occupy a referee's slot and
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
	 * signature's own type (`P`/`NP` → participant, `C`/`NC` → referee).
	 */
	private checkMemberAndRole(merged: TrxRecord<TTerms, TPayload>, signature: Signature): DependentMember | undefined {
		const member = this.memberByKey(merged.topology, signature.address)
		if (!member) {
			this.rejectSignature(merged, 'non-member')
			return undefined
		}
		const isPromisePhase = signature.type === 'P' || signature.type === 'NP'
		const requiredRole: MemberType = isPromisePhase ? MemberTypes.participant : MemberTypes.referee
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
	 * - Promise phase **complete** → verify now and, on success, promote into the authoritative set with
	 *   the dedupe/equivocation check ({@link promoteCommit}); a failure is `forged`.
	 * - Promise phase **incomplete** → the commit cannot be verified yet. Hold it in the durable side pool
	 *   ({@link poolCommit}), never in `merged.commits`. {@link drainPendingCommits} promotes or drops it
	 *   once the promise set fills.
	 */
	private async mergeCommit(merged: TrxRecord<TTerms, TPayload>, signature: Signature, pending: Signature[]): Promise<void> {
		if (this.promisePhaseComplete(merged)) {
			return this.promoteCommit(merged, signature)
		}
		this.poolCommit(merged, signature, pending)
	}

	/**
	 * Promote a commit into the authoritative `commits` set once it verifies against the complete promise
	 * set. Verification runs **first**; only a verified commit reaches the dedupe/equivocation check, so an
	 * unverified one can never occupy a referee's slot. A verification failure is `forged`; an identical
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
			return this.rejectSignature(merged, existing.type === signature.type ? 'changed' : 'equivocation')
		}
		merged.commits = [...merged.commits, signature]
	}

	/**
	 * Hold an unverifiable (promise-phase-incomplete) commit in the side `pending` pool. Idempotent on an
	 * identical re-delivery; capped at {@link MAX_PENDING_COMMITS_PER_REFEREE} entries **per signer** so a
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
		if (forThisSigner >= MAX_PENDING_COMMITS_PER_REFEREE) {
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

	/** Trace + log a dropped signature. The record is otherwise unharmed; the merge continues. */
	private rejectSignature(merged: TrxRecord<TTerms, TPayload>, reason: SignatureRejectReason): void {
		this.traceSink({ ...this.traceBase(merged), type: 'signature-rejected', transactionCode: merged.transactionCode, reason })
		this.log('tallynet consensus: dropped signature (%s) on transaction %s', reason, merged.transactionCode)
	}

	/* ── classify ─────────────────────────────────────────────────────────────────────── */

	/**
	 * Classify the record for our member role across the two phases (strict-majority rule, docs/design.md
	 * § Protocol design (Consensus)).
	 */
	private async getRecordState(record: TrxRecord<TTerms, TPayload>): Promise<RecordState> {
		// ── Promise phase ──
		if (record.promises.some((signature) => signature.type === 'NP')) {
			return 'rejected' // any refusal voids the lift — it can never form
		}
		if (!this.promisePhaseComplete(record)) {
			if (this.weAre(MemberTypes.participant, record) && !this.weHaveSigned(record.promises)) {
				return 'ourPromiseNeeded'
			}
			return 'promising' // waiting on other participants
		}

		// ── Commit phase (every participant has promised; the full promise set is present) ──
		const referees = this.membersWithRole(record.topology, MemberTypes.referee)
		if (referees.length === 0) {
			// Unreachable after validation (an empty referee set is rejected there); guarded so a stray
			// record can never settle on a "majority of zero" (ChipNet's isConsensus(0,0), review :285-287).
			this.log('tallynet consensus: empty referee set reached the commit phase on transaction %s (invalid)', record.transactionCode)
			return 'propagating'
		}

		const commitCount = await this.countVerifiedCommits(record, 'C', referees)
		const noCommitCount = await this.countVerifiedCommits(record, 'NC', referees)
		// Strict majority both ways → mutually exclusive (counts are over distinct referees, so they sum
		// to at most R; two strict majorities would sum to more than R). A tie satisfies neither.
		if (commitCount > referees.length / 2) {
			return 'consensus'
		}
		if (noCommitCount > referees.length / 2) {
			return 'rejected'
		}
		if (this.weAre(MemberTypes.referee, record) && !this.weHaveSigned(record.commits)) {
			return 'ourCommitNeeded'
		}
		// NOTE: a stuck commit phase (a tie, or referees still to vote) stays `propagating` and does NOT
		// settle in-band — v1 has no timer. This is the seam for `feat-tallynet-propagation-timeouts`: a
		// timeout-triggered referee NC (void-on-timeout) would be injected here, keyed off the record's
		// deadline `this.sessionCodes.expiresAt(record.transactionCode)`; stalled-transaction recovery
		// hangs off the same point. Do not add a timer here — the extension owns it.
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
	 * Count distinct referees whose `type` commit signature verifies against the record's (now complete)
	 * promise set. The merge now admits only already-verified commits into `commits` (an unverified
	 * out-of-order arrival waits in the side pool, never here), so this re-verification is **defensive** —
	 * it cannot admit a forged vote; a signature that somehow fails to verify is simply not counted.
	 */
	private async countVerifiedCommits(
		record: TrxRecord<TTerms, TPayload>,
		type: 'C' | 'NC',
		referees: DependentMember[],
	): Promise<number> {
		// NOTE: re-verifies every commit on each classification pass, and getRecordState runs in a loop.
		// Fine at lift scale (a handful of referees); if referee sets ever grow large, cache verification
		// per (record promise-set, signature).
		const refereeKeys = new Set(referees.map((member) => member.address.key))
		const counted = new Set<string>()
		for (const signature of record.commits) {
			if (signature.type !== type || counted.has(signature.address) || !refereeKeys.has(signature.address)) {
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
	 * Cast our promise. Expiry refuses first (`NP`, never approve). Else the host's `shouldPromise` gate
	 * (default true); false → `NP`. True → hold via `resource.promise` — a throw means nothing was held
	 * (the gate already passed), so we sign `NP` and log the reason. Success → `P`.
	 */
	private async castPromise(record: TrxRecord<TTerms, TPayload>): Promise<void> {
		const context = this.resourceContext(record)
		let decision: SignatureType = SignatureTypesLocal.promise
		if (this.anyCodeExpired(record)) {
			decision = SignatureTypesLocal.noPromise
		} else if (!(await (this.resource.shouldPromise?.(context) ?? true))) {
			decision = SignatureTypesLocal.noPromise
		} else {
			try {
				await this.resource.promise(context)
			} catch (error) {
				decision = SignatureTypesLocal.noPromise
				this.log('tallynet consensus: promise refused on transaction %s: %o', record.transactionCode, error)
			}
		}
		await this.sign(record, decision, 'promises')
		this.traceSink({ ...this.traceBase(record), type: 'promise-signed', transactionCode: record.transactionCode, signatureType: decision })
	}

	/**
	 * Cast our referee vote. Expiry votes `NC` first (never approve). Else the host's `shouldCommit`
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
		this.traceSink({ ...this.traceBase(record), type: 'referee-vote', transactionCode: record.transactionCode, decision })
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

	/* ── push ─────────────────────────────────────────────────────────────────────────── */

	/**
	 * Push the current record to reachable peers: members with a dialable `physical` address, plus the
	 * member at the other end of each of our links. A peer whose last-acked copy equals what we would
	 * push is skipped. A failed push logs **once** and emits `record-pushed` `ok:false`; it is not
	 * retried in-band (retry is the push-wake transport's concern).
	 */
	private async push(record: TrxRecord<TTerms, TPayload>): Promise<void> {
		for (const peer of this.reachablePeers(record)) {
			const last = await this.store.getPeerRecord(record.transactionCode, peer.key)
			if (last && sameSignatureSets(last, record)) {
				continue // unchanged since our last push to this peer — suppress the re-push
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
			new Rule<Test>('NonEmptyRefereeSet', (record) =>
				Promise.resolve({ passed: this.membersWithRole(record.topology, MemberTypes.referee).length > 0, message: 'Empty referee set' }),
			),
			new Rule<Test>('SelfConsistent', (record) =>
				Promise.resolve({ passed: this.selfConsistent(record.topology), message: 'Our member/links are inconsistent' }),
			),
			new Rule<Test>('CoreEncodable', (record) => Promise.resolve(this.coreEncodable(record))),
		])
	}

	/**
	 * Our membership is consistent with our links: if we are a participant member we must ride at least
	 * one link, and if we ride any link we must be a member. A referee-only member rides no tally edge
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
 * Cap on unverified (promise-phase-incomplete) commits held **per referee** in the side pool before the
 * overflow is dropped as `pool-full`. Small by design: a genuine referee contributes at most two faces
 * (`C` and `NC`), so 4 leaves slack for out-of-order re-delivery while denying a peer unbounded growth.
 */
const MAX_PENDING_COMMITS_PER_REFEREE = 4

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
