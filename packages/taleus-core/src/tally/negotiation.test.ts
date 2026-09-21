import {
	newKey,
} from '../store/index.js'
import type { RowWrite } from '../store/strand.js'
import {
	Tally,
	newInvitation,
	newParty,
	type Party,
} from '../store/test-harness.js'
import { createTally, seatFoil, seatStock, tallyCid } from './formation.js'
import { proposeContract, publishCreditTerms, signContract } from './negotiation.js'

/**
 * Negotiation between two parties, each validating on their own replica.
 *
 * The asymmetry worth holding on to: **credit terms are unilateral** -- a grantor signs
 * alone, because saying how much you are willing to be owed obliges nobody else -- while
 * **a contract is bilateral**, one row carrying both signatures over the same digest.
 * Until it does, there is no tally, only an offer.
 */

const TODAY = '2026-03-02'
const PROTOCOL = 'taleus/1'
const CONTRACT = 'cid:standard-tally-v1'

async function opened() {
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
	return { jan, sam, tally, cid: tallyCid(identity) }
}

/** Each party states what it will let the other owe it. */
async function withTerms(world: Awaited<ReturnType<typeof opened>>, janLimit = 50000, samLimit = 0) {
	await world.tally.propose([
		publishCreditTerms({
			sid: world.jan.sid,
			tallyCid: world.cid,
			revision: 1,
			creditLimit: janLimit,
			callDays: 21,
			date: TODAY,
			effectiveDate: TODAY,
			signer: world.jan.keys[0],
		}),
	])
	await world.tally.propose([
		publishCreditTerms({
			sid: world.sam.sid,
			tallyCid: world.cid,
			revision: 1,
			creditLimit: samLimit,
			callDays: 21,
			date: TODAY,
			effectiveDate: TODAY,
			signer: world.sam.keys[0],
		}),
	])
	return world
}

describe('credit terms are one party’s own statement', () => {
	it('a grantor publishes alone, and the counterparty’s engine accepts it', async () => {
		const { jan, sam, tally, cid } = await opened()
		await tally.propose([
			publishCreditTerms({
				sid: jan.sid,
				tallyCid: cid,
				revision: 1,
				creditLimit: 50000,
				callDays: 21,
				date: TODAY,
				effectiveDate: TODAY,
				signer: jan.keys[0],
			}),
		])
		// Sam never signed it and could not have refused it. What Jan will be owed is Jan's
		// to say; what Sam does about it is to trade or not.
		await expect(
			tally.sees(sam, 'select CreditLimit from CreditTerms where Sid = ?', [jan.sid]),
		).resolves.toEqual([{ CreditLimit: 50000 }])
	})

	it('a party cannot publish terms in the other’s name', async () => {
		const { jan, sam, tally, cid } = await opened()
		await expect(
			tally.refuses([
				publishCreditTerms({
					sid: sam.sid, // claiming to be Sam
					tallyCid: cid,
					revision: 1,
					creditLimit: 999999,
					callDays: 0,
					date: TODAY,
					effectiveDate: TODAY,
					signer: jan.keys[0], // but signing as Jan
				}),
			]),
		).resolves.toMatch(/SignerAuthorized/)
	})

	it('a stranger to the tally cannot publish terms at all', async () => {
		const { tally, cid } = await opened()
		const outsider = newParty('outsider')
		await expect(
			tally.refuses([
				publishCreditTerms({
					sid: outsider.sid,
					tallyCid: cid,
					revision: 1,
					creditLimit: 1,
					callDays: 0,
					date: TODAY,
					effectiveDate: TODAY,
					signer: outsider.keys[0],
				}),
			]),
		).resolves.toMatch(/PartyOfTally/)
	})

	it('a permissive change takes effect at once', async () => {
		const world = await withTerms(await opened())
		const { jan, tally, cid } = world
		// More credit, same notice: nobody is worse off, so there is nothing to wait for.
		await tally.propose([
			publishCreditTerms({
				sid: jan.sid,
				tallyCid: cid,
				revision: 2,
				creditLimit: 80000,
				callDays: 21,
				date: '2026-04-01',
				effectiveDate: '2026-04-01',
				signer: jan.keys[0],
			}),
		])
		await expect(
			tally.sees(world.sam, 'select CreditLimit from CreditTerms where Sid = ? and Revision = 2', [
				jan.sid,
			]),
		).resolves.toEqual([{ CreditLimit: 80000 }])
	})

	it('a restrictive change must wait out the notice already agreed', async () => {
		const { jan, tally, cid } = await withTerms(await opened())
		const cut = (effectiveDate: string) =>
			publishCreditTerms({
				sid: jan.sid,
				tallyCid: cid,
				revision: 2,
				creditLimit: 20000,
				callDays: 21,
				date: '2026-04-01',
				effectiveDate,
				signer: jan.keys[0],
			})

		// Twenty-one days' notice was the promise; twenty is not enough, and same-day is the
		// promise broken outright.
		await expect(tally.refuses([cut('2026-04-01')])).resolves.toMatch(/EffectiveDateValid/)
		await expect(tally.refuses([cut('2026-04-21')])).resolves.toMatch(/EffectiveDateValid/)
		await expect(tally.propose([cut('2026-04-22')])).resolves.toBeUndefined()
	})

	it('shortening the notice period is itself restrictive', async () => {
		const { jan, tally, cid } = await withTerms(await opened())
		// The limit is unchanged, but the runway is shorter -- so it waits like any other
		// reduction. A party cannot quietly make its own next reduction faster.
		await expect(
			tally.refuses([
				publishCreditTerms({
					sid: jan.sid,
					tallyCid: cid,
					revision: 2,
					creditLimit: 50000,
					callDays: 1,
					date: '2026-04-01',
					effectiveDate: '2026-04-01',
					signer: jan.keys[0],
				}),
			]),
		).resolves.toMatch(/EffectiveDateValid/)
	})
})

