import { digest, signText, type KeyPairText } from '../store/index.js'
import type { RowWrite } from '../store/strand.js'
import type { Side } from './negotiation.js'

/**
 * Winding a tally down.
 *
 * A close is **unilateral and safe**, which sounds like a contradiction and is not. Filing a
 * `CloseRequest` does exactly two things: it freezes balance *growth* in both directions, and
 * it leaves balance *reduction* permitted -- direct chits and lift pledges alike. So the party
 * who did not ask for the close can still be paid down, or lift the value out, and `closed` is
 * reached only when the settled balance is actually zero.
 *
 * That is why no countersignature is needed. A close grants its filer nothing they did not
 * already have: either party could always set their own `CreditTerms.CreditLimit` to the
 * current balance and achieve the same freeze. What close adds is a signed, visible statement
 * of intent -- and a terminal state, which zero credit is not (a tally at zero credit is still
 * `open`, and a later revision can restore the limit).
 *
 * Both parties may file. The primary key is `Requester`, so each gets at most one row, and
 * the tally is closing the moment either exists.
 */

export interface CloseRequest {
	tallyCid: string
	/** The side asking to wind down. */
	requester: Side
	/** A calendar date the requester asserts and signs -- see `docs/timestamps.md`. */
	date: string
	signer: KeyPairText
}

export function requestClose(request: CloseRequest): RowWrite {
	return {
		table: 'CloseRequest',
		row: {
			Requester: request.requester,
			Date: request.date,
			SignerKey: request.signer.publicKey,
			Signature: signText(
				request.signer,
				digest(request.tallyCid, request.requester, request.date),
			),
		},
	}
}
