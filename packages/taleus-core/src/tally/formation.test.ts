import {
	digest,
	newKey,
	signText,
} from '../store/index.js'
import {
	DisagreementError,
	Tally,
	newInvitation,
	newParty,
	type Party,
} from '../store/test-harness.js'
import { createTally, genesisKey, seatFoil, seatStock, tallyCid } from './formation.js'

/**
 * Formation, with two parties who each hold their own replica.
 *
 * Nothing here inserts a row into "the database". Jan proposes; Sam's engine re-validates
 * against its own copy of the schema; the row stands only if both accept. That is the real
 * safety model -- the counterparty's engine is what stops a forgery -- and a test that used
 * one shared database would be testing a system nobody is going to run.
 */

const TODAY = '2026-03-02'
const PROTOCOL = 'taleus/1'

/** Jan invites Sam over lunch and both take their seats. */
async function seated() {
	const jan = newParty('jan')
	const sam = newParty('sam')
	const invitation = newInvitation()
	const tally = await Tally.open([jan, sam])

	await tally.propose(seatStock({ sid: jan.sid, genesis: jan.keys[0], invitation }))
	await tally.propose(seatFoil({ sid: sam.sid, genesis: sam.keys[0], invitation }))
	return { jan, sam, invitation, tally }
}

describe('seating two parties', () => {
	it('seats the inviter and the invitee, and both replicas agree', async () => {
		const { jan, sam, tally } = await seated()

		// Each party's own engine accepted both seats, independently.
		for (const party of [jan, sam]) {
			await expect(tally.sees(party, 'select Sid from Stock')).resolves.toEqual([{ Sid: jan.sid }])
			await expect(tally.sees(party, 'select Sid from Foil')).resolves.toEqual([{ Sid: sam.sid }])
			await expect(
				tally.sees(party, 'select Sid from AuthorizedKey order by Sid'),
			).resolves.toHaveLength(2)
		}
	})

	it('cannot seat a party one row at a time', async () => {
		// The circularity is the point: Stock.SignerAuthorized needs the PartyKey, and the
		// genesis PartyKey signature validates against Stock.InvitationKey. Neither row can
		// go in alone, and only a transaction whose subquery CHECKs defer to COMMIT seats
		// anybody at all.
		const jan = newParty('jan')
		const invitation = newInvitation()
		const tally = await Tally.open([jan])
		const [stockRow, keyRow] = seatStock({ sid: jan.sid, genesis: jan.keys[0], invitation })

		// The Stock row alone has no authorized signer; the key alone has no invitation key
		// to validate its genesis signature against.
		await expect(tally.refuses([stockRow])).resolves.toMatch(/SignerAuthorized/)
		await expect(tally.refuses([keyRow])).resolves.toMatch(/SignatureValid/)
		await expect(tally.propose([stockRow, keyRow])).resolves.toBeUndefined()
	})

	it('refuses an invitee who does not hold the invitation', async () => {
		const jan = newParty('jan')
		const mallory = newParty('mallory')
		const invitation = newInvitation()
		const tally = await Tally.open([jan, mallory])
		await tally.propose(seatStock({ sid: jan.sid, genesis: jan.keys[0], invitation }))

		// Mallory has her own key pair but not the invitation secret, so she signs the Foil
		// row with what she does have. Nothing ties her to this strand, and both engines say so.
		const forged = newInvitation()
		const reason = await tally.refuses(
			seatFoil({ sid: mallory.sid, genesis: mallory.keys[0], invitation: forged }),
		)
		expect(reason).toMatch(/InvitationSignatureValid/)
		await expect(tally.sees(jan, 'select Sid from Foil')).resolves.toEqual([])
	})

	it('refuses a genesis key that authorizes itself', async () => {
		const jan = newParty('jan')
		const invitation = newInvitation()
		const tally = await Tally.open([jan])

		// Signing the genesis row with the genesis key would mint authority from nothing.
		const selfSigned = genesisKey(jan.sid, jan.keys[0], {
			publicKey: jan.keys[0].publicKey,
			secretKey: jan.keys[0].secretKey,
		})
		const [stockRow] = seatStock({ sid: jan.sid, genesis: jan.keys[0], invitation })
		await expect(tally.refuses([stockRow, selfSigned])).resolves.toMatch(/SignatureValid/)
	})

	it('refuses a second responder to the same invitation', async () => {
		const { sam, invitation, tally } = await seated()
		const second = newParty('second')
		// `second` even holds the invitation secret -- a leaked invitation. Note *which* rule
		// stops them: not a "one responder" rule on Foil, but TwoParties on PartyKey, because
		// a second responder is necessarily a third Sid. Foil's primary key is (Sid), so it is
		// not a singleton the way Stock is; the protection is real but indirect.
		await expect(
			tally.refuses(seatFoil({ sid: second.sid, genesis: second.keys[0], invitation })),
		).resolves.toMatch(/TwoParties/)
		await expect(tally.sees(sam, 'select Sid from Foil')).resolves.toEqual([{ Sid: sam.sid }])
	})

	it('never admits a third party', async () => {
		const { invitation, tally } = await seated()
		const third = newParty('third')
		await expect(tally.refuses([genesisKey(third.sid, third.keys[0], invitation)])).resolves.toMatch(
			/TwoParties/,
		)
	})
})

