import { offerableAgreements, TALLY_CONTRACTS } from './agreements.js'
import { ContractLibrary, type Fetch } from './library.js'
import { testContract } from './test-contract.js'

const CONTRACT = await testContract()
const [AGREEMENT, CLAUSE] = CONTRACT.documents

/** A publisher at `docs.test`: its catalog and its documents. */
const publisher: Fetch = async url => {
	if (url === 'https://docs.test/.well-known/stroc/catalog.json') {
		return new Response(
			JSON.stringify({
				'stroc-catalog': '1.1',
				domain: 'docs.test',
				entries: [
					{ cid: AGREEMENT.cid, title: CONTRACT.title, role: 'author', status: 'current', collections: [TALLY_CONTRACTS] },
					{ cid: CLAUSE.cid, title: 'Closing', role: 'author', status: 'current' },
					{ cid: 'baguqeeraolderversionolderversionolderversionolderversionaa', role: 'author', status: 'superseded', collections: [TALLY_CONTRACTS] },
				],
			}),
		)
	}
	const cid = /\/ipfs\/([^?]+)/.exec(url)?.[1]
	const document = CONTRACT.documents.find(d => d.cid === cid)
	return document ? new Response(document.json) : new Response('not found', { status: 404 })
}

describe('the agreements a party can offer', () => {
	it("are the current entries of each source's tally-contracts collection -- not its clauses", async () => {
		const library = new ContractLibrary({ sources: () => ['docs.test'], fetch: publisher })
		expect(await offerableAgreements(library, ['docs.test'], publisher)).toEqual([
			{ id: AGREEMENT.cid, title: CONTRACT.title, publisher: 'test.invalid', language: 'en' },
		])
	})

	it('skips a source whose catalog cannot be read', async () => {
		const library = new ContractLibrary({ sources: () => [] })
		const down: Fetch = async () => new Response('', { status: 503 })
		expect(await offerableAgreements(library, ['down.test'], down)).toEqual([])
	})
})
