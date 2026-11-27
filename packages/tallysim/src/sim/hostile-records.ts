/**
 * Mint the malicious consensus records an active-emission attack needs, from the simulator's own known
 * identities. The sim holds every node's private key deterministically ({@link makeSimSigner}), so it can
 * forge a face in any member's name, flood a voter's commit pool with junk, or god-mint both faces an
 * equivocating voter would sign — all without any new protocol code. These are the primitives the
 * hand-driven hostile-actor scenarios (`hostile-scenarios.test.ts`) push at a real reconstructed route to
 * prove `tallynet`'s own defences hold. See `docs/design.md` § Consensus simulation (hostile-actor scenarios).
 *
 * ── Two kinds of face, deliberately distinct ───────────────────────────────────────────────────────────
 * - {@link signAs} is a **genuine** face in some node's name, signed with that node's real key — it VERIFIES.
 *   It is what the equivocation scenarios use: the sim god-mints a voter's genuine `C` *and* its genuine
 *   `NC`, exactly the two faces a double-signing voter would itself emit.
 * - {@link forgeFace} is a face that *claims* to be a victim but is signed with an ATTACKER's key, so it
 *   fails `verifySignature` and is rejected `forged`. It models a node forging another member's face: the
 *   attacker never holds the victim's private key.
 *
 * This module is platform-neutral (no Node globals, no base64url decoder): {@link junkCommits} makes an
 * invalid value by swapping one character of the base64url string in place, which stays canonical, decodes,
 * and fails verification without any byte-level machinery.
 */

import { signRecord, type Signature, type SignatureType, type TrxRecord } from 'tallynet'
import { makeSimSigner } from './identity.js'
import type { LiftTerms } from './terms.js'

/**
 * A **genuine** face of `type` in `signerName`'s name, signed with that node's real key (the sim holds every
 * node's key under `identitySeed`). It verifies — so it is counted. This is the primitive the equivocation
 * scenarios use to god-mint the two faces an equivocating voter would itself produce.
 */
export function signAs(
	identitySeed: number,
	signerName: string,
	type: SignatureType,
	record: TrxRecord<LiftTerms, unknown>,
): Promise<Signature> {
	return signRecord(makeSimSigner(identitySeed, signerName), type, record)
}

/**
 * A face of `type` that CLAIMS to be `victimKey` but is SIGNED with `attackerName`'s key, so it fails
 * `verifySignature` and is rejected `forged`. Models a node forging another member's face: the attacker
 * signs with its own key, then relabels the signature's `address` to the victim — the value was made by the
 * attacker's key but claims to be the victim, so verification against the victim's key fails. `attackerName`
 * need not be a network node; any name yields a deterministic key under `identitySeed`.
 */
export async function forgeFace(
	identitySeed: number,
	victimKey: string,
	attackerName: string,
	type: SignatureType,
	record: TrxRecord<LiftTerms, unknown>,
): Promise<Signature> {
	const signed = await signRecord(makeSimSigner(identitySeed, attackerName), type, record)
	return { ...signed, address: victimKey } // claim the victim; the value is the attacker's → verify fails
}

/**
 * `n` DISTINCT garbage commits attributed to one voter (`genuine.address`, `genuine.type`), each with an
 * invalid value — so none dedupes against another and none verifies. One base64url character of the value is
 * swapped at a rotating position (`'A'` when it was anything else, `'B'` when it was already `'A'`): the swap
 * always changes the character and stays within the base64url alphabet, so each value is canonical, decodes,
 * and fails verification. Distinct positions give distinct values for `n ≤ value.length` (an ed25519
 * signature is 86 base64url chars, far above the pool cap), which is the flood a per-voter pool cap must survive.
 */
export function junkCommits(genuine: Signature, n: number): Signature[] {
	return Array.from({ length: n }, (_, i) => {
		const chars = [...genuine.value]
		const pos = i % chars.length
		chars[pos] = chars[pos] === 'A' ? 'B' : 'A' // a different valid base64url char ⇒ a wrong signature value
		return { ...genuine, value: chars.join('') }
	})
}
