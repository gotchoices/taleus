import { digest, signText } from '../store/index.js'
import { chitDelta, issueChit } from './chits.js'
import { TODAY, balanceOf, trading } from './test-harness.js'

/**
 * Direct chits: the ledger and its balance. There is no credit gate (see 'no credit gate').
 *
 * The one convention to hold on to: a chit is signed by the party it makes **worse off**.
 * Issuing raises what you owe or lowers what you are owed, which is why no countersignature
 * is needed. The balance is always the stock party's perspective; `Units` is always positive
 * and direction comes from `Issuer`.
 *
 * The ledger is a set of signed chits keyed by their ids: no running number, no stored running
 * balance. The balance is their sum (`SettledBalance`).
 *
 * The two-party setup lives in `./test-harness.ts` -- Jan is stock and lets Sam owe him 50000.
 */

describe('the balance', () => {
	it('accumulates, and both parties read the same total', async () => {
		const { jan, sam, tally, chit } = await trading()
		await tally.propose([chit({ seq: 1, issuer: 'F', units: 18000 })])
		await tally.propose([chit({ seq: 2, issuer: 'F', units: 9000 })])

		for (const party of [jan, sam]) {
			await expect(balanceOf(tally, party)).resolves.toEqual({ Balance: 27000 })
		}
	})

	it('moves the other way when the other side gives', async () => {
		const { jan, tally, chit } = await trading()
		await tally.propose([chit({ seq: 1, issuer: 'F', units: 18000 })])
		// Jan (stock) hands value back: the stock-perspective balance falls by what he gave.
		await tally.propose([chit({ seq: 2, issuer: 'S', units: 7000 })])
		await expect(balanceOf(tally, jan)).resolves.toEqual({ Balance: 11000 })
	})

	it('states the direction in one place, so no screen re-derives it', () => {
		expect(chitDelta('F', 100)).toBe(100)
		expect(chitDelta('S', 100)).toBe(-100)
	})

	it('does not depend on the order chits arrive in', async () => {
		// A sum: two parties writing at once, or a chit queued offline and sent later, reach the
		// same balance whichever lands first.
		const one = await trading()
		await one.tally.propose([one.chit({ seq: 1, issuer: 'F', units: 18000 })])
		await one.tally.propose([one.chit({ seq: 2, issuer: 'S', units: 7000 })])
		const two = await trading()
		await two.tally.propose([two.chit({ seq: 2, issuer: 'S', units: 7000 })])
		await two.tally.propose([two.chit({ seq: 1, issuer: 'F', units: 18000 })])
		await expect(balanceOf(one.tally, one.jan)).resolves.toEqual({ Balance: 11000 })
		await expect(balanceOf(two.tally, two.jan)).resolves.toEqual({ Balance: 11000 })
	})

	it('takes both parties’ chits at once: neither claims anything the other needs', async () => {
		const { jan, tally, chit } = await trading()
		await tally.propose([chit({ seq: 1, issuer: 'F', units: 18000 }), chit({ seq: 2, issuer: 'S', units: 7000 })])
		await expect(balanceOf(tally, jan)).resolves.toEqual({ Balance: 11000 })
	})

	it('refuses a second chit under the same id: a retried payment is not a second payment', async () => {
		const { tally, chit } = await trading()
		await tally.propose([chit({ seq: 1, issuer: 'F', units: 18000 })])
		await expect(tally.refuses([chit({ seq: 1, issuer: 'F', units: 18000 })])).resolves.toBeTruthy()
	})
})

describe('no credit gate', () => {
	// A chit is the issuer's promise, like a cheque: accepted when duly signed, for any amount.
	// The credit limit says what the other party will extend for goods or services; it is
	// enforced by their declining to deliver, never by refusing the record.
	it('admits a chit inside the limit the other party granted', async () => {
		const { tally, chit } = await trading()
		await expect(
			tally.propose([chit({ seq: 1, issuer: 'F', units: 50000 })]),
		).resolves.toBeUndefined()
	})

	it('admits one that carries the balance past it', async () => {
		const { jan, tally, chit } = await trading()
		await tally.propose([chit({ seq: 1, issuer: 'F', units: 50001 })])
		await expect(balanceOf(tally, jan)).resolves.toEqual({ Balance: 50001 })
	})

	it('admits a promise into credit the other side never extended', async () => {
		const { tally, chit } = await trading()
		// Sam granted nothing; Jan may still promise to pay him.
		await expect(
			tally.propose([chit({ seq: 1, issuer: 'S', units: 1 })]),
		).resolves.toBeUndefined()
	})

	it('admits chits with no terms published at all', async () => {
		const { tally, chit } = await trading({ janGrants: 0, samGrants: 0 })
		await expect(
			tally.propose([chit({ seq: 1, issuer: 'F', units: 1 })]),
		).resolves.toBeUndefined()
	})
})

