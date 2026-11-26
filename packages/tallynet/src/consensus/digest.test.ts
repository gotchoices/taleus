import { recordDigest } from './digest.js'
import { DEFAULT_CONSENSUS_METHOD } from '../discovery/types.js'
import type { Signature, TrxRecord } from './types.js'

type TTerms = string
type TPayload = unknown

function toHex(bytes: Uint8Array): string {
	let out = ''
	for (const b of bytes) {
		out += b.toString(16).padStart(2, '0')
	}
	return out
}

/** A minimal, fully-encodable record. Overrides let a test vary one field at a time. */
function sampleRecord(overrides: Partial<TrxRecord<TTerms, TPayload>> = {}): TrxRecord<TTerms, TPayload> {
	return {
		transactionCode: 'tx-A',
		sessionCode: 'sc-A',
		payload: { amount: '100', memo: 'lunch' },
		topology: {
			members: [
				{ types: ['P'], address: { key: 'alice' } },
				{ types: ['P', 'V'], address: { key: 'bob' } },
			],
			links: {
				nonce1: { source: 'alice', target: 'bob', intents: { lift: 'termsAB' } },
			},
		},
		method: DEFAULT_CONSENSUS_METHOD,
		promises: [],
		commits: [],
		...overrides,
	}
}

function promise(address: string, value: string): Signature {
	return { type: 'P', address, value }
}

describe('recordDigest — binds the signature kind (type-substitution fix)', () => {
	it('a different kind yields different bytes', () => {
		const record = sampleRecord()
		expect(toHex(recordDigest('P', record))).not.toBe(toHex(recordDigest('NP', record)))
		// C and NC also differ from each other over the SAME promise set.
		expect(toHex(recordDigest('C', record, record.promises))).not.toBe(toHex(recordDigest('NC', record, record.promises)))
	})

	it('is deterministic for a fixed (kind, record)', () => {
		const record = sampleRecord()
		expect(toHex(recordDigest('P', record))).toBe(toHex(recordDigest('P', record)))
	})
})

describe('recordDigest — binds (transactionCode, sessionCode) (replay fix)', () => {
	it('a different transactionCode yields different bytes with the same topology', () => {
		const a = sampleRecord({ transactionCode: 'tx-A' })
		const b = sampleRecord({ transactionCode: 'tx-B' })
		expect(toHex(recordDigest('P', a))).not.toBe(toHex(recordDigest('P', b)))
	})

	it('a different sessionCode yields different bytes with the same topology', () => {
		const a = sampleRecord({ sessionCode: 'sc-A' })
		const b = sampleRecord({ sessionCode: 'sc-B' })
		expect(toHex(recordDigest('P', a))).not.toBe(toHex(recordDigest('P', b)))
	})
})

describe('recordDigest — payload and topology are covered', () => {
	it('a different payload yields different bytes', () => {
		const a = sampleRecord({ payload: { amount: '100' } })
		const b = sampleRecord({ payload: { amount: '101' } })
		expect(toHex(recordDigest('P', a))).not.toBe(toHex(recordDigest('P', b)))
	})

	it('payload key order does not matter (DAG-CBOR sorts map keys)', () => {
		const a = sampleRecord({ payload: { amount: '100', memo: 'lunch' } })
		const b = sampleRecord({ payload: { memo: 'lunch', amount: '100' } })
		expect(toHex(recordDigest('P', a))).toBe(toHex(recordDigest('P', b)))
	})

	it('a changed member yields different bytes (topology is signed)', () => {
		const a = sampleRecord()
		const b = sampleRecord({
			topology: {
				members: [
					{ types: ['P'], address: { key: 'alice' } },
					{ types: ['P', 'V'], address: { key: 'mallory' } }, // bob → mallory
				],
				links: { nonce1: { source: 'alice', target: 'bob', intents: { lift: 'termsAB' } } },
			},
		})
		expect(toHex(recordDigest('P', a))).not.toBe(toHex(recordDigest('P', b)))
	})

	it('a changed link term yields different bytes (topology is signed)', () => {
		const a = sampleRecord()
		const b = sampleRecord({
			topology: {
				members: a.topology.members,
				links: { nonce1: { source: 'alice', target: 'bob', intents: { lift: 'termsXY' } } },
			},
		})
		expect(toHex(recordDigest('P', a))).not.toBe(toHex(recordDigest('P', b)))
	})

	it('the members array is order-sensitive (its order is the immutable core)', () => {
		const a = sampleRecord()
		const b = sampleRecord({
			topology: {
				members: [a.topology.members[1], a.topology.members[0]], // reversed
				links: a.topology.links,
			},
		})
		expect(toHex(recordDigest('P', a))).not.toBe(toHex(recordDigest('P', b)))
	})

	it('the links map is order-independent (keyed by nonce, so insertion order is irrelevant)', () => {
		const base = sampleRecord()
		const linkA = { source: 'alice', target: 'bob', intents: { lift: 'termsAB' } }
		const linkB = { source: 'bob', target: 'alice', intents: { lift: 'termsBA' } }
		const forward = sampleRecord({ topology: { members: base.topology.members, links: { n1: linkA, n2: linkB } } })
		const reversed = sampleRecord({ topology: { members: base.topology.members, links: { n2: linkB, n1: linkA } } })
		expect(toHex(recordDigest('P', forward))).toBe(toHex(recordDigest('P', reversed)))
	})
})