describe('offering and countersigning', () => {
	const offerFrom = (
		cid: string,
		proposer: 'S' | 'F',
		signer: Party['keys'][0],
		over: { sequenceNumber?: number; stockCreditTermsRevision?: number } = {},
	) =>
		proposeContract({
			tallyCid: cid,
			sequenceNumber: 1,
			contractCid: CONTRACT,
			proposer,
			stockCreditTermsRevision: 1,
			foilCreditTermsRevision: 1,
			signer,
			...over,
		})

	/**
	 * Countersign a standing offer -- reading the terms off the proposal row itself, which is
	 * what a real accepter does. It holds only its own key; the proposer's signature over the
	 * contract digest travelled in the offer.
	 */
	const acceptOf = (cid: string, offer: RowWrite, accepter: Party['keys'][0]) =>
		signContract({
			tallyCid: cid,
			number: offer.row.SequenceNumber as number,
			contractCid: offer.row.ContractCid as string,
			stockCreditTermsRevision: offer.row.StockCreditTermsRevision as number,
			foilCreditTermsRevision: offer.row.FoilCreditTermsRevision as number,
			denomination: offer.row.Denomination as string,
			denominationScale: offer.row.DenominationScale as number,
			proposer: offer.row.Proposer as 'S' | 'F',
			proposerSignerKey: offer.row.SignerKey as string,
			proposerSignature: offer.row.ContractSignature as string,
			accepter,
		})

	it('FINDING: there is no counter-offer — one proposal row exists, ever', async () => {
		const { jan, sam, tally, cid } = await withTerms(await opened())
		await tally.propose([offerFrom(cid, 'S', jan.keys[0])])

		// `docs/architecture.md` describes offers with identity, ordering and expiry, several
		// outstanding at once, and the later-drafted one governing when two end up signed.
		// `TallyContractProposal` is `primary key (/* 1 row */)` with constraints `on insert,
		// update`: one row, replaced in place. So Sam cannot counter without destroying Jan's
		// offer, there is no history of what was offered, and nothing expires.
		//
		// This is `feat-offer-lifecycle`, and it is the MyCHIPs signing dance the reboot left
		// implicit. Demonstrated here rather than described.
		await expect(
			tally.refuses([offerFrom(cid, 'F', sam.keys[0], { sequenceNumber: 2 })]),
		).resolves.toMatch(
			/UNIQUE constraint failed: TallyContractProposal/,
		)
	})

	it('an offer states both sides’ terms, so it is a complete proposition', async () => {
		const { jan, sam, tally, cid } = await withTerms(await opened())
		await tally.propose([offerFrom(cid, 'S', jan.keys[0])])

		// Sam sees exactly what he would be agreeing to, both halves of it.
		await expect(
			tally.seesOne(sam, 'select Proposer, StockCreditTermsRevision, FoilCreditTermsRevision from TallyContractProposal'),
		).resolves.toEqual({ Proposer: 'S', StockCreditTermsRevision: 1, FoilCreditTermsRevision: 1 })
	})

	it('an offer must be signed by the side it claims to come from', async () => {
		const { sam, tally, cid } = await withTerms(await opened())
		// Sam signing an offer marked as the stock side's.
		await expect(tally.refuses([offerFrom(cid, 'S', sam.keys[0])])).resolves.toMatch(
			/SignerAuthorized/,
		)
	})

	it('countersigning makes a tally: one row, both signatures', async () => {
		const { jan, sam, tally, cid } = await withTerms(await opened())
		const offer = offerFrom(cid, 'S', jan.keys[0])
		await tally.propose([offer])
		await tally.propose([acceptOf(cid, offer, sam.keys[0])])

		for (const party of [jan, sam]) {
			await expect(
				tally.seesOne(party, 'select Number, ContractCid from TallyContract'),
			).resolves.toEqual({ Number: 1, ContractCid: CONTRACT })
		}
	})

	it('one signature is not a tally', async () => {
		const { jan, tally, cid } = await withTerms(await opened())
		const offer = offerFrom(cid, 'S', jan.keys[0])
		await tally.propose([offer])
		// Jan accepts his own offer. The foil signature is his, over the right digest, with a
		// key that is simply not Sam's -- which is the whole check.
		await expect(tally.refuses([acceptOf(cid, offer, jan.keys[0])])).resolves.toMatch(
			/FoilSignerAuthorized/,
		)
	})

	it('the accepter cannot alter what the proposer signed up to', async () => {
		// The proposer's signature travels in the offer, which is the only way a two-party
		// contract can be assembled at all -- the accepter does not hold their key. Handing it
		// over is safe because it covers every field: swap the contract document and the
		// relayed signature stops verifying.
		const { jan, sam, tally, cid } = await withTerms(await opened())
		const offer = offerFrom(cid, 'S', jan.keys[0])
		await tally.propose([offer])
		const tampered = acceptOf(cid, offer, sam.keys[0])
		await expect(
			tally.refuses([
				{ ...tampered, row: { ...tampered.row, ContractCid: 'cid:something-else' } },
			]),
		).resolves.toMatch(/StockSignatureValid/)
	})

	it('a contract cannot lock terms revisions that were never published', async () => {
		const { jan, sam, tally, cid } = await withTerms(await opened())
		// Nothing stops the *offer* naming a revision that does not exist -- the proposal has no
		// existence check. It is the contract that refuses to lock it.
		const offer = offerFrom(cid, 'S', jan.keys[0], { stockCreditTermsRevision: 7 })
		await tally.propose([offer])
		await expect(tally.refuses([acceptOf(cid, offer, sam.keys[0])])).resolves.toMatch(
			/StockTermsExist/,
		)
	})

	it('a key revoked before countersigning cannot complete the contract', async () => {
		const { jan, sam, tally, cid } = await withTerms(await opened())
		const tablet = newKey()
		await tally.propose([
			{
				table: 'PartyKey',
				row: {
					Sid: sam.sid,
					Revision: 2,
					PublicKey: tablet.publicKey,
					AuthKey: sam.keys[0].publicKey,
					Signature: (await import('../store/index.js')).signText(
						sam.keys[0],
						(await import('../store/index.js')).digest(
							sam.sid,
							2,
							tablet.publicKey,
							sam.keys[0].publicKey,
						),
					),
				},
			},
		])
		const { revokeKey } = await import('./keys.js')
		await tally.propose([revokeKey({ sid: sam.sid, publicKey: tablet.publicKey, by: sam.keys[0] })])

		const offer = offerFrom(cid, 'S', jan.keys[0])
		await tally.propose([offer])
		// The stolen tablet countersigns. Both engines refuse: authority is checked when the
		// row is written, not when the key was issued.
		await expect(tally.refuses([acceptOf(cid, offer, tablet)])).resolves.toMatch(
			/FoilSignerAuthorized/,
		)
	})
})

