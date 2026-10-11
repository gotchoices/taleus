/**
 * Contracts as the model shows them: what an agreement is called and who issued it, its text for
 * reading, and which agreements a party can offer.
 */
import { collectionEntries, type ComposedInline, type ComposedSection, fetchCatalog, formatNumber } from '@stroc/compose'
import type { Tally } from 'taleus-core'
import type { Agreement, AgreementDocument } from '../tally.js'
import { platformFetch, type ContractLibrary, type Fetch } from './library.js'

/** What `cid` is called and who issued it; the bare CID when its document cannot be read. */
export async function agreementOf(library: ContractLibrary, cid: string, tally?: Tally): Promise<Agreement> {
	if (!cid) return { id: '', title: '', publisher: '', language: '' }
	const document = await library.describe(cid, tally)
	return document
		? { id: cid, title: document.title, publisher: document.author ?? '', language: document.language }
		: { id: cid, title: cid, publisher: '', language: '' }
}

/** The agreement composed for reading, or undefined if any part of it cannot be found. */
export async function agreementDocumentOf(
	library: ContractLibrary,
	cid: string,
	tally?: Tally,
): Promise<AgreementDocument | undefined> {
	const gathered = await library.gather(cid, tally)
	if (gathered.missing.length > 0) return undefined
	const composed = await library.compose(cid, tally)
	return {
		...(await agreementOf(library, cid, tally)),
		version: composed.document?.published ?? '',
		parameters: composed.parameters.flatMap(group => group.parameters.map(parameter => parameter.label)),
		sections: composed.sections.map(section => ({
			heading: [formatNumber(section.number), titleOf(section)].filter(Boolean).join(' '),
			body: bodyOf(section),
		})),
	}
}

/**
 * The collection a publisher lists tally contracts in (Stroc catalog 1.1): the agreements to offer,
 * not the clauses they include. Agreed with sereus.org; another publisher uses the same name.
 */
export const TALLY_CONTRACTS = 'tally-contracts'

/** The agreements a party can offer: each known source's current tally contracts. */
export async function offerableAgreements(
	library: ContractLibrary,
	sources: readonly string[],
	fetch: Fetch = platformFetch(),
): Promise<Agreement[]> {
	const offerable: Agreement[] = []
	for (const domain of sources) {
		const { catalog, error } = await fetchCatalog(`https://${domain}`, { fetch: fetch as never })
		if (!catalog) {
			console.warn(`taleus-model: reading ${domain}'s document catalog failed: ${error}`)
			continue
		}
		for (const entry of collectionEntries(catalog, TALLY_CONTRACTS)) {
			offerable.push(await agreementOf(library, entry.cid))
		}
	}
	return offerable
}

function titleOf(section: ComposedSection): string {
	return section.title ?? section.include?.document.title ?? ''
}

/** A section's text and everything under it, as plain paragraphs. */
function bodyOf(section: ComposedSection): string {
	const own = section.text ? [plain(section.text)] : []
	const inner = section.sections.map(child => {
		const heading = [formatNumber(child.number), titleOf(child)].filter(Boolean).join(' ')
		return [heading, bodyOf(child)].filter(Boolean).join('\n')
	})
	return [...own, ...inner].filter(Boolean).join('\n\n')
}

function plain(inlines: readonly ComposedInline[]): string {
	return inlines
		.map(inline => {
			switch (inline.type) {
				case 'text':
					return inline.value
				case 'emphasis':
					return plain(inline.children)
				case 'ref':
					return inline.target ? `Section ${formatNumber(inline.target)}` : inline.path.join('/')
				case 'param':
					return `[${inline.path}]`
			}
		})
		.join('')
}
