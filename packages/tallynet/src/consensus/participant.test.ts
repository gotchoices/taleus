import { ed25519 } from '@noble/curves/ed25519.js'
import { base64urlToBytes, bytesToBase64url } from '../base64url.js'
import type { Clock } from '../clock.js'
import type { Signer, Verifier } from '../crypto.js'
import { generate } from '../session-code.js'
import type { TraceEvent } from '../trace.js'
import { MemberTypes, type DependentMember, type MemberType } from '../discovery/types.js'
import { signRecord } from './signature.js'
import { MemoryTrxStore, type TrxStore } from './store.js'
import { MAX_PENDING_COMMITS_PER_REFEREE, TrxParticipant, type Logger, type UpdatePeerFunc } from './participant.js'
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

interface MutableClock extends Clock {
	set(now: number): void
}

/**
 * A clock whose `now` the test moves by hand. The consensus engine owns no timer, so `setTimer` /
 * `clearTimer` are wired to throw — any accidental timer use fails the test loudly.
 */
function makeClock(start = NOW): MutableClock {
	let current = start
	return {
		now: () => current,
		setTimer: () => {
			throw new Error('consensus must not arm timers')
		},
		clearTimer: () => {
			throw new Error('consensus must not clear timers')
		},
		set: (next) => {
			current = next
		},
	}
}

/* ── resource double ─────────────────────────────────────────────────────────────────── */

interface ResourceOpts {
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
	/** Contexts seen by the `shouldPromise` gate. */
	shouldPromiseCtxs: ResourceContext<TTerms, TPayload>[]
	/** Contexts seen by the `shouldCommit` gate. */
	shouldCommitCtxs: ResourceContext<TTerms, TPayload>[]
	/** The `success` flag of each **successful** `release` (a throwing release is not recorded). */
	releaseSuccesses: boolean[]
}

function makeResource(opts: ResourceOpts = {}): ResourceDouble {
	const promiseCtxs: ResourceContext<TTerms, TPayload>[] = []
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
	return { resource, promiseCtxs, shouldPromiseCtxs, shouldCommitCtxs, releaseSuccesses }
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
	nonceToLinkId?: Record<string, string>
	selfKeyOverride?: string
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
		nonceToLinkId: opts.nonceToLinkId ?? {},
		clock,
		trace: (event) => events.push(event),
		log,
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
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])], {
			n1: link(alice, bob),
		})
		record.transactionCode = generate(1000, { now: NOW - 10_000 }) // expired well before NOW
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects an expired session code', async () => {
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])], {
			n1: link(alice, bob),
		})
		record.sessionCode = generate(1000, { now: NOW - 10_000 })
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects an empty referee set (no "majority of zero")', async () => {
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant])], { n1: link(alice, bob) })
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects an empty participant set', async () => {
		const r1 = makeParty()
		const r2 = makeParty()
		const record = makeRecord([member(r1, [MemberTypes.referee]), member(r2, [MemberTypes.referee])], {})
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects a duplicate member entry', async () => {
		const record = makeRecord(
			[member(alice, [MemberTypes.participant]), member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])],
			{ n1: link(alice, bob) },
		)
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects a link that references a non-member', async () => {
		const stranger = makeParty()
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])], {
			n1: { source: alice.key, target: stranger.key, intents: { lift: 'terms' } },
		})
		await expect(reject(record)).rejects.toThrow()
	})

	it('rejects a record where our own participant member rides no link', async () => {
		// self = alice, a participant, but the only link is bob→bob — so alice is on no link (self-inconsistent).
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])], {
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
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])]
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
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])]
		const record = makeRecord(members, { n1: link(alice, bob) })
		const strangerPromise = await sign(stranger, 'P', record)
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...record, promises: [strangerPromise] })
		expect(merged.promises).toEqual([])
		expect(rejectReasons(events)).toContain('non-member')
	})

	it('drops a promise cast by a referee-only member (wrong role)', async () => {
		const alice = makeParty()
		const ref = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(ref, [MemberTypes.referee])]
		const record = makeRecord(members, { n1: link(alice, alice) })
		const refPromise = await sign(ref, 'P', record)
		const { participant, events } = relayOver()
		const merged = await participant.update({ ...record, promises: [refPromise] })
		expect(merged.promises).toEqual([])
		expect(rejectReasons(events)).toContain('wrong-role')
	})

	it('drops a commit cast by a non-referee member (wrong role)', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])]
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
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])]
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
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])]
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
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])]
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
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])]
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
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])]
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
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])], {
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
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])], {
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
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])], {
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
		const record = makeRecord([member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant, MemberTypes.referee])], {
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
})