describe('who may issue a chit', () => {
	it('is signed by the party it makes worse off, and needs no countersignature', async () => {
		const { sam, tally, chit } = await trading()
		await tally.propose([chit({ seq: 1, issuer: 'F', units: 18000 })])
		// One signature, Sam's, and the tally moved. Jan agreed to nothing here.
		await expect(
			tally.seesOne(sam, "select SignerKey from App.Ledger where Id = 'chit:1'"),
		).resolves.toEqual({ SignerKey: sam.keys[0].publicKey })
	})

	it('cannot be signed by the other party', async () => {
		const { jan, sam, tally, cid } = await trading()
		// Jan signing a foil-issued chit: Jan cannot put Sam into debt.
		await expect(
			tally.refuses([
				issueChit({
					tallyCid: cid,
					contractNumber: 1,
					id: 'chit:forged',
					issuer: 'F',
					units: 18000,
					date: TODAY,
					at: `${TODAY}T12:00:00.000Z`,
					signer: jan.keys[0],
					issuerSid: sam.sid,
				}),
			]),
		).resolves.toMatch(/SignerAuthorized/)
	})

	it('cannot carry a signature over different content', async () => {
		const { sam, tally, chit } = await trading()
		const write = chit({ seq: 1, issuer: 'F', units: 18000 })
		// The amount is changed after signing -- the shape of a tampered chit in flight.
		await expect(
			tally.refuses([{ ...write, row: { ...write.row, Units: 40000 } }]),
		).resolves.toMatch(/SignatureValid/)
		expect(sam.keys).toHaveLength(1)
	})

	it('must carry a positive amount; direction comes from the issuer', async () => {
		const { tally, chit } = await trading()
		const write = chit({ seq: 1, issuer: 'F', units: 18000 })
		await expect(
			tally.refuses([{ ...write, row: { ...write.row, Units: -18000 } }]),
		).resolves.toBeTruthy()
	})
})

describe('the date a chit asserts', () => {
	// docs/timestamps.md: the issuer asserts and signs the date. DateMonotonic keeps each party's
	// own chits in date order, so an issuer cannot slot one in before its own latest.
	const dated = (t: Awaited<ReturnType<typeof trading>>, side: 'S' | 'F', seq: number, date: string) =>
		t.chit({ seq, issuer: side, units: 1000, date })

	it('may not reach back before the same issuer’s latest chit', async () => {
		const t = await trading()
		await t.tally.propose([dated(t, 'F', 1, '2026-03-02')])
		await expect(t.tally.refuses([dated(t, 'F', 2, '2026-03-01')])).resolves.toMatch(/DateMonotonic/)
		// The same day is fine; several chits a day is ordinary.
		await expect(t.tally.propose([dated(t, 'F', 2, '2026-03-02')])).resolves.toBeUndefined()
	})

	it('is not held to the other party’s dates, so their activity cannot make it fail', async () => {
		const t = await trading()
		await t.tally.propose([dated(t, 'S', 1, '2026-03-02')])
		await expect(t.tally.propose([dated(t, 'F', 2, '2026-03-01')])).resolves.toBeUndefined()
	})
})

describe('the instant a chit asserts', () => {
	it('must be a UTC instant in the one fixed shape, so its text order is time order', async () => {
		const t = await trading()
		const write = t.chit({ seq: 1, units: 1000 })
		for (const at of ['2026-03-02T12:00:00Z', '2026-03-02T12:00:00.000+01:00', '2026-03-02']) {
			const resigned = t.chit({ seq: 1, units: 1000, at })
			await expect(t.tally.refuses([resigned])).resolves.toBeTruthy()
		}
		await expect(t.tally.propose([write])).resolves.toBeUndefined()
	})

	it('is inside the signature, so it cannot be changed after signing', async () => {
		const t = await trading()
		const write = t.chit({ seq: 1, units: 1000 })
		await expect(
			t.tally.refuses([{ ...write, row: { ...write.row, At: '2026-03-02T23:59:59.999Z' } }]),
		).resolves.toMatch(/SignatureValid/)
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
		await tally.propose([chit({ seq: 1, issuer: 'F', units: 18000 })])
		const row = await tally.seesOne<{ Signature: string }>(
			sam,
			"select Signature from App.Ledger where Id = 'chit:1'",
		)
		// Signed over Sam's own Sid -- the issuer -- not Jan's.
		expect(row?.Signature).toBe(
			signText(sam.keys[0], digest('chit:1', 'F', sam.sid, 18000, TODAY, `${TODAY}T12:00:00.001Z`, '', '', null)),
		)
		expect(cid).toBeTruthy()
	})
})
