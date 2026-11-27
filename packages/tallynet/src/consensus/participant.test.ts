import { ed25519 } from '@noble/curves/ed25519.js'
import { base64urlToBytes, bytesToBase64url } from '../base64url.js'
import type { Clock } from '../clock.js'
import type { RandomSource, Signer, Verifier } from '../crypto.js'
import { expiresAt, generate } from '../session-code.js'
import type { TraceEvent } from '../trace.js'
import { DEFAULT_CONSENSUS_METHOD, MemberTypes, type ConsensusMethod, type DependentMember, type MemberType } from '../discovery/types.js'
import { signRecord } from './signature.js'
import { MemoryTrxStore, type TrxStore } from './store.js'
import { MAX_PENDING_COMMITS_PER_VOTER, MIN_PROMISE_MARGIN_MS, RECOVERY_BASE_MS, SKEW_GRACE_MS, TrxParticipant, type FetchRecordFunc, type Logger, type UpdatePeerFunc } from './participant.js'
import type { ResourceContext, TrxParticipantResource } from './resource.js'
import type { Signature, SignatureType, TrxLink, TrxRecord } from './types.js'

/**
 * Pure unit tests for the consensus state machine (`TrxParticipant`). Every test drives a single
 * participant's `update` over a {@link MemoryTrxStore}, an injected `@noble/curves` ed25519
 * signer/verifier (the same doubles as `signature.test.ts`), an **injected mutable clock** (no fake
 * timers — the engine owns no timer) and in-memory {@link TrxParticipantResource} doubles. Records are
 * hand-built so each test drives one classification / one adversarial row from the ticket's edge-case
 * list and one `chipnet-review.md` § Transaction-module-defects row.
 *
 * There is no network here: `updatePeer` is a recording stub and multi-node propagation is the next
 * ticket (`3.2-tallynet-consensus`). What a node *does* when it sees a record — merge, classify,
 * promise/vote, release once, push to reachable peers, and refuse the forged/expired/equivocating — is
 * all exercised against one node at a time.
 */

type TTerms = string
type TPayload = { amount: string }

/** Fixed "now" every record's codes are minted against; the clock starts here. */
const NOW = 1_700_000_000_000
/** A comfortably-valid code lifetime (10 min), well under the session-code max-TTL ceiling. */
const LONG_TTL = 600_000

/* ── crypto doubles (copied from signature.test.ts) ──────────────────────────────────── */

/** A real ed25519 signer bound to a fresh key pair (dev-only; `@noble/curves` is a devDependency). */
function makeSigner(): Signer {
	const { secretKey, publicKey } = ed25519.keygen()
	return { publicKey, sign: (digest) => ed25519.sign(digest, secretKey) }
}

/** A real ed25519 verifier honouring the Verifier contract (a malformed input is `false`, never a throw). */
const verifier: Verifier = {
	verify: (publicKey, digest, signature) => {
		try {
			return ed25519.verify(signature, digest, publicKey)
		} catch {
			return false
		}
	},
}

/** A deterministic RandomSource for the harness. `random` is only consumed by `proceed`, which these one-node unit tests never drive (proceed's end-to-end path is `testing/consensus.test.ts`). */
const harnessRandom: RandomSource = { randomBytes: (length) => new Uint8Array(length).fill(7) }

/* ── parties, members, records ───────────────────────────────────────────────────────── */

/** A test party: a signer plus the base64url member key its public key encodes to (what `self.key` must equal). */
interface Party {
	signer: Signer
	key: string
}

function makeParty(): Party {
	const signer = makeSigner()
	return { signer, key: bytesToBase64url(signer.publicKey) }
}

function member(party: Party, types: MemberType[], extra: Partial<DependentMember> = {}): DependentMember {
	return { types, address: { key: party.key }, ...extra }
}

function link(from: Party, to: Party): TrxLink<TTerms> {
	return { source: from.key, target: to.key, intents: { lift: 'terms' } }
}

/** Build a fresh record whose codes are valid at `NOW` (fresh CSPRNG codes each call → distinct tx/sc). */
function makeRecord(
	members: DependentMember[],
	links: Record<string, TrxLink<TTerms>>,
	overrides: Partial<TrxRecord<TTerms, TPayload>> = {},
): TrxRecord<TTerms, TPayload> {
	return {
		transactionCode: generate(LONG_TTL, { now: NOW }),
		sessionCode: generate(LONG_TTL, { now: NOW }),
		payload: { amount: '100' },
		topology: { members, links },
		method: DEFAULT_CONSENSUS_METHOD,
		promises: [],
		commits: [],
		...overrides,
	}
}

/** Sign `record` with `party`'s key under `kind` (a commit binds `record.promises`, as the real engine does). */
function sign(party: Party, kind: SignatureType, record: TrxRecord<TTerms, TPayload>): Promise<Signature> {
	return signRecord(party.signer, kind, record)
}

/** Flip the low bit of a signature's first value byte, keeping its length (verify fails rather than throws). */
function corrupt(signature: Signature): Signature {
	const bytes = base64urlToBytes(signature.value)
	bytes[0] ^= 0x01
	return { ...signature, value: bytesToBase64url(bytes) }
}

/** Flip the low bit of value byte `index` — distinct `index`es yield distinct garbage values (for the pool cap). */
function corruptAt(signature: Signature, index: number): Signature {
	const bytes = base64urlToBytes(signature.value)
	bytes[index % bytes.length] ^= 0x01
	return { ...signature, value: bytesToBase64url(bytes) }
}

/* ── clock double ────────────────────────────────────────────────────────────────────── */

interface ArmedTimer {
	fn: () => void | Promise<void>
	delayMs: number
	cleared: boolean
}

interface MutableClock extends Clock {
	set(now: number): void
	/** Every timer ever armed, in arm order (cleared ones keep their slot, flagged `cleared`). */
	armed: ArmedTimer[]
	/** Count of live (armed, not cleared) timers. */
	liveTimers(): number
	/** Fire every live timer once, in arm order (a test sets `now` first; firing advances nothing). */
	fireAll(): Promise<void>
}

/**
 * A clock whose `now` the test moves by hand. The deadline work arms real timers, so this double
 * RECORDS each armed timer rather than throwing: a test sets `now`, then either drives
 * `participant.onDeadline` directly or calls {@link MutableClock.fireAll}, and asserts arm/clear via
 * {@link MutableClock.liveTimers}. (A surface-compatible superset of the old `now`/`set` clock, so the
 * existing tests that only read those keep working — a non-terminal record simply arms a quiet timer.)
 */
function makeClock(start = NOW): MutableClock {
	let current = start
	const armed: ArmedTimer[] = []
	const clock: MutableClock = {
		now: () => current,
		setTimer: (fn, ms) => {
			const timer: ArmedTimer = { fn, delayMs: ms, cleared: false }
			armed.push(timer)
			return timer
		},
		clearTimer: (handle) => {
			const timer = handle as ArmedTimer | undefined
			if (timer && armed.includes(timer)) {
				timer.cleared = true
			}
		},
		set: (next) => {
			current = next
		},
		armed,
		liveTimers: () => armed.filter((timer) => !timer.cleared).length,
		fireAll: async () => {
			for (const timer of armed) {
				if (!timer.cleared) {
					await timer.fn()
				}
			}
		},
	}
	return clock
}

/* ── resource double ─────────────────────────────────────────────────────────────────── */

interface ResourceOpts {
	/** Provide an `acceptsProposal` gate returning this value. Omitted → the hook is absent (engine defaults true). */
	acceptsProposal?: boolean
	/** `acceptsProposal` throws (treated as a refusal → `NP`, logged). */
	proposalThrows?: boolean
	/** Provide a `shouldPromise` gate returning this value. Omitted → the hook is absent (engine defaults true). */
	shouldPromise?: boolean
	/** `promise` throws (a host refusal after the gate passed). */
	promiseThrows?: boolean
	/** Provide a `shouldCommit` gate returning this value. Omitted → the hook is absent (engine defaults true). */
	shouldCommit?: boolean
	/** How `release` behaves: succeed, always throw, or throw only on its first call. */
	releaseMode?: 'ok' | 'always-throw' | 'throw-once'
	/** Provide a `resolveAttachment` returning this value (rides on the commit signature). Omitted → no hook. */
	attachment?: unknown
}

interface ResourceDouble {
	resource: TrxParticipantResource<TTerms, TPayload>
	/** Contexts seen by `promise` (the hold). Empty ⇒ nothing was ever held. */
	promiseCtxs: ResourceContext<TTerms, TPayload>[]
	/** Contexts seen by the `acceptsProposal` gate. */
	acceptsProposalCtxs: ResourceContext<TTerms, TPayload>[]
	/** Contexts seen by the `shouldPromise` gate. */
	shouldPromiseCtxs: ResourceContext<TTerms, TPayload>[]
	/** Contexts seen by the `shouldCommit` gate. */
	shouldCommitCtxs: ResourceContext<TTerms, TPayload>[]
	/** The `success` flag of each **successful** `release` (a throwing release is not recorded). */
	releaseSuccesses: boolean[]
}

function makeResource(opts: ResourceOpts = {}): ResourceDouble {
	const promiseCtxs: ResourceContext<TTerms, TPayload>[] = []
	const acceptsProposalCtxs: ResourceContext<TTerms, TPayload>[] = []
	const shouldPromiseCtxs: ResourceContext<TTerms, TPayload>[] = []
	const shouldCommitCtxs: ResourceContext<TTerms, TPayload>[] = []
	const releaseSuccesses: boolean[] = []
	let releaseThrewOnce = false

	const resource: TrxParticipantResource<TTerms, TPayload> = {
		promise: (ctx) => {
			promiseCtxs.push(ctx)
			if (opts.promiseThrows) {
				throw new Error('promise refused by host')
			}
		},
		release: (ctx) => {
			if (opts.releaseMode === 'always-throw') {
				throw new Error('release failed')
			}
			if (opts.releaseMode === 'throw-once' && !releaseThrewOnce) {
				releaseThrewOnce = true
				throw new Error('release failed once')
			}
			releaseSuccesses.push(ctx.success)
		},
	}
	if (opts.acceptsProposal !== undefined || opts.proposalThrows) {
		resource.acceptsProposal = (ctx) => {
			acceptsProposalCtxs.push(ctx)
			if (opts.proposalThrows) {
				throw new Error('proposal gate refused by host')
			}
			return opts.acceptsProposal ?? true
		}
	}
	if (opts.shouldPromise !== undefined) {
		resource.shouldPromise = (ctx) => {
			shouldPromiseCtxs.push(ctx)
			return opts.shouldPromise as boolean
		}
	}
	if (opts.shouldCommit !== undefined) {
		resource.shouldCommit = (ctx) => {
			shouldCommitCtxs.push(ctx)
			return opts.shouldCommit as boolean
		}
	}
	if (opts.attachment !== undefined) {
		resource.resolveAttachment = () => opts.attachment
	}
	return { resource, promiseCtxs, acceptsProposalCtxs, shouldPromiseCtxs, shouldCommitCtxs, releaseSuccesses }
}

