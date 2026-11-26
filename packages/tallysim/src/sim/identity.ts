/**
 * The simulator's deterministic identity layer: a signer/verifier pair that gives every simulated node a
 * reproducible ed25519 key from a `(identitySeed, name)` pair, so a consensus run reproduces byte-for-byte
 * across invocations (ed25519 signing is deterministic → same keys ⇒ same signatures ⇒ same trace stream).
 *
 * This mirrors the identity doubles in `tallynet`'s `consensus.test.ts` exactly — it IS the same
 * byte-reproducible contract, lifted out of that test so the simulator (and the viewer) can wire real
 * consensus over {@link InMemoryNetwork}. `tallynet` ships no signature curve (only `Hasher`/`RandomSource`
 * defaults), so the curve is supplied here from `@noble/curves` (a pure-JS, platform-neutral dependency).
 *
 * ── Why a dedicated identity seed ─────────────────────────────────────────────────────────────────────
 * The identity seed is its **own** stream, independent of the network/workload/conditions seeds. Secrets
 * are derived from `(identitySeed, name)` directly, never drawn from a shared RNG whose consumption order
 * could shift and silently rebind keys. Two runs with the same `identitySeed` and node names always get the
 * same keys. See the voter model: a lift settles by its voter set (`V`-role members), default a set of
 * one — the originator voting itself.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { nobleHasher, type Signer, type Verifier } from 'tallynet'

/**
 * A deterministic signer for the node `name` under `identitySeed`: `secret = sha256("<seed>:<name>")`,
 * `publicKey = ed25519.getPublicKey(secret)`, and `sign(digest) = ed25519.sign(digest, secret)`. The same
 * `(identitySeed, name)` always yields the same key pair — and, since ed25519 signing is deterministic, the
 * same signatures. The returned `publicKey` becomes that node's consensus member key inside the harness.
 */
export function makeSimSigner(identitySeed: number, name: string): Signer {
	const secret = nobleHasher.sha256(new TextEncoder().encode(`${identitySeed}:${name}`))
	const publicKey = ed25519.getPublicKey(secret)
	return { publicKey, sign: (digest) => ed25519.sign(digest, secret) }
}

/** The per-node signer factory {@link InMemoryNetwork} takes, bound to one `identitySeed`. */
export function signerForSeed(identitySeed: number): (name: string) => Signer {
	return (name) => makeSimSigner(identitySeed, name)
}

/**
 * A real ed25519 verifier honouring the {@link Verifier} contract: a malformed key or signature is a
 * failed check (`false`), never a throw. One shared instance is enough — verification holds no key state.
 */
export const simVerifier: Verifier = {
	verify: (publicKey, digest, signature) => {
		try {
			return ed25519.verify(signature, digest, publicKey)
		} catch {
			return false
		}
	},
}
