/**
 * Who stands behind an agreement (story 08): read from publishers' catalogs, cached a while so a
 * screen refreshing every few seconds does not refetch them.
 */
import { type Catalog, fetchCatalog } from '@stroc/compose'
import { isDomain, type StrocDocument } from '@stroc/core'
import { BUILT_IN_PUBLISHER, type AgreementStanding } from '../agreement.js'
import { platformFetch, type Fetch } from './library.js'

/** What this party has decided to trust. */
export interface Trusted {
	/** The publishers it trusts, the built-in one included. */
	publishers: readonly string[]
	/** Agreements it trusts on their own, by CID. */
	agreements: readonly string[]
}

/** How long a publisher's catalog is taken as read. */
const CATALOG_TTL_MS = 10 * 60 * 1000

export class StandingChecker {
	private readonly catalogs = new Map<string, { at: number; catalog: Promise<Catalog | undefined> }>()

	constructor(
		private readonly fetch: Fetch = platformFetch(),
		private readonly now: () => number = Date.now,
	) {}

	async standing(cid: string, document: StrocDocument, trusted: Trusted): Promise<AgreementStanding> {
		const publisher = document.author ?? ''
		const own = isDomain(publisher) ? await this.catalog(publisher) : undefined
		const entry = own?.entries.find(e => e.cid === cid)
		const publisherConfirms = !own ? 'unknown' : entry?.role === 'author' ? 'yes' : 'no'
		return {
			publisherConfirms,
			trust: trustOf(publisherConfirms, publisher, cid, trusted),
			recommendedBy: await this.recommenders(cid, publisher, trusted.publishers),
			status: entry?.role === 'author' ? entry.status : 'unknown',
		}
	}

	/** The trusted publishers whose catalogs recommend `cid`, other than its own publisher. */
	private async recommenders(cid: string, publisher: string, trusted: readonly string[]): Promise<string[]> {
		const found: string[] = []
		for (const domain of trusted.filter(d => d !== publisher)) {
			const entry = (await this.catalog(domain))?.entries.find(e => e.cid === cid)
			if (entry?.role === 'endorse' && entry.status === 'current') found.push(domain)
		}
		return found
	}

	/** A publisher's catalog; undefined when it cannot be read. */
	catalog(domain: string): Promise<Catalog | undefined> {
		const held = this.catalogs.get(domain)
		if (held && this.now() - held.at < CATALOG_TTL_MS) return held.catalog
		const catalog = fetchCatalog(`https://${domain}`, { fetch: this.fetch as never }).then(({ catalog, error }) => {
			if (!catalog) {
				console.warn(`taleus-model: reading ${domain}'s document catalog failed: ${error}`)
				// Not kept: the next asker tries again rather than inheriting a failure.
				this.catalogs.delete(domain)
			}
			return catalog
		})
		this.catalogs.set(domain, { at: this.now(), catalog })
		return catalog
	}
}

/**
 * Why the party trusts this agreement. A publisher that does not stand behind it voids any trust its
 * name would carry (story 08 path B); one that could not be asked does not.
 */
function trustOf(
	confirms: AgreementStanding['publisherConfirms'],
	publisher: string,
	cid: string,
	trusted: Trusted,
): AgreementStanding['trust'] {
	if (confirms !== 'no') {
		if (publisher === BUILT_IN_PUBLISHER) return 'built-in'
		if (trusted.publishers.includes(publisher)) return 'publisher'
	}
	return trusted.agreements.includes(cid) ? 'agreement' : 'none'
}