describe('TrxParticipant — commit phase and settlement', () => {
	/** A one-member [P,R] lift over a self-link: it cascades promise → vote → release in one update. */
	function soloRecord(solo: Party): TrxRecord<TTerms, TPayload> {
		return makeRecord([member(solo, [MemberTypes.participant, MemberTypes.referee])], { n1: link(solo, solo) })
	}

	it('a solo node promises, commits (carrying its attachment), and releases on consensus', async () => {
		const solo = makeParty()
		const resource = makeResource({ attachment: 'edge-sig-bundle' })
		const { participant, events } = harness({ self: solo, resource: resource.resource })
		const merged = await participant.update(soloRecord(solo))
		expect(merged.promises.map((s) => s.type)).toEqual(['P'])
		expect(merged.commits.map((s) => s.type)).toEqual(['C'])
		expect(merged.commits[0].attachment).toBe('edge-sig-bundle') // the opaque per-edge bundle rides the vote
		expect(eventsOfType(events, 'referee-vote').map((e) => e.decision)).toEqual(['C'])
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
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.referee])]
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
		expect(eventsOfType(events, 'referee-vote').map((e) => e.decision)).toEqual(['NC'])
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
			member(r1, [MemberTypes.referee]),
			member(r2, [MemberTypes.referee]),
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

describe('TrxParticipant — referee set sizes (strict majority, both ways, never both)', () => {
	/** A 2-participant lift plus `refs` referee-only members; the promise phase is pre-filled. */
	function completeLift(alice: Party, bob: Party, refs: Party[]) {
		const members = [
			member(alice, [MemberTypes.participant]),
			member(bob, [MemberTypes.participant]),
			...refs.map((r) => member(r, [MemberTypes.referee])),
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

describe('TrxParticipant — equivocation (a referee signs both faces)', () => {
	it('refuses the second face on merge, keeps the first, and logs', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.referee])]
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

	it('for a sole referee, the first face wins and a later opposite face cannot re-settle', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		// alice is self (a participant on the link); ref is the one referee.
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.referee])]
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
	// A 2-participant, 1-referee lift. A relay observes the merge so the pool→drain transition is visible
	// without the observer itself promising or voting. With a SOLE referee, a silenced vote would leave the
	// route at `pending` (no majority) — so a `commit` outcome proves the genuine vote survived.
	function lift(alice: Party, bob: Party, ref: Party): TrxRecord<TTerms, TPayload> {
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.referee])]
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
		expect(await participant.outcome(base.transactionCode)).toBe('commit') // sole referee → strict majority
		expect(rejectReasons(events)).toContain('forged') // the drained garbage, dropped on verification
		expect(rejectReasons(events)).not.toContain('changed') // never collided with the genuine vote
		expect(rejectReasons(events)).not.toContain('equivocation')
		expect(await store.getPendingCommits(base.transactionCode)).toEqual([]) // pool drained empty
	})

	it('a garbage opposite-face (NC) commit pooled pre-promise does not collide with the genuine C', async () => {
		// Under the old (dedupe-before-verify) code a garbage NC occupied the referee's slot first, so the
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

	it('caps the pool per referee: overflow drops as pool-full, and a later genuine vote still counts', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const ref = makeParty()
		const base = lift(alice, bob, ref)
		const aliceP = await sign(alice, 'P', base)
		const bobP = await sign(bob, 'P', base)
		const complete: TrxRecord<TTerms, TPayload> = { ...base, promises: [aliceP, bobP] }
		const genuineC = await sign(ref, 'C', complete)
		// MAX_PENDING_COMMITS_PER_REFEREE + 1 DISTINCT garbage commits for the one referee (distinct values, so
		// none dedupes): the pool fills at the cap and the final one overflows.
		const garbage = Array.from({ length: MAX_PENDING_COMMITS_PER_REFEREE + 1 }, (_, i) => corruptAt(genuineC, i))

		const { participant, store, events } = harness({ self: makeParty() })
		await participant.update({ ...base, promises: [], commits: garbage })
		expect(await store.getPendingCommits(base.transactionCode)).toHaveLength(MAX_PENDING_COMMITS_PER_REFEREE)
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
		return makeRecord([member(solo, [MemberTypes.participant, MemberTypes.referee])], { n1: link(solo, solo) })
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
			member(bob, [MemberTypes.participant, MemberTypes.referee], { physical: 'addr-bob' }),
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

	it('logs once and emits ok:false when a push fails; it is not retried in-band', async () => {
		const alice = makeParty()
		const bob = makeParty()
		const relay = makeParty()
		const members = [
			member(alice, [MemberTypes.participant], { physical: 'addr-alice' }),
			member(bob, [MemberTypes.participant, MemberTypes.referee]), // no physical, not linked to relay → unreachable
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
			member(ref, [MemberTypes.referee]),
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
		const members = [member(alice, [MemberTypes.participant]), member(bob, [MemberTypes.participant]), member(ref, [MemberTypes.referee])]
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
		expect(eventsOfType(events, 'referee-vote')).toEqual([])
	})
})
