import { generateKeyPair, getCryptoProvider, setCryptoProvider, sha256, sign, verify } from './index.js'
import type { CryptoProvider } from './provider.js'

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

describe('crypto', () => {
	it('signs a digest that verifies with the matching key, and rejects a tampered digest', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const digest = sha256(new TextEncoder().encode('taleus'))
		const signature = sign(secretKey, digest)

		expect(verify(publicKey, digest, signature)).toBe(true)

		const tampered = sha256(new TextEncoder().encode('not taleus'))
		expect(verify(publicKey, tampered, signature)).toBe(false)
	})

	it('rejects a tampered signature under the correct digest and key', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const digest = sha256(new TextEncoder().encode('taleus'))
		const signature = sign(secretKey, digest)

		const tampered = Uint8Array.from(signature)
		tampered[0] ^= 0x01

		expect(verify(publicKey, digest, tampered)).toBe(false)
	})

	// The cross-primitive constraint (docs/architecture.md § Referee model) requires this digest to be
	// byte-identical to what Quereus's Digest() recomputes. Known-answer vectors pin the algorithm to
	// standard sha256 so a future provider swap can't silently diverge.
	it('computes standard sha256 (known-answer vectors)', () => {
		expect(toHex(sha256(new Uint8Array(0)))).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		)
		expect(toHex(sha256(new TextEncoder().encode('abc')))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		)
	})

	it('produces deterministic digests for the same input', () => {
		const input = new TextEncoder().encode('taleus')
		expect(toHex(sha256(input))).toBe(toHex(sha256(input)))
	})

	it('emits raw key and signature byte lengths for the ed25519 scheme', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const signature = sign(secretKey, sha256(new Uint8Array(0)))

		expect(publicKey.length).toBe(32)
		expect(secretKey.length).toBe(32)
		expect(signature.length).toBe(64)
	})

	describe('provider injection', () => {
		it('routes the top-level functions through the injected provider', () => {
			const marker = new Uint8Array([1, 2, 3])
			const original = getCryptoProvider()
			const stub: CryptoProvider = {
				sha256: () => marker,
				generateKeyPair: () => ({ publicKey: marker, secretKey: marker }),
				sign: () => marker,
				verify: () => true,
			}

			setCryptoProvider(stub)
			try {
				expect(sha256(new Uint8Array(0))).toBe(marker)
				expect(verify(marker, marker, marker)).toBe(true)
			} finally {
				setCryptoProvider(original)
			}
		})
	})
})
