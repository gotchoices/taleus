import { Tally, newInvitation, newParty, type Party } from '../store/test-harness.js'
import { issueChit, type Chit } from './chits.js'
import { requestClose } from './close.js'
import { createTally, seatFoil, seatStock, tallyCid } from './formation.js'
import { declineInvoice, requestPayment, type InvoiceRequest } from './invoices.js'
import { proposeContract, publishCreditTerms, signContract, type Side } from './negotiation.js'

/**
 * An open tally between two parties, ready to trade on -- the setup every ledger-level suite
 * needs before it can say anything interesting.
 *
 * Jan is stock and lets Sam owe him 50000. Sam is foil and lets Jan owe nothing. That
 * asymmetry is deliberate: it is the ordinary shape of a credit relationship (a supplier
 * extends credit to a customer, not the reverse), and it makes the credit gate visible in
 * tests that are nominally about something else. Pass `samGrants` when a test needs Jan able
 * to issue.
 *
 * Excluded from the build (`tsconfig.build.json`), like `src/store/test-harness.ts`.
 */

export const TODAY = '2026-03-02'
export const PROTOCOL = 'taleus/1'
export const CONTRACT = 'cid:standard-tally-v1'

export interface TradingTally {
	jan: Party
	sam: Party
	tally: Tally
	cid: string
	/** A chit from whichever side is giving. Sam (foil), paying Jan, by default. */
	chit: (over: Partial<Chit> & Pick<Chit, 'number' | 'units' | 'balance'>) => ReturnType<typeof issueChit>
	/** An invoice from whichever side is asking to be paid. Jan (stock) by default. */
	invoice: (
		over: Partial<InvoiceRequest> & Pick<InvoiceRequest, 'id' | 'units'>,
	) => ReturnType<typeof requestPayment>
	/** A decline by whichever side is refusing. Sam, the payer of Jan's invoices, by default. */
	decline: (invoiceId: string, declinedBy?: Side) => ReturnType<typeof declineInvoice>
	/** A close request from whichever side is winding down. Jan by default. */
	close: (requester?: Side, date?: string) => ReturnType<typeof requestClose>
}

export async function trading({ janGrants = 50000, samGrants = 0 } = {}): Promise<TradingTally> {
	const jan = newParty('jan')
	const sam = newParty('sam')
	const invitation = newInvitation()
	const tally = await Tally.open([jan, sam])
	await tally.propose(seatStock({ sid: jan.sid, genesis: jan.keys[0], invitation }))
	await tally.propose(seatFoil({ sid: sam.sid, genesis: sam.keys[0], invitation }))
	const identity = {
		stockSid: jan.sid,
		foilSid: sam.sid,
		protocolVersion: PROTOCOL,
		createdAt: TODAY,
	}
	await tally.propose(createTally({ ...identity, signer: jan.keys[0] }))
	const cid = tallyCid(identity)

	for (const [sid, signer, creditLimit] of [
		[jan.sid, jan.keys[0], janGrants],
		[sam.sid, sam.keys[0], samGrants],
	] as const) {
		await tally.propose([
			publishCreditTerms({
				sid,
				tallyCid: cid,
				revision: 1,
				creditLimit,
				callDays: 21,
				date: TODAY,
				effectiveDate: TODAY,
				signer,
			}),
		])
	}
	await tally.propose([
		proposeContract({
			tallyCid: cid,
			sequenceNumber: 1,
			contractCid: CONTRACT,
			proposer: 'S',
			stockCreditTermsRevision: 1,
			foilCreditTermsRevision: 1,
			signer: jan.keys[0],
		}),
	])
	await tally.propose([
		signContract({
			tallyCid: cid,
			number: 1,
			contractCid: CONTRACT,
			stockCreditTermsRevision: 1,
			foilCreditTermsRevision: 1,
			stockSigner: jan.keys[0],
			foilSigner: sam.keys[0],
		}),
	])

	const sideParty = (side: Side) => (side === 'F' ? sam : jan)

	return {
		jan,
		sam,
		tally,
		cid,
		chit: over => {
			const issuer = over.issuer ?? 'F'
			const party = sideParty(issuer)
			return issueChit({
				tallyCid: cid,
				contractNumber: 1,
				id: `chit:${over.number}`,
				date: TODAY,
				signer: party.keys[0],
				issuerSid: party.sid,
				issuer,
				...over,
			})
		},
		invoice: over => {
			const requester = over.requester ?? 'S'
			return requestPayment({
				tallyCid: cid,
				requester,
				date: TODAY,
				signer: sideParty(requester).keys[0],
				...over,
			})
		},
		decline: (invoiceId, declinedBy = 'F') =>
			declineInvoice({ tallyCid: cid, invoiceId, declinedBy, signer: sideParty(declinedBy).keys[0] }),
		close: (requester = 'S', date = TODAY) =>
			requestClose({ tallyCid: cid, requester, date, signer: sideParty(requester).keys[0] }),
	}
}

/** The running stock-perspective balance both parties should agree on. */
export const balanceOf = (tally: Tally, party: Party) =>
	tally.seesOne<{ Balance: number }>(party, 'select Balance from Ledger order by Number desc limit 1')