/* ── participant harness ─────────────────────────────────────────────────────────────── */

interface Harness {
	participant: TrxParticipant<TTerms, TPayload>
	store: TrxStore<TTerms, TPayload>
	clock: MutableClock
	events: TraceEvent[]
	logs: string[]
	pushes: { record: TrxRecord<TTerms, TPayload>; to: string }[]
}

interface HarnessOpts {
	self: Party
	store?: TrxStore<TTerms, TPayload>
	clock?: MutableClock
	resource?: TrxParticipantResource<TTerms, TPayload>
	updatePeer?: UpdatePeerFunc<TTerms, TPayload>
	fetchRecord?: FetchRecordFunc<TTerms, TPayload>
	nonceToLinkId?: Record<string, string>
	selfKeyOverride?: string
	minPromiseMarginMs?: number
	skewGraceMs?: number
	recoveryBaseMs?: number
	recoveryMaxMs?: number
	recoveryGiveupMs?: number
}

/** Build a participant plus recording sinks. Ports default to a memory store, a recording trace/log/updatePeer. */
function harness(opts: HarnessOpts): Harness {
	const store = opts.store ?? new MemoryTrxStore<TTerms, TPayload>()
	const clock = opts.clock ?? makeClock()
	const events: TraceEvent[] = []
	const logs: string[] = []
	const pushes: { record: TrxRecord<TTerms, TPayload>; to: string }[] = []
	const log: Logger = (message) => {
		logs.push(message)
	}
	const updatePeer: UpdatePeerFunc<TTerms, TPayload> =
		opts.updatePeer ??
		((record, to) => {
			pushes.push({ record, to: to.key })
			return Promise.resolve()
		})
	const participant = new TrxParticipant<TTerms, TPayload>({
		self: { key: opts.selfKeyOverride ?? opts.self.key },
		signer: opts.self.signer,
		verifier,
		store,
		resource: opts.resource ?? makeResource().resource,
		updatePeer,
		fetchRecord: opts.fetchRecord,
		nonceToLinkId: opts.nonceToLinkId ?? {},
		clock,
		random: harnessRandom,
		trace: (event) => events.push(event),
		log,
		minPromiseMarginMs: opts.minPromiseMarginMs,
		skewGraceMs: opts.skewGraceMs,
		recoveryBaseMs: opts.recoveryBaseMs,
		recoveryMaxMs: opts.recoveryMaxMs,
		recoveryGiveupMs: opts.recoveryGiveupMs,
	})
	return { participant, store, clock, events, logs, pushes }
}

/* ── event helpers ───────────────────────────────────────────────────────────────────── */

function eventsOfType<T extends TraceEvent['type']>(events: TraceEvent[], type: T): Extract<TraceEvent, { type: T }>[] {
	return events.filter((event): event is Extract<TraceEvent, { type: T }> => event.type === type)
}

function rejectReasons(events: TraceEvent[]): string[] {
	return eventsOfType(events, 'signature-rejected').map((event) => event.reason)
}

/* ────────────────────────────────────────────────────────────────────────────────────── */

describe('TrxParticipant — construction', () => {
	it('throws when the signer public key does not encode to self.key', () => {
		const self = makeParty()
		expect(() => harness({ self, selfKeyOverride: 'not-our-key' })).toThrow(/signer public key does not match/)
	})

	it('constructs when the signer key matches self.key', () => {
		const self = makeParty()
		expect(() => harness({ self })).not.toThrow()
	})
})

describe('TrxParticipant — first-sight validation (new-record RuleSet)', () => {
	const relay = makeParty()
	const alice = makeParty()
	const bob = makeParty()

	function reject(record: TrxRecord<TTerms, TPayload>): Promise<unknown> {
		const { participant } = harness({ self: relay })
		return participant.update(record)
	}

	it('rejects an expired transaction code', async () => {
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		record.transactionCode = generate(1000, { now: NOW - 10_000 }) // expired well before NOW
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects an expired session code', async () => {
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		record.sessionCode = generate(1000, { now: NOW - 10_000 })
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects an empty voter set (no "majority of zero")', async () => {
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant])], { n1: link(alice, bob) })
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects an empty participant set', async () => {
		const r1 = makeParty()
		const r2 = makeParty()
		const record = makeRecord([member(r1, [MemberTypes.voter]), member(r2, [MemberTypes.voter])], {})
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects a duplicate member entry', async () => {
		const record = makeRecord(
			[member(alice, [MemberTypes.participant]), member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])],
			{ n1: link(alice, bob) },
		)
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects a link that references a non-member', async () => {
		const stranger = makeParty()
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: { source: alice.key, target: stranger.key, intents: { lift: 'terms' } },
		})
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects a record where our own participant member rides no link', async () => {
		// self = alice, a participant, but the only link is bob→bob — so alice is on no link (self-inconsistent).
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(bob, bob),
		})
		const { participant } = harness({ self: alice })
		await expect(participant.update(record)).rejects.toThrow()
	})
})

describe('TrxParticipant — signature merge rejection reasons', () => {
	// A pure relay (self not a member) so `update` only merges + pushes; nothing it signs confounds the merge.
	// The topology travels on the record handed to `update`, so the relay itself needs no members/links.
	function relayOver() {
		return harness({ self: makeParty() })
	}

	it('drops a forged promise (verification fails) and leaves the record unharmed', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const forged = corrupt(await sign(alice, 'P', record))
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...record, promises: [forged] })
		expect(merged.promises).toEqual([])
		expect(rejectReasons(events)).toContain('forged')
	})

	it('drops a signature from a non-member', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const stranger = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const strangerPromise = await sign(stranger, 'P', record)
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...record, promises: [strangerPromise] })
		expect(merged.promises).toEqual([])
		expect(rejectReasons(events)).toContain('non-member')
	})

	it('drops a promise cast by a voter-only member (wrong role)', async () => {
		const alice = makeParty()
		const ref = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(ref, [MemberTypes.voter])]
		const record = makeRecord(members, { n1: link(alice, alice) })
		const refPromise = await sign(ref, 'P', record)
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...record, promises: [refPromise] })
		expect(merged.promises).toEqual([])
		expect(rejectReasons(events)).toContain('wrong-role')
	})

	it('drops a commit cast by a non-voter member (wrong role)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const aliceCommit = await sign(alice, 'C', record) // alice is participant-only → cannot vote
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...record, commits: [aliceCommit] })
		expect(merged.commits).toEqual([])
		expect(rejectReasons(events)).toContain('wrong-role')
	})

	it('drops a type-substituted promise (P relabelled NP) arriving fresh as forged', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const genuineP = await sign(alice, 'P', record)
		const relabelled: Signature = { ...genuineP, type: 'NP' } // relabel, no genuine prior signature present
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...record, promises: [relabelled] })
		expect(merged.promises).toEqual([])
		expect(rejectReasons(events)).toContain('forged')
	})

	it('drops a signature replayed from another transaction with the same topology (forged)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])]
		const links = { n1: link(alice, bob) }
		const recordA = makeRecord(members, links)
		const recordB: TrxRecord<TTerms, TPayload> = {
			...recordA,
			transactionCode: generate(LONG_TTL, { now: NOW }),
			sessionCode: generate(LONG_TTL, { now: NOW }),
			promises: [],
			commits: [],
		}
		const promiseOverB = await sign(alice, 'P', recordB) // valid under B, delivered into A
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...recordA, promises: [promiseOverB] })
		expect(merged.promises).toEqual([])
		expect(rejectReasons(events)).toContain('forged')
	})

	it('refuses a changed promise value for the same phase and keeps the first', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const first = await sign(alice, 'P', record)
		// A second promise, same address + same phase type, different value — refused as `changed` before any
		// verify (so a hand-mangled value is fine). `corrupt` just yields a value distinct from the first.
		const changed: Signature = corrupt(first)
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...record, promises: [first, changed] })
		expect(merged.promises).toEqual([first])
		expect(rejectReasons(events)).toContain('changed')
	})

	it('dedupes an identical re-delivered signature with no change and no rejection', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const promise = await sign(alice, 'P', record)
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...record, promises: [promise, promise] })
		expect(merged.promises).toEqual([promise]) // the duplicate deduped silently
		expect(rejectReasons(events)).toEqual([])
	})

	it('refuses a whole update whose immutable core differs from the stored copy (core-mismatch)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const { participant, store, events } = harness({ self: makeParty() })
		await participant.update(record) // first sight, stored
		const tampered: TrxRecord<TTerms, TPayload> = { ...record, payload: { amount: '999' } }
		await expect(participant.update(tampered)).rejects.toThrow()
		expect(rejectReasons(events)).toContain('core-mismatch')
		const stored = await store.getRecord(record.transactionCode)
		expect(stored?.payload).toEqual({ amount: '100' }) // the stored copy is unharmed
	})
})

