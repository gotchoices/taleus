/**
 * Contracts as the model shows them: what an agreement is called and who issued it, its text for
 * reading, and which agreements a party can offer.
 */
import { type ComposedInline, type ComposedSection, formatNumber, parseCatalog } from '@stroc/compose'
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
 * The agreements a party can offer: those each known source issues as current.
 *
 * INTERIM until Stroc marks a document's kind: an offerable agreement is told from a clause by
 * including other documents, which every agreement here does and no clause does.
 */
export async function offerableAgreements(
	library: ContractLibrary,
	sources: readonly string[],
	fetch: Fetch = platformFetch(),
): Promise<Agreement[]> {
	const offerable: Agreement[] = []
	for (const domain of sources) {
		for (const entry of await currentIssuedBy(domain, fetch)) {
			const gathered = await library.gather(entry.cid)
			if (gathered.missing.length === 0 && gathered.documents.length > 1) {
				offerable.push(await agreementOf(library, entry.cid))
			}
		}
	}
	return offerable
}

async function currentIssuedBy(domain: string, fetch: Fetch) {
	try {
		const response = await fetch(`https://${domain}/.well-known/stroc/catalog.json`, { headers: { Accept: 'application/json' } })
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		const { catalog, error } = parseCatalog(await response.json())
		if (!catalog) throw new Error(error)
		return catalog.entries.filter(entry => entry.role === 'author' && entry.status === 'current')
	} catch (error) {
		console.warn(`taleus-model: reading ${domain}'s document catalog failed:`, error)
		return []
	}
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
