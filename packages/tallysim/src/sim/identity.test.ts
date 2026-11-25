import { makeSimSigner, signerForSeed, simVerifier } from './identity.js'

describe('sim identity — deterministic ed25519', () => {
	it('the same (identitySeed, name) always yields the same key pair', () => {
		expect(makeSimSigner(7, '0').publicKey).toEqual(makeSimSigner(7, '0').publicKey)
	})

	it('produces a 32-byte ed25519 public key', () => {
		expect(makeSimSigner(7, '0').publicKey).toHaveLength(32)
	})

	it('different names — or different seeds — yield different keys', () => {
		expect(makeSimSigner(7, '0').publicKey).not.toEqual(makeSimSigner(7, '1').publicKey)
		expect(makeSimSigner(7, '0').publicKey).not.toEqual(makeSimSigner(8, '0').publicKey)
	})

	it('a signature verifies against its own key and fails against another', async () => {
		const signer = makeSimSigner(7, '0')
		const digest = new TextEncoder().encode('a 32-ish byte digest to sign...')
		const signature = await signer.sign(digest)
		expect(await simVerifier.verify(signer.publicKey, digest, signature)).toBe(true)
		expect(await simVerifier.verify(makeSimSigner(7, '1').publicKey, digest, signature)).toBe(false)
	})

	it('simVerifier returns false (never throws) on malformed input', async () => {
		expect(await simVerifier.verify(new Uint8Array(3), new Uint8Array(4), new Uint8Array(5))).toBe(false)
	})

	it('signerForSeed binds the seed: factory(name) matches makeSimSigner(seed, name)', () => {
		expect(signerForSeed(7)('0').publicKey).toEqual(makeSimSigner(7, '0').publicKey)
	})
})
