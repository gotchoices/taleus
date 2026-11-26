import { jest } from '@jest/globals'
import { realClock } from '../clock.js'
import { nobleHasher, type RandomSource } from '../crypto.js'
import { makeNonce } from '../nonce.js'
import { generate } from '../session-code.js'
import { canonicalEncode, type DigestValue } from '../digest.js'
import type { TraceEvent } from '../trace.js'
import { defaultHooks, type DiscoveryHooks } from './hooks.js'
import { MemoryParticipantStore, type ParticipantStore, type StoredContext } from './store.js'
import { Participant, type ParticipantConfig, type ParticipantOptions } from './participant.js'
import {
	DEFAULT_CONSENSUS_METHOD,
	MemberTypes,
	type FindAddressFunc,
	type FindResult,
	type Match,
	type Plan,
	type QueryPeerFunc,
	type QueryRequest,
	type QueryResponse,
	type UniQuery,
} from './types.js'

/**
 * Every test drives a single participant's `enter`/`reenter` over a **stub `queryPeer`** (no
 * network) and a `MemoryParticipantStore`, on the `realClock` under jest fake timers — exactly the
 * harness the ticket calls for. Each test targets one ChipNet discovery defect or edge case, each
 * of which a naive port gets wrong.
 *
 * Fake timers freeze `Date.now()` at {@link NOW}, so session validity and the round budget are
 * deterministic; a never-answering peer's round is ended by advancing the fake clock, never by real
 * wall time. The `afterEach` asserts no timer survives any test — the leaked-timer guarantee.
 */

type TTerms = string
type TPayload = string

const NOW = 1_700_000_000_000
const LONG_TTL = 600_000 // 10 min — comfortably valid and longer than minSessionMs
const BUDGET = 1_000

const SELF: Match = { member: { types: [MemberTypes.participant], address: { key: 'self' } } }

function matchFor(key: string): Match {
	return { member: { types: [MemberTypes.participant], address: { key } } }
}

function makeSession(ttlMs = LONG_TTL, now = NOW): string {
	return generate(ttlMs, { now }) // default CSPRNG → each call yields a distinct code
}

function nonceOf(session: string, linkId: string): string {
	return makeNonce(session, linkId, nobleHasher)
}

function makeQuery(session: string, overrides: Partial<UniQuery<TTerms>> = {}): UniQuery<TTerms> {
	return { target: { address: { key: 'target' } }, sessionCode: session, intents: { lift: 'want' }, maxDepth: 7, method: DEFAULT_CONSENSUS_METHOD, ...overrides }
}

function originatorPlan(): Plan<TTerms, TPayload> {
	return { path: [], members: [] }
}

/** A plan whose single inbound link's nonce matches `inLinkId` — what a mid-path node is reached with. */
function inboundPlan(session: string, inLinkId: string): Plan<TTerms, TPayload> {
	return { path: [{ nonce: nonceOf(session, inLinkId), intents: { lift: 'in' } }], members: [] }
}

function zeroStats(): QueryResponse<TTerms, TPayload>['stats'] {
	return { earliest: 0, latest: 0, gross: 0, outstanding: 0 }
}

function entranceReq(query: UniQuery<TTerms>, plan: Plan<TTerms, TPayload>, budgetMs = BUDGET): QueryRequest<TTerms, TPayload> {
	return { entrance: { query, plan }, budgetMs }
}

function reentranceReq(session: string, path: string[], budgetMs = BUDGET): QueryRequest<TTerms, TPayload> {
	return { reentrance: { sessionCode: session, path }, budgetMs }
}

interface HarnessOptions {
	findAddress: FindAddressFunc<TTerms, TPayload>
	queryPeer?: QueryPeerFunc<TTerms, TPayload>
	options?: Partial<ParticipantOptions>
	hooks?: DiscoveryHooks<TTerms, TPayload>
	store?: ParticipantStore<TTerms, TPayload>
	nodeId?: string
}

