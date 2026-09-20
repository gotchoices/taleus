import { digest, newKey, signText } from '../store/index.js'
import type { RowWrite } from '../store/strand.js'
import { Tally, type Party } from '../store/test-harness.js'
import { requestClose } from './close.js'
import { publishCreditTerms } from './negotiation.js'
import { TODAY, balanceOf, trading } from './test-harness.js'

/**
 * Winding a tally down.
 *
 * The claim under test is that a unilateral close is safe. It rests on two halves: closing
 * freezes balance *growth* in both directions, and it always permits balance *reduction* --
 * direct chits here, and lift pledges too, so a party holding value can either be paid down or
 * lift it out. `closed` is reached only at an actual settled zero with nothing still pending,
 * which is what stops a close from being a way to trap the counterparty.
 *
 * The two-party setup lives in `./test-harness.ts`.
 */

/** `TODAY` plus the 21 days of notice a restrictive credit revision owes. */
const NOTICE_GIVEN = '2026-03-23'
const AFTER_NOTICE = '2026-03-24'

const stateOf = (tally: Tally, party: Party) =>
	tally.seesOne<{ State: string }>(party, 'select State from CloseState')

describe('filing a close', () => {
	it('is unilateral — one party’s signature moves the tally to closing', async () => {
		const { jan, sam, tally, chit, close } = await trading()
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await expect(stateOf(tally, sam)).resolves.toEqual({ State: 'open' })

		await tally.propose([close('S')])
		for (const party of [jan, sam]) {
			await expect(stateOf(tally, party)).resolves.toEqual({ State: 'closing' })
		}
	})

	it('admits both parties filing, and each of them only once', async () => {
		// The primary key is `Requester`, so the two rows do not collide -- a close is a
		// statement of intent, and both parties may make one.
		const { jan, tally, chit, close } = await trading()
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await tally.propose([close('S')])
		await tally.propose([close('F')])

		await expect(
			tally.sees(jan, 'select Requester from CloseRequest order by Requester'),
		).resolves.toEqual([{ Requester: 'F' }, { Requester: 'S' }])
		await expect(tally.refuses([close('S')])).resolves.toMatch(
			/UNIQUE constraint failed: CloseRequest/,
		)
	})

	it('refuses a close the requesting side did not sign', async () => {
		const { sam, tally, cid } = await trading()
		await expect(
			tally.refuses([
				requestClose({ tallyCid: cid, requester: 'S', date: TODAY, signer: sam.keys[0] }),
			]),
		).resolves.toMatch(/SignerAuthorized/)
	})

	it('refuses a close whose date was altered after signing', async () => {
		const { tally, close } = await trading()
		const forged = close('S')
		await expect(
			tally.refuses([{ ...forged, row: { ...forged.row, Date: '2026-04-01' } }]),
		).resolves.toMatch(/SignatureValid/)
	})

	it('is not the same thing as withdrawing credit, and is immediate where that is not', async () => {
		// Jan can always drop his limit to zero, which freezes growth as closing does. Two
		// things separate them. Withdrawing credit is *restrictive*, so it owes Sam the current
		// 21 days of notice before it binds -- a close binds the moment it is signed. And it is
		// neither terminal nor visible as an intention: the tally stays `open` throughout, and a
		// later revision can put the limit back.
		const { jan, sam, tally, cid, chit } = await trading()
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await tally.propose([
			publishCreditTerms({
				sid: jan.sid,
				tallyCid: cid,
				revision: 2,
				creditLimit: 0,
				callDays: 21,
				date: TODAY,
				effectiveDate: NOTICE_GIVEN,
				signer: jan.keys[0],
			}),
		])
		await expect(stateOf(tally, sam)).resolves.toEqual({ State: 'open' })

		// Inside the notice period the old limit still governs, so Sam may still draw on it.
		await tally.propose([chit({ number: 2, units: 1000, balance: 31000 })])
		// After it, growth is frozen -- by the limit, not by a close.
		await expect(
			tally.refuses([chit({ number: 3, units: 1, date: AFTER_NOTICE, balance: 31001 })]),
		).resolves.toMatch(/WithinCreditLimits/)
		// And the balance stays payable throughout.
		await tally.propose([chit({ number: 3, issuer: 'S', units: 31000, balance: 0 })])
		await expect(stateOf(tally, sam)).resolves.toEqual({ State: 'open' })
	})
})

