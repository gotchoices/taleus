import { digest, signText } from '../store/index.js'
import { chitDelta, issueChit } from './chits.js'
import { publishCreditTerms } from './negotiation.js'
import { TODAY, balanceOf, trading } from './test-harness.js'

/**
 * Direct chits: the ledger, the balance chain, and the credit gate.
 *
 * The one convention to hold on to: a chit is signed by the party it makes **worse off**.
 * Issuing raises what you owe or lowers what you are owed, which is why no countersignature
 * is needed -- and what the issuer consumes is credit the *other* party granted. `Balance` is
 * always the stock party's perspective; `Units` is always positive and direction comes from
 * `Issuer`.
 *
 * The two-party setup lives in `./test-harness.ts` -- Jan is stock and lets Sam owe him 50000.
 */

describe('the balance chain', () => {
	it('accumulates, and both parties read the same running total', async () => {
		const { jan, sam, tally, chit } = await trading()
		await tally.propose([chit({ number: 1, issuer: 'F', units: 18000, balance: 18000 })])
		await tally.propose([chit({ number: 2, issuer: 'F', units: 9000, balance: 27000 })])

		for (const party of [jan, sam]) {
			await expect(balanceOf(tally, party)).resolves.toEqual({ Balance: 27000 })
		}
	})

	it('rejects a balance that is only the chit’s own delta', async () => {
		// This is the bug `BalanceCorrect` had: `where Number = Number - 1` compared the
		// subquery's own column to itself, matched nothing, and made every chit's Balance its
		// own delta. The chain did not chain -- and the credit gate, which reads it, became
		// per-chit rather than cumulative.
		const { tally, chit } = await trading()
		await tally.propose([chit({ number: 1, issuer: 'F', units: 18000, balance: 18000 })])
		await expect(
			tally.refuses([chit({ number: 2, issuer: 'F', units: 9000, balance: 9000 })]),
		).resolves.toMatch(/BalanceCorrect/)
	})

	it('moves the other way when the other side gives', async () => {
		const { jan, tally, chit } = await trading()
		await tally.propose([chit({ number: 1, issuer: 'F', units: 18000, balance: 18000 })])
		// Jan (stock) hands value back: the stock-perspective balance falls by what he gave.
		await tally.propose([chit({ number: 2, issuer: 'S', units: 7000, balance: 11000 })])
		await expect(balanceOf(tally, jan)).resolves.toEqual({ Balance: 11000 })
	})

	it('states the direction in one place, so no screen re-derives it', () => {
		expect(chitDelta('F', 100)).toBe(100)
		expect(chitDelta('S', 100)).toBe(-100)
	})

	it('refuses a wrong arithmetic result in either direction', async () => {
		const { tally, chit } = await trading()
		await tally.propose([chit({ number: 1, issuer: 'F', units: 18000, balance: 18000 })])
		await expect(
			tally.refuses([chit({ number: 2, issuer: 'S', units: 7000, balance: 25000 })]),
		).resolves.toMatch(/BalanceCorrect/)
	})
})

describe('the credit gate', () => {
	it('admits a chit inside the limit the other party granted', async () => {
		const { tally, chit } = await trading()
		await expect(
			tally.propose([chit({ number: 1, issuer: 'F', units: 50000, balance: 50000 })]),
		).resolves.toBeUndefined()
	})

	it('refuses one that would carry the balance past it', async () => {
		const { tally, chit } = await trading()
		await expect(
			tally.refuses([chit({ number: 1, issuer: 'F', units: 50001, balance: 50001 })]),
		).resolves.toMatch(/WithinCreditLimits/)
	})

	it('is cumulative, not per chit', async () => {
		// The consequence of the chain bug: with the balance frozen at each chit's own delta,
		// a party could pass any limit by issuing enough small chits.
		const { tally, chit } = await trading()
		await tally.propose([chit({ number: 1, issuer: 'F', units: 30000, balance: 30000 })])
		await expect(
			tally.refuses([chit({ number: 2, issuer: 'F', units: 30000, balance: 60000 })]),
		).resolves.toMatch(/WithinCreditLimits/)
	})

	it('binds each side separately: Sam granted nothing, so Jan may owe nothing', async () => {
		const { tally, chit } = await trading()
		// Jan issuing drives the balance negative -- into credit Sam has not extended.
		await expect(
			tally.refuses([chit({ number: 1, issuer: 'S', units: 1, balance: -1 })]),
		).resolves.toMatch(/WithinCreditLimits/)
	})

	it('with no terms published at all, nothing may be owed', async () => {
		const { tally, chit } = await trading({ janGrants: 0, samGrants: 0 })
		await expect(
			tally.refuses([chit({ number: 1, issuer: 'F', units: 1, balance: 1 })]),
		).resolves.toMatch(/WithinCreditLimits/)
	})
})