interface Harness {
	participant: Participant<TTerms, TPayload>
	store: ParticipantStore<TTerms, TPayload>
	traces: TraceEvent[]
	peerCalls: Array<{ request: QueryRequest<TTerms, TPayload>; linkId: string }>
}

function makeHarness(opts: HarnessOptions): Harness {
	const traces: TraceEvent[] = []
	const peerCalls: Harness['peerCalls'] = []
	const store = opts.store ?? new MemoryParticipantStore<TTerms, TPayload>()
	const random: RandomSource = { randomBytes: (n) => new Uint8Array(n) }
	const inner: QueryPeerFunc<TTerms, TPayload> = opts.queryPeer ?? ((_r, linkId) => Promise.reject(new Error(`unexpected queryPeer to ${linkId}`)))
	const queryPeer: QueryPeerFunc<TTerms, TPayload> = (request, linkId) => {
		peerCalls.push({ request, linkId })
		return inner(request, linkId)
	}
	const config: ParticipantConfig<TTerms, TPayload> = {
		store,
		clock: realClock,
		random,
		hasher: nobleHasher,
		nodeId: opts.nodeId ?? 'node-under-test',
		findAddress: opts.findAddress,
		hooks: opts.hooks ?? defaultHooks<TTerms, TPayload>(),
		queryPeer,
		options: opts.options,
		trace: (event) => traces.push(event),
	}
	return { participant: new Participant(config), store, traces, peerCalls }
}

/** A fixed `findAddress` for one node: defaults to "not the target, no neighbours", overridden per test. */
function findAddress(partial: Partial<FindResult<TTerms, TPayload>>): FindAddressFunc<TTerms, TPayload> {
	return () => Promise.resolve({ self: SELF, selfIsMatch: false, ...partial })
}

function prunes(traces: TraceEvent[], reason: string): TraceEvent[] {
	return traces.filter((event) => event.type === 'candidate-pruned' && event.reason === reason)
}

beforeEach(() => {
	jest.useFakeTimers({ now: NOW })
})

afterEach(() => {
	// The leaked-timer guarantee across every scenario: no round ever leaves a timer armed.
	expect(jest.getTimerCount()).toBe(0)
	jest.useRealTimers()
})

describe('enter — matches', () => {
	it('self is the target: returns ALL matching plans (self plan + one per peer link), no reentrance when no candidates', async () => {
		const session = makeSession()
		const h = makeHarness({
			findAddress: findAddress({
				selfIsMatch: true,
				peerMatch: [
					{ match: matchFor('target'), link: { id: 'P1', intents: { lift: 't' } } },
					{ match: matchFor('target'), link: { id: 'P2', intents: { lift: 't' } } },
				],
			}),
		})
		const resp = await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))

		expect(resp.plans).toHaveLength(3)
		expect(resp.plans!.filter((plan) => plan.path.length === 0)).toHaveLength(1) // the self plan
		expect(resp.plans!.filter((plan) => plan.path.length === 1)).toHaveLength(2) // one per matching peer link
		expect(resp.reentrance).toBeUndefined()
	})

	it('target is a direct peer: a peer-match plan at depth 1 with [self, target] members, no reentrance', async () => {
		const session = makeSession()
		const h = makeHarness({
			findAddress: findAddress({ peerMatch: [{ match: matchFor('target'), link: { id: 'P1', intents: { lift: 't' } } }] }),
		})
		const resp = await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))

		expect(resp.plans).toHaveLength(1)
		expect(resp.plans![0].path).toHaveLength(1)
		expect(resp.plans![0].members.map((member) => member.address.key)).toEqual(['self', 'target'])
		expect(resp.reentrance).toBeUndefined()
	})

	it('offers a reentrance while real candidates remain', async () => {
		const session = makeSession()
		const h = makeHarness({ findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }) })
		const resp = await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))

		expect(resp.plans).toBeUndefined()
		expect(resp.reentrance).toEqual({ sessionCode: session, path: [] })
	})
})

