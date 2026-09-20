import { Tally, type Party } from '../store/test-harness.js'
import { requestPayment } from './invoices.js'
import { TODAY, trading } from './test-harness.js'

/**
 * Invoices: asking to be paid, and the four ways that ends.
 *
 * An invoice is a *request*, not a commitment. It binds nobody, it is not credit-gated, and
 * its state is never stored -- `InvoiceState` derives it from the tables every time it is
 * read, with precedence `paid > declined > expired > open`.
 *
 * `feat-invoice-lifecycle` argues this model is too contract-like; these tests record the
 * schema as it stands. The two-party setup lives in `./test-harness.ts` -- Jan is stock and
 * invoices Sam, so it is Sam's answering chit that has to fit inside the credit Jan granted.
 */

/**
 * A date that has already passed, and always will have. `InvoiceState` derives expiry from
 * `Today()`, the one volatile function in the schema, so a fixed past date is the only stable
 * way to test it -- the wall clock only moves further away from it.
 */
const LONG_PAST = '2026-03-09'
/** Far enough out that `open` stays `open` for the life of this test suite. */
const FAR_FUTURE = '2099-01-01'

const stateOf = (tally: Tally, party: Party, id: string) =>
	tally.seesOne<{ State: string }>(party, `select State from InvoiceState where Id = '${id}'`)

describe('asking to be paid', () => {
	it('is signed by the party that wants the money, and both parties see the request', async () => {
		const { jan, sam, tally, invoice } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000, memo: 'March hours' })])

		for (const party of [jan, sam]) {
			await expect(
				tally.seesOne(party, "select Requester, Units, Memo from Invoice where Id = 'inv:1'"),
			).resolves.toEqual({ Requester: 'S', Units: 12000, Memo: 'March hours' })
		}
	})

	it('refuses an invoice the requesting side did not sign', async () => {
		// Sam signing an invoice that names Jan as the one to be paid: Sam would be writing
		// himself a bill. `SignerAuthorized` resolves the key against the *requester's* set.
		const { sam, tally, cid } = await trading()
		await expect(
			tally.refuses([
				requestPayment({
					tallyCid: cid,
					id: 'inv:forged',
					requester: 'S',
					units: 12000,
					date: TODAY,
					signer: sam.keys[0],
				}),
			]),
		).resolves.toMatch(/SignerAuthorized/)
	})

	it('refuses an invoice whose terms were altered after signing', async () => {
		// The digest covers the units, so raising the amount on a signed request breaks it.
		const { tally, invoice } = await trading()
		const forged = invoice({ id: 'inv:1', units: 12000 })
		await expect(
			tally.refuses([{ ...forged, row: { ...forged.row, Units: 90000 } }]),
		).resolves.toMatch(/SignatureValid/)
	})

	it('refuses an expiry before the invoice date', async () => {
		const { tally, invoice } = await trading()
		await expect(
			tally.refuses([invoice({ id: 'inv:1', units: 12000, expiryDate: '2026-03-01' })]),
		).resolves.toMatch(/ExpiryValid/)
	})

	it('may ask for more than the counterparty can currently pay', async () => {
		// Jan granted 50000. Asking for 90000 is legitimate -- Jan may raise the limit, or Sam
		// may simply have the capacity by the time he answers. The gate is on the chit, not here.
		const { jan, tally, invoice } = await trading()
		await tally.propose([invoice({ id: 'inv:big', units: 90000 })])
		await expect(stateOf(tally, jan, 'inv:big')).resolves.toEqual({ State: 'open' })
	})
})

