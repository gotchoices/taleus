import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import type { CryptoProvider, KeyPair } from './provider.js'

/**
 * Default CryptoProvider: sha256 from @noble/hashes, ed25519 from
 * @noble/curves. Both are pure JS with no node:crypto or other
 * platform-specific import, so this runs unchanged in Node, the browser,
 * and NativeScript — the platform seam exists for a future native/HSM
 * implementation, not because this default needs one.
 */
export const nobleCryptoProvider: CryptoProvider = {
	sha256: (data) => nobleSha256(data),

	generateKeyPair: (): KeyPair => {
		const { secretKey, publicKey } = ed25519.keygen()
		return { publicKey, secretKey }
	},

	sign: (secretKey, digest) => ed25519.sign(digest, secretKey),

	verify: (publicKey, digest, signature) => ed25519.verify(signature, digest, publicKey),
}