describe('TrxParticipant — promise phase', () => {
	it('a cooperative participant signs P and then waits (promising)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const resource = makeResource()
		const { participant, events } = harness({
			self: alice,
			resource: resource.resource,
		})
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		const merged = await participant.update(record)
		expect(merged.promises.map((s) => s.type)).toEqual(['P'])
		expect(resource.promiseCtxs).toHaveLength(1)
		expect(eventsOfType(events, 'promise-signed').map((e) => e.signatureType)).toEqual(['P'])
		expect(resource.releaseSuccesses).toEqual([]) // nothing settled — bob has not promised
	})

	it('a declined gate (shouldPromise=false) signs NP and holds nothing, then voids', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const resource = makeResource({ shouldPromise: false })
		const { participant, events } = harness({ self: alice, resource: resource.resource })
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		await participant.update(record)
		expect(resource.shouldPromiseCtxs).toHaveLength(1)
		expect(resource.promiseCtxs).toEqual([]) // gate declined → the hold is never attempted
		expect(eventsOfType(events, 'promise-signed').map((e) => e.signatureType)).toEqual(['NP'])
		expect(resource.releaseSuccesses).toEqual([false]) // any NP voids the lift
	})

	it('a throwing hold (promise throws after the gate passed) signs NP, logs, and voids', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const resource = makeResource({ promiseThrows: true })
		const { participant, events, logs } = harness({ self: alice, resource: resource.resource })
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		await participant.update(record)
		expect(resource.promiseCtxs).toHaveLength(1) // the hold was attempted (gate defaulted true)
		expect(eventsOfType(events, 'promise-signed').map((e) => e.signatureType)).toEqual(['NP'])
		expect(resource.releaseSuccesses).toEqual([false])
		expect(logs.length).toBeGreaterThan(0)
	})

	it('an expired code at promise time signs NP without attempting the hold', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const clock = makeClock(NOW)
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		// Seed the record by first sight (via a relay) while the codes are still valid.
		await harness({ self: makeParty(), store, clock }).participant.update(record)
		// Now advance the clock past the codes' expiry; this is no longer first sight, so no RuleSet re-run.
		clock.set(NOW + LONG_TTL + 1)
		const resource = makeResource()
		const { participant, events } = harness({ self: alice, store, clock, resource: resource.resource })
		await participant.update(record)
		expect(resource.promiseCtxs).toEqual([]) // expiry refuses before any gate/hold
		expect(eventsOfType(events, 'promise-signed').map((e) => e.signatureType)).toEqual(['NP'])
		expect(resource.releaseSuccesses).toEqual([false])
	})

	it('a refused proposal (acceptsProposal=false) signs NP before shouldPromise is even consulted, and voids', async () => {
		const alice = makeParty()
		const bob = makeParty()
		// shouldPromise is present AND would pass — the test proves acceptsProposal runs first and short-circuits it.
		const resource = makeResource({ acceptsProposal: false, shouldPromise: true })
		const { participant, events } = harness({ self: alice, resource: resource.resource })
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		await participant.update(record)
		expect(resource.acceptsProposalCtxs).toHaveLength(1) // the proposal gate was consulted
		expect(resource.shouldPromiseCtxs).toEqual([]) // …and short-circuited the terms gate (ordering: proposal → terms)
		expect(resource.promiseCtxs).toEqual([]) // nothing was ever held
		expect(eventsOfType(events, 'promise-signed').map((e) => e.signatureType)).toEqual(['NP'])
		expect(resource.releaseSuccesses).toEqual([false]) // any NP voids the lift
	})

	it('a throwing proposal gate (acceptsProposal throws) signs NP, logs, and voids', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const resource = makeResource({ proposalThrows: true, shouldPromise: true })
		const { participant, events, logs } = harness({ self: alice, resource: resource.resource })
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		await participant.update(record)
		expect(resource.acceptsProposalCtxs).toHaveLength(1)
		expect(resource.shouldPromiseCtxs).toEqual([]) // a gate throw short-circuits just like a false
		expect(resource.promiseCtxs).toEqual([]) // nothing held
		expect(eventsOfType(events, 'promise-signed').map((e) => e.signatureType)).toEqual(['NP'])
		expect(resource.releaseSuccesses).toEqual([false])
		expect(logs.length).toBeGreaterThan(0) // the throw is logged, never swallowed silently
	})

	it('an accepted proposal consults both gates in order (proposal → terms) and then holds, signing P', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const resource = makeResource({ acceptsProposal: true, shouldPromise: true })
		const { participant } = harness({ self: alice, resource: resource.resource })
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		const merged = await participant.update(record)
		expect(resource.acceptsProposalCtxs).toHaveLength(1)
		expect(resource.shouldPromiseCtxs).toHaveLength(1) // both gates ran once, proposal before terms
		expect(resource.promiseCtxs).toHaveLength(1) // the hold ran after both gates passed
		expect(merged.promises.map((s) => s.type)).toEqual(['P'])
	})
})

describe('TrxParticipant — commit phase and settlement', () => {
	/** A one-member [P,V] lift over a self-link: it cascades promise → vote → release in one update. */
	function soloRecord(solo: Party): TrxRecord<TTerms, TPayload> {
		return makeRecord([member(solo, [MemberTypes.participant, MemberTypes.voter])], { n1: link(solo, solo) })
	}

	it('a solo node promises, commits (carrying its attachment), and releases on consensus', async () => {
		const solo = makeParty()
		const resource = makeResource({ attachment: 'edge-sig-bundle' })
		const { participant, events } = harness({ self: solo, resource: resource.resource })
		const merged = await participant.update(soloRecord(solo))
		expect(merged.promises.map((s) => s.type)).toEqual(['P'])
		expect(merged.commits.map((s) => s.type)).toEqual(['C'])
		expect(merged.commits[0].attachment).toBe('edge-sig-bundle') // the opaque per-edge bundle rides the vote
		expect(eventsOfType(events, 'voter-vote').map((e) => e.decision)).toEqual(['C'])
		expect(eventsOfType(events, 'settled').map((e) => e.decision)).toEqual(['commit'])
		expect(resource.releaseSuccesses).toEqual([true])
	})

	it('a solo node that declines to commit (shouldCommit=false) votes NC and voids', async () => {
		const solo = makeParty()
		const resource = makeResource({ shouldCommit: false })
		const { participant, events } = harness({ self: solo, resource: resource.resource })
		const merged = await participant.update(soloRecord(solo))
		expect(merged.commits.map((s) => s.type)).toEqual(['NC'])
		expect(eventsOfType(events, 'settled').map((e) => e.decision)).toEqual(['void'])
		expect(resource.releaseSuccesses).toEqual([false])
	})

	it('an expired code at commit time votes NC without consulting the gate', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const clock = makeClock(NOW)
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.voter])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const record: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)] }
		// Seed by first sight with the promise phase already complete; codes valid.
		await harness({ self: makeParty(), store, clock }).participant.update(record)
		clock.set(NOW + LONG_TTL + 1)
		const resource = makeResource({ shouldCommit: true }) // would say "commit" — but expiry pre-empts it
		const { participant, events } = harness({ self: ref, store, clock, resource: resource.resource })
		const merged = await participant.update(record)
		expect(merged.commits.map((s) => s.type)).toEqual(['NC'])
		expect(resource.shouldCommitCtxs).toEqual([]) // the gate is never consulted once expired
		expect(eventsOfType(events, 'voter-vote').map((e) => e.decision)).toEqual(['NC'])
		expect(resource.releaseSuccesses).toEqual([false])
	})

	it('retains an out-of-order commit unverified, then counts it once the last promise lands', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const r1 = makeParty()
		const r2 = makeParty()
		const members = [
			member(alice, [MemberTypes.participant]),
			member(bob, [MemberTypes.participant]),
			member(r1, [MemberTypes.voter]),
			member(r2, [MemberTypes.voter]),
		]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const aliceP = await sign(alice, 'P', base)
		const bobP = await sign(bob, 'P', base)
		const completePromises: TrxRecord<TTerms, TPayload> = { ...base, promises: [aliceP, bobP] }
		const r2Commit = await sign(r2, 'C', completePromises) // signed over the full promise set

		const resource = makeResource()
		const { participant, store, events } = harness({ self: r1, resource: resource.resource })

		// Delivery 1: r2's commit arrives before bob has promised — it cannot be verified yet, so it waits in
		// the side pool (NOT in the counted `commits` set, NOT rejected), where it cannot shadow a genuine vote.
		const afterFirst = await participant.update({ ...base, promises: [aliceP], commits: [r2Commit] })
		expect(afterFirst.commits).toHaveLength(0) // pooled, not counted
		expect(await store.getPendingCommits(base.transactionCode)).toHaveLength(1) // held in the side pool
		expect(rejectReasons(events)).toEqual([])
		expect(resource.releaseSuccesses).toEqual([]) // promise phase incomplete → r1 does not even vote

		// Delivery 2: bob's promise lands → promise phase completes → r2's commit verifies and counts; r1 votes;
		// two commits in a set of two is a strict majority → consensus.
		await participant.update({ ...base, promises: [aliceP, bobP], commits: [r2Commit] })
		expect(eventsOfType(events, 'settled').map((e) => e.decision)).toEqual(['commit'])
		expect(resource.releaseSuccesses).toEqual([true])
	})
})

describe('TrxParticipant — voter set sizes (strict majority, both ways, never both)', () => {
	/** A 2-participant lift plus `refs` voter-only members; the promise phase is pre-filled. */
	function completeLift(alice: Party, bob: Party, refs: Party[]) {
		const members = [
			member(alice, [MemberTypes.participant]),
			member(bob, [MemberTypes.participant]),
			...refs.map((r) => member(r, [MemberTypes.voter])),
		]
		const base = makeRecord(members, { n1: link(alice, bob) })
		return { base, members }
	}

	it('a set of two does not settle on a single vote (no majority yet)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const r1 = makeParty()
		const r2 = makeParty()
		const { base } = completeLift(alice, bob, [r1, r2])
		const promises = [await sign(alice, 'P', base), await sign(bob, 'P', base)]
		const resource = makeResource()
		const { participant, events } = harness({ self: r1, resource: resource.resource })
		const merged = await participant.update({ ...base, promises })
		expect(merged.commits.map((s) => s.type)).toEqual(['C']) // r1 voted
		expect(eventsOfType(events, 'settled')).toEqual([]) // but 1 of 2 is not a strict majority
		expect(resource.releaseSuccesses).toEqual([])
	})

	it('a set of two split one commit / one void settles neither way', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const r1 = makeParty()
		const r2 = makeParty()
		const { base } = completeLift(alice, bob, [r1, r2])
		const promises = [await sign(alice, 'P', base), await sign(bob, 'P', base)]
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises }
		const r2Void = await sign(r2, 'NC', complete)
		const resource = makeResource() // r1 will vote C by default
		const { participant, events } = harness({ self: r1, resource: resource.resource })
		await participant.update({ ...complete, commits: [r2Void] })
		expect(eventsOfType(events, 'settled')).toEqual([]) // even split → neither commit nor void majority
		expect(resource.releaseSuccesses).toEqual([])
	})

	it('a set of three settles on the second concurring vote', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const r1 = makeParty()
		const r2 = makeParty()
		const r3 = makeParty()
		const { base } = completeLift(alice, bob, [r1, r2, r3])
		const promises = [await sign(alice, 'P', base), await sign(bob, 'P', base)]
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises }
		const r2Commit = await sign(r2, 'C', complete)
		const resource = makeResource()
		const { participant, events } = harness({ self: r1, resource: resource.resource })
		await participant.update({ ...complete, commits: [r2Commit] }) // r1 votes → 2 of 3 → consensus
		expect(eventsOfType(events, 'settled').map((e) => e.decision)).toEqual(['commit'])
		expect(resource.releaseSuccesses).toEqual([true])
	})
})

