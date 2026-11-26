/**
 * Sign and verify a transaction-record signature. These are the two primitives the consensus state
 * machine (next ticket) and the Taleus voter both call; they are kept **pure** — no clock, no store,
 * no record mutation — so they can be reused anywhere.
 *
 * Both go through the one shared preimage {@link recordDigest}, so sign and verify can never disagree
 * on what bytes are covered (ChipNet's `:159,173` vs `:222,253` bug). `verifySignature` **always
 * awaits** the verifier (ChipNet's `verifyDigest` never did, so nothing was ever checked, review
 * § Transaction module defects) and never throws on a malformed key/signature — a bad input is a
 * failed check.
 *
 * TallyNet ships no signature curve: `Signer`/`Verifier` are injected ports (`../crypto.js`), ed25519
 * in production. Signature `address`/`value` are base64url (`../base64url.js`), matching the rest of
 * the wire surface.
 */

import { bytesToBase64url, base64urlToBytes } from '../base64url.js'
import type { Hasher, Signer, Verifier } from '../crypto.js'
import { recordDigest } from './digest.js'
import type { Signature, SignatureType, TrxRecord } from './types.js'

/**
 * Produce a signature of `kind` over `record`, from `signer`'s key. The commit preimage binds the
 * record's current promise set (passed through to {@link recordDigest}); for a promise it is ignored.
 * The opaque `attachment` is the caller's to add afterward — it is never signed, so it is never set
 * here.
 */
export async function signRecord<TTerms, TPayload>(
	signer: Signer,
	kind: SignatureType,
	record: TrxRecord<TTerms, TPayload>,
	hasher?: Hasher,
): Promise<Signature> {
	const preimage = recordDigest(kind, record, record.promises, hasher)
	const value = bytesToBase64url(await signer.sign(preimage))
	return { type: kind, address: bytesToBase64url(signer.publicKey), value }
}

/**
 * Check `signature` against `record`. Recomputes the preimage with the signature's **claimed** kind
 * (so a relabel fails) over the record's promise set, decodes the base64url key and value, and awaits
 * the verifier. Returns `false` — never throws — for a non-canonical base64url key/value or a verifier
 * rejection; `Verifier` already guarantees it never throws on malformed bytes.
 */
export async function verifySignature<TTerms, TPayload>(
	verifier: Verifier,
	signature: Signature,
	record: TrxRecord<TTerms, TPayload>,
	hasher?: Hasher,
): Promise<boolean> {
	const preimage = recordDigest(signature.type, record, record.promises, hasher)
	let publicKey: Uint8Array
	let value: Uint8Array
	try {
		publicKey = base64urlToBytes(signature.address)
		value = base64urlToBytes(signature.value)
	} catch {
		// A signature whose key or value is not canonical base64url cannot verify — a failed check,
		// not an error (matches the Verifier contract that a bad input is `false`, never a throw).
		return false
	}
	return await verifier.verify(publicKey, preimage, value)
}
