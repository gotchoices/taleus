import { digest, signText, type KeyPairText } from '../store/index.js'
import type { RowWrite } from '../store/strand.js'

/**
 * A party's authorized key set: adding, revoking, and regaining authority after losing
 * everything.
 *
 * The set is not a chain with one head. Any currently-authorized, non-revoked key may
 * authorize another, and any authorized key may revoke another. What makes that safe is
 * that nothing here is self-referential: a key never admits itself, and the checks read
 * the **committed** snapshot so a row cannot bootstrap off itself or off something
 * inserted alongside it.
 *
 * Revocation is forward-only. Rows already committed under a revoked key stay valid --
 * their signature was checked once, at their own insert, against the set authorized then.
 * Only future inserts are refused. That is the compromise-versus-loss trade: a stolen
 * key's past signatures stand, its future ones do not.
 */

export interface KeyAdd {
	sid: string
	/** The key being authorized. */
	key: KeyPairText
	/** A currently-authorized key of the same party, which signs the admission. */
	by: KeyPairText
	/** Per-Sid sequence; must be exactly one more than the highest committed. */
	revision: number
}

/** Authorize another key. The admitting key signs; the new key does not sign itself in. */
export function addKey({ sid, key, by, revision }: KeyAdd): RowWrite {
	return {
		table: 'PartyKey',
		row: {
			Sid: sid,
			Revision: revision,
			PublicKey: key.publicKey,
			AuthKey: by.publicKey,
			Signature: signText(by, digest(sid, revision, key.publicKey, by.publicKey)),
		},
	}
}

export interface KeyRevoke {
	sid: string
	/** The key being retired -- a registered key of this party. */
	publicKey: string
	/** A currently-authorized key doing the retiring. Not the target: retire a device from
	 *  another surviving device, never from itself. */
	by: KeyPairText
}

export function revokeKey({ sid, publicKey, by }: KeyRevoke): RowWrite {
	return {
		table: 'PartyKeyRevocation',
		row: {
			Sid: sid,
			PublicKey: publicKey,
			RevokedBy: by.publicKey,
			Signature: signText(by, digest(sid, publicKey, by.publicKey)),
		},
	}
}

export interface KeyAdoption {
	/** The party regaining authority. Its identity does not change. */
	sid: string
	/** The fresh key, which proves possession by signing for itself. */
	key: KeyPairText
	/** The **counterparty's** authorized key, attesting. Not the party's own -- a party who
	 *  has lost everything has nothing left to attest with, which is the whole point. */
	counterparty: KeyPairText
}

/**
 * The counterparty re-key ceremony: how a party who has lost every device gets back in.
 *
 * Two signatures over the same digest. The new key signs to prove the recovering party
 * holds it; the counterparty signs to attest that they believe it. Neither alone is
 * enough, and the counterparty's attestation is what makes this a negotiation rather than
 * a claim -- there is no other authority in a two-party strand to appeal to.
 */
export function adoptKey({ sid, key, counterparty }: KeyAdoption): RowWrite {
	const claim = digest(sid, key.publicKey)
	return {
		table: 'PartyKeyAdoption',
		row: {
			Sid: sid,
			PublicKey: key.publicKey,
			SelfSignature: signText(key, claim),
			CounterpartyKey: counterparty.publicKey,
			CounterpartySignature: signText(counterparty, claim),
		},
	}
}
