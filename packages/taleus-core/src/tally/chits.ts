import { digest, signText, type KeyPairText } from '../store/index.js'
import type { RowWrite } from '../store/strand.js'
import type { Side } from './negotiation.js'

/**
 * Direct chits: the ledger.
 *
 * A chit is issued -- and signed -- by the party it makes **worse off**. Issuing raises what
 * you owe or lowers what you are owed. That is why a chit needs no countersignature: nobody
 * needs protecting from a stranger making themselves poorer, and a party can always give.
 *
 * The ledger is a set of signed chits, not a chain: a chit carries no running number and no
 * running balance, so two parties issuing at once never contend for anything. The balance is
 * their sum (`SettledBalance`), and what the issuer's chosen date can and cannot do is
 * `docs/timestamps.md`.
 *
 * The sign convention, once: the balance is the stock party's perspective. A foil-issued chit
 * raises it (the foil owes the stock more); a stock-issued chit lowers it. `Units` is always
 * positive; direction comes from `Issuer`, never from the sign of the amount.
 */

export interface Chit {
	tallyCid: string
	/** The contract revision in force when it was issued. */
	contractNumber: number
	/** Caller-supplied and fresh: the chit's identity, and inside the digest the issuer signs. */
	id: string
	/** Which side is giving -- 'F' raises the stock-perspective balance, 'S' lowers it. */
	issuer: Side
	units: number
	/** A calendar date the issuer asserts and signs. */
	date: string
	/** The instant the issuer made it, as it asserts and signs it (`toISOString()`, UTC). Orders chits within a day. */
	at: string
	reference?: string
	memo?: string
	/** Set when this chit answers an invoice. */
	invoiceId?: string | null
	signer: KeyPairText
	/**
	 * The Sid the digest names. The schema computes it as the **issuer's** own Sid, despite
	 * the column being aliased `RecipientSid` -- see test/STATUS.md § 0. Passed in rather
	 * than guessed so the caller can see which it is.
	 */
	issuerSid: string
}

/**
 * The stock-perspective delta a chit applies. Positive raises the balance (the foil owes the
 * stock more), negative lowers it.
 */
export function chitDelta(issuer: Side, units: number): number {
	return issuer === 'F' ? units : -units
}

export function issueChit(chit: Chit): RowWrite {
	// `Reference` and `Memo` are documented optional and declared NOT NULL -- empty text
	// stands in, and that is what the signature covers. See test/STATUS.md § 0.
	const reference = chit.reference ?? ''
	const memo = chit.memo ?? ''
	const invoiceId = chit.invoiceId ?? null
	return {
		table: 'Ledger',
		row: {
			ContractNumber: chit.contractNumber,
			Id: chit.id,
			Issuer: chit.issuer,
			Units: chit.units,
			Date: chit.date,
			At: chit.at,
			Reference: reference,
			Memo: memo,
			InvoiceId: invoiceId,
			SignerKey: chit.signer.publicKey,
			Signature: signText(
				chit.signer,
				digest(
					chit.id,
					chit.issuer,
					chit.issuerSid,
					chit.units,
					chit.date,
					chit.at,
					reference,
					memo,
					invoiceId,
				),
			),
			Kind: 'direct',
			LiftId: null,
			RefereeSignature: null,
		},
	}
}