describe('recordDigest — the promise set (commit preimage only)', () => {
	const record = sampleRecord()
	const p1 = promise('alice', 'sigA')
	const p2 = promise('bob', 'sigB')

	it('C/NC over a promise set is invariant to the order the promises are given in', () => {
		const forward = recordDigest('C', record, [p1, p2])
		const reversed = recordDigest('C', record, [p2, p1])
		expect(toHex(forward)).toBe(toHex(reversed))
	})

	it('C over different promise sets yields different bytes', () => {
		const withBoth = recordDigest('C', record, [p1, p2])
		const withOne = recordDigest('C', record, [p1])
		expect(toHex(withBoth)).not.toBe(toHex(withOne))
	})

	it('drops a promise attachment before hashing (attachment is never signed)', () => {
		const plain = promise('alice', 'sigA')
		const withAttachment: Signature = { ...plain, attachment: { opaque: 'host-data' } }
		expect(toHex(recordDigest('C', record, [plain]))).toBe(toHex(recordDigest('C', record, [withAttachment])))
	})

	it('P/NP omit the promise set entirely — the promises argument is ignored', () => {
		expect(toHex(recordDigest('P', record, [p1]))).toBe(toHex(recordDigest('P', record, [])))
		expect(toHex(recordDigest('P', record, [p1]))).toBe(toHex(recordDigest('P', record)))
		expect(toHex(recordDigest('NP', record, [p1, p2]))).toBe(toHex(recordDigest('NP', record)))
	})
})

describe('recordDigest — payload that cannot canonically encode', () => {
	it('throws with a JSON-path pointing into the payload', () => {
		const record = sampleRecord({ payload: { when: new Date() } })
		expect(() => recordDigest('P', record)).toThrow(/\$\.pl\.when/)
	})

	it('throws on a function in the payload', () => {
		const record = sampleRecord({ payload: { f: (): number => 1 } })
		expect(() => recordDigest('P', record)).toThrow(/function/)
	})

	it('throws on undefined in the payload with its path', () => {
		const record = sampleRecord({ payload: { x: undefined } })
		expect(() => recordDigest('P', record)).toThrow(/\$\.pl\.x/)
	})
})

describe('recordDigest — binds the consensus method and lift contract (proposal params)', () => {
	it('a record differing only in method yields different bytes', () => {
		const a = sampleRecord({ method: { weighting: 'distinct-voter', thresholdNum: 1, thresholdDen: 2 } })
		const b = sampleRecord({ method: { weighting: 'distinct-voter', thresholdNum: 2, thresholdDen: 3 } })
		expect(toHex(recordDigest('P', a))).not.toBe(toHex(recordDigest('P', b)))
	})

	it('adding a lift contract changes the bytes; the same contract is stable', () => {
		const without = sampleRecord()
		const withContract = sampleRecord({ liftContract: 'bafyLiftContractCID' })
		expect(toHex(recordDigest('P', withContract))).not.toBe(toHex(recordDigest('P', without)))
		expect(toHex(recordDigest('P', withContract))).toBe(toHex(recordDigest('P', sampleRecord({ liftContract: 'bafyLiftContractCID' }))))
	})

	it('a record differing only in lift contract yields different bytes', () => {
		const a = sampleRecord({ liftContract: 'bafyA' })
		const b = sampleRecord({ liftContract: 'bafyB' })
		expect(toHex(recordDigest('P', a))).not.toBe(toHex(recordDigest('P', b)))
	})
})
