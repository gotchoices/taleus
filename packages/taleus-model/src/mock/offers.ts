import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import type { Result } from '../types.js'
import type { ProposedTerms, Offer } from '../offers.js'

let answered: Record<string, 'accepted' | 'countered'> = {}

/** The offer outstanding on a tally, if any (story 03). */
export async function readOffer(tallyId: string): Promise<Result<Offer | null>> {
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
			return fixture('offer.empty') as { offers: Record<string, Offer> }
		case 'superseded':
			return fixture('offer.superseded') as { offers: Record<string, Offer> }
		default:
			return fixture('offer.happy') as { offers: Record<string, Offer> }
	}
}
