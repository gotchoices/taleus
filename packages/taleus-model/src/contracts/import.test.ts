import { createLocalWorld } from '../engine/index.js'
import { documentLink, MemoryDocumentCache, type Fetch } from './library.js'
import type { Result } from '../types.js'
import { testContract } from './test-contract.js'

function must<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
	return result.value
}

/**
 * Bringing in an agreement from a link, as a contract's QR code or share link carries it. The
 * party's device starts with no copy of it and no idea of the host.
 */

const CONTRACT = await testContract()
const [AGREEMENT, CLAUSE] = CONTRACT.documents
const LINK = `https://docs.test/ipfs/${AGREEMENT.cid}`

/** `docs.test` serves `documents`; every other host (and every catalog) is unreachable. */
function host(documents = CONTRACT.documents): Fetch {
	return async url => {
		const cid = /^https:\/\/docs\.test\/ipfs\/([^?]+)/.exec(url)?.[1]
		const document = documents.find(d => d.cid === cid)
		return document ? new Response(document.json) : new Response('not found', { status: 404 })
	}
}

async function party(fetch: Fetch) {
	const world = await createLocalWorld({ documents: () => new MemoryDocumentCache(), fetch })
	return world.me.model
}

describe('importing an agreement by link', () => {
	it('fetches it with everything it includes and keeps it -- trusting nothing', async () => {
		const me = await party(host())
		const imported = await me.invitations.importAgreement(LINK)
		expect(imported).toEqual({
			ok: true,
			value: {
				id: AGREEMENT.cid,
				title: CONTRACT.title,
				publisher: 'test.invalid',
				language: 'en',
				source: 'docs.test',
				// test.invalid's catalog cannot be read, so nothing confirms who published it.
				standing: { publisherConfirms: 'unknown', trust: 'none', recommendedBy: [], status: 'unknown' },
			},
		})
		const offerable = await me.invitations.listAgreements()
		expect(offerable.ok && offerable.value).toEqual([])
	})

	it('is offered once the party trusts the agreement', async () => {
		const me = await party(host())
		must(await me.invitations.importAgreement(LINK))
		must(await me.publishers.trustAgreement(AGREEMENT.cid))
		const offerable = must(await me.invitations.listAgreements())
		expect(offerable.map(a => [a.id, a.standing?.trust])).toEqual([[AGREEMENT.cid, 'agreement']])
	})

	it('refuses an agreement it cannot read in full', async () => {
		const me = await party(host([AGREEMENT]))
		const imported = await me.invitations.importAgreement(LINK)
		expect(imported.ok || imported.error.kind).toBe('agreement-unreadable')
	})

	it('refuses anything that is not a link to a published document', async () => {
		const me = await party(host())
		const imported = await me.invitations.importAgreement('http://docs.test/ipfs/nonsense')
		expect(imported.ok || imported.error.kind).toBe('invalid')
	})
})

describe('the publishers a party trusts', () => {
	it('start with sereus.org, which cannot be removed', async () => {
		const me = await party(host())
		expect(must(await me.publishers.listTrusted())).toEqual([{ domain: 'sereus.org', builtIn: true }])
		const removed = await me.publishers.untrustPublisher('sereus.org')
		expect(removed.ok || removed.error.kind).toBe('built-in')
	})

	it('can be added by name and removed again', async () => {
		const me = await party(host())
		const added = must(await me.publishers.trustPublisher('Fair-N-Square.org '))
		expect(added.map(p => p.domain)).toEqual(['sereus.org', 'fair-n-square.org'])
		expect(must(await me.publishers.untrustPublisher('fair-n-square.org')).map(p => p.domain)).toEqual(['sereus.org'])
		const nonsense = await me.publishers.trustPublisher('not a domain')
		expect(nonsense.ok || nonsense.error.kind).toBe('invalid')
	})
})

describe('a document link', () => {
	it('is https://<host>/ipfs/<cid>', () => {
		expect(documentLink(LINK)).toEqual({ domain: 'docs.test', cid: AGREEMENT.cid })
		expect(documentLink(`https://Docs.Test:8443/ipfs/${CLAUSE.cid}/?format=raw`)).toEqual({ domain: 'docs.test:8443', cid: CLAUSE.cid })
	})

	it('is nothing else', () => {
		expect(documentLink(`http://docs.test/ipfs/${AGREEMENT.cid}`)).toBeUndefined()
		expect(documentLink(`https://docs.test/files/${AGREEMENT.cid}`)).toBeUndefined()
		expect(documentLink('https://docs.test/ipfs/notacid')).toBeUndefined()
	})
})