describe('answering an invoice', () => {
	it('is one chit, from the payer, for the exact units', async () => {
		const { jan, sam, tally, invoice, chit } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await tally.propose([chit({ number: 1, units: 12000, balance: 12000, invoiceId: 'inv:1' })])

		for (const party of [jan, sam]) {
			await expect(stateOf(tally, party, 'inv:1')).resolves.toEqual({ State: 'paid' })
		}
	})

	it('refuses a chit issued by the requester’s own side', async () => {
		// Jan asked to be paid; a Jan-issued chit answering it would *lower* the balance he is
		// owed. The direction is wrong, not merely the amount. Sam grants credit here only so
		// that the chit clears `WithinCreditLimits` and `InvoiceLink` is the constraint left
		// to fire -- with the default grant of zero, Jan cannot issue at all and the credit
		// gate answers first.
		const { tally, invoice, chit } = await trading({ samGrants: 50000 })
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await expect(
			tally.refuses([
				chit({ number: 1, issuer: 'S', units: 12000, balance: -12000, invoiceId: 'inv:1' }),
			]),
		).resolves.toMatch(/InvoiceLink/)
	})

	it('refuses partial payment', async () => {
		const { tally, invoice, chit } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await expect(
			tally.refuses([chit({ number: 1, units: 5000, balance: 5000, invoiceId: 'inv:1' })]),
		).resolves.toMatch(/InvoiceLink/)
	})

	it('refuses a second chit against the same invoice', async () => {
		const { tally, invoice, chit } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await tally.propose([chit({ number: 1, units: 12000, balance: 12000, invoiceId: 'inv:1' })])
		await expect(
			tally.refuses([chit({ number: 2, units: 12000, balance: 24000, invoiceId: 'inv:1' })]),
		).resolves.toMatch(/InvoiceLink/)
	})

	it('refuses a chit naming an invoice that does not exist', async () => {
		const { tally, chit } = await trading()
		await expect(
			tally.refuses([chit({ number: 1, units: 12000, balance: 12000, invoiceId: 'inv:ghost' })]),
		).resolves.toMatch(/InvoiceLink/)
	})

	it('leaves the invoice open when the payer pays a different amount unlinked', async () => {
		// The way to pay something other than what was asked: an ordinary chit, no link. It
		// settles value and says nothing about the request, which stays open for the difference
		// to be renegotiated out of band.
		const { jan, tally, invoice, chit } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await tally.propose([chit({ number: 1, units: 5000, balance: 5000 })])

		await expect(stateOf(tally, jan, 'inv:1')).resolves.toEqual({ State: 'open' })
		await expect(
			tally.seesOne(jan, 'select Balance from Ledger order by Number desc limit 1'),
		).resolves.toEqual({ Balance: 5000 })
	})

	it('credit-gates the answering chit even though the invoice was not gated', async () => {
		const { tally, invoice, chit } = await trading()
		await tally.propose([invoice({ id: 'inv:big', units: 90000 })])
		await expect(
			tally.refuses([chit({ number: 1, units: 90000, balance: 90000, invoiceId: 'inv:big' })]),
		).resolves.toMatch(/WithinCreditLimits/)
	})
})

