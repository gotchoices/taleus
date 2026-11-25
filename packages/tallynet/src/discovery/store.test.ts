import { canonicalEncode, digest, type DigestValue } from '../digest.js'
import { contextKey, MemoryParticipantStore, type StoredContext } from './store.js'
import type { Plan, QueryResponse } from './types.js'

/**
 * `TTerms` and `TPayload` are deliberately plain-string here: a `StoredContext` is only durable if
 * every value it holds is serialisable, and a string is the simplest encodable witness. (A host's
 * real terms are a plain-object record; either encodes.) See `store.ts`'s durable/in-flight split.
 */
type TTerms = string
type TPayload = string

/** A fully-populated context exercising every field: candidates with a last-response, accumulated plans, the nonce map. */
function sampleContext(): StoredContext<TTerms, TPayload> {
	const downstreamResponse: QueryResponse<TTerms, TPayload> = {
		plans: [{ path: [{ nonce: 'nD', intents: { lift: 'termsD' } }], members: [{ types: ['P'], address: { key: 'keyD' } }] }],
		reentrance: { sessionCode: 'sess', path: ['nIn', 'nC1'] },
		stats: { earliest: 3, latest: 9, gross: 12, outstanding: 1 },
	}
	const accumulated: Plan<TTerms, TPayload> = {
		path: [{ nonce: 'nIn', intents: { lift: 'termsIn' } }],
		members: [{ types: ['P'], address: { key: 'self' } }],
		payload: 'carried',
	}
	return {
		query: { target: { address: { key: 'target' } }, sessionCode: 'sess', intents: { lift: 'want' }, maxDepth: 7 },
		plan: { path: [{ nonce: 'nIn', intents: { lift: 'termsIn' } }], members: [] },
		self: { member: { types: ['P'], address: { key: 'self' } } },
		candidates: [
			{ linkId: 'L1', nonce: 'nC1', depth: 2, intents: { lift: 'termsC1' }, lastResponse: downstreamResponse },
			{ linkId: 'L2', nonce: 'nC2', depth: 0, intents: { lift: 'termsC2' } },
		],
		nonceToLinkId: { nIn: 'inbound-link', nC1: 'L1', nC2: 'L2' },
		plans: [accumulated],
		depth: 2,
		complete: false,
	}
}

describe('StoredContext serialisability', () => {
	it('round-trips through JSON.stringify / parse unchanged', () => {
		const ctx = sampleContext()
		const roundTripped = JSON.parse(JSON.stringify(ctx)) as StoredContext<TTerms, TPayload>
		expect(roundTripped).toEqual(ctx)
	})

	it('round-trips through DAG-CBOR canonicalEncode (no function, promise, or class instance)', () => {
		const ctx = sampleContext()
		// canonicalEncode throws on `undefined`, a function, a class instance, or any non-plain value;
		// surviving it proves the durable context is a plain, serialisable tree.
		expect(() => canonicalEncode(ctx as unknown as DigestValue)).not.toThrow()
		expect(digest(ctx as unknown as DigestValue).length).toBe(32)
	})

	it('is stable under DAG-CBOR regardless of property insertion order', () => {
		const a = sampleContext()
		const b = sampleContext()
		// Rebuild `b.query` with keys in a different order; DAG-CBOR sorts map keys, so the bytes match.
		b.query = { maxDepth: 7, intents: { lift: 'want' }, sessionCode: 'sess', target: { address: { key: 'target' } } }
		expect(digest(a as unknown as DigestValue)).toEqual(digest(b as unknown as DigestValue))
	})
})

describe('MemoryParticipantStore — one key across validate/get/save (ChipNet nesting bug fixed)', () => {
	const session = 'sess'

	it('uses the same (session, path) key for save, get and validateNewQuery', async () => {
		const store = new MemoryParticipantStore<TTerms, TPayload>()
		const ctx = sampleContext()
		const path = ['nIn']

		await store.saveContext(ctx, path)

		// The SAME key that saveContext wrote under must be the key getContext reads...
		expect(await store.getContext(session, path)).toBe(ctx)
		// ...and the key validateNewQuery checks — so a real duplicate is now actually rejected.
		await expect(store.validateNewQuery(session, path)).rejects.toThrow(/already in progress/)
	})

	it('allows the same session on a different path', async () => {
		const store = new MemoryParticipantStore<TTerms, TPayload>()
		await store.saveContext(sampleContext(), ['nIn'])
		// A distinct path under the same session is a distinct query, not a duplicate.
		await expect(store.validateNewQuery(session, ['nIn', 'nDeeper'])).resolves.toBeUndefined()
		await expect(store.validateNewQuery(session, [])).resolves.toBeUndefined()
	})

	it('a different session on the same path is independent', async () => {
		const store = new MemoryParticipantStore<TTerms, TPayload>()
		await store.saveContext(sampleContext(), ['nIn'])
		await expect(store.validateNewQuery('other-session', ['nIn'])).resolves.toBeUndefined()
	})

	it('contextKey separates session from path with a NUL and never collides', () => {
		// ("a","bc") vs ("ab","c") would collide under a bare join; the NUL delimiter prevents it.
		expect(contextKey('a', ['bc'])).not.toBe(contextKey('ab', ['c']))
		expect(contextKey(session, ['nIn'])).toBe(contextKey(session, ['nIn']))
	})
})

describe('MemoryParticipantStore.getNonceToLinkMap', () => {
	it('unions nonceToLinkId across every context of the session, excluding other sessions', async () => {
		const store = new MemoryParticipantStore<TTerms, TPayload>()

		const first = sampleContext()
		first.nonceToLinkId = { nA: 'linkA', nB: 'linkB' }
		await store.saveContext(first, ['nA'])

		const second = sampleContext()
		second.nonceToLinkId = { nC: 'linkC' }
		await store.saveContext(second, ['nA', 'nC'])

		// A context under a *different* session must not leak into this session's map.
		const other = sampleContext()
		other.query = { ...other.query, sessionCode: 'other' }
		other.nonceToLinkId = { nX: 'linkX' }
		await store.saveContext(other, ['nX'])

		expect(await store.getNonceToLinkMap('sess')).toEqual({ nA: 'linkA', nB: 'linkB', nC: 'linkC' })
		expect(await store.getNonceToLinkMap('other')).toEqual({ nX: 'linkX' })
	})

	it('returns an empty map for an unknown session', async () => {
		const store = new MemoryParticipantStore<TTerms, TPayload>()
		expect(await store.getNonceToLinkMap('nobody')).toEqual({})
	})
})