describe('TrxParticipant — threshold settlement (method-driven win condition)', () => {
	const method = (thresholdNum: number, thresholdDen: number): ConsensusMethod => ({ weighting: 'distinct-voter', thresholdNum, thresholdDen })

	/** A 2-participant lift plus `voterCount` voter-only members, promise phase pre-filled, under `consensusMethod`. */
	async function completeUnder(voterCount: number, consensusMethod: ConsensusMethod): Promise<{ voters: Party[]; complete: TrxRecord<TTerms, TPayload> }> {
		const alice = makeParty()
		const bob = makeParty()
		const voters = Array.from({ length: voterCount }, () => makeParty())
		const members = [
			member(alice, [MemberTypes.participant]),
			member(bob, [MemberTypes.participant]),
			...voters.map((v) => member(v, [MemberTypes.voter])),
		]
		const base = makeRecord(members, { n1: link(alice, bob) }, { method: consensusMethod })
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)] }
		return { voters, complete }
	}

	it('2 of 3 voters commit settles at threshold 2/3 (reach, not merely a bare majority)', async () => {
		const { voters, complete } = await completeUnder(3, method(2, 3))
		const [v1, v2] = voters
		const v2Commit = await sign(v2, 'C', complete)
		const resource = makeResource() // v1 votes C by default → 2 of 3
		const { participant, events } = harness({ self: v1, resource: resource.resource })
		await participant.update({ ...complete, commits: [v2Commit] })
		expect(eventsOfType(events, 'settled').map((e) => e.decision)).toEqual(['commit'])
		expect(resource.releaseSuccesses).toEqual([true])
	})

	it('3 of 4 voters commit settles at threshold 3/4; 2 of 4 stays in the no-settle band', async () => {
		const { voters, complete } = await completeUnder(4, method(3, 4))
		const [v1, v2, v3] = voters
		const c1 = await sign(v1, 'C', complete)
		const c2 = await sign(v2, 'C', complete)
		const c3 = await sign(v3, 'C', complete)
		// 2 of 4: the strict-majority floor fails (2*2 = 4, not > 4) → no settle (the band), stays pending.
		const band = harness({ self: makeParty() }) // a relay observes the merge without voting
		await band.participant.update({ ...complete, commits: [c1, c2] })
		expect(eventsOfType(band.events, 'settled')).toEqual([])
		expect(await band.participant.outcome(complete.transactionCode)).toBe('pending')
		// 3 of 4: clears the floor (3*2 = 6 > 4) and reaches 3/4 → commit.
		const win = harness({ self: makeParty() })
		await win.participant.update({ ...complete, commits: [c1, c2, c3] })
		expect(await win.participant.outcome(complete.transactionCode)).toBe('commit')
	})

	it('threshold 1 (unanimity) needs every voter; one short does not settle', async () => {
		const { voters, complete } = await completeUnder(3, method(1, 1))
		const [v1, v2] = voters
		const v2Commit = await sign(v2, 'C', complete)
		const resource = makeResource() // v1 commits → 2 of 3, still short of unanimity
		const { participant, events } = harness({ self: v1, resource: resource.resource })
		await participant.update({ ...complete, commits: [v2Commit] })
		expect(eventsOfType(events, 'settled')).toEqual([])
		expect(resource.releaseSuccesses).toEqual([])
	})

	it('a lone voter under the default method settles on its own commit', async () => {
		const { voters, complete } = await completeUnder(1, DEFAULT_CONSENSUS_METHOD)
		const resource = makeResource()
		const { participant, events } = harness({ self: voters[0], resource: resource.resource })
		await participant.update(complete)
		expect(eventsOfType(events, 'settled').map((e) => e.decision)).toEqual(['commit'])
		expect(resource.releaseSuccesses).toEqual([true])
	})
})

describe('TrxParticipant — consensus-method validation', () => {
	const alice = makeParty()
	const bob = makeParty()

	function rejectWith(method: unknown): Promise<unknown> {
		const record = makeRecord(
			[member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])],
			{ n1: link(alice, bob) },
			{ method: method as ConsensusMethod },
		)
		return harness({ self: makeParty() }).participant.update(record)
	}

	it('rejects a threshold below 1/2', async () => {
		await expect(rejectWith({ weighting: 'distinct-voter', thresholdNum: 1, thresholdDen: 3 })).rejects.toThrow()
	})

	it('rejects a zero or non-integer denominator', async () => {
		await expect(rejectWith({ weighting: 'distinct-voter', thresholdNum: 1, thresholdDen: 0 })).rejects.toThrow()
		await expect(rejectWith({ weighting: 'distinct-voter', thresholdNum: 1, thresholdDen: 2.5 })).rejects.toThrow()
	})

	it('rejects a threshold above 1', async () => {
		await expect(rejectWith({ weighting: 'distinct-voter', thresholdNum: 3, thresholdDen: 2 })).rejects.toThrow()
	})

	it('rejects a reserved weighting', async () => {
		await expect(rejectWith({ weighting: 'nominator-split', thresholdNum: 1, thresholdDen: 2 })).rejects.toThrow()
	})

	it('accepts the default method', async () => {
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])], {
			n1: link(alice, bob),
		})
		await expect(harness({ self: makeParty() }).participant.update(record)).resolves.toBeDefined()
	})

	it('rejects an empty-string lift contract but accepts a present, non-empty one (LiftContract)', async () => {
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.voter])]
		const empty = makeRecord(members, { n1: link(alice, bob) }, { liftContract: '' })
		await expect(harness({ self: makeParty() }).participant.update(empty)).rejects.toThrow(/liftContract/)
		const present = makeRecord(members, { n1: link(alice, bob) }, { liftContract: 'bafyLiftContractCID' })
		await expect(harness({ self: makeParty() }).participant.update(present)).resolves.toBeDefined()
	})
})

describe('TrxParticipant — equivocation (a voter signs both faces)', () => {
	it('refuses the second face on merge, keeps the first, and logs', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.voter])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)] }
		const refCommit = await sign(ref, 'C', complete)
		const refVoid = await sign(ref, 'NC', complete) // a genuine second, different face
		const { participant, store, events, logs } = harness({ self: makeParty() }) // relay observes the merge
		await participant.update({ ...complete, commits: [refCommit] })
		const merged = await participant.update({ ...complete, commits: [refVoid] })
		expect(merged.commits).toEqual([refCommit]) // the first face stands
		expect(rejectReasons(events)).toContain('equivocation')
		expect(logs.length).toBeGreaterThan(0)
		const stored = await store.getRecord(base.transactionCode)
		expect(stored?.commits).toEqual([refCommit])
	})

	it('for a sole voter, the first face wins and a later opposite face cannot re-settle', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		// alice is self (a participant on the link); ref is the one voter.
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.voter])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const bobP = await sign(bob, 'P', base)
		const aliceP = await sign(alice, 'P', base)
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [aliceP, bobP] }
		const refCommit = await sign(ref, 'C', complete)
		const refVoid = await sign(ref, 'NC', complete)
		const resource = makeResource()
		const { participant, events } = harness({ self: alice, resource: resource.resource })
		// Delivery 1: bob's promise + ref's commit; alice promises herself → promises complete → commit counts → consensus.
		await participant.update({ ...base, promises: [bobP], commits: [refCommit] })
		expect(eventsOfType(events, 'settled').map((e) => e.decision)).toEqual(['commit'])
		expect(resource.releaseSuccesses).toEqual([true])
		// Delivery 2: ref now equivocates with NC — refused on merge; already-released, so no second release.
		await participant.update({ ...base, promises: [aliceP, bobP], commits: [refVoid] })
		expect(rejectReasons(events)).toContain('equivocation')
		expect(resource.releaseSuccesses).toEqual([true]) // still exactly one release; the commit outcome stands
	})
})