describe('enter — validation (errors never disclose a link id)', () => {
	it('rejects a non-empty plan arriving without an inbound link', async () => {
		const session = makeSession()
		const h = makeHarness({ findAddress: findAddress({}) })
		await expect(h.participant.query(entranceReq(makeQuery(session), inboundPlan(session, 'x')))).rejects.toThrow(/Plan must be empty/)
	})

	it('rejects an empty plan arriving over an inbound link', async () => {
		const session = makeSession()
		const h = makeHarness({ findAddress: findAddress({}) })
		await expect(h.participant.query(entranceReq(makeQuery(session), originatorPlan()), 'inbound')).rejects.toThrow(/A plan is required/)
	})

	it('rejects when the inbound nonce does not match the plan tail, disclosing no link id', async () => {
		const session = makeSession()
		const inLink = 'secret-inbound-link-id'
		const h = makeHarness({ findAddress: findAddress({}) })
		// Plan tail is the nonce of a *different* link than the one we were actually reached over.
		const wrongPlan: Plan<TTerms, TPayload> = { path: [{ nonce: nonceOf(session, 'other-link'), intents: { lift: 'x' } }], members: [] }

		const attempt = h.participant.query(entranceReq(makeQuery(session), wrongPlan), inLink)
		await expect(attempt).rejects.toThrow(/does not match the plan/)
		await attempt.catch((error: unknown) => {
			const text = error instanceof Error ? error.message : String(error)
			expect(text).not.toContain(inLink)
			expect(text).not.toContain('other-link')
		})
	})

	it('refuses a session with too little life left (SessionLongevity)', async () => {
		const shortSession = makeSession(10_000) // 10s < default minSessionMs (30s)
		const h = makeHarness({ findAddress: findAddress({}) })
		await expect(h.participant.query(entranceReq(makeQuery(shortSession), originatorPlan()))).rejects.toThrow(/too short-lived/)
	})

	it('refuses a query whose consensus method we cannot honour, before promising (ConsensusMethod)', async () => {
		const session = makeSession()
		const h = makeHarness({ findAddress: findAddress({}) })
		// A reserved weighting is refused at discovery time — the same validator the consensus new-record rule runs.
		const badMethod = { weighting: 'nominator-split', thresholdNum: 1, thresholdDen: 2 } as unknown as UniQuery<TTerms>['method']
		await expect(
			h.participant.query(entranceReq(makeQuery(session, { method: badMethod }), originatorPlan())),
		).rejects.toThrow(/weighting/)
		// An out-of-range threshold (below the strict-majority floor) is likewise refused.
		const lowThreshold = { weighting: 'distinct-voter', thresholdNum: 1, thresholdDen: 3 } as const
		await expect(
			h.participant.query(entranceReq(makeQuery(makeSession(), { method: lowThreshold }), originatorPlan())),
		).rejects.toThrow(/at least 1\/2/)
	})

	it('rejects a duplicate first visit for the same (session, path) — the check that never fired in ChipNet', async () => {
		const session = makeSession()
		const h = makeHarness({ findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }) })
		await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))
		await expect(h.participant.query(entranceReq(makeQuery(session), originatorPlan()))).rejects.toThrow(/already in progress/)
	})

	it('allows the same session on a different path', async () => {
		const session = makeSession()
		const h = makeHarness({ findAddress: findAddress({}) })
		// Two mid-path visits over different inbound links → two distinct (session, path) contexts.
		await h.participant.query(entranceReq(makeQuery(session), inboundPlan(session, 'in-a')), 'in-a')
		await expect(h.participant.query(entranceReq(makeQuery(session), inboundPlan(session, 'in-b')), 'in-b')).resolves.toBeDefined()
		expect(await h.store.getContext(session, [nonceOf(session, 'in-a')])).toBeDefined()
		expect(await h.store.getContext(session, [nonceOf(session, 'in-b')])).toBeDefined()
	})
})

