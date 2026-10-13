import type { CatalogEntry } from '@stroc/compose'
import { BUILT_IN_PUBLISHER } from '../agreement.js'
import { agreementOf, offerableAgreements, TALLY_CONTRACTS, type AgreementContext } from './agreements.js'
import { ContractLibrary, type Fetch } from './library.js'
import { StandingChecker, type Trusted } from './standing.js'
import { testContract } from '../testing/index.js'

/**
 * What a party is told about an agreement (story 08): offered when its publisher is trusted, and
 * always with who stands behind it -- three facts, never merged into one verdict.
 */

const CONTRACT = await testContract('docs.test')
const [AGREEMENT, CLAUSE] = CONTRACT.documents

/** Publishers on the web: each domain's catalog, and the documents docs.test serves. */
function web(catalogs: Record<string, Partial<CatalogEntry>[]>): Fetch {
	return async url => {
		const domain = /^https:\/\/([^/]+)\//.exec(url)?.[1] ?? ''
		if (url.endsWith('/.well-known/stroc/catalog.json')) {
			const entries = catalogs[domain]
			return entries
				? new Response(JSON.stringify({ 'stroc-catalog': '1.1', domain, entries }))
				: new Response('', { status: 503 })
		}
		const cid = /\/ipfs\/([^?]+)/.exec(url)?.[1]
		const document = domain === 'docs.test' ? CONTRACT.documents.find(d => d.cid === cid) : undefined
		return document ? new Response(document.json) : new Response('not found', { status: 404 })
	}
}

const PUBLISHED: Partial<CatalogEntry>[] = [
	{ cid: AGREEMENT.cid, role: 'author', status: 'current', collections: [TALLY_CONTRACTS] },
	{ cid: CLAUSE.cid, role: 'author', status: 'current' },
]

function context(fetch: Fetch, trusted: Partial<Trusted> = {}, held = false): AgreementContext {
	const trust: Trusted = { publishers: [BUILT_IN_PUBLISHER], agreements: [], ...trusted }
	return {
		library: new ContractLibrary({ sources: () => trust.publishers, fetch, ...(held ? { cache: CONTRACT.cache() } : {}) }),
		standing: new StandingChecker(fetch),
		trusted: () => trust,
	}
}

describe('the agreements a party can offer', () => {
	it("are its trusted publishers' current tally contracts -- not their clauses", async () => {
		const offerable = await offerableAgreements(
			context(web({ 'docs.test': PUBLISHED }), { publishers: [BUILT_IN_PUBLISHER, 'docs.test'] }),
		)
		expect(offerable.map(a => a.id)).toEqual([AGREEMENT.cid])
		expect(offerable[0].standing).toEqual({ publisherConfirms: 'yes', trust: 'publisher', recommendedBy: [], status: 'current' })
	})

	it('include an agreement trusted on its own, whoever publishes it', async () => {
		// Trusted alone, it was imported earlier: this device holds it.
		const offerable = await offerableAgreements(context(web({ 'docs.test': PUBLISHED }), { agreements: [AGREEMENT.cid] }, true))
		expect(offerable.map(a => [a.id, a.standing?.trust])).toEqual([[AGREEMENT.cid, 'agreement']])
	})

	it('skip a trusted publisher whose catalog cannot be read', async () => {
		expect(await offerableAgreements(context(web({}), { publishers: [BUILT_IN_PUBLISHER, 'docs.test'] }))).toEqual([])
	})
})

describe('who stands behind an agreement', () => {
	const standingOf = async (fetch: Fetch, trusted: Partial<Trusted> = {}) =>
		(await agreementOf(context(fetch, trusted), AGREEMENT.cid, undefined, ['docs.test'])).standing

	it('a publisher the party does not trust, recommended by one it does', async () => {
		const fetch = web({ 'docs.test': PUBLISHED, [BUILT_IN_PUBLISHER]: [{ cid: AGREEMENT.cid, role: 'endorse', status: 'current' }] })
		expect(await standingOf(fetch)).toEqual({ publisherConfirms: 'yes', trust: 'none', recommendedBy: [BUILT_IN_PUBLISHER], status: 'current' })
	})

	it('a claimed publisher that does not stand behind it: trusted or not, nothing is trusted', async () => {
		const fetch = web({ 'docs.test': [{ cid: CLAUSE.cid, role: 'author', status: 'current' }] })
		expect(await standingOf(fetch, { publishers: [BUILT_IN_PUBLISHER, 'docs.test'] })).toEqual({
			publisherConfirms: 'no',
			trust: 'none',
			recommendedBy: [],
			status: 'unknown',
		})
	})

	it('a publisher that cannot be asked: unknown, not reassured -- but still the party\'s trusted one', async () => {
		expect(await standingOf(web({}), { publishers: [BUILT_IN_PUBLISHER, 'docs.test'] })).toEqual({
			publisherConfirms: 'unknown',
			trust: 'publisher',
			recommendedBy: [],
			status: 'unknown',
		})
	})

	it('an agreement its publisher no longer recommends says so', async () => {
		const fetch = web({ 'docs.test': [{ cid: AGREEMENT.cid, role: 'author', status: 'withdrawn' }] })
		expect((await standingOf(fetch))?.status).toBe('withdrawn')
	})
})