describe('declining', () => {
	it('records the refusal where the requester can see it', async () => {
		// Story 21 path D: an unanswered request and a refused one are different facts. Silence
		// is not an answer, so a decline is a signed row of its own.
		const { jan, sam, tally, invoice, decline } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await tally.propose([decline('inv:1')])

		for (const party of [jan, sam]) {
			await expect(stateOf(tally, party, 'inv:1')).resolves.toEqual({ State: 'declined' })
		}
	})

	it('is the payer’s to make, not the requester’s', async () => {
		// Jan cannot decline his own invoice. Withdrawing a request is a different act, and the
		// schema does not have one -- see test/STATUS.md § 0.
		const { tally, invoice, decline } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await expect(tally.refuses([decline('inv:1', 'S')])).resolves.toMatch(/DeclinerIsPayer/)
	})

	it('happens at most once', async () => {
		const { tally, invoice, decline } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await tally.propose([decline('inv:1')])
		// The primary key is `InvoiceId` alone, so "at most one decline" needs no constraint.
		await expect(tally.refuses([decline('inv:1')])).resolves.toMatch(
			/UNIQUE constraint failed: InvoiceDecline/,
		)
	})

	it('refuses to decline an invoice already paid', async () => {
		const { tally, invoice, chit, decline } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await tally.propose([chit({ number: 1, units: 12000, balance: 12000, invoiceId: 'inv:1' })])
		await expect(tally.refuses([decline('inv:1')])).resolves.toMatch(/NotPaid/)
	})

	it('refuses to pay an invoice already declined', async () => {
		const { tally, invoice, chit, decline } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		await tally.propose([decline('inv:1')])
		await expect(
			tally.refuses([chit({ number: 1, units: 12000, balance: 12000, invoiceId: 'inv:1' })]),
		).resolves.toMatch(/InvoiceLink/)
	})

	it('refuses a decline whose signature does not verify', async () => {
		const { tally, invoice, decline } = await trading()
		await tally.propose([invoice({ id: 'inv:1', units: 12000 })])
		const forged = decline('inv:1')
		await expect(
			tally.refuses([{ ...forged, row: { ...forged.row, Signature: 'deadbeef' } }]),
		).resolves.toMatch(/SignatureValid/)
	})

	it('refuses a decline naming an invoice that does not exist', async () => {
		const { tally, decline } = await trading()
		await expect(tally.refuses([decline('inv:ghost')])).resolves.toMatch(/InvoiceExists/)
	})
})

describe('expiry and state precedence', () => {
	it('reads as expired once the date has passed, with no row written', async () => {
		const { jan, tally, invoice } = await trading()
		await tally.propose([invoice({ id: 'inv:old', units: 12000, expiryDate: LONG_PAST })])
		await expect(stateOf(tally, jan, 'inv:old')).resolves.toEqual({ State: 'expired' })
	})

	it('stays open while the expiry is still ahead', async () => {
		const { jan, tally, invoice } = await trading()
		await tally.propose([invoice({ id: 'inv:live', units: 12000, expiryDate: FAR_FUTURE })])
		await expect(stateOf(tally, jan, 'inv:live')).resolves.toEqual({ State: 'open' })
	})

	it('accepts a late payment, and paid beats expired', async () => {
		// Expiry is advisory: it is not gated at chit insert. A payer settling an old request is
		// doing the requester a favour, and the schema does not stand in the way.
		const { jan, sam, tally, invoice, chit } = await trading()
		await tally.propose([invoice({ id: 'inv:old', units: 12000, expiryDate: LONG_PAST })])
		await tally.propose([chit({ number: 1, units: 12000, balance: 12000, invoiceId: 'inv:old' })])

		for (const party of [jan, sam]) {
			await expect(stateOf(tally, party, 'inv:old')).resolves.toEqual({ State: 'paid' })
		}
	})

	it('reports declined over expired', async () => {
		const { jan, tally, invoice, decline } = await trading()
		await tally.propose([invoice({ id: 'inv:old', units: 12000, expiryDate: LONG_PAST })])
		await tally.propose([decline('inv:old')])
		await expect(stateOf(tally, jan, 'inv:old')).resolves.toEqual({ State: 'declined' })
	})

	it('lists only the open ones as upcoming movement', async () => {
		const { jan, tally, invoice, chit, decline } = await trading()
		await tally.propose([invoice({ id: 'inv:open', units: 3000 })])
		await tally.propose([invoice({ id: 'inv:paid', units: 4000 })])
		await tally.propose([invoice({ id: 'inv:declined', units: 5000 })])
		await tally.propose([invoice({ id: 'inv:old', units: 6000, expiryDate: LONG_PAST })])
		await tally.propose([chit({ number: 1, units: 4000, balance: 4000, invoiceId: 'inv:paid' })])
		await tally.propose([decline('inv:declined')])

		await expect(tally.sees(jan, 'select Id from OpenInvoice order by Id')).resolves.toEqual([
			{ Id: 'inv:open' },
		])
	})
})
