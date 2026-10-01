/** offers: shapes and policy shared by every implementation of the model. */
import type { Amount, Instant, Result, Unit } from './types.js'
import type { Agreement } from './invitations.js'

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

/** What a screen can read and do about offers. Both the mock and the engine implement it. */
export interface OffersModel {
	/** The offer outstanding on a tally, if any (story 03). */
	readOffer(tallyId: string): Promise<Result<Offer | null>>
	/**
	 * Accepting signs the offer as it stands. Countering drafts a *new* proposal —
	 * the roles swap, and the other party now has to agree to this one.
	 */
	respondToOffer(tallyId: string, answer: 'accept' | 'counter', _terms?: ProposedTerms): Promise<Result<'accepted' | 'countered'>>
}