describe('TrxParticipant — commit-phase side pool (forged-commit-shadows-vote)', () => {
	// A 2-participant, 1-voter lift. A relay observes the merge so the pool→drain transition is visible
	// without the observer itself promising or voting. With a SOLE voter, a silenced vote would leave the
	// route at `pending` (no majority) — so a `commit` outcome proves the genuine vote survived.
	function lift(alice: Party, bob: Party, ref: Party): TrxRecord<TTerms, TPayload> {
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.voter])]
		return makeRecord(members, { n1: link(alice, bob) })
	}

	it('a garbage commit pooled before the promise phase completes does not shadow the genuine vote', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const base = lift(alice, bob, ref)
		const aliceP = await sign(alice, 'P', base)
		const bobP = await sign(bob, 'P', base)
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [aliceP, bobP] }
		const genuineC = await sign(ref, 'C', complete)
		const garbage = corrupt(genuineC) // same signer + face, non-verifying value

		const { participant, store, events } = harness({ self: makeParty() }) // a relay observes the merge

		// Pre-promise: the garbage commit cannot be verified yet → it waits in the side pool, never in `commits`.
		const afterGarbage = await participant.update({ ...base, promises: [], commits: [garbage] })
		expect(afterGarbage.commits).toEqual([])
		expect(await store.getPendingCommits(base.transactionCode)).toHaveLength(1)
		expect(rejectReasons(events)).toEqual([]) // pooled, not yet judged

		// Promises complete and the genuine vote arrives: the garbage drains (forged), the genuine C counts.
		const settled = await participant.update({ ...base, promises: [aliceP, bobP], commits: [genuineC] })
		expect(settled.commits).toEqual([genuineC]) // the genuine vote stands
		expect(await participant.outcome(base.transactionCode)).toBe('commit') // sole voter → strict majority
		expect(rejectReasons(events)).toContain('forged') // the drained garbage, dropped on verification
		expect(rejectReasons(events)).not.toContain('changed') // never collided with the genuine vote
		expect(rejectReasons(events)).not.toContain('equivocation')
		expect(await store.getPendingCommits(base.transactionCode)).toEqual([]) // pool drained empty
	})

	it('a garbage opposite-face (NC) commit pooled pre-promise does not collide with the genuine C', async () => {
		// Under the old (dedupe-before-verify) code a garbage NC occupied the voter's slot first, so the
		// genuine C collided as `equivocation` and was silenced. Pooled-until-verified, the garbage NC instead
		// drains as `forged` and the genuine C stands.
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const base = lift(alice, bob, ref)
		const aliceP = await sign(alice, 'P', base)
		const bobP = await sign(bob, 'P', base)
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [aliceP, bobP] }
		const genuineC = await sign(ref, 'C', complete)
		const garbageNC = corrupt(await sign(ref, 'NC', complete))

		const { participant, store, events } = harness({ self: makeParty() })
		await participant.update({ ...base, promises: [], commits: [garbageNC] })
		expect(await store.getPendingCommits(base.transactionCode)).toHaveLength(1)

		const settled = await participant.update({ ...base, promises: [aliceP, bobP], commits: [genuineC] })
		expect(settled.commits).toEqual([genuineC])
		expect(await participant.outcome(base.transactionCode)).toBe('commit')
		expect(rejectReasons(events)).toContain('forged')
		expect(rejectReasons(events)).not.toContain('equivocation')
	})

	it('caps the pool per voter: overflow drops as pool-full, and a later genuine vote still counts', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const base = lift(alice, bob, ref)
		const aliceP = await sign(alice, 'P', base)
		const bobP = await sign(bob, 'P', base)
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [aliceP, bobP] }
		const genuineC = await sign(ref, 'C', complete)
		// MAX_PENDING_COMMITS_PER_VOTER + 1 DISTINCT garbage commits for the one voter (distinct values, so
		// none dedupes): the pool fills at the cap and the final one overflows.
		const garbage = Array.from({ length: MAX_PENDING_COMMITS_PER_VOTER + 1 }, (_, i) => corruptAt(genuineC, i))

		const { participant, store, events } = harness({ self: makeParty() })
		await participant.update({ ...base, promises: [], commits: garbage })
		expect(await store.getPendingCommits(base.transactionCode)).toHaveLength(MAX_PENDING_COMMITS_PER_VOTER)
		expect(rejectReasons(events)).toContain('pool-full') // the overflow was refused, never pooled

		const settled = await participant.update({ ...base, promises: [aliceP, bobP], commits: [genuineC] })
		expect(settled.commits).toEqual([genuineC]) // the cap never locked out the real vote
		expect(await participant.outcome(base.transactionCode)).toBe('commit')
	})

	it('a genuine equivocation pooled pre-promise resolves to the earliest face on drain', async () => {
		// Both faces verify, both arrive before the promise phase completes, both are pooled. On drain the
		// insertion-order first face is promoted and the second is refused as `equivocation`.
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const base = lift(alice, bob, ref)
		const aliceP = await sign(alice, 'P', base)
		const bobP = await sign(bob, 'P', base)
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [aliceP, bobP] }
		const refCommit = await sign(ref, 'C', complete)
		const refVoid = await sign(ref, 'NC', complete)

		const { participant, store, events } = harness({ self: makeParty() })
		// Both genuine faces pooled pre-promise, commit first.
		await participant.update({ ...base, promises: [], commits: [refCommit, refVoid] })
		expect(await store.getPendingCommits(base.transactionCode)).toHaveLength(2)

		// Promises complete (the commit is NOT re-carried): the pool drains in insertion order.
		const settled = await participant.update({ ...base, promises: [aliceP, bobP], commits: [] })
		expect(settled.commits).toEqual([refCommit]) // the earliest face stands
		expect(rejectReasons(events)).toContain('equivocation')
		expect(await participant.outcome(base.transactionCode)).toBe('commit')
	})
})

describe('TrxParticipant — delivery lifecycle (release-once across re-delivery and restart)', () => {
	function soloRecord(solo: Party): TrxRecord<TTerms, TPayload> {
		return makeRecord([member(solo, [MemberTypes.participant, MemberTypes.voter])], { n1: link(solo, solo) })
	}

	it('does not re-release when a settled record is delivered again', async () => {
		const solo = makeParty()
		const resource = makeResource()
		const { participant } = harness({ self: solo, resource: resource.resource })
		const record = soloRecord(solo)
		const merged = await participant.update(record) // settles, releases once
		await participant.update(merged) // re-delivery after settlement
		expect(resource.releaseSuccesses).toEqual([true]) // released exactly once
	})

	it('a fresh participant over the same store does not re-release what was already released', async () => {
		const solo = makeParty()
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const first = makeResource()
		const h1 = harness({ self: solo, store, resource: first.resource })
		const merged = await h1.participant.update(soloRecord(solo))
		expect(first.releaseSuccesses).toEqual([true])
		// "Restart": a new participant over the same store sees the release flag and does not release again.
		const second = makeResource()
		const h2 = harness({ self: solo, store, resource: second.resource })
		await h2.participant.update(merged)
		expect(second.releaseSuccesses).toEqual([])
	})

	it('a restart that happened before release still releases exactly once', async () => {
		const solo = makeParty()
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const base = soloRecord(solo)
		const soloP = await sign(solo, 'P', base)
		const settled: TrxRecord<TTerms, TPayload> = { ...base, promises: [soloP], commits: [await sign(solo, 'C', { ...base, promises: [soloP] })] }
		await store.saveRecord(settled) // a settled record persisted, but the release flag was never set (crash)
		const resource = makeResource()
		const { participant } = harness({ self: solo, store, resource: resource.resource })
		await participant.update(settled)
		expect(resource.releaseSuccesses).toEqual([true]) // released once on recovery
	})

	it('a throwing release is retried on the next update and never double-releases', async () => {
		const solo = makeParty()
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const resource = makeResource({ releaseMode: 'throw-once' })
		const { participant, logs } = harness({ self: solo, store, resource: resource.resource })
		const record = soloRecord(solo)
		await expect(participant.update(record)).rejects.toThrow() // release threw → re-thrown; flag left unset
		expect(resource.releaseSuccesses).toEqual([]) // no successful release yet
		expect(logs.length).toBeGreaterThan(0)
		await participant.update(record) // retried; release now succeeds
		expect(resource.releaseSuccesses).toEqual([true]) // exactly one successful release, never two
	})
})

describe('TrxParticipant — reachability and push', () => {
	it('pushes to reachable peers, suppresses an unchanged re-push, and re-pushes once the record changes', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const relay = makeParty()
		const members = [
			member(alice, [MemberTypes.participant], { physical: 'addr-alice' }),
			member(bob, [MemberTypes.participant, MemberTypes.voter], { physical: 'addr-bob' }),
		]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const { participant, pushes } = harness({ self: relay, store })
		const aliceP = await sign(alice, 'P', record)
		const bobP = await sign(bob, 'P', record)

		await participant.update({ ...record, promises: [aliceP] })
		expect(pushes.map((p) => p.to).sort()).toEqual([alice.key, bob.key].sort()) // both physical peers

		await participant.update({ ...record, promises: [aliceP] }) // identical → every peer's copy unchanged
		expect(pushes).toHaveLength(2) // suppressed

		await participant.update({ ...record, promises: [aliceP, bobP] }) // the signature set changed
		expect(pushes).toHaveLength(4) // re-pushed to both
	})

	it('suppresses the echo back to the peer we just received from, but still forwards onward and re-pushes once content changes', async () => {
		// ChipNet primed the sender's peer-record on receipt so an unchanged record was never pushed
		// straight back to whoever just sent it (docs/chipnet-review.md § Regression check). A relay with
		// nothing new to add must stay quiet toward the sender while still forwarding to other peers, and
		// must resume pushing to the sender once our content actually changes.
		const alice = makeParty()
		const bob = makeParty()
		const relay = makeParty()
		const members = [
			member(alice, [MemberTypes.participant], { physical: 'addr-alice' }),
			member(bob, [MemberTypes.participant, MemberTypes.voter], { physical: 'addr-bob' }),
		]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const { participant, pushes } = harness({ self: relay })
		const aliceP = await sign(alice, 'P', record)

		await participant.update({ ...record, promises: [aliceP] }, { key: alice.key })
		expect(pushes.map((p) => p.to)).toEqual([bob.key]) // forwarded to bob, not echoed back to alice

		const bobP = await sign(bob, 'P', record)
		await participant.update({ ...record, promises: [aliceP, bobP] }, { key: bob.key })
		// bob's own content is suppressed (we just received it from bob); alice's copy is now stale → re-pushed
		expect(pushes.map((p) => p.to)).toEqual([bob.key, alice.key])
	})

	it('logs once and emits ok:false when a push fails; it is not retried in-band', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const relay = makeParty()
		const members = [
			member(alice, [MemberTypes.participant], { physical: 'addr-alice' }),
			member(bob, [MemberTypes.participant, MemberTypes.voter]), // no physical, not linked to relay → unreachable
		]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const failingPush: UpdatePeerFunc<TTerms, TPayload> = () => Promise.reject(new Error('transport down'))
		const { participant, events, logs } = harness({ self: relay, updatePeer: failingPush })
		await participant.update({ ...record, promises: [await sign(alice, 'P', record)] })
		const pushed = eventsOfType(events, 'record-pushed')
		expect(pushed).toHaveLength(1) // only alice is reachable
		expect(pushed[0].ok).toBe(false)
		expect(logs.length).toBeGreaterThan(0)
	})
})

