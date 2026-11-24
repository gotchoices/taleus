import { makeNonce } from './nonce.js'

describe('makeNonce', () => {
	it('is deterministic for the same inputs', () => {
		expect(makeNonce('session-xyz', 'tally-42')).toBe(makeNonce('session-xyz', 'tally-42'))
	})

	it('produces a 43-char base64url string (sha256 → 32 bytes)', () => {
		const nonce = makeNonce('session-xyz', 'tally-42')
		expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(nonce.length).toBe(43)
	})

	it('changes with the session code (salting)', () => {
		expect(makeNonce('session-a', 'tally-42')).not.toBe(makeNonce('session-b', 'tally-42'))
	})

	it('changes with the link id', () => {
		expect(makeNonce('session-xyz', 'tally-1')).not.toBe(makeNonce('session-xyz', 'tally-2'))
	})

	it('distinguishes pairs whose plain concatenation is equal (length-prefixed preimage)', () => {
		// Without the length prefix, "a"‖"bc" and "ab"‖"c" would hash the same; a nonce collision
		// would let a peer conflate two distinct tallies.
		expect(makeNonce('a', 'bc')).not.toBe(makeNonce('ab', 'c'))
	})
})