describe('who may issue a chit', () => {
	it('is signed by the party it makes worse off, and needs no countersignature', async () => {
		const { sam, tally, chit } = await trading()
		await tally.propose([chit({ number: 1, issuer: 'F', units: 18000, balance: 18000 })])
		// One signature, Sam's, and the tally moved. Jan agreed to nothing here.
		await expect(
			tally.seesOne(sam, 'select SignerKey from Ledger where Number = 1'),
		).resolves.toEqual({ SignerKey: sam.keys[0].publicKey })
	})

	it('cannot be signed by the other party', async () => {
		const { jan, sam, tally, cid } = await trading()
		// Jan signing a foil-issued chit: Jan cannot put Sam into debt.
		await expect(
			tally.refuses([
				issueChit({
					tallyCid: cid,
					number: 1,
					contractNumber: 1,
					id: 'chit:forged',
					issuer: 'F',
					units: 18000,
					date: TODAY,
					balance: 18000,
					signer: jan.keys[0],
					issuerSid: sam.sid,
				}),
			]),
		).resolves.toMatch(/SignerAuthorized/)
	})

	it('cannot carry a signature over different content', async () => {
		const { sam, tally, chit } = await trading()
		const write = chit({ number: 1, issuer: 'F', units: 18000, balance: 18000 })
		// The amount is changed after signing -- the shape of a tampered chit in flight.
		await expect(
			tally.refuses([{ ...write, row: { ...write.row, Units: 40000, Balance: 40000 } }]),
		).resolves.toMatch(/SignatureValid/)
		expect(sam.keys).toHaveLength(1)
	})

	it('must carry a positive amount; direction comes from the issuer', async () => {
		const { tally, chit } = await trading()
		const write = chit({ number: 1, issuer: 'F', units: 18000, balance: 18000 })
		await expect(
			tally.refuses([{ ...write, row: { ...write.row, Units: -18000, Balance: -18000 } }]),
		).resolves.toBeTruthy()
	})
})

describe('the date a chit asserts', () => {
	it('may not reach back before the chit before it', async () => {
		// docs/timestamps.md: the issuer asserts and signs the date, and the credit gate reads
		// the limit effective as of it. DateMonotonic is what bounds how far back that reach
		// goes -- on an active tally, to the gap since the last chit.
		const { tally, cid, sam } = await trading()
		const at = (number: number, date: string, balance: number) =>
			issueChit({
				tallyCid: cid,
				number,
				contractNumber: 1,
				id: `chit:${number}`,
				issuer: 'F',
				units: 1000,
				date,
				balance,
				signer: sam.keys[0],
				issuerSid: sam.sid,
			})
		await tally.propose([at(1, '2026-03-02', 1000)])
		await expect(tally.refuses([at(2, '2026-03-01', 2000)])).resolves.toMatch(/DateMonotonic/)
		// The same day is fine; several chits a day is ordinary.
		await expect(tally.propose([at(2, '2026-03-02', 2000)])).resolves.toBeUndefined()
	})

	it('selects the credit epoch, which is why reaching back matters', async () => {
		const { jan, sam, tally, cid } = await trading()
		// Jan cuts his limit to 20000, effective after the 21 days he promised.
		await tally.propose([
			publishCreditTerms({
				sid: jan.sid,
				tallyCid: cid,
				revision: 2,
				creditLimit: 20000,
				callDays: 21,
				date: '2026-04-01',
				effectiveDate: '2026-04-22',
				signer: jan.keys[0],
			}),
		])
		const at = (number: number, date: string, units: number, balance: number) =>
			issueChit({
				tallyCid: cid,
				number,
				contractNumber: 1,
				id: `chit:${number}`,
				issuer: 'F',
				units,
				date,
				balance,
				signer: sam.keys[0],
				issuerSid: sam.sid,
			})

		// Before the cut bites, the old limit governs.
		await expect(tally.propose([at(1, '2026-04-21', 40000, 40000)])).resolves.toBeUndefined()
		// After it, the new one does.
		await expect(tally.refuses([at(2, '2026-04-22', 1, 40001)])).resolves.toMatch(
			/WithinCreditLimits/,
		)
	})
})

describe('what a chit is signed over', () => {
	it('FINDING: the digest names the issuer, under an alias saying recipient', async () => {
		// `Ledger.SignatureValid` computes
		//   (select case when Issuer = 'F' then FoilSid else StockSid end RecipientSid ...)
		// -- which yields the FOIL's Sid for a foil-issued chit, i.e. the issuer's own, while
		// the alias calls it the recipient. Cryptographically harmless: both sides compute the
		// same thing. But the name is a trap for anyone writing a second implementation from
		// the schema, which is exactly how signature divergence happens. Recorded, not changed.
		const { sam, tally, cid, chit } = await trading()
		await tally.propose([chit({ number: 1, issuer: 'F', units: 18000, balance: 18000 })])
		const row = await tally.seesOne<{ Signature: string }>(
			sam,
			'select Signature from Ledger where Number = 1',
		)
		// Signed over Sam's own Sid -- the issuer -- not Jan's.
		expect(row?.Signature).toBe(
			signText(sam.keys[0], digest('chit:1', 'F', sam.sid, 18000, TODAY, '', '', null)),
		)
		expect(cid).toBeTruthy()
	})
})
