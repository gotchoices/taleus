import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { engineAbsent, type Amount, type Instant, type Result, type Unit } from './types'
import type { Agreement } from './invitations'

/** One side's terms in a proposal. Each party sets their own. */
export interface Terms {
	creditLimit: Amount
	noticeDays: number
}

export interface ProposedTerms {
	mine: Terms
	theirs: Terms
}

/** What differs from the offer before this one (story 03 step 3). */
export interface Change {
	field: string
	from: number
	to: number
}

/**
 * A proposal outstanding on a tally.
 *
 * A proposal is identified, ordered, and carries an expiry, and more than one
 * may be outstanding at once — `docs/architecture.md` § Offer semantics. A
 * counter is therefore a *new proposal*, never an edit of a live one, and the
 * screen has to say so.
 */
export interface Offer {
	id: string
	tallyId: string
	counterparty: { sid: string; name: string }
	waitingOn: 'me' | 'them' | 'nobody'
	drafted: Instant
	expires?: Instant
	unit: Unit
	agreement: Agreement
	proposed: ProposedTerms
	/** Terms already in force, when a tally is open and being amended. */
	inForce: (ProposedTerms & { effective: string }) | null
	previous?: { id: string; drafted: Instant; by: 'me' | 'them' }
	changes: Change[]
	signedByBoth?: boolean
	/**
	 * Set when two proposals ended up fully signed. The later-drafted one
	 * governs, and this is it — precedence follows the proposal's own version
	 * order, not the order signatures arrived, so both parties reach the same
	 * answer without a clock.
	 */
	supersededBy?: {
		id: string
		drafted: Instant
		by: 'me' | 'them'
		proposed: ProposedTerms
	}
}

let answered: Record<string, 'accepted' | 'countered'> = {}

/** The offer outstanding on a tally, if any (story 03). */
export async function readOffer(tallyId: string): Promise<Result<Offer | null>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	return { ok: true, value: fixtureFor(getVariant()).offers[tallyId] ?? null }
}

/**
 * Accepting signs the offer as it stands. Countering drafts a *new* proposal —
 * the roles swap, and the other party now has to agree to this one.
 */
export async function respondToOffer(
	tallyId: string,
	answer: 'accept' | 'counter',
	_terms?: ProposedTerms,
): Promise<Result<'accepted' | 'countered'>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const outcome = answer === 'accept' ? 'accepted' : 'countered'
	answered = { ...answered, [tallyId]: outcome }
	return { ok: true, value: outcome }
}

export function resetOffers(): void {
	answered = {}
}

function fixtureFor(variant: string): { offers: Record<string, Offer> } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/offer.empty.json') as { offers: Record<string, Offer> }
		case 'superseded':
			return require('../../mock/data/offer.superseded.json') as { offers: Record<string, Offer> }
		default:
			return require('../../mock/data/offer.happy.json') as { offers: Record<string, Offer> }
	}
}
