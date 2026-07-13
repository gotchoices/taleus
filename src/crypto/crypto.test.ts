import { generateKeyPair, sha256, sign, verify } from './index.js'

describe('crypto', () => {
	it('signs a digest that verifies with the matching key, and rejects a tampered digest', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const digest = sha256(new TextEncoder().encode('taleus'))
		const signature = sign(secretKey, digest)

		expect(verify(publicKey, digest, signature)).toBe(true)

		const tampered = sha256(new TextEncoder().encode('not taleus'))
		expect(verify(publicKey, tampered, signature)).toBe(false)
	})
})
