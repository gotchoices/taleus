import { ed25519 } from '@noble/curves/ed25519.js'
import { base64urlToBytes, bytesToBase64url } from '../base64url.js'
import type { Signer, Verifier } from '../crypto.js'
import { signRecord, verifySignature } from './signature.js'
import { DEFAULT_CONSENSUS_METHOD } from '../discovery/types.js'
import type { Signature, TrxRecord } from './types.js'

type TTerms = string
type TPayload = unknown

/** A real ed25519 signer bound to a fresh key pair (dev-only; @noble/curves is a devDependency). */
function makeSigner(): Signer {
	const { secretKey, publicKey } = ed25519.keygen()
	return { publicKey, sign: (digest) => ed25519.sign(digest, secretKey) }
}

/** A real ed25519 verifier that honours the Verifier contract (a malformed input is `false`, not a throw). */
const verifier: Verifier = {
	verify: (publicKey, digest, signature) => {
		try {
			return ed25519.verify(signature, digest, publicKey)
		} catch {
			return false
		}
	},
}

function sampleRecord(overrides: Partial<TrxRecord<TTerms, TPayload>> = {}): TrxRecord<TTerms, TPayload> {
	return {
		transactionCode: 'tx-A',
		sessionCode: 'sc-A',
		payload: { amount: '100' },
		topology: {
			members: [
				{ types: ['P'], address: { key: 'alice' } },
				{ types: ['P', 'V'], address: { key: 'bob' } },
			],
			links: { nonce1: { source: 'alice', target: 'bob', intents: { lift: 'termsAB' } } },
		},
		method: DEFAULT_CONSENSUS_METHOD,
		promises: [],
		commits: [],
		...overrides,
	}
}

/** Flip the low bit of the first signature byte, keeping its length (so verify fails, not throws). */
function corrupt(signature: Signature): Signature {
	const bytes = base64urlToBytes(signature.value)
	bytes[0] ^= 0x01
	return { ...signature, value: bytesToBase64url(bytes) }
}

describe('signRecord / verifySignature — happy path', () => {
	it('round-trips a promise signature', async () => {
		const signer = makeSigner()
		const record = sampleRecord()
		const sig = await signRecord(signer, 'P', record)
		expect(sig.type).toBe('P')
		expect(sig.address).toBe(bytesToBase64url(signer.publicKey))
		expect(await verifySignature(verifier, sig, record)).toBe(true)
	})

	it('round-trips a commit signature over the record promise set', async () => {
		const participant = makeSigner()
		const voter = makeSigner()
		const record = sampleRecord()
		record.promises = [await signRecord(participant, 'P', record)]
		const commit = await signRecord(voter, 'C', record)
		expect(commit.type).toBe('C')
		expect(await verifySignature(verifier, commit, record)).toBe(true)
	})
})

describe('verifySignature — adversarial cases', () => {
	it('a flipped bit in the value fails', async () => {
		const signer = makeSigner()
		const record = sampleRecord()
		const sig = await signRecord(signer, 'P', record)
		expect(await verifySignature(verifier, corrupt(sig), record)).toBe(false)
	})

	it('a P signature relabelled NP fails (the kind is in the preimage)', async () => {
		const signer = makeSigner()
		const record = sampleRecord()
		const sig = await signRecord(signer, 'P', record)
		const relabelled: Signature = { ...sig, type: 'NP' }
		expect(await verifySignature(verifier, relabelled, record)).toBe(false)
	})

	it('a signature for transaction A fails under transaction B with the same topology (replay)', async () => {
		const signer = makeSigner()
		const recordA = sampleRecord({ transactionCode: 'tx-A', sessionCode: 'sc-A' })
		const recordB = sampleRecord({ transactionCode: 'tx-B', sessionCode: 'sc-B' })
		const sigA = await signRecord(signer, 'P', recordA)
		expect(await verifySignature(verifier, sigA, recordA)).toBe(true)
		expect(await verifySignature(verifier, sigA, recordB)).toBe(false)
	})

	it("a signature verified against another member's key fails", async () => {
		const signer = makeSigner()
		const other = makeSigner()
		const record = sampleRecord()
		const sig = await signRecord(signer, 'P', record)
		// Same value bytes, but claim a different signer: the address is not in the preimage, so the
		// preimage is unchanged and the real signer's bytes do not verify under the other's key.
		const impersonated: Signature = { ...sig, address: bytesToBase64url(other.publicKey) }
		expect(await verifySignature(verifier, impersonated, record)).toBe(false)
	})

	it('a commit fails once the promise set it was cast over changes', async () => {
		const participant = makeSigner()
		const other = makeSigner()
		const voter = makeSigner()
		const record = sampleRecord()
		record.promises = [await signRecord(participant, 'P', record)]
		const commit = await signRecord(voter, 'C', record)
		expect(await verifySignature(verifier, commit, record)).toBe(true)
		// A promise appears that the voter never saw: the commit preimage no longer matches.
		record.promises = [...record.promises, await signRecord(other, 'P', record)]
		expect(await verifySignature(verifier, commit, record)).toBe(false)
	})

	it('returns false (never throws) for a non-canonical base64url value or address', async () => {
		const signer = makeSigner()
		const record = sampleRecord()
		const sig = await signRecord(signer, 'P', record)
		expect(await verifySignature(verifier, { ...sig, value: 'not*base64url' }, record)).toBe(false)
		expect(await verifySignature(verifier, { ...sig, address: 'not*base64url' }, record)).toBe(false)
	})
})