describe('enter — cycle pruning (ChipNet reported cycles but never removed them)', () => {
	it('removes a candidate whose nonce is already on the path, and never re-queries it', async () => {
		const session = makeSession()
		const inLink = 'inbound'
		const normalLink = 'L-normal'
		const h = makeHarness({
			findAddress: findAddress({
				candidates: [
					{ id: inLink, intents: { lift: 'c' } }, // cycle: its nonce equals the inbound-path nonce
					{ id: normalLink, intents: { lift: 'n' } },
				],
			}),
			queryPeer: () => Promise.resolve({ stats: zeroStats() }), // normal link turns out to be a dead end
		})

		const enterResp = await h.participant.query(entranceReq(makeQuery(session), inboundPlan(session, inLink)), inLink)
		expect(prunes(h.traces, 'cycle').map((event) => (event as { nonce: string }).nonce)).toEqual([nonceOf(session, inLink)])
		expect(enterResp.reentrance).toBeDefined() // the non-cycle candidate survives

		await h.participant.query(reentranceReq(session, [nonceOf(session, inLink)]), inLink)
		expect(h.peerCalls.map((call) => call.linkId)).not.toContain(inLink) // cycle link never queried
		expect(h.peerCalls.map((call) => call.linkId)).toContain(normalLink)
	})
})

describe('reenter — advancing, pruning and conclusion', () => {
	it('prunes an errored sub-query (failed) and returns no reentrance when it was the last candidate', async () => {
		const session = makeSession()
		const h = makeHarness({
			findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }),
			queryPeer: () => Promise.reject(new Error('peer down')),
		})
		const enterResp = await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))
		expect(enterResp.reentrance).toBeDefined()
		const resp = await h.participant.query(reentranceReq(session, []))

		expect(prunes(h.traces, 'failed')).toHaveLength(1)
		expect(resp.reentrance).toBeUndefined()
		expect(resp.plans).toBeUndefined()
	})

	it('target unreachable: a dead-end candidate is pruned (no-reentrance); the search ends with no plans and never throws', async () => {
		const session = makeSession()
		const h = makeHarness({
			findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }),
			queryPeer: () => Promise.resolve({ stats: zeroStats() }), // completed, no plan, no reentrance
		})
		const enterResp = await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))
		expect(enterResp.reentrance).toBeDefined()

		const resp = await h.participant.query(reentranceReq(session, []))
		expect(prunes(h.traces, 'no-reentrance')).toHaveLength(1)
		expect(resp.plans).toBeUndefined()
		expect(resp.reentrance).toBeUndefined()
	})

	it('enforces the per-query maxDepth ceiling: prunes remaining candidates (max-depth) and concludes without a throw', async () => {
		const session = makeSession()
		const h = makeHarness({
			findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }),
			queryPeer: () => Promise.resolve({ reentrance: { sessionCode: session, path: ['d'] }, stats: zeroStats() }),
		})
		const query = makeQuery(session, { maxDepth: 2 })
		await h.participant.query(entranceReq(query, originatorPlan()))
		const r1 = await h.participant.query(reentranceReq(session, [])) // depth 1 → 2; candidate kept (has reentrance)
		expect(r1.reentrance).toBeDefined()

		const r2 = await h.participant.query(reentranceReq(session, [])) // depth 2 >= maxDepth 2 → conclude
		expect(prunes(h.traces, 'max-depth')).toHaveLength(1)
		expect(r2.reentrance).toBeUndefined()
	})
})

