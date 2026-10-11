/**
 * Contracts as the model shows them: what an agreement is called, who stands behind it, its text
 * for reading, and which agreements a party can offer.
 */
import { collectionEntries, type ComposedInline, type ComposedSection, formatNumber } from '@stroc/compose'
import { isDomain } from '@stroc/core'
import type { Tally } from 'taleus-core'
import type { Agreement, AgreementDocument, AgreementSection, TextRun } from '../agreement.js'
import type { ContractLibrary } from './library.js'
import type { StandingChecker, Trusted } from './standing.js'

/** Everything needed to say what an agreement is, from one party's point of view. */
export interface AgreementContext {
	library: ContractLibrary
	standing: StandingChecker
	trusted: () => Trusted
}

/**
 * The collection a publisher lists tally contracts in (Stroc catalog 1.1): the agreements to offer,
 * not the clauses they include. Agreed with sereus.org; another publisher uses the same name.
 */
export const TALLY_CONTRACTS = 'tally-contracts'

/**
 * What `cid` is called, who published it, and who stands behind it; the bare CID when its document
 * cannot be read. `also` names places to look beyond the trusted publishers (an invitation's hint).
 */
export async function agreementOf(
	context: AgreementContext,
	cid: string,
	tally?: Tally,
	also: readonly string[] = [],
): Promise<Agreement> {
	if (!cid) return { id: '', title: '', publisher: '', language: '' }
	const found = await context.library.document(cid, tally, also)
	const document = found ? await context.library.describe(cid, tally) : undefined
	if (!document) return { id: cid, title: cid, publisher: '', language: '' }
	return {
		id: cid,
		title: document.title,
		publisher: document.author ?? '',
		language: document.language,
		standing: await context.standing.standing(cid, document, context.trusted()),
	}
}

/** `agreementOf`, also saying whether the whole agreement can be read -- for one a party may agree to. */
export async function agreementToDecide(
	context: AgreementContext,
	cid: string,
	tally?: Tally,
	also: readonly string[] = [],
): Promise<Agreement> {
	const gathered = await context.library.gather(cid, tally, also)
	return { ...(await agreementOf(context, cid, tally, also)), readable: gathered.missing.length === 0 }
}

/** Where an agreement's publisher serves it: its author, when that is a domain. */
export function publisherDomainOf(agreement: Agreement): string | undefined {
	return isDomain(agreement.publisher) ? agreement.publisher : undefined
}

/** The agreement composed for reading, or undefined if any part of it cannot be found. */
export async function agreementDocumentOf(
	context: AgreementContext,
	cid: string,
	tally?: Tally,
	also: readonly string[] = [],
): Promise<AgreementDocument | undefined> {
	const gathered = await context.library.gather(cid, tally, also)
	if (gathered.missing.length > 0) return undefined
	const composed = await context.library.compose(cid, tally)
	return {
		...(await agreementOf(context, cid, tally, also)),
		version: composed.document?.published ?? '',
		parameters: composed.parameters.flatMap(group => group.parameters.map(parameter => parameter.label)),
		...(composed.text ? { preamble: runsOf(composed.text) } : {}),
		sections: composed.sections.map(sectionOf),
	}
}

/**
 * The agreements a party can offer: its trusted publishers' current tally contracts, then any
 * agreement it trusts on its own. A publisher whose catalog cannot be read offers nothing for now.
 */
export async function offerableAgreements(context: AgreementContext): Promise<Agreement[]> {
	const trusted = context.trusted()
	const ids: string[] = []
	for (const domain of trusted.publishers) {
		const catalog = await context.standing.catalog(domain)
		for (const entry of catalog ? collectionEntries(catalog, TALLY_CONTRACTS) : []) {
			if (!ids.includes(entry.cid)) ids.push(entry.cid)
		}
	}
	for (const cid of trusted.agreements) if (!ids.includes(cid)) ids.push(cid)
	return Promise.all(ids.map(cid => agreementOf(context, cid)))
}

function sectionOf(section: ComposedSection): AgreementSection {
	const title = section.title ?? section.include?.document.title
	return {
		number: formatNumber(section.number),
		...(title ? { title } : {}),
		...(section.text ? { text: runsOf(section.text) } : {}),
		sections: section.sections.map(sectionOf),
		...(section.include
			? {
					included: {
						id: section.include.cid.toString(),
						title: section.include.document.title,
						publisher: section.include.document.author ?? '',
					},
				}
			: {}),
	}
}

/** Stroc's inline markup as styled runs, emphasis flattened onto each run it covers. */
function runsOf(inlines: readonly ComposedInline[], style: Omit<TextRun, 'text'> = {}): TextRun[] {
	return inlines.flatMap((inline): TextRun[] => {
		switch (inline.type) {
			case 'text':
				return [{ ...style, text: inline.value }]
			case 'emphasis':
				return runsOf(inline.children, { ...style, ...EMPHASIS[inline.tag] })
			case 'ref':
				return [{ ...style, reference: true, text: inline.target ? `Section ${formatNumber(inline.target)}` : inline.path.join('/') }]
			case 'param':
				return [{ ...style, parameter: true, text: `[${inline.path}]` }]
		}
	})
}

const EMPHASIS: Record<'b' | 'i' | 'u', Omit<TextRun, 'text'>> = {
	b: { bold: true },
	i: { italic: true },
	u: { underline: true },
}
