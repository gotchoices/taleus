/**
 * The cryptographic ports TallyNet depends on, as interfaces, plus the default implementations
 * it can supply without a curve library.
 *
 * TallyNet never reaches for a concrete algorithm directly: it hashes, signs, verifies and draws
 * randomness only through these ports, so a host can inject a platform signer (a NativeScript
 * keychain, a secure enclave) without touching protocol code. The shapes mirror `taleus-core`'s
 * `CryptoProvider` (`packages/taleus-core/src/crypto/provider.ts`) closely enough that it can
 * satisfy them (see `providerSigner` / `providerVerifier` / `providerHasher`), **without**
 * TallyNet importing `taleus-core` -- the dependency only ever points the other way.
 *
 * TallyNet's one runtime crypto dependency is `@noble/hashes` (sha256). It deliberately does
 * **not** depend on a signature curve library (`@noble/curves`), so it ships no default `Signer`
 * or `Verifier`: ed25519 is the host's to provide. Only `Hasher` and `RandomSource` have defaults
 * here. See docs/design.md § Scope and boundaries.
 */

import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'

/** sha256 over raw bytes. The one hash TallyNet's digests and nonces are built on. */
export interface Hasher {
	sha256(data: Uint8Array): Uint8Array
}

/**
 * A signer already bound to one key pair: it exposes its own `publicKey` and signs a digest with
 * the held secret. `sign` may be sync or async (a hardware signer awaits); every call site
 * **awaits** it regardless.
 */
export interface Signer {
	readonly publicKey: Uint8Array
	sign(digest: Uint8Array): Uint8Array | Promise<Uint8Array>
}

/**
 * Verify a signature over a digest against a public key. Returns a boolean (never throws for a
 * malformed key or signature -- a bad input is a failed check, not an error). May be sync or
 * async; every call site **awaits** it.
 */
export interface Verifier {
	verify(publicKey: Uint8Array, digest: Uint8Array, signature: Uint8Array): boolean | Promise<boolean>
}

/** A source of cryptographically strong random bytes. */
export interface RandomSource {
	randomBytes(length: number): Uint8Array
}

/** Default `Hasher`: sha256 from `@noble/hashes`. Pure JS, no platform import. */
export const nobleHasher: Hasher = {
	sha256: (data) => nobleSha256(data),
}

/**
 * Default `RandomSource`: the Web Crypto global `crypto.getRandomValues`, present on every target
 * (browsers, Node ≥ 16, Hermes/React Native). No `node:crypto` import.
 */
export const webRandomSource: RandomSource = {
	randomBytes(length: number): Uint8Array {
		if (!Number.isInteger(length) || length < 0) {
			throw new Error(`randomBytes: length must be a non-negative integer, got ${String(length)}`)
		}
		return crypto.getRandomValues(new Uint8Array(length))
	},
}

/* ── adapters from a `taleus-core`-style CryptoProvider ──────────────────────────── */

/** A raw key pair (public + secret bytes), matching `taleus-core`'s `KeyPair`. */
export interface KeyPairLike {
	readonly publicKey: Uint8Array
	readonly secretKey: Uint8Array
}

/**
 * The structural shape of `taleus-core`'s `CryptoProvider`, replicated here so TallyNet can adapt
 * one into its ports **without importing `taleus-core`**. A value of that type is assignable to
 * this (a compile-time proof the two line up; the binding step relies on it).
 */
export interface CryptoProviderLike {
	sha256(data: Uint8Array): Uint8Array
	sign(secretKey: Uint8Array, digest: Uint8Array): Uint8Array
	verify(publicKey: Uint8Array, digest: Uint8Array, signature: Uint8Array): boolean
}

/** A `Hasher` backed by a CryptoProvider. */
export function providerHasher(provider: Pick<CryptoProviderLike, 'sha256'>): Hasher {
	return { sha256: (data) => provider.sha256(data) }
}

/**
 * A `Signer` bound to `keyPair`, backed by a CryptoProvider. TallyNet's `Signer.sign(digest)`
 * holds the key; the provider's `sign(secretKey, digest)` takes it as an argument, so the adapter
 * closes over the secret.
 */
export function providerSigner(provider: Pick<CryptoProviderLike, 'sign'>, keyPair: KeyPairLike): Signer {
	return {
		publicKey: keyPair.publicKey,
		sign: (digest) => provider.sign(keyPair.secretKey, digest),
	}
}

/** A `Verifier` backed by a CryptoProvider. */
export function providerVerifier(provider: Pick<CryptoProviderLike, 'verify'>): Verifier {
	return { verify: (publicKey, digest, signature) => provider.verify(publicKey, digest, signature) }
}