describe('TrxParticipant — topology shapes', () => {
	it('a circular lift puts our member on two links; we promise over both and push to both neighbours', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const carol = makeParty()
		const ref = makeParty()
		const members = [
			member(alice, [MemberTypes.participant]),
			member(bob, [MemberTypes.participant]),
			member(carol, [MemberTypes.participant]),
			member(ref, [MemberTypes.voter]),
		]
		const links = { la: link(alice, bob), lb: link(bob, carol), lc: link(carol, alice) } // ring a→b→c→a
		const record = makeRecord(members, links)
		const resource = makeResource()
		const { participant, pushes } = harness({ self: alice, resource: resource.resource })
		const merged = await participant.update(record)
		expect(merged.promises.map((s) => s.type)).toEqual(['P']) // alice promises despite riding two links
		const ctx = resource.promiseCtxs[0]
		expect(ctx.outLinks.map((l) => `${l.source}->${l.target}`)).toEqual([`${alice.key}->${bob.key}`]) // our out-edge a→b
		expect(ctx.inLinks.map((l) => `${l.source}->${l.target}`)).toEqual([`${carol.key}->${alice.key}`]) // our in-edge c→a
		expect(pushes.map((p) => p.to).sort()).toEqual([bob.key, carol.key].sort()) // both link neighbours
	})

	it('a pure relay (self not a member) merges and pushes but never promises, votes, or releases', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const relay = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.voter])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)] }
		const refCommit = await sign(ref, 'C', complete) // a record that WOULD settle at a member
		const resource = makeResource()
		const { participant, events } = harness({ self: relay, resource: resource.resource })
		const merged = await participant.update({ ...complete, commits: [refCommit] })
		expect(merged.promises).toHaveLength(2)
		expect(merged.commits).toEqual([refCommit]) // merged by union
		expect(resource.promiseCtxs).toEqual([]) // never held
		expect(resource.releaseSuccesses).toEqual([]) // never released
		expect(eventsOfType(events, 'settled')).toEqual([]) // never settled — a relay does not act
		expect(eventsOfType(events, 'promise-signed')).toEqual([])
		expect(eventsOfType(events, 'voter-vote')).toEqual([])
	})
})

describe('TrxParticipant — record availability (fetchOutcome pulls a settled record)', () => {
	/**
	 * A two-member lift: `voter` is the sole `[P,V]` member and publishes a `physical` contact point;
	 * `self` is a `[P]`-only participant on the `voter → self` link. `self` holds the complete promise
	 * phase but no commit, so it is `pending` until it pulls the voter's settled record. The stub serves
	 * the voter's settled copy (its commit) only when asked of the voter's key — exactly what the
	 * in-memory network's pull channel does over a contact point.
	 */
	function availabilityFixture() {
		const voter = makeParty()
		const self = makeParty()
		return { voter, self }
	}

	async function settledVoterRecord(voter: Party, self: Party) {
		const members = [member(voter, [MemberTypes.participant, MemberTypes.voter], { physical: 'dial:voter' }), member(self, [MemberTypes.participant])]
		const base = makeRecord(members, { n1: link(voter, self) })
		const voterP = await sign(voter, 'P', base)
		const selfP = await sign(self, 'P', base)
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [voterP, selfP] }
		const voterCommit = await sign(voter, 'C', complete)
		const settled: TrxRecord<TTerms, TPayload> = { ...complete, commits: [voterCommit] }
		return { base, complete, voterCommit, settled }
	}

	it('pending with the promise phase alone; fetchOutcome pulls the voter commit, settles, and releases once', async () => {
		const { voter, self } = availabilityFixture()
		const { base, complete, voterCommit, settled } = await settledVoterRecord(voter, self)
		const fetchRecord: FetchRecordFunc<TTerms, TPayload> = (_tx, from) => Promise.resolve(from.key === voter.key ? settled : undefined)
		const resource = makeResource()
		const { participant, store } = harness({ self, resource: resource.resource, fetchRecord })

		// First sight of the complete promise phase, no commit: our side is settled nowhere yet.
		await participant.update(complete)
		expect(await participant.outcome(base.transactionCode)).toBe('pending')
		expect(resource.releaseSuccesses).toEqual([]) // nothing settled → nothing released

		// A pull obtains the voter's settled copy over its contact point and drives us to commit.
		expect(await participant.fetchOutcome(base.transactionCode)).toBe('commit')
		expect(resource.releaseSuccesses).toEqual([true])
		const stored = await store.getRecord(base.transactionCode)
		expect(stored?.commits).toEqual([voterCommit])

		// A second pull after settlement is idempotent: the union merge adds nothing, no second release.
		expect(await participant.fetchOutcome(base.transactionCode)).toBe('commit')
		expect(resource.releaseSuccesses).toEqual([true])
	})

	it('a pull reply carrying a forged commit is dropped by verify-on-merge; the puller stays pending', async () => {
		const { voter, self } = availabilityFixture()
		const { base, complete, voterCommit } = await settledVoterRecord(voter, self)
		const forgedReply: TrxRecord<TTerms, TPayload> = { ...complete, commits: [corrupt(voterCommit)] }
		const fetchRecord: FetchRecordFunc<TTerms, TPayload> = (_tx, from) => Promise.resolve(from.key === voter.key ? forgedReply : undefined)
		const resource = makeResource()
		const { participant, events } = harness({ self, resource: resource.resource, fetchRecord })

		await participant.update(complete)
		expect(await participant.fetchOutcome(base.transactionCode)).toBe('pending') // the forged commit never counts
		expect(rejectReasons(events)).toContain('forged')
		expect(resource.releaseSuccesses).toEqual([]) // a pull cannot inject unverified state
	})

	it('fetchOutcome with no stored record returns pending and pulls nothing (no topology to address)', async () => {
		const self = makeParty()
		let pulls = 0
		const fetchRecord: FetchRecordFunc<TTerms, TPayload> = () => {
			pulls += 1
			return Promise.resolve(undefined)
		}
		const { participant } = harness({ self, fetchRecord })
		expect(await participant.fetchOutcome('a-transaction-we-never-saw')).toBe('pending')
		expect(pulls).toBe(0) // without the record we hold no topology, so we cannot even address a pull
	})

	it('traces a `record-pulled` event per reachable peer, ok:true for the one that served and ok:false for the one that did not', async () => {
		const voter1 = makeParty()
		const voter2 = makeParty()
		const self = makeParty()
		const members = [
			member(voter1, [MemberTypes.participant, MemberTypes.voter], { physical: 'dial:voter1' }),
			member(voter2, [MemberTypes.participant, MemberTypes.voter], { physical: 'dial:voter2' }),
			member(self, [MemberTypes.participant]),
		]
		const record = makeRecord(members, { n1: link(voter1, self), n2: link(voter2, self) })
		// voter1 serves its own (identical, already-stored) copy back; voter2 serves nothing.
		const fetchRecord: FetchRecordFunc<TTerms, TPayload> = (_tx, from) => Promise.resolve(from.key === voter1.key ? record : undefined)
		const { participant, events } = harness({ self, fetchRecord })

		await participant.update(record)
		await participant.fetchOutcome(record.transactionCode)

		const pulled = eventsOfType(events, 'record-pulled')
		expect(new Map(pulled.map((event) => [event.from, event.ok]))).toEqual(
			new Map([
				[voter1.key, true],
				[voter2.key, false],
			]),
		)
	})
})

describe('TrxParticipant — equivocation proof kept (both signed faces retained as evidence)', () => {
	it('retains both commit faces (C and NC) as proof while the first face still settles', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.voter])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)] }
		const refCommit = await sign(ref, 'C', complete)
		const refVoid = await sign(ref, 'NC', complete) // a genuine, verifiable opposite face
		const { participant, store, events } = harness({ self: makeParty() }) // a relay observes the merge
		await participant.update({ ...complete, commits: [refCommit] })
		const merged = await participant.update({ ...complete, commits: [refVoid] })
		expect(merged.commits.map((s) => s.type)).toEqual(['C']) // the authoritative set is unchanged — the first face stands
		expect(rejectReasons(events)).toContain('equivocation')
		const proof = await store.getProof(base.transactionCode, ref.key)
		expect(proof.map((s) => s.type)).toEqual(['C', 'NC']) // both faces retained as proof
		expect(await store.getProofSigners(base.transactionCode)).toEqual([ref.key])
		expect(eventsOfType(events, 'equivocation-proof-kept').map((e) => e.signer)).toEqual([ref.key])
	})

	it('retains both promise faces (P and NP) as proof', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.voter])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const aliceP = await sign(alice, 'P', base)
		const aliceNP = await sign(alice, 'NP', base) // alice equivocates in the promise phase
		const { participant, store, events } = harness({ self: makeParty() })
		await participant.update({ ...base, promises: [aliceP] })
		await participant.update({ ...base, promises: [aliceNP] })
		const proof = await store.getProof(base.transactionCode, alice.key)
		expect(proof.map((s) => s.type)).toEqual(['P', 'NP'])
		expect(eventsOfType(events, 'equivocation-proof-kept').map((e) => e.signer)).toEqual([alice.key])
	})

	it('does not retain a forged opposite face — a face the signer never signed is not evidence', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.voter])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)] }
		const refCommit = await sign(ref, 'C', complete)
		const refVoidForged = corrupt(await sign(ref, 'NC', complete))
		const { participant, store, events } = harness({ self: makeParty() })
		await participant.update({ ...complete, commits: [refCommit] })
		await participant.update({ ...complete, commits: [refVoidForged] })
		expect(rejectReasons(events)).toContain('forged') // promoteCommit verifies first → forged, not equivocation
		expect(await store.getProof(base.transactionCode, ref.key)).toEqual([]) // no proof retained
		expect(await store.getProofSigners(base.transactionCode)).toEqual([])
		expect(eventsOfType(events, 'equivocation-proof-kept')).toEqual([])
	})
})

