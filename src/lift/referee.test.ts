import { type RefereeEdge } from './referee.js'
import { digest, verifyLiftTerms, verifyLiftVoid } from './digest.js'
import { identity, referee } from './test-harness.js'

const recordDigest = digest(['tx1', 's1'])

function edge(liftId: string, cid: string, refereeKey: string, issuer: 'S' | 'F' = 'F', units = 100n): RefereeEdge {
	return { cid, liftId, refereeKey, issuer, units, date: '2026-07-13', expiry: '2026-07-20' }
}

describe('SingleReferee.commit', () => {
	it('emits a record signature plus one per-edge signature that verifies against the referee key', () => {
		const { ref, key } = referee()
		const edges = [edge('L1', 'cid-1', key), edge('L2', 'cid-2', key, 'S', 250n)]
		const commit = ref.commit(recordDigest, edges)

		expect(commit.decision).toBe('commit')
		expect(commit.recordSignature).toMatch(/^[0-9a-f]+$/)
		expect(Object.keys(commit.edgeSignatures)).toEqual(['L1', 'L2'])
		for (const e of edges) {
			expect(verifyLiftTerms(key, e, commit.edgeSignatures[e.liftId])).toBe(true)
		}
	})

	it('produces DISTINCT per-edge signatures — each binds its own cid', () => {
		const { ref, key } = referee()
		const commit = ref.commit(recordDigest, [edge('L1', 'cid-1', key), edge('L2', 'cid-2', key)])
		expect(commit.edgeSignatures.L1).not.toBe(commit.edgeSignatures.L2)
		// A signature for L1 must NOT verify against L2's terms (different cid).
		expect(verifyLiftTerms(key, edge('L2', 'cid-2', key), commit.edgeSignatures.L1)).toBe(false)
	})
})

describe('SingleReferee.void', () => {
	it('emits per-edge void signatures that verify, and cannot be replayed as a commit', () => {
		const { ref, key } = referee()
		const edges = [edge('L1', 'cid-1', key), edge('L2', 'cid-2', key)]
		const result = ref.void(recordDigest, edges)

		expect(result.decision).toBe('void')
		for (const e of edges) {
			expect(verifyLiftVoid(key, e.cid, e.liftId, result.edgeSignatures[e.liftId])).toBe(true)
			// The void signature is over the DISTINCT void digest, so it cannot satisfy LiftFinalize.
			expect(verifyLiftTerms(key, e, result.edgeSignatures[e.liftId])).toBe(false)
		}
	})

	it('a commit signature cannot be replayed as a void (distinct digests)', () => {
		const { ref, key } = referee()
		const e = edge('L1', 'cid-1', key)
		const commit = ref.commit(recordDigest, [e])
		expect(verifyLiftVoid(key, e.cid, e.liftId, commit.edgeSignatures.L1)).toBe(false)
	})
})

describe('SingleReferee guards', () => {
	it('refuses to resolve an edge that names a DIFFERENT referee', () => {
		const { ref, key } = referee()
		const other = identity().publicKeyText
		expect(() => ref.commit(recordDigest, [edge('L1', 'cid-1', other)])).toThrow(/naming referee/)
		expect(key).not.toBe(other)
	})

	it('rejects a duplicate LiftId within one resolution', () => {
		const { ref, key } = referee()
		expect(() => ref.commit(recordDigest, [edge('L1', 'cid-1', key), edge('L1', 'cid-2', key)])).toThrow(/duplicate LiftId/)
	})
})
