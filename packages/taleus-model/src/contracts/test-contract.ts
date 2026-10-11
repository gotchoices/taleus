/**
 * A two-document contract for tests: an agreement that includes one clause, as real Stroc
 * documents, seeded into a device cache so nothing has to be fetched. Excluded from the build.
 */
import { documentCid, fromPlain } from '@stroc/core'
import type { StoredDocument } from 'taleus-core'
import { MemoryDocumentCache, type Fetch } from './library.js'

export interface TestContract {
	/** The agreement's CID: what an invitation names and a tally signs. */
	cid: string
	title: string
	documents: StoredDocument[]
	/** A cache holding both documents, as a device that has already seen the contract would. */
	cache: () => MemoryDocumentCache
	/** Its publisher on the web: serves both documents at `https://<author>/ipfs/<cid>`, nothing else. */
	publisher: Fetch
}

/** A document written in its plain DAG-JSON form (links as `{ '/': cid }`), filed under its CID. */
async function stored(document: unknown): Promise<StoredDocument> {
	const { cid, bytes } = await documentCid(fromPlain(document).value)
	if (!cid || !bytes) throw new Error('test contract document is not a valid Stroc document')
	return { cid: cid.toString(), json: new TextDecoder().decode(bytes) }
}

/** The contract, published under `author` (a domain whose catalog a test can serve). */
export async function testContract(author = 'test.invalid'): Promise<TestContract> {
	const clause = await stored({
		stroc: '1.0',
		language: 'en',
		title: 'Closing',
		author,
		text: 'Either party may ask to close; the tally closes when the balance is settled.',
	})
	const title = 'Test Tally Agreement'
	const agreement = await stored({
		stroc: '1.0',
		language: 'en',
		title,
		author,
		text: 'A contract for tests: it binds nobody.',
		sections: [{ id: 'closing', source: { '/': clause.cid } }],
	})
	const documents = [agreement, clause]
	return {
		cid: agreement.cid,
		title,
		documents,
		publisher: async url => {
			const prefix = `https://${author}/ipfs/`
			const document = url.startsWith(prefix) ? documents.find(d => url.slice(prefix.length).startsWith(d.cid)) : undefined
			return document ? new Response(document.json) : new Response('not found', { status: 404 })
		},
		cache: () => {
			const cache = new MemoryDocumentCache()
			for (const document of documents) void cache.put(document)
			return cache
		},
	}
}

/** A `fetch` for tests that must not reach the network: every request fails. */
export const offline: Fetch = async url => {
	throw new Error(`offline: ${url}`)
}
