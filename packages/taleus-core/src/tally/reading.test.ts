import { digest, newKey, signText } from '../store/index.js'
import { Tally, newInvitation, newParty, type Party } from '../store/test-harness.js'
import { createTally, seatFoil, seatStock, tallyCid } from './formation.js'
import { publishCreditTerms } from './negotiation.js'
import { PROTOCOL, TODAY, trading } from './test-harness.js'

/**
 * Reading a tally.
 *
 * Every view here is derived -- nothing in this file writes state that a later read depends
 * on. Two properties matter. The first is that the two parties, holding separate databases,
 * read the *same* facts stated from their own side: a balance one party sees as +18000 the
 * other must see as -18000, never as a different magnitude. The second is that "settled" and
 * "reserved" stay distinct, because an open lift pledge reserves capacity without having moved
 * any value yet.
 */

/** A view that must answer: `seesOne` returns undefined for an empty result, which is a failure. */
async function must<T>(read: Promise<T | undefined>): Promise<T> {
	const value = await read
	if (value === undefined) {
		throw new Error('a derived view returned no row')
	}
	return value
}

const perspective = (tally: Tally, party: Party) =>
	tally.seesOne<{ Balance: number }>(
		party,
		`select Balance from PerspectiveBalance where Sid = '${party.sid}'`,
	)

const reservedPerspective = (tally: Tally, party: Party) =>
	tally.seesOne<{ Balance: number }>(
		party,
		`select Balance from ReservedPerspectiveBalance where Sid = '${party.sid}'`,
	)

const limitGrantedBy = (tally: Tally, reader: Party, grantor: Party) =>
	tally.seesOne<{ CreditLimit: number }>(
		reader,
		`select CreditLimit from CurrentCreditLimit where Sid = '${grantor.sid}'`,
	)

describe('perspective', () => {
	it('states one balance oppositely to each party', async () => {
		const { jan, sam, tally, chit } = await trading()
		await tally.propose([chit({ number: 1, units: 18000, balance: 18000 })])

		// Jan is stock and has accumulated value; Sam is foil and owes it.
		await expect(perspective(tally, jan)).resolves.toEqual({ Balance: 18000 })
		await expect(perspective(tally, sam)).resolves.toEqual({ Balance: -18000 })
	})

	it('reads the same on both replicas, not merely on the reader’s own', async () => {
		// Each party holds its own database. A view that read differently depending on *which*
		// copy answered would make the two parties disagree about a signed fact.
		const { jan, sam, tally, chit } = await trading()
		await tally.propose([chit({ number: 1, units: 18000, balance: 18000 })])

		for (const reader of [jan, sam]) {
			await expect(
				tally.sees(reader, 'select Balance from PerspectiveBalance order by Balance'),
			).resolves.toEqual([{ Balance: -18000 }, { Balance: 18000 }])
		}
	})

	it('hands the foil side a negative zero at a zero balance', async () => {
		// `Balance * -1` on a zero is `-0` in JavaScript, and it comes back through Quereus as
		// one. Harmless in arithmetic and in JSON (`-0` serializes as `0`), but `Object.is(b, 0)`
		// is false for it, and so is a naive snapshot comparison -- which is how this was found.
		// Recorded in test/STATUS.md § 0; a display layer should normalize rather than assume.
		const { jan, sam, tally } = await trading()
		await expect(perspective(tally, jan)).resolves.toEqual({ Balance: 0 })
		const foil = await must(perspective(tally, sam))
		expect(Object.is(foil.Balance, -0)).toBe(true)
		expect(foil.Balance === 0).toBe(true) // `===` does not distinguish them; `Object.is` does
	})
})

describe('credit limits', () => {
	it('returns the revision in force, not the latest one filed', async () => {
		// Jan files a withdrawal of credit that does not bind until 2099. Until then the terms
		// Sam is actually trading under are revision 1's.
		const { jan, sam, tally, cid } = await trading()
		await tally.propose([
			publishCreditTerms({
				sid: jan.sid,
				tallyCid: cid,
				revision: 2,
				creditLimit: 0,
				callDays: 21,
				date: TODAY,
				effectiveDate: '2099-01-01',
				signer: jan.keys[0],
			}),
		])
		await expect(limitGrantedBy(tally, sam, jan)).resolves.toEqual({ CreditLimit: 50000 })
	})

	it('picks up a raise immediately, because a raise owes no notice', async () => {
		const { jan, sam, tally, cid } = await trading()
		await tally.propose([
			publishCreditTerms({
				sid: jan.sid,
				tallyCid: cid,
				revision: 2,
				creditLimit: 80000,
				callDays: 21,
				date: TODAY,
				effectiveDate: TODAY,
				signer: jan.keys[0],
			}),
		])
		await expect(limitGrantedBy(tally, sam, jan)).resolves.toEqual({ CreditLimit: 80000 })
	})

	it('reports zero for a party that granted nothing', async () => {
		const { jan, sam, tally } = await trading()
		await expect(limitGrantedBy(tally, jan, sam)).resolves.toEqual({ CreditLimit: 0 })
	})
})

describe('settled versus reserved', () => {
	it('keeps an open pledge out of the settled balance and inside the reserved one', async () => {
		const { jan, sam, tally, cid, chit } = await trading()
		await tally.propose([chit({ number: 1, units: 18000, balance: 18000 })])

		const referee = newKey()
		const expiry = '2026-04-01'
		await tally.propose([
			{
				table: 'PendingLift',
				row: {
					LiftId: 'lift:1',
					RefereeKey: referee.publicKey,
					Issuer: 'S',
					Units: 5000,
					Date: TODAY,
					Expiry: expiry,
					SignerKey: jan.keys[0].publicKey,
					Signature: signText(
						jan.keys[0],
						digest(cid, 'lift:1', referee.publicKey, 'S', 5000, TODAY, expiry),
					),
				},
			},
		])

		// Jan has pledged 5000 away but nothing has settled: what he is owed is unchanged, what
		// he can still commit is not.
		await expect(perspective(tally, jan)).resolves.toEqual({ Balance: 18000 })
		await expect(reservedPerspective(tally, jan)).resolves.toEqual({ Balance: 13000 })
		await expect(reservedPerspective(tally, sam)).resolves.toEqual({ Balance: -13000 })
	})
})

describe('a tally with no activity', () => {
	it('reads as a coherent zero rather than an error', async () => {
		// Formation and nothing else -- no credit terms, no contract, no chits. Every view has
		// to answer, because this is the state an app opens onto the moment a tally is seated.
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
		expect(tallyCid(identity)).toBeTruthy()

		// `+ 0` normalizes the foil side's negative zero -- see the perspective suite above.
		for (const party of [jan, sam]) {
			expect((await must(perspective(tally, party))).Balance + 0).toEqual(0)
			expect((await must(reservedPerspective(tally, party))).Balance + 0).toEqual(0)
			await expect(limitGrantedBy(tally, party, party)).resolves.toEqual({ CreditLimit: 0 })
			await expect(
				tally.seesOne(party, 'select State from CloseState'),
			).resolves.toEqual({ State: 'open' })
			await expect(tally.sees(party, 'select Id from OpenInvoice')).resolves.toEqual([])
			await expect(tally.sees(party, 'select LiftId from OpenPendingLift')).resolves.toEqual([])
		}
	})
})
