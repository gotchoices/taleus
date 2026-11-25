import { FORMAT_VERSION, linkIdForTally, type Network } from 'tallysim'
import { makeNonce } from 'tallynet'
import { createDeanonymiser } from './deanonymise.js'

// A 3-node path network: tally 0 joins 0↔1, tally 1 joins 1↔2.
const network: Network = {
	entityCount: 3,
	tallies: [
		{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
		{ stock: 1, foil: 2, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
	],
	meta: { generator: 'test', params: {}, seed: 1, formatVersion: FORMAT_VERSION },
}

const SESSION = 'session-alpha'
// The nonces the real protocol would stamp for this session, computed from the real makeNonce.
const nonce0 = makeNonce(SESSION, linkIdForTally(0))
const nonce1 = makeNonce(SESSION, linkIdForTally(1))

describe('createDeanonymiser', () => {
	it('inverts makeNonce back to the exact tally index', () => {
		const d = createDeanonymiser(network)
		expect(d.tallyOfNonce(SESSION, nonce0)).toBe(0)
		expect(d.tallyOfNonce(SESSION, nonce1)).toBe(1)
	})

	it('returns the undefined sentinel for a nonce no tally produces', () => {
		const d = createDeanonymiser(network)
		expect(d.tallyOfNonce(SESSION, 'not-a-real-nonce')).toBeUndefined()
	})

	it('is session-salted: the same tally hashes differently under a different session', () => {
		const d = createDeanonymiser(network)
		expect(makeNonce('session-beta', linkIdForTally(0))).not.toBe(nonce0)
		expect(d.tallyOfNonce('session-beta', nonce0)).toBeUndefined()
	})

	it('walks a plan path to the node sequence from the originator', () => {
		const d = createDeanonymiser(network)
		expect(d.nodePathOfPlanPath(SESSION, 0, [nonce0, nonce1])).toEqual([0, 1, 2])
		// The same edges walked from the other end.
		expect(d.nodePathOfPlanPath(SESSION, 2, [nonce1, nonce0])).toEqual([2, 1, 0])
		// An empty path is just the originator.
		expect(d.nodePathOfPlanPath(SESSION, 0, [])).toEqual([0])
	})

	it('returns the sentinel when a plan nonce does not resolve or the walk is non-contiguous', () => {
		const d = createDeanonymiser(network)
		// tally 1 (1↔2) does not touch the originator 0 — non-contiguous.
		expect(d.nodePathOfPlanPath(SESSION, 0, [nonce1])).toBeUndefined()
		// A nonce no tally produces — unresolvable.
		expect(d.nodePathOfPlanPath(SESSION, 0, ['bogus'])).toBeUndefined()
	})
})