describe('naming the tally', () => {
	it('is created by the inviter once both are seated', async () => {
		const { jan, sam, tally } = await seated()
		await tally.propose(
			createTally({
				stockSid: jan.sid,
				foilSid: sam.sid,
				protocolVersion: PROTOCOL,
				createdAt: TODAY,
				signer: jan.keys[0],
			}),
		)

		const expected = tallyCid({
			stockSid: jan.sid,
			foilSid: sam.sid,
			protocolVersion: PROTOCOL,
			createdAt: TODAY,
		})
		// Both parties compute the same identity from the same founding fields.
		for (const party of [jan, sam]) {
			await expect(tally.sees(party, 'select Cid from TallyCore')).resolves.toEqual([
				{ Cid: expected },
			])
		}
	})

	it('cannot be named before the invitee has seated', async () => {
		const jan = newParty('jan')
		const sam = newParty('sam')
		const invitation = newInvitation()
		const tally = await Tally.open([jan, sam])
		await tally.propose(seatStock({ sid: jan.sid, genesis: jan.keys[0], invitation }))

		// There is no tally until somebody answers. The identity cannot be minted against a
		// counterparty who never seated.
		await expect(
			tally.refuses(
				createTally({
					stockSid: jan.sid,
					foilSid: sam.sid,
					protocolVersion: PROTOCOL,
					createdAt: TODAY,
					signer: jan.keys[0],
				}),
			),
		).resolves.toMatch(/FoilSeated/)
	})

	it('refuses a Cid that does not address its own founding fields', async () => {
		const { jan, sam, tally } = await seated()
		const [write] = createTally({
			stockSid: jan.sid,
			foilSid: sam.sid,
			protocolVersion: PROTOCOL,
			createdAt: TODAY,
			signer: jan.keys[0],
		})
		await expect(
			tally.refuses([{ ...write, row: { ...write.row, Cid: digest('something', 'else') } }]),
		).resolves.toMatch(/CidCorrect/)
	})

	it('refuses the invitee naming the tally', async () => {
		const { jan, sam, tally } = await seated()
		// The initiator creates the identity; SignerKey resolves against the STOCK party's set.
		const identity = {
			stockSid: jan.sid,
			foilSid: sam.sid,
			protocolVersion: PROTOCOL,
			createdAt: TODAY,
		}
		const cid = tallyCid(identity)
		await expect(
			tally.refuses([
				{
					table: 'TallyCore',
					row: {
						Cid: cid,
						StockSid: identity.stockSid,
						FoilSid: identity.foilSid,
						ProtocolVersion: identity.protocolVersion,
						CreatedAt: identity.createdAt,
						SignerKey: sam.keys[0].publicKey,
						Signature: signText(sam.keys[0], cid),
					},
				},
			]),
		).resolves.toMatch(/SignerAuthorized/)
	})
})

describe('a party whose node accepted what the counterparty refuses', () => {
	it('is a disagreement, not a silent divergence', async () => {
		const { jan, sam, tally } = await seated()

		// Jan's node has admitted a key add nobody authorized -- the shape of a compromised
		// or buggy node. Sam's engine has no reason to accept it.
		const rogue = newKey()
		const sidOf = (p: Party) => p.sid
		await tally.onlyOn(jan, [
			{
				table: 'PartyKey',
				row: {
					Sid: sidOf(jan),
					Revision: 2,
					PublicKey: rogue.publicKey,
					AuthKey: jan.keys[0].publicKey,
					Signature: signText(jan.keys[0], digest(sidOf(jan), 2, rogue.publicKey, jan.keys[0].publicKey)),
				},
			},
		])

		// The replicas now differ, and the harness says so rather than papering over it.
		await expect(tally.sees(jan, 'select PublicKey from AuthorizedKey')).resolves.toHaveLength(3)
		await expect(tally.sees(sam, 'select PublicKey from AuthorizedKey')).resolves.toHaveLength(2)
	})

	it('surfaces as DisagreementError when only one replica accepts an act', async () => {
		const { sam, tally } = await seated()
		// Sam's replica alone learns of a key; the next act that depends on it is accepted by
		// Sam and refused by Jan, which is precisely what must never pass silently.
		const extra = newKey()
		const add = {
			table: 'PartyKey',
			row: {
				Sid: sam.sid,
				Revision: 2,
				PublicKey: extra.publicKey,
				AuthKey: sam.keys[0].publicKey,
				Signature: signText(sam.keys[0], digest(sam.sid, 2, extra.publicKey, sam.keys[0].publicKey)),
			},
		}
		await tally.onlyOn(sam, [add])
		await expect(tally.propose([add])).rejects.toBeInstanceOf(DisagreementError)
	})
})