describe('the denomination', () => {
	it('accepts the three namespaces and nothing else', async () => {
		const { jan, tally, cid } = await withTerms(await opened())
		const offer = (denomination: string) =>
			proposeContract({
				tallyCid: cid,
				sequenceNumber: 1,
				contractCid: CONTRACT,
				proposer: 'S',
				stockCreditTermsRevision: 1,
				foilCreditTermsRevision: 1,
				denomination,
				denominationScale: 2,
				signer: jan.keys[0],
			})

		// One proposal row exists at a time (see the FINDING above), so each acceptable
		// denomination gets its own freshly-opened tally rather than a second row here.
		await expect(tally.propose([offer('CHIP')])).resolves.toBeUndefined()
		for (const good of ['iso4217:USD', 'cid:bafy-dave-hours']) {
			const world = await withTerms(await opened())
			await expect(
				world.tally.propose([
					proposeContract({
						tallyCid: world.cid,
						sequenceNumber: 1,
						contractCid: CONTRACT,
						proposer: 'S',
						stockCreditTermsRevision: 1,
						foilCreditTermsRevision: 1,
						denomination: good,
						denominationScale: 2,
						signer: world.jan.keys[0],
					}),
				]),
			).resolves.toBeUndefined()
		}
		// Shape only -- a private or future code passes; a malformed one does not. These are
		// refused before the primary key is ever reached.
		for (const bad of ['iso4217:usd', 'iso4217:US', 'iso4217:USDX', 'cid:', 'dollars', '']) {
			const world = await withTerms(await opened())
			await expect(
				world.tally.refuses([
					proposeContract({
						tallyCid: world.cid,
						sequenceNumber: 1,
						contractCid: CONTRACT,
						proposer: 'S',
						stockCreditTermsRevision: 1,
						foilCreditTermsRevision: 1,
						denomination: bad,
						denominationScale: 2,
						signer: world.jan.keys[0],
					}),
				]),
			).resolves.toMatch(/validdenomination/i)
		}
	})
})