describe('the closing gate on direct chits', () => {
	it('admits a chit that moves a positive balance toward zero', async () => {
		const { jan, sam, tally, chit, close } = await trading()
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await tally.propose([close('S')])
		await tally.propose([chit({ number: 2, issuer: 'S', units: 12000, balance: 18000 })])

		for (const party of [jan, sam]) {
			await expect(balanceOf(tally, party)).resolves.toEqual({ Balance: 18000 })
		}
	})

	it('refuses a chit that moves it further away', async () => {
		const { tally, chit, close } = await trading()
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await tally.propose([close('S')])
		await expect(
			tally.refuses([chit({ number: 2, units: 5000, balance: 35000 })]),
		).resolves.toMatch(/ClosingReducesBalance/)
	})

	it('refuses a sign-flip overshoot', async () => {
		// +30000 -> -5000 reduces the number but mints 5000 of new credit in the other
		// direction, which is exactly what closing is meant to stop. Hence the same-sign form:
		// a positive balance may only land in [0, prior).
		const { tally, chit, close } = await trading({ samGrants: 50000 })
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await tally.propose([close('S')])
		await expect(
			tally.refuses([chit({ number: 2, issuer: 'S', units: 35000, balance: -5000 })]),
		).resolves.toMatch(/ClosingReducesBalance/)
	})

	it('works the same way when the balance is negative', async () => {
		// The gate is symmetric: whoever holds value can always collect it, regardless of which
		// side asked to close.
		const { tally, chit, close } = await trading({ samGrants: 50000 })
		await tally.propose([chit({ number: 1, issuer: 'S', units: 20000, balance: -20000 })])
		await tally.propose([close('F')])
		await tally.propose([chit({ number: 2, units: 8000, balance: -12000 })])
		await expect(
			tally.refuses([chit({ number: 3, issuer: 'S', units: 5000, balance: -17000 })]),
		).resolves.toMatch(/ClosingReducesBalance/)
	})

	it('reaches closed at an actual settled zero, and stays there', async () => {
		// At a prior balance of zero both arms of the gate are false, so every further direct
		// chit is rejected. "No ledger inserts once closed" needs no constraint of its own --
		// `debt-tally-close-no-reopen`'s terminality falls out of the same predicate.
		// Sam grants credit here only so that `WithinCreditLimits` is not the gate that answers
		// the final chit -- the point is that the *closing* gate rejects it.
		const { jan, sam, tally, chit, close } = await trading({ samGrants: 50000 })
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await tally.propose([close('S')])
		await tally.propose([chit({ number: 2, issuer: 'S', units: 30000, balance: 0 })])

		for (const party of [jan, sam]) {
			await expect(stateOf(tally, party)).resolves.toEqual({ State: 'closed' })
		}
		await expect(
			tally.refuses([chit({ number: 3, issuer: 'S', units: 1, balance: -1 })]),
		).resolves.toMatch(/ClosingReducesBalance/)
	})
})

/**
 * The lift half of the close story. `src/tally/` does not carry a lift surface yet (test/STATUS.md
 * § 10 keeps lifts stubbed), so the pledge row is built here by hand -- the minimum needed to
 * exercise a *close* gate, not the start of a lift API.
 */
function pledge(
	cid: string,
	over: { liftId: string; issuer: 'S' | 'F'; units: number; signer: Party },
): RowWrite {
	const referee = newKey()
	const expiry = '2026-04-01'
	return {
		table: 'PendingLift',
		row: {
			LiftId: over.liftId,
			RefereeKey: referee.publicKey,
			Issuer: over.issuer,
			Units: over.units,
			Date: TODAY,
			Expiry: expiry,
			SignerKey: over.signer.keys[0].publicKey,
			Signature: signText(
				over.signer.keys[0],
				digest(cid, over.liftId, referee.publicKey, over.issuer, over.units, TODAY, expiry),
			),
		},
	}
}

describe('the closing gate on lift pledges', () => {
	it('lets the value be lifted out rather than paid down', async () => {
		// This is the other half of why a unilateral close cannot trap anyone: Sam does not
		// need Jan to pay him, he can route the value away through the graph.
		const { jan, sam, tally, cid, chit, close } = await trading()
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await tally.propose([close('S')])
		await tally.propose([pledge(cid, { liftId: 'lift:1', issuer: 'S', units: 10000, signer: jan })])

		await expect(tally.seesOne(sam, 'select Balance from ReservedBalance')).resolves.toEqual({
			Balance: 20000,
		})
	})

	it('refuses a pledge that grows the reserved balance', async () => {
		const { sam, tally, cid, chit, close } = await trading()
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await tally.propose([close('S')])
		await expect(
			tally.refuses([pledge(cid, { liftId: 'lift:1', issuer: 'F', units: 5000, signer: sam })]),
		).resolves.toMatch(/ClosingReducesReserved/)
	})

	it('holds a settled zero at closing while a pledge is still open', async () => {
		// The load-bearing clause in `CloseState`: without the open-pledge test, this tally
		// would read `closed` and then a later finalize would bump it off zero.
		// Sam grants credit because the settling chit is gated on the *reserved* balance too,
		// and Jan's open pledge leaves that at -10000 once the ledger reaches zero.
		const { jan, tally, cid, chit, close } = await trading({ samGrants: 50000 })
		await tally.propose([chit({ number: 1, units: 30000, balance: 30000 })])
		await tally.propose([close('S')])
		await tally.propose([pledge(cid, { liftId: 'lift:1', issuer: 'S', units: 10000, signer: jan })])
		await tally.propose([chit({ number: 2, issuer: 'S', units: 30000, balance: 0 })])

		await expect(balanceOf(tally, jan)).resolves.toEqual({ Balance: 0 })
		await expect(stateOf(tally, jan)).resolves.toEqual({ State: 'closing' })
	})
})
