/**
 * Agreements: the contracts tallies are made under, and what a party is told about who stands
 * behind them (story 08).
 *
 * Few parties can judge an agreement by reading it, so every agreement shown carries its
 * `standing`: three separate facts the screens state side by side and never merge into a verdict --
 * whether its publisher stands behind it, whether this party trusts it, and who else recommends it.
 */

/** sereus.org makes Taleus: every party trusts it, and cannot stop. */
export const BUILT_IN_PUBLISHER = 'sereus.org'

export interface Agreement {
	id: string
	title: string
	/** Who published it: the domain (or name) the agreement itself names as its author. */
	publisher: string
	language: string
	summary?: string
	recommended?: boolean
	/** Who stands behind it, from this party's point of view. Absent in mock mode. */
	standing?: AgreementStanding
	/**
	 * `false` when it cannot be read in full -- a part missing, or a copy that is not the document it
	 * claims to be -- and so cannot be agreed to (story 02 path E). Absent when not asked.
	 */
	readable?: boolean
}

export interface AgreementStanding {
	/**
	 * Whether the publisher lists this agreement as its own: `yes`; `no` -- it names a publisher
	 * that does not stand behind it, which is a stronger warning than an unknown one; `unknown` -- the
	 * publisher could not be asked (offline, or it names a person rather than a domain).
	 */
	publisherConfirms: 'yes' | 'no' | 'unknown'
	/**
	 * Why this party trusts it: its publisher is built in, or one the party trusts, or the party
	 * trusts this agreement alone; `none` otherwise, and always when the publisher does not confirm.
	 */
	trust: 'built-in' | 'publisher' | 'agreement' | 'none'
	/** Publishers this party trusts that recommend it, other than its own publisher. Information only. */
	recommendedBy: string[]
	/** What its publisher says of it now; `unknown` when that could not be read. */
	status: 'current' | 'superseded' | 'withdrawn' | 'unknown'
}

/** An agreement brought in from a link or a scanned code (story 01 path F). */
export interface ImportedAgreement extends Agreement {
	/** Where it was found. Nothing is trusted by finding it there. */
	source: string
}

/**
 * The agreement itself, for reading (stories 02, 07): numbered sections, as the publisher wrote them.
 *
 * A tally's terms are not the agreement: they are the figures a party filled in on a document both
 * signed. `parameters` names which figures those are, so the reader can see the join rather than
 * being asked to assume it.
 */
export interface AgreementDocument extends Agreement {
	/** When the publisher issued this version; empty if it does not say. */
	version: string
	parameters: string[]
	/** The opening paragraph, before the first section. */
	preamble?: TextRun[]
	sections: AgreementSection[]
}

export interface AgreementSection {
	/** Its number as printed: `3`, `3.1`. */
	number: string
	title?: string
	/** Its paragraph, if it has one. */
	text?: TextRun[]
	sections: AgreementSection[]
	/** Set when this section is another published document, included whole. */
	included?: { id: string; title: string; publisher: string }
}

/** A stretch of text with one style. A reference reads "Section 3.1"; a parameter is a figure filled in. */
export interface TextRun {
	text: string
	bold?: boolean
	italic?: boolean
	underline?: boolean
	reference?: boolean
	parameter?: boolean
}

/** A publisher this party trusts. */
export interface TrustedPublisher {
	domain: string
	/** sereus.org: always trusted, cannot be removed. */
	builtIn: boolean
	/** When the party started trusting it (an ISO date); absent for the built-in one. */
	since?: string
}