describe('TrxParticipant — settled-outcome contradiction (equivocating voters split two copies)', () => {
	it('flags a contradiction when our committed outcome meets a voided copy, keeps our outcome, and retains the proof', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const r1 = makeParty()
		const r2 = makeParty()
		const members = [
			member(alice, [MemberTypes.participant]),
			member(bob, [MemberTypes.participant]),
			member(r1, [MemberTypes.voter]),
			member(r2, [MemberTypes.voter]),
		]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)] }
		const r1C = await sign(r1, 'C', complete)
		const r2C = await sign(r2, 'C', complete)
		const r1NC = await sign(r1, 'NC', complete)
		const r2NC = await sign(r2, 'NC', complete)
		const resource = makeResource()
		const { participant, events } = harness({ self: alice, resource: resource.resource })

		// Delivery 1: both voters' commit faces → strict majority → consensus; alice releases; no contradiction yet.
		await participant.update({ ...complete, commits: [r1C, r2C] })
		expect(await participant.outcome(base.transactionCode)).toBe('commit')
		expect(resource.releaseSuccesses).toEqual([true])
		expect(await participant.contradicts(base.transactionCode)).toBe(false)

		// Delivery 2: the SAME voters' NC faces (they equivocated) → a copy that voids. Our settled outcome stands.
		await participant.update({ ...complete, commits: [r1NC, r2NC] })
		expect(await participant.outcome(base.transactionCode)).toBe('commit')
		expect(await participant.contradicts(base.transactionCode)).toBe(true)
		const flags = eventsOfType(events, 'contradiction-detected')
		expect(flags).toHaveLength(1)
		expect(flags[0]).toMatchObject({ ourOutcome: 'commit', peerOutcome: 'void' })
		expect(resource.releaseSuccesses).toEqual([true]) // still exactly one release — settlement is untouched
		expect([...(await participant.equivocators(base.transactionCode))].sort()).toEqual([r1.key, r2.key].sort())
		expect(await participant.equivocationProof(base.transactionCode, r1.key)).toHaveLength(2) // C + NC
	})
})

describe('TrxParticipant — deadline timer', () => {
	const P = MemberTypes.participant
	const V = MemberTypes.voter

	it('(a) drives an un-voted voter to NC on the deadline (seeded complete-promise store)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [P]), member(bob, [P]), member(ref, [V])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		// A complete promise phase with zero commits, SEEDED directly: calling update() would make ref vote C
		// synchronously, so the un-voted-voter-at-deadline branch is only reachable by seeding the store by hand.
		const stored: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)], commits: [] }
		const store = new MemoryTrxStore<TTerms, TPayload>()
		await store.saveRecord(stored)
		const clock = makeClock(NOW)
		const resource = makeResource()
		const { participant, events } = harness({ self: ref, store, clock, resource: resource.resource })

		clock.set(expiresAt(base.transactionCode) + 1) // past the deadline
		await participant.onDeadline(base.transactionCode)

		const settled = await store.getRecord(base.transactionCode)
		expect(settled!.commits.map((s) => s.type)).toEqual(['NC']) // the un-voted voter voids on timeout
		expect(settled!.commits[0].address).toBe(ref.key)
		expect(await participant.outcome(base.transactionCode)).toBe('void') // sole voter NC → strict void majority
		expect(eventsOfType(events, 'deadline-reached').map((e) => e.acted)).toEqual([true])
		expect(resource.releaseSuccesses).toEqual([false]) // released once, as a void
	})

	it('(b) a voter that already voted C no-ops on the deadline (no equivocation)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const r2 = makeParty()
		const members = [member(alice, [P]), member(bob, [P]), member(ref, [V]), member(r2, [V])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)] }
		const refC = await sign(ref, 'C', complete) // ref already voted C; r2 has not voted → 1 of 2, no majority yet
		const stored: TrxRecord<TTerms, TPayload> = { ...complete, commits: [refC] }
		const store = new MemoryTrxStore<TTerms, TPayload>()
		await store.saveRecord(stored)
		const clock = makeClock(NOW)
		const resource = makeResource()
		const { participant, events } = harness({ self: ref, store, clock, resource: resource.resource })

		clock.set(expiresAt(base.transactionCode) + 1)
		await participant.onDeadline(base.transactionCode)

		const after = await store.getRecord(base.transactionCode)
		expect(after!.commits.map((s) => s.type)).toEqual(['C']) // still just ref's C — no second (NC) face appended
		expect(await participant.outcome(base.transactionCode)).toBe('pending') // propagating: 1 of 2
		expect(eventsOfType(events, 'deadline-reached').map((e) => e.acted)).toEqual([false])
		expect(resource.releaseSuccesses).toEqual([])
	})

	it('(c) a promised-and-waiting participant arms a timer, then no-ops when its deadline fires', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [P]), member(bob, [P]), member(ref, [V])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const clock = makeClock(NOW)
		const resource = makeResource()
		const { participant, events } = harness({ self: alice, clock, resource: resource.resource })

		await participant.update(record) // alice promises; the promise phase is incomplete → pending → a timer arms
		expect(clock.liveTimers()).toBe(1)
		expect(clock.armed[0].delayMs).toBe(LONG_TTL + SKEW_GRACE_MS) // fires a skew grace past the code's own expiry

		clock.set(expiresAt(record.transactionCode) + 1)
		await participant.onDeadline(record.transactionCode)

		const held = await participant.serveRecord(record.transactionCode)
		expect(held!.promises.some((s) => s.type === 'NP')).toBe(false) // alice holds P; it cannot NP over its own P
		expect(await participant.outcome(record.transactionCode)).toBe('pending')
		expect(eventsOfType(events, 'deadline-reached').map((e) => e.acted)).toEqual([false])
	})

	it('(d) arms on a non-terminal record and clears on a terminal one in a single update', async () => {
		const solo = makeParty()
		const clock = makeClock(NOW)
		const { participant } = harness({ self: solo, clock })
		await participant.update(makeRecord([member(solo, [P, V])], { n1: link(solo, solo) })) // cascades to commit → terminal
		expect(clock.liveTimers()).toBe(0) // a settled record leaves no timer armed
	})

	it('(e) leaks no timer across settle or abort', async () => {
		// A committing update leaves nothing armed.
		const solo = makeParty()
		const c1 = makeClock(NOW)
		const h1 = harness({ self: solo, clock: c1 })
		await h1.participant.update(makeRecord([member(solo, [P, V])], { n1: link(solo, solo) }))
		expect(c1.liveTimers()).toBe(0)

		// An abort that voids leaves nothing armed.
		const alice = makeParty()
		const bob = makeParty()
		const base = makeRecord([member(alice, [P]), member(bob, [P, V])], { n1: link(alice, bob) })
		const store = new MemoryTrxStore<TTerms, TPayload>()
		await store.saveRecord(base) // seeded without our promise, so abort may sign NP and void
		const c2 = makeClock(NOW)
		const h2 = harness({ self: alice, store, clock: c2 })
		await h2.participant.abort(base.transactionCode)
		expect(c2.liveTimers()).toBe(0)
	})

	it('(f) onDeadline is a safe no-op on an unknown, released, or non-member transaction', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const base = makeRecord([member(alice, [P]), member(bob, [P]), member(ref, [V])], { n1: link(alice, bob) })

		// Unknown transaction: nothing stored.
		const unknown = harness({ self: ref })
		await expect(unknown.participant.onDeadline('not-a-transaction')).resolves.toBeUndefined()
		expect(eventsOfType(unknown.events, 'deadline-reached')).toEqual([])

		// Released transaction: the release flag short-circuits.
		const releasedStore = new MemoryTrxStore<TTerms, TPayload>()
		await releasedStore.saveRecord(base)
		await releasedStore.setReleased(base.transactionCode)
		const rel = harness({ self: ref, store: releasedStore })
		await rel.participant.onDeadline(base.transactionCode)
		expect(eventsOfType(rel.events, 'deadline-reached')).toEqual([])

		// Non-member: a stranger over the same stored record does nothing.
		const nonMemberStore = new MemoryTrxStore<TTerms, TPayload>()
		await nonMemberStore.saveRecord(base)
		const stranger = harness({ self: makeParty(), store: nonMemberStore })
		await stranger.participant.onDeadline(base.transactionCode)
		expect(eventsOfType(stranger.events, 'deadline-reached')).toEqual([])
	})

	it('(g) the promise pre-gate signs NP when too little of the lift window remains', async () => {
		const alice = makeParty()
		const bob = makeParty()
		// A transaction code whose whole remaining window is under the promise margin, but still unexpired + valid.
		const record = makeRecord([member(alice, [P]), member(bob, [P, V])], { n1: link(alice, bob) }, {
			transactionCode: generate(MIN_PROMISE_MARGIN_MS - 1000, { now: NOW }),
		})
		const resource = makeResource({ shouldPromise: true }) // would gladly promise — the pre-gate refuses first
		const { participant, events } = harness({ self: alice, resource: resource.resource })

		await participant.update(record)
		expect(eventsOfType(events, 'promise-signed').map((e) => e.signatureType)).toEqual(['NP'])
		expect(resource.shouldPromiseCtxs).toEqual([]) // the pre-gate short-circuits before the terms gate
		expect(resource.promiseCtxs).toEqual([]) // nothing was ever held
		expect(await participant.outcome(record.transactionCode)).toBe('void') // the NP voids the lift
	})

	it('(h) a per-node skewGraceMs override sets the armed delay (config is threaded, not hard-coded)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [P]), member(bob, [P]), member(ref, [V])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const clock = makeClock(NOW)
		const { participant } = harness({ self: alice, clock, skewGraceMs: 12_345 }) // not the SKEW_GRACE_MS default

		await participant.update(record) // alice promises; phase incomplete → pending → a timer arms
		expect(clock.liveTimers()).toBe(1)
		expect(clock.armed[0].delayMs).toBe(LONG_TTL + 12_345) // the override, not LONG_TTL + SKEW_GRACE_MS
	})

	it('(i) a per-node minPromiseMarginMs override moves the pre-gate both ways', async () => {
		const build = (marginMs: number, ttlMs: number) => {
			const alice = makeParty()
			const bob = makeParty()
			const record = makeRecord([member(alice, [P]), member(bob, [P, V])], { n1: link(alice, bob) }, {
				transactionCode: generate(ttlMs, { now: NOW }),
			})
			const resource = makeResource({ shouldPromise: true })
			return { record, ...harness({ self: alice, resource: resource.resource, minPromiseMarginMs: marginMs }) }
		}

		// A small margin accepts a window the DEFAULT margin (test g) would refuse.
		const accept = build(1_000, MIN_PROMISE_MARGIN_MS - 1_000)
		await accept.participant.update(accept.record)
		expect(eventsOfType(accept.events, 'promise-signed').map((e) => e.signatureType)).toEqual(['P'])

		// A margin wider than a full window refuses even that full window.
		const refuse = build(LONG_TTL + 1, LONG_TTL)
		await refuse.participant.update(refuse.record)
		expect(eventsOfType(refuse.events, 'promise-signed').map((e) => e.signatureType)).toEqual(['NP'])
		expect(await refuse.participant.outcome(refuse.record.transactionCode)).toBe('void')
	})
})

