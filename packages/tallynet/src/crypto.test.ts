import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import {
	nobleHasher,
	webRandomSource,
	providerHasher,
	providerSigner,
	providerVerifier,
	type CryptoProviderLike,
} from './crypto.js'

function toHex(bytes: Uint8Array): string {
	let out = ''
	for (const b of bytes) {
		out += b.toString(16).padStart(2, '0')
	}
	return out
}

describe('nobleHasher', () => {
	it('computes the sha256 of "abc" (NIST test vector)', () => {
		const digest = nobleHasher.sha256(new TextEncoder().encode('abc'))
		expect(toHex(digest)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
	})
})

describe('webRandomSource', () => {
	it('returns the requested number of bytes', () => {
		expect(webRandomSource.randomBytes(16).length).toBe(16)
		expect(webRandomSource.randomBytes(0).length).toBe(0)
	})

	it('does not return the same bytes twice (overwhelmingly likely)', () => {
		expect(toHex(webRandomSource.randomBytes(32))).not.toBe(toHex(webRandomSource.randomBytes(32)))
	})

	it('rejects a negative or non-integer length', () => {
		expect(() => webRandomSource.randomBytes(-1)).toThrow()
		expect(() => webRandomSource.randomBytes(1.5)).toThrow()
	})
})

/**
 * A `taleus-core` `CryptoProvider` has exactly these four methods (shape copied here, NOT imported
 * — the dependency only points the other way). The toy implementation below uses a symmetric
 * "signature" (sha256 of key ‖ digest, with publicKey == secretKey) so the adapters can be
 * exercised without a real curve library; it proves the adapters wire their arguments correctly,
 * not that ed25519 works.
 */
interface CoreCryptoProvider {
	sha256(data: Uint8Array): Uint8Array
	generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array }
	sign(secretKey: Uint8Array, digest: Uint8Array): Uint8Array
	verify(publicKey: Uint8Array, digest: Uint8Array, signature: Uint8Array): boolean
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length)
	out.set(a, 0)
	out.set(b, a.length)
	return out
}

const toyProvider: CoreCryptoProvider = {
	sha256: (data) => nobleSha256(data),
	generateKeyPair: () => {
		const key = webRandomSource.randomBytes(32)
		return { publicKey: key, secretKey: key }
	},
	sign: (secretKey, digest) => nobleSha256(concat(secretKey, digest)),
	verify: (publicKey, digest, signature) => toHex(nobleSha256(concat(publicKey, digest))) === toHex(signature),
}

describe('CryptoProvider adapters', () => {
	// Compile-time proof: a full taleus-core CryptoProvider (a superset) satisfies the ports' needs.
	const asPortProvider: CryptoProviderLike = toyProvider

	it('providerHasher delegates sha256', () => {
		const data = new TextEncoder().encode('hello')
		expect(toHex(providerHasher(asPortProvider).sha256(data))).toBe(toHex(nobleSha256(data)))
	})

	it('providerSigner + providerVerifier round-trip a signature', async () => {
		const keyPair = toyProvider.generateKeyPair()
		const signer = providerSigner(asPortProvider, keyPair)
		const verifier = providerVerifier(asPortProvider)
		const digest = nobleSha256(new TextEncoder().encode('message'))

		expect(signer.publicKey).toBe(keyPair.publicKey)
		const signature = await signer.sign(digest)
		expect(await verifier.verify(signer.publicKey, digest, signature)).toBe(true)
		expect(await verifier.verify(signer.publicKey, nobleSha256(digest), signature)).toBe(false)
	})
})
