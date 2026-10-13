import { ContractLibrary, MemoryDocumentCache, type Fetch } from './library.js'
import { offline, testContract } from '../testing/index.js'

/**
 * The library's one guarantee: a document is used only if its bytes are the document its CID
 * names, wherever it came from.
 */

const CONTRACT = await testContract()
const [AGREEMENT, CLAUSE] = CONTRACT.documents

/** A `fetch` serving `documents` as a Stroc server does (`/ipfs/<cid>`), counting requests. */
function server(documents: Record<string, string>) {
	const requests: string[] = []
	const fetch: Fetch = async url => {
		requests.push(url)
		const cid = /\/ipfs\/([^?]+)/.exec(url)?.[1] ?? ''
		const body = documents[cid]
		return body === undefined ? new Response('not found', { status: 404 }) : new Response(body)
	}
	return { fetch, requests }
}

describe('the contract library', () => {
	it('gathers a contract and everything it includes', async () => {
		const library = new ContractLibrary({ sources: () => [], cache: CONTRACT.cache() })
		const gathered = await library.gather(CONTRACT.cid)
		expect(gathered.missing).toEqual([])
		expect(gathered.documents.map(d => d.cid).sort()).toEqual([AGREEMENT.cid, CLAUSE.cid].sort())
	})

	it('reports a contract with a part missing as missing that part', async () => {
		const cache = new MemoryDocumentCache()
		await cache.put(AGREEMENT)
		const library = new ContractLibrary({ sources: () => [], cache, fetch: offline })
		expect(await library.gather(CONTRACT.cid)).toEqual({ documents: [AGREEMENT], missing: [CLAUSE.cid] })
	})

	it('never uses a copy that is not the document its CID names', async () => {
		const cache = new MemoryDocumentCache()
		await cache.put({ cid: CLAUSE.cid, json: CLAUSE.json.replace('settled', 'forgiven') })
		const library = new ContractLibrary({ sources: () => [], cache, fetch: offline })
		expect(await library.document(CLAUSE.cid)).toBeUndefined()
	})

	it('fetches what it lacks from a source, verifies it, and keeps it', async () => {
		const { fetch, requests } = server({ [AGREEMENT.cid]: AGREEMENT.json, [CLAUSE.cid]: CLAUSE.json })
		const cache = new MemoryDocumentCache()
		const library = new ContractLibrary({ sources: () => ['docs.test'], cache, fetch })
		expect((await library.gather(CONTRACT.cid)).missing).toEqual([])
		expect(requests[0]).toMatch(new RegExp(`^https://docs\\.test/ipfs/${AGREEMENT.cid}`))
		expect(await cache.get(CLAUSE.cid)).toBe(CLAUSE.json)
	})

	it('refuses what a source serves under the wrong CID', async () => {
		const { fetch } = server({ [CLAUSE.cid]: AGREEMENT.json })
		const library = new ContractLibrary({ sources: () => ['docs.test'], fetch })
		expect(await library.document(CLAUSE.cid)).toBeUndefined()
	})
})
