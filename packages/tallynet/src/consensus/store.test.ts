import { canonicalEncode, digest, type DigestValue } from '../digest.js'
import { DEFAULT_CONSENSUS_METHOD } from '../discovery/types.js'
import { MemoryTrxStore } from './store.js'
import type { Signature, TrxRecord } from './types.js'

type TTerms = string
type TPayload = unknown

/**
 * A fully-populated record exercising every field, including a commit carrying an opaque (but
 * encodable) `attachment` — the per-edge voter signatures ride there in production. Everything here
 * must be JSON- and DAG-CBOR-round-trippable, like the discovery store's `StoredContext`.
 */
function sampleRecord(): TrxRecord<TTerms, TPayload> {
	return {
		transactionCode: 'tx-1',
		sessionCode: 'sc-1',
		payload: { amount: '100', memo: 'lunch' },
		topology: {
			members: [
				{ types: ['P'], address: { key: 'alice' } },
				{ types: ['P', 'V'], address: { key: 'bob' }, dependsOn: [{ key: 'carol' }] },
			],
			links: {
				nA: { source: 'alice', target: 'bob', intents: { lift: 'termsAB' } },
			},
		},
		method: DEFAULT_CONSENSUS_METHOD,
		promises: [
			{ type: 'P', address: 'alice', value: 'sigAliceP' },
			{ type: 'P', address: 'bob', value: 'sigBobP' },
		],
		commits: [
			{ type: 'C', address: 'bob', value: 'sigBobC', attachment: { edgeSignatures: { lift1: 'edgeSigBob' } } },
		],
	}
}

describe('TrxRecord serialisability', () => {
	it('round-trips through JSON.stringify / parse unchanged', () => {
		const record = sampleRecord()
		const roundTripped = JSON.parse(JSON.stringify(record)) as TrxRecord<TTerms, TPayload>
		expect(roundTripped).toEqual(record)
	})

	it('round-trips through DAG-CBOR canonicalEncode (no function, promise, or class instance)', () => {
		const record = sampleRecord()
		expect(() => canonicalEncode(record as unknown as DigestValue)).not.toThrow()
		expect(digest(record as unknown as DigestValue).length).toBe(32)
	})

	it('is stable under DAG-CBOR regardless of property insertion order', () => {
		const a = sampleRecord()
		const b = sampleRecord()
		b.payload = { memo: 'lunch', amount: '100' }
		expect(digest(a as unknown as DigestValue)).toEqual(digest(b as unknown as DigestValue))
	})
})

describe('MemoryTrxStore', () => {
	it('round-trips the current record', async () => {
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const record = sampleRecord()
		expect(await store.getRecord('tx-1')).toBeUndefined()
		await store.saveRecord(record)
		expect(await store.getRecord('tx-1')).toBe(record)
	})

	it('keeps a separate last-pushed copy per peer address, keyed by transaction', async () => {
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const toAlice = sampleRecord()
		const toBob = { ...sampleRecord(), sessionCode: 'sc-other' }
		await store.savePeerRecord('tx-1', 'alice', toAlice)
		await store.savePeerRecord('tx-1', 'bob', toBob)

		expect(await store.getPeerRecord('tx-1', 'alice')).toBe(toAlice)
		expect(await store.getPeerRecord('tx-1', 'bob')).toBe(toBob)
		// A peer copy for a different transaction is independent.
		expect(await store.getPeerRecord('tx-2', 'alice')).toBeUndefined()
	})

	it('is the release-once flag, idempotent and per transaction', async () => {
		const store = new MemoryTrxStore<TTerms, TPayload>()
		expect(await store.isReleased('tx-1')).toBe(false)
		await store.setReleased('tx-1')
		expect(await store.isReleased('tx-1')).toBe(true)
		// Idempotent: setting again is harmless.
		await store.setReleased('tx-1')
		expect(await store.isReleased('tx-1')).toBe(true)
		// A different transaction is unaffected.
		expect(await store.isReleased('tx-2')).toBe(false)
	})
})

describe('MemoryTrxStore — pending commits (the forged-commit side pool)', () => {
	/** A pooled commit-phase signature (the shape the participant holds until it can verify it). */
	function pooledCommit(address: string, value: string): Signature {
		return { type: 'C', address, value }
	}

	it('returns [] for a transaction with no pooled commits', async () => {
		const store = new MemoryTrxStore<TTerms, TPayload>()
		expect(await store.getPendingCommits('tx-unseen')).toEqual([])
	})

	it('round-trips a saved pool', async () => {
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const pool = [pooledCommit('r1', 'sigR1'), pooledCommit('r2', 'sigR2')]
		await store.savePendingCommits('tx-1', pool)
		expect(await store.getPendingCommits('tx-1')).toEqual(pool)
	})

	it('keys the pool per transaction (a different transaction is independent)', async () => {
		const store = new MemoryTrxStore<TTerms, TPayload>()
		await store.savePendingCommits('tx-1', [pooledCommit('r1', 'sigR1')])
		expect(await store.getPendingCommits('tx-2')).toEqual([])
		// And replacing one tx's pool leaves the other untouched.
		await store.savePendingCommits('tx-2', [pooledCommit('r2', 'sigR2')])
		expect(await store.getPendingCommits('tx-1')).toEqual([pooledCommit('r1', 'sigR1')])
	})

	it('returns a copy: mutating the returned array does not change the stored pool', async () => {
		const store = new MemoryTrxStore<TTerms, TPayload>()
		await store.savePendingCommits('tx-1', [pooledCommit('r1', 'sigR1')])
		const got = await store.getPendingCommits('tx-1')
		got.push(pooledCommit('r2', 'sigR2')) // the participant splices/pushes its working pool freely
		got.splice(0, got.length)
		expect(await store.getPendingCommits('tx-1')).toEqual([pooledCommit('r1', 'sigR1')]) // stored pool intact
	})

	it('stores a copy: mutating the saved array afterward does not change the stored pool', async () => {
		const store = new MemoryTrxStore<TTerms, TPayload>()
		const pool = [pooledCommit('r1', 'sigR1')]
		await store.savePendingCommits('tx-1', pool)
		pool.push(pooledCommit('r2', 'sigR2')) // mutate the caller's array after saving
		expect(await store.getPendingCommits('tx-1')).toEqual([pooledCommit('r1', 'sigR1')])
	})

	it('a pooled commit (with its opaque attachment) is JSON- and DAG-CBOR-round-trippable', () => {
		const pooled: Signature = { type: 'C', address: 'bob', value: 'sigBobC', attachment: { edgeSignatures: { lift1: 'edgeSigBob' } } }
		expect(JSON.parse(JSON.stringify(pooled))).toEqual(pooled)
		expect(() => canonicalEncode([pooled] as unknown as DigestValue)).not.toThrow()
	})
})