describe('reenter — the real time budget (ChipNet hard-coded 1000ms) and leaked timers', () => {
	it('ends the round at budgetMs — not before — with a round-budget-expired trace, keeping the sleeping candidate', async () => {
		const session = makeSession()
		const h = makeHarness({
			findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }),
			queryPeer: () => new Promise<QueryResponse<TTerms, TPayload>>(() => {}), // never answers
		})
		await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))

		const budgetMs = 250 // deliberately not 1000
		const pending = h.participant.query(reentranceReq(session, [], budgetMs))
		await Promise.resolve() // let reenter reach budgetedStep and arm the budget timer
		await jest.advanceTimersByTimeAsync(budgetMs - 1)
		expect(h.traces.some((event) => event.type === 'round-budget-expired')).toBe(false)
		await jest.advanceTimersByTimeAsync(1)
		const resp = await pending

		expect(h.traces.some((event) => event.type === 'round-budget-expired')).toBe(true)
		expect(resp.reentrance).toBeDefined() // the still-outstanding candidate is kept for a later round
	})

	it('leaves no armed timer after enter, nor after a budget-expired reenter', async () => {
		const session = makeSession()
		const h = makeHarness({
			findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }),
			queryPeer: () => new Promise<QueryResponse<TTerms, TPayload>>(() => {}),
		})
		await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))
		expect(jest.getTimerCount()).toBe(0) // enter arms no timer at all

		const pending = h.participant.query(reentranceReq(session, [], BUDGET))
		await jest.advanceTimersByTimeAsync(BUDGET)
		await pending
		expect(jest.getTimerCount()).toBe(0) // the budget timer fired and was cleared
	})

	it('folds a sleeping peer\'s late answer on the next round (late-answer-folded)', async () => {
		const session = makeSession()
		let resolvePeer!: (resp: QueryResponse<TTerms, TPayload>) => void
		const peerPromise = new Promise<QueryResponse<TTerms, TPayload>>((resolve) => {
			resolvePeer = resolve
		})
		const h = makeHarness({
			findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }),
			queryPeer: () => peerPromise,
		})
		await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))

		// Round 1: the peer sleeps through the whole budget.
		const round1 = h.participant.query(reentranceReq(session, [], BUDGET))
		await jest.advanceTimersByTimeAsync(BUDGET)
		const r1 = await round1
		expect(r1.reentrance).toBeDefined() // candidate kept, still sleeping

		// The peer wakes up with a (non-satisfying, dead-end) answer between rounds.
		const latePlan: Plan<TTerms, TPayload> = { path: [{ nonce: 'late', intents: { other: 'y' } }], members: [] }
		resolvePeer({ plans: [latePlan], stats: zeroStats() })
		await Promise.resolve()

		// Round 2: harvest observes the late completion and folds it in.
		const r2 = await h.participant.query(reentranceReq(session, [], BUDGET))
		expect(h.traces.some((event) => event.type === 'late-answer-folded' && (event as { nonce: string }).nonce === nonceOf(session, 'L1'))).toBe(true)
		expect(r2.plans).toHaveLength(1)
		expect(r2.reentrance).toBeUndefined() // dead end after folding → concluded
	})

	it('a sleeping peer that errors between rounds is pruned (failed) without a spurious retry', async () => {
		const session = makeSession()
		let rejectPeer!: (reason: Error) => void
		const peerPromise = new Promise<QueryResponse<TTerms, TPayload>>((_resolve, reject) => {
			rejectPeer = reject
		})
		const h = makeHarness({
			findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }),
			queryPeer: () => peerPromise,
		})
		await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))

		// Round 1: the peer sleeps through the whole budget (issued exactly once).
		const round1 = h.participant.query(reentranceReq(session, [], BUDGET))
		await jest.advanceTimersByTimeAsync(BUDGET)
		const r1 = await round1
		expect(r1.reentrance).toBeDefined() // candidate kept, still outstanding
		expect(h.peerCalls).toHaveLength(1)

		// The sleeping sub-query errors between rounds.
		rejectPeer(new Error('peer died late'))
		await Promise.resolve()

		// Round 2: the late error is harvested → candidate pruned (failed), and NOT re-queried.
		const r2 = await h.participant.query(reentranceReq(session, [], BUDGET))
		expect(prunes(h.traces, 'failed')).toHaveLength(1)
		expect(h.peerCalls).toHaveLength(1) // no spurious retry of the errored candidate
		expect(r2.reentrance).toBeUndefined()
		expect(r2.plans).toBeUndefined()
	})
})

