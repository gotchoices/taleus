import { digest, signText, type KeyPairText } from '../store/index.js'
import type { RowWrite } from '../store/strand.js'

/**
 * Formation: seating two parties on a strand and naming the tally.
 *
 * Every function here returns **rows, signed** -- not database effects. Who applies them
 * is replication's business, and in a two-party strand they are applied to both parties'
 * replicas, each of which re-validates independently. Keeping the two apart is what lets a
 * test ask the question that matters: does the counterparty's engine accept this?
 *
 * The order is fixed by the protocol, not by preference:
 *
 * 1. The inviter generates an **invitation key** and gets the secret half to the invitee out
 *    of band -- in person, by QR, however they like. That key is the only thing that ties
 *    the invitee's seating to this strand.
 * 2. The inviter seats itself: a `Stock` row and its own genesis `PartyKey`.
 * 3. The invitee seats itself: a `Foil` row and its own genesis `PartyKey`.
 * 4. The inviter names the tally: `TallyCore`, which requires both seats to exist.
 *
 * Steps 2 and 3 are each **circular** and must be one transaction. `Stock.SignerAuthorized`
 * requires the signer to be in the party's authorized set, which lives in `PartyKey`; and a
 * genesis `PartyKey` signature validates against `Stock.InvitationKey`, which does not exist
 * until `Stock` does. Quereus defers a CHECK containing a subquery to COMMIT, so both rows
 * see each other there -- and neither can be inserted alone.
 */

/** The out-of-band secret that ties an invitee's seating to this strand. */
export interface Invitation {
	publicKey: string
	secretKey: Uint8Array
}

export interface Seating {
	sid: string
	/** The party's genesis device key. */
	genesis: KeyPairText
	invitation: Invitation
}

/**
 * The inviter's seat. Two rows, one act.
 *
 * The genesis key is signed by the **invitation** key rather than by itself: a key cannot
 * authorize its own admission, or authority would be minted from nothing.
 */
export function seatStock({ sid, genesis, invitation }: Seating): RowWrite[] {
	return [
		{
			table: 'Stock',
			row: {
				Sid: sid,
				InvitationKey: invitation.publicKey,
				SignerKey: genesis.publicKey,
				Signature: signText(genesis, digest(sid, invitation.publicKey)),
			},
		},
		genesisKey(sid, genesis, invitation),
	]
}

/**
 * The invitee's seat. The `Foil` row is signed with the **invitation secret**, which is the
 * whole proof that this responder is the one the inviter handed the invitation to.
 */
export function seatFoil({ sid, genesis, invitation }: Seating): RowWrite[] {
	return [
		{
			table: 'Foil',
			row: {
				Sid: sid,
				Signature: signText(
					{ publicKey: invitation.publicKey, secretKey: invitation.secretKey },
					digest(sid),
				),
			},
		},
		genesisKey(sid, genesis, invitation),
	]
}

/** A party's Revision-1 key, signed by the invitation key. */
export function genesisKey(sid: string, genesis: KeyPairText, invitation: Invitation): RowWrite {
	return {
		table: 'PartyKey',
		row: {
			Sid: sid,
			Revision: 1,
			PublicKey: genesis.publicKey,
			AuthKey: null,
			Signature: signText(
				{ publicKey: invitation.publicKey, secretKey: invitation.secretKey },
				digest(sid, 1, genesis.publicKey, null),
			),
		},
	}
}

export interface TallyIdentity {
	stockSid: string
	foilSid: string
	protocolVersion: string
	/** A calendar date, not an instant -- it reads the same to both parties. */
	createdAt: string
	/** An authorized key of the **stock** party; the inviter names the tally. */
	signer: KeyPairText
}

/** The tally's content-addressed identity. Both parties can compute it; only stock signs it. */
export function tallyCid(identity: Pick<TallyIdentity, 'stockSid' | 'foilSid' | 'protocolVersion' | 'createdAt'>): string {
	return digest(identity.stockSid, identity.foilSid, identity.protocolVersion, identity.createdAt)
}

export function createTally(identity: TallyIdentity): RowWrite[] {
	const cid = tallyCid(identity)
	return [
		{
			table: 'TallyCore',
			row: {
				Cid: cid,
				StockSid: identity.stockSid,
				FoilSid: identity.foilSid,
				ProtocolVersion: identity.protocolVersion,
				CreatedAt: identity.createdAt,
				SignerKey: identity.signer.publicKey,
				Signature: signText(identity.signer, cid),
			},
		},
	]
}
