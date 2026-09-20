import { digest, signText, type KeyPairText } from '../store/index.js'
import type { RowWrite } from '../store/strand.js'
import type { Side } from './negotiation.js'

/**
 * Invoices: asking to be paid.
 *
 * An invoice is the requester's **statement of what they think they are owed**. It is
 * signed by them alone and obliges the payer to nothing — only a chit moves a balance.
 * That asymmetry is the whole design: what you *owe* is what you have signed, what someone
 * is *asking* is what they say, and both are worth seeing.
 *
 * `feat-invoice-lifecycle` argues this model is too contract-like and asks for part payment,
 * withdrawal, and aging in place of expiry. This module implements the schema as it stands.
 *
 * One invoice is answered by exactly one chit, for the exact units, issued from the
 * opposite side. Partial payment is not a thing: a payer who wants to pay a different
 * amount issues an ordinary unlinked chit and leaves the invoice open. That keeps "paid" a
 * single-existence test rather than a running sum.
 */

export interface InvoiceRequest {
	tallyCid: string
	/** Caller-supplied: it is inside the digest the requester signs. */
	id: string
	/** The side asking to be paid — the future recipient of value. */
	requester: Side
	units: number
	date: string
	/** Null never expires. Even expired, a late payment still lands as paid. */
	expiryDate?: string | null
	reference?: string
	memo?: string
	signer: KeyPairText
}

export function requestPayment(invoice: InvoiceRequest): RowWrite {
	// Documented optional, declared NOT NULL — see test/STATUS.md § 0.
	const reference = invoice.reference ?? ''
	const memo = invoice.memo ?? ''
	const expiryDate = invoice.expiryDate ?? null
	return {
		table: 'Invoice',
		row: {
			Id: invoice.id,
			Requester: invoice.requester,
			Units: invoice.units,
			Date: invoice.date,
			ExpiryDate: expiryDate,
			Reference: reference,
			Memo: memo,
			SignerKey: invoice.signer.publicKey,
			Signature: signText(
				invoice.signer,
				digest(
					invoice.tallyCid,
					invoice.id,
					invoice.requester,
					invoice.units,
					invoice.date,
					expiryDate,
					reference,
					memo,
				),
			),
		},
	}
}

export interface InvoiceRefusal {
	tallyCid: string
	invoiceId: string
	/** The payer — the side the invoice was addressed to. */
	declinedBy: Side
	signer: KeyPairText
}

/**
 * Saying no, on the record. Story 21 path D: a refused request is visible to the requester,
 * so an unanswered invoice and a refused one are different facts rather than the same
 * silence.
 */
export function declineInvoice(refusal: InvoiceRefusal): RowWrite {
	return {
		table: 'InvoiceDecline',
		row: {
			InvoiceId: refusal.invoiceId,
			DeclinedBy: refusal.declinedBy,
			SignerKey: refusal.signer.publicKey,
			Signature: signText(
				refusal.signer,
				digest(refusal.tallyCid, refusal.invoiceId, refusal.declinedBy),
			),
		},
	}
}

/** The side opposite a given one — the payer for a requester, and vice versa. */
export function otherSide(side: Side): Side {
	return side === 'S' ? 'F' : 'S'
}
