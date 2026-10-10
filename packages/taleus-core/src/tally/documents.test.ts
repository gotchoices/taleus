import { Tally, newInvitation, newParty } from '../store/test-harness.js'
import { storeDocument } from './documents.js'
import { createTally, seatFoil, seatStock, tallyCid } from './formation.js'
import { proposeContract, publishCreditTerms } from './negotiation.js'
import { CONTRACT_DOCUMENT } from './test-harness.js'

/**
 * The documents a tally's contracts are made of travel in the tally (`Document`), so the
 * counterparty reads a contract from the tally itself rather than from wherever it was published.
 */

const TODAY = '2026-03-02'

async function established() {
	const jan = newParty('jan')
	const sam = newParty('sam')
	const invitation = newInvitation()
	const tally = await Tally.open([jan, sam])
	await tally.propose(seatStock({ sid: jan.sid, genesis: jan.keys[0], invitation }))
	await tally.propose(seatFoil({ sid: sam.sid, genesis: sam.keys[0], invitation }))
	const identity = { stockSid: jan.sid, foilSid: sam.sid, protocolVersion: 'taleus/1', createdAt: TODAY }
	await tally.propose(createTally({ ...identity, signer: jan.keys[0] }))
	const cid = tallyCid(identity)
	for (const party of [jan, sam]) {
		await tally.propose([
			publishCreditTerms({
				sid: party.sid,
				tallyCid: cid,
				revision: 1,
				creditLimit: 0,
				callDays: 21,
				date: TODAY,
				effectiveDate: TODAY,
				signer: party.keys[0],
			}),
		])
	}
	const offer = () =>
		proposeContract({
			tallyCid: cid,
			sequenceNumber: 1,
			contractCid: CONTRACT_DOCUMENT.cid,
			proposer: 'S',
			stockCreditTermsRevision: 1,
			foilCreditTermsRevision: 1,
			signer: jan.keys[0],
		})
	return { tally, jan, offer }
}

describe('contract documents in the tally', () => {
	it('an offer stores its contract with it, in one act', async () => {
		const { tally, offer } = await established()
		await expect(tally.propose([storeDocument(CONTRACT_DOCUMENT), offer()])).resolves.toBeUndefined()
	})

	it('refuses an offer whose contract the tally does not hold', async () => {
		const { tally, offer } = await established()
		await expect(tally.refuses([offer()])).resolves.toMatch(/ContractStored/)
	})

	it('keeps a document already held, whoever stores it again', async () => {
		const { tally } = await established()
		await tally.propose([storeDocument(CONTRACT_DOCUMENT)])
		await expect(tally.propose([storeDocument(CONTRACT_DOCUMENT)])).resolves.toBeUndefined()
	})

	it('files only Stroc CIDs', async () => {
		const { tally, jan } = await established()
		const malformed = { Cid: 'cid:standard-tally-v1', Json: CONTRACT_DOCUMENT.json }
		await expect(tally.refuses([{ table: 'Document', row: malformed }])).resolves.toMatch(/CidFormat/)
		// Stored "if absent", a document the schema refuses is left out rather than failing the act.
		await tally.propose([{ table: 'Document', row: malformed, ifAbsent: true }])
		await expect(tally.sees(jan, 'select Cid from App.Document')).resolves.toEqual([])
	})

	it('never changes or drops a document', async () => {
		const { tally } = await established()
		await tally.propose([storeDocument(CONTRACT_DOCUMENT)])
		await expect(
			tally.refuses([{ table: 'Document', row: { Cid: CONTRACT_DOCUMENT.cid, Json: '{}' } }]),
		).resolves.toMatch(/UNIQUE|PRIMARY|constraint/i)
	})
})
