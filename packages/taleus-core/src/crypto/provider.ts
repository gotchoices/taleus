/** An ed25519 key pair, raw bytes (no encoding). */
export interface KeyPair {
	readonly publicKey: Uint8Array
	readonly secretKey: Uint8Array
}

/**
 * The hash + signature primitives every signed row in the tally schema is
 * built on. ChipNet's referee signature (`chipcryptbase`'s `CryptoHash` /
 * `Asymmetric`) and the Quereus schema's `Digest()` / `SignatureValid()`
 * scalar functions must resolve to the exact same algorithms — sha256 for
 * the digest, ed25519 for the signature (see docs/architecture.md § Referee
 * model and the commit seam, "Cross-primitive constraint"). This interface
 * is that one shared implementation's shape; `setCryptoProvider` is the
 * platform-injection seam for swapping it (e.g. a NativeScript keychain- or
 * secure-enclave-backed signer) without touching call sites.
 */
export interface CryptoProvider {
	sha256(data: Uint8Array): Uint8Array
	generateKeyPair(): KeyPair
	sign(secretKey: Uint8Array, digest: Uint8Array): Uint8Array
	verify(publicKey: Uint8Array, digest: Uint8Array, signature: Uint8Array): boolean
}
