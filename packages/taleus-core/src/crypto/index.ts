import type { CryptoProvider, KeyPair } from './provider.js'
import { nobleCryptoProvider } from './noble-provider.js'

export type { CryptoProvider, KeyPair } from './provider.js'
export { nobleCryptoProvider } from './noble-provider.js'

let currentProvider: CryptoProvider = nobleCryptoProvider

/** Platform-injection seam: swap the sha256/ed25519 implementation without touching call sites. */
export function setCryptoProvider(provider: CryptoProvider): void {
	currentProvider = provider
}

export function getCryptoProvider(): CryptoProvider {
	return currentProvider
}

export function sha256(data: Uint8Array): Uint8Array {
	return currentProvider.sha256(data)
}

export function generateKeyPair(): KeyPair {
	return currentProvider.generateKeyPair()
}

export function sign(secretKey: Uint8Array, digest: Uint8Array): Uint8Array {
	return currentProvider.sign(secretKey, digest)
}

export function verify(publicKey: Uint8Array, digest: Uint8Array, signature: Uint8Array): boolean {
	return currentProvider.verify(publicKey, digest, signature)
}