describe('TrxParticipant — recovery loop (periodic re-push/pull after the deadline)', () => {
	const P = MemberTypes.participant
	const V = MemberTypes.voter

	/** The latest live (armed, not cleared) timer's delay, or undefined when none is armed. */
	function liveDelay(clock: MutableClock): number | undefined {
		const live = clock.armed.filter((timer) => !timer.cleared)
		return live.length ? live[live.length - 1].delayMs : undefined
	}

	/**
	 * A promised-but-waiting participant: alice (self) holds her `P`, bob (the other participant) has not
	 * promised and ref (the sole voter) has not voted — so the record is non-terminal (`pending`) and
	 * alice has nothing left to do, the clean "quiet tick" fixture. Alice's only reachable peer is bob (the
	 * `n1` link), so a pull targets bob.
	 */
	async function pendingAlice(): Promise<{ alice: Party; bob: Party; ref: Party; base: TrxRecord<TTerms, TPayload>; store: MemoryTrxStore<TTerms, TPayload> }> {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [P]), member(bob, [P]), member(ref, [V])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		const stored: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base)], commits: [] }
		const store = new MemoryTrxStore<TTerms, TPayload>()
		await store.saveRecord(stored)
		return { alice, bob, ref, base, store }
	}

	it('(j) a quiet recovery tick re-pushes, emits recovery-tick, and doubles the backoff', async () => {
		const { alice, base, store } = await pendingAlice()
		const clock = makeClock(NOW)
		const { participant, events } = harness({ self: alice, store, clock })
		clock.set(expiresAt(base.transactionCode) + 1) // past the deadline — the loop, not the 6a one-shot, now drives

		await participant.onRecoveryTick(base.transactionCode)
		expect(liveDelay(clock)).toBe(RECOVERY_BASE_MS * 2) // base 5000, doubled on a quiet tick → 10000
		await participant.onRecoveryTick(base.transactionCode)
		expect(liveDelay(clock)).toBe(RECOVERY_BASE_MS * 4) // doubled again → 20000
		expect(eventsOfType(events, 'recovery-tick').map((e) => [e.attempt, e.changed])).toEqual([[1, false], [2, false]])
		expect(clock.liveTimers()).toBe(1) // exactly one timer armed after each tick (the prior one cleared)
		expect(await participant.outcome(base.transactionCode)).toBe('pending') // nothing settled; alice still waits on bob
	})

	it('(k) a tick that merges new info resets the backoff to base', async () => {
		const { alice, bob, base, store } = await pendingAlice()
		const box: { reply?: TrxRecord<TTerms, TPayload> } = {} // mutable holder so the pull can start empty, then deliver
		const fetchRecord: FetchRecordFunc<TTerms, TPayload> = () => Promise.resolve(box.reply)
		const clock = makeClock(NOW)
		const { participant, events } = harness({ self: alice, store, clock, fetchRecord })
		clock.set(expiresAt(base.transactionCode) + 1)

		await participant.onRecoveryTick(base.transactionCode) // reply undefined → quiet: 5000 → 10000
		await participant.onRecoveryTick(base.transactionCode) // quiet: 10000 → 20000
		expect(liveDelay(clock)).toBe(RECOVERY_BASE_MS * 4)

		// Connectivity delivers bob's promise on the next pull → the merge is progress → backoff resets to base.
		box.reply = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)], commits: [] }
		await participant.onRecoveryTick(base.transactionCode)
		expect(liveDelay(clock)).toBe(RECOVERY_BASE_MS)
		const ticks = eventsOfType(events, 'recovery-tick')
		expect(ticks[ticks.length - 1].changed).toBe(true)
	})

	it('(l) gives up past the ceiling: emits recovery-abandoned and does not re-arm', async () => {
		const { alice, base, store } = await pendingAlice()
		const clock = makeClock(NOW)
		const { participant, events } = harness({ self: alice, store, clock, recoveryGiveupMs: 1_000 })
		clock.set(expiresAt(base.transactionCode) + 2_000) // past expiry + giveup

		await participant.onRecoveryTick(base.transactionCode)
		expect(eventsOfType(events, 'recovery-abandoned').map((e) => e.transactionCode)).toEqual([base.transactionCode])
		expect(eventsOfType(events, 'recovery-tick')).toEqual([]) // abandoned before the tick's force-push / emit
		expect(clock.liveTimers()).toBe(0) // no re-arm — active polling stopped
		expect(await participant.outcome(base.transactionCode)).toBe('pending') // resources stay held (the stuck case)
	})

	it('(m) a later inbound update after abandonment re-arms the loop (abandonment is not final)', async () => {
		const { alice, bob, base, store } = await pendingAlice()
		const clock = makeClock(NOW)
		const { participant } = harness({ self: alice, store, clock, recoveryGiveupMs: 1_000 })
		clock.set(expiresAt(base.transactionCode) + 2_000)
		await participant.onRecoveryTick(base.transactionCode) // abandons
		expect(clock.liveTimers()).toBe(0)

		// Connectivity returns: a delivery carrying bob's promise merges new info post-deadline → re-arms at base.
		const reply: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)], commits: [] }
		await participant.update(reply, { key: bob.key })
		expect(clock.liveTimers()).toBe(1)
		expect(liveDelay(clock)).toBe(RECOVERY_BASE_MS) // backoff cleared on abandon → resumes at base
	})

	it('(n) onRecoveryTick is a safe no-op on an unknown, released, or non-member transaction', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const base = makeRecord([member(alice, [P]), member(bob, [P]), member(ref, [V])], { n1: link(alice, bob) })

		const unknown = harness({ self: ref })
		await expect(unknown.participant.onRecoveryTick('not-a-transaction')).resolves.toBeUndefined()
		expect(eventsOfType(unknown.events, 'recovery-tick')).toEqual([])
		expect(eventsOfType(unknown.events, 'recovery-abandoned')).toEqual([])

		const releasedStore = new MemoryTrxStore<TTerms, TPayload>()
		await releasedStore.saveRecord(base)
		await releasedStore.setReleased(base.transactionCode)
		const rel = harness({ self: ref, store: releasedStore })
		await rel.participant.onRecoveryTick(base.transactionCode)
		expect(eventsOfType(rel.events, 'recovery-tick')).toEqual([])
		expect(rel.clock.liveTimers()).toBe(0)

		const nonMemberStore = new MemoryTrxStore<TTerms, TPayload>()
		await nonMemberStore.saveRecord(base)
		const stranger = harness({ self: makeParty(), store: nonMemberStore })
		await stranger.participant.onRecoveryTick(base.transactionCode)
		expect(eventsOfType(stranger.events, 'recovery-tick')).toEqual([])
	})

	it('(o) recovery forces a re-push even when unchanged, while a happy-path re-push still skips', async () => {
		const { alice, base, store } = await pendingAlice()
		const clock = makeClock(NOW)
		const stored: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base)], commits: [] }
		const { participant, pushes } = harness({ self: alice, store, clock })

		await participant.update(stored) // first push to bob records the peer copy
		const afterFirst = pushes.length
		expect(afterFirst).toBeGreaterThanOrEqual(1)

		await participant.update(stored) // unchanged → the happy-path skip suppresses the re-push
		expect(pushes.length).toBe(afterFirst)

		clock.set(expiresAt(base.transactionCode) + 1)
		await participant.onRecoveryTick(base.transactionCode) // recovery forces the re-send despite no change
		expect(pushes.length).toBeGreaterThan(afterFirst)
	})

	it('(p) a plain re-delivery after the deadline does not arm a recovery timer (the storm guard)', async () => {
		const { alice, base, store } = await pendingAlice()
		const clock = makeClock(NOW)
		const { participant } = harness({ self: alice, store, clock, recoveryGiveupMs: 1_000 })
		clock.set(expiresAt(base.transactionCode) + 2_000)
		await participant.onRecoveryTick(base.transactionCode) // abandons; no live timer
		expect(clock.liveTimers()).toBe(0)

		// Re-delivering the record we already hold merges nothing → must NOT revive the abandoned loop.
		await participant.update({ ...base, promises: [await sign(alice, 'P', base)], commits: [] })
		expect(clock.liveTimers()).toBe(0)
	})

	it('(q) the quiet-tick backoff caps at recoveryMaxMs', async () => {
		const { alice, base, store } = await pendingAlice()
		const clock = makeClock(NOW)
		const { participant } = harness({ self: alice, store, clock, recoveryBaseMs: 100, recoveryMaxMs: 250 })
		clock.set(expiresAt(base.transactionCode) + 1)
		await participant.onRecoveryTick(base.transactionCode) // 100 → 200
		expect(liveDelay(clock)).toBe(200)
		await participant.onRecoveryTick(base.transactionCode) // 200 → min(400, 250) = 250
		expect(liveDelay(clock)).toBe(250)
		await participant.onRecoveryTick(base.transactionCode) // stays capped
		expect(liveDelay(clock)).toBe(250)
	})

	it('(r) a recovery tick casts the deadline NC for an un-voted voter and settles (deadline folded into the tick)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [P]), member(bob, [P]), member(ref, [V])]
		const base = makeRecord(members, { n1: link(alice, bob) })
		// A complete promise phase, zero commits, seeded by hand (an un-voted sole voter past its deadline).
		const stored: TrxRecord<TTerms, TPayload> = { ...base, promises: [await sign(alice, 'P', base), await sign(bob, 'P', base)], commits: [] }
		const store = new MemoryTrxStore<TTerms, TPayload>()
		await store.saveRecord(stored)
		const clock = makeClock(NOW)
		const resource = makeResource()
		const { participant } = harness({ self: ref, store, clock, resource: resource.resource })
		clock.set(expiresAt(base.transactionCode) + 1)

		await participant.onRecoveryTick(base.transactionCode)
		const settled = await store.getRecord(base.transactionCode)
		expect(settled!.commits.map((s) => s.type)).toEqual(['NC']) // the tick's advance loop cast the timeout NC
		expect(await participant.outcome(base.transactionCode)).toBe('void') // sole voter NC → strict void majority
		expect(resource.releaseSuccesses).toEqual([false]) // released once, as a void
		expect(clock.liveTimers()).toBe(0) // settled → loop cleared, no re-arm
	})
})