describe('reenter — ticket validation', () => {
	it('refuses a reentrance once the session has expired mid-search (expired)', async () => {
		const session = makeSession(LONG_TTL)
		const h = makeHarness({ findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }) })
		await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))

		jest.setSystemTime(NOW + LONG_TTL + 1) // the session is now past its expiry
		await expect(h.participant.query(reentranceReq(session, []))).rejects.toThrow(/session expired/)
		expect(prunes(h.traces, 'expired')).toHaveLength(1)
	})

	it('rejects a reentrance for a session with no stored context', async () => {
		const session = makeSession()
		const other = makeSession()
		const h = makeHarness({ findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }) })
		await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))
		await expect(h.participant.query(reentranceReq(other, []))).rejects.toThrow(/already complete/)
	})

	it('rejects a reentrance whose session disagrees with the stored context', async () => {
		const stored = makeSession()
		const ticket = makeSession() // valid, but not the session the stored context was created under
		const storedContext: StoredContext<TTerms, TPayload> = {
			query: makeQuery(stored),
			plan: originatorPlan(),
			self: SELF,
			candidates: [{ linkId: 'L1', nonce: 'n1', depth: 0, intents: { lift: 't' } }],
			nonceToLinkId: {},
			depth: 1,
			complete: false,
		}
		const store: ParticipantStore<TTerms, TPayload> = {
			validateNewQuery: () => Promise.resolve(),
			getContext: () => Promise.resolve(storedContext),
			saveContext: () => Promise.resolve(),
			getNonceToLinkMap: () => Promise.resolve({}),
		}
		const h = makeHarness({ findAddress: findAddress({}), store })
		await expect(h.participant.query(reentranceReq(ticket, []))).rejects.toThrow(/Session code mismatch/)
	})
})

describe('durability — nothing stray or non-serialisable escapes', () => {
	it('returned plans carry no sessionCode field and canonical-encode cleanly', async () => {
		const session = makeSession()
		const h = makeHarness({ findAddress: findAddress({ selfIsMatch: true }) })
		const resp = await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))

		expect(resp.plans).toHaveLength(1)
		for (const plan of resp.plans!) {
			expect('sessionCode' in plan).toBe(false)
			expect(() => canonicalEncode(plan as unknown as DigestValue)).not.toThrow()
		}
	})

	it('a host-supplied payload rides on a concluding plan and stays encodable', async () => {
		const session = makeSession()
		const h = makeHarness({ findAddress: findAddress({ selfIsMatch: true, payload: 'terminus-message' }) })
		const resp = await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))
		expect(resp.plans![0].payload).toBe('terminus-message')
		expect(() => canonicalEncode(resp.plans![0] as unknown as DigestValue)).not.toThrow()
	})

	it('the saved StoredContext holds no live Pending — it is DAG-CBOR encodable at every save', async () => {
		const session = makeSession()
		const saves: StoredContext<TTerms, TPayload>[] = []
		const inner = new MemoryParticipantStore<TTerms, TPayload>()
		const spyStore: ParticipantStore<TTerms, TPayload> = {
			validateNewQuery: (code, path) => inner.validateNewQuery(code, path),
			getContext: (code, path) => inner.getContext(code, path),
			getNonceToLinkMap: (code) => inner.getNonceToLinkMap(code),
			saveContext: (context, path) => {
				// If a live Pending (or any class instance / function) had slipped into the context,
				// this throws here and the reenter rejects — the test would fail loudly.
				canonicalEncode(context as unknown as DigestValue)
				saves.push(context)
				return inner.saveContext(context, path)
			},
		}
		const h = makeHarness({
			store: spyStore,
			findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }),
			queryPeer: () => Promise.resolve({ reentrance: { sessionCode: session, path: ['d'] }, stats: zeroStats() }),
		})
		await h.participant.query(entranceReq(makeQuery(session), originatorPlan()))
		await h.participant.query(reentranceReq(session, []))

		expect(saves.length).toBeGreaterThanOrEqual(2)
		const last = saves[saves.length - 1]
		const stored = last.candidates[0].lastResponse
		expect(stored).toBeDefined()
		expect(Object.getPrototypeOf(stored)).toBe(Object.prototype) // a plain object, not a Pending instance
	})
})

describe('restart & concurrency — durable lastResponse is the single source of truth', () => {
	it('a restart between rounds (fresh in-flight table, same store) re-issues from durable state without losing or double-counting plans', async () => {
		const session = makeSession()
		const store = new MemoryParticipantStore<TTerms, TPayload>()
		// Non-satisfying plans (no `lift` code) so the search keeps going rather than concluding.
		const plan1: Plan<TTerms, TPayload> = { path: [{ nonce: 'p1', intents: { other: 'y' } }], members: [] }
		const plan2: Plan<TTerms, TPayload> = { path: [{ nonce: 'p2', intents: { other: 'y' } }], members: [] }

		const first = makeHarness({
			store,
			findAddress: findAddress({ candidates: [{ id: 'L1', intents: { lift: 't' } }] }),
			queryPeer: () => Promise.resolve({ plans: [plan1], reentrance: { sessionCode: session, path: ['d1'] }, stats: zeroStats() }),
		})
		await first.participant.query(entranceReq(makeQuery(session), originatorPlan()))
		const r1 = await first.participant.query(reentranceReq(session, []))
		expect(r1.plans).toHaveLength(1) // plan1 folded, candidate still live
		expect(r1.reentrance).toBeDefined()

		// "Restart": a brand-new Participant over the SAME store — its in-flight table starts empty.
		const second = makeHarness({
			store,
			findAddress: findAddress({}),
			queryPeer: () => Promise.resolve({ plans: [plan2], stats: zeroStats() }), // dead-end this time
		})
		const r2 = await second.participant.query(reentranceReq(session, []))

		expect(r2.plans).toHaveLength(2) // plan1 (from durable state) preserved, plan2 added
		const paths = r2.plans!.map((plan) => plan.path.map((link) => link.nonce).join(','))
		expect(new Set(paths)).toEqual(new Set(['p1', 'p2'])) // each exactly once — none lost, none doubled
		expect(second.peerCalls.map((call) => call.linkId)).toEqual(['L1']) // re-issued from the durable reentrance
	})

	it('concurrent sessions on one participant keep independent contexts', async () => {
		const sessionA = makeSession()
		const sessionB = makeSession()
		const h = makeHarness({
			findAddress: (query) =>
				Promise.resolve({
					self: SELF,
					selfIsMatch: false,
					candidates: query.sessionCode === sessionA ? [{ id: 'LA', intents: { lift: 't' } }] : [{ id: 'LB', intents: { lift: 't' } }],
				}),
			queryPeer: (_request, linkId) =>
				Promise.resolve(linkId === 'LA' ? { stats: zeroStats() } : { reentrance: { sessionCode: sessionB, path: ['d'] }, stats: zeroStats() }),
		})

		await h.participant.query(entranceReq(makeQuery(sessionA), originatorPlan()))
		await h.participant.query(entranceReq(makeQuery(sessionB), originatorPlan()))

		const rA = await h.participant.query(reentranceReq(sessionA, [])) // LA dead-ends → A concludes
		expect(rA.reentrance).toBeUndefined()

		const rB = await h.participant.query(reentranceReq(sessionB, [])) // B is untouched by A's conclusion
		expect(rB.reentrance).toBeDefined()

		expect((await h.store.getContext(sessionA, []))?.complete).toBe(true)
		expect((await h.store.getContext(sessionB, []))?.complete).toBe(false)
	})
})
