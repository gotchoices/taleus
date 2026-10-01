/** tally: shapes and policy shared by every implementation of the model. */
import type { Result } from './types.js'
import {
	type Amount,
	type Balance,
	type CivilDate,
	type Counterparty,
	type Instant,
	type TallyState,
	type Unit,
	type WaitingOn,
} from './types.js'

export interface Terms {
	creditLimit: Amount
	noticeDays: number
	/** A calendar date, not an instant — the notice rule counts days, not hours. */
	effective: CivilDate
	/** Set when a change has been agreed but has not yet taken effect. */
	pending?: { creditLimit: Amount; noticeDays: number; effective: CivilDate }
}

export interface Agreement {
	id: string
	title: string
	publisher: string
	language: string
}

/**
 * The contract the terms are arguments to (story 07 step 5).
 *
 * A tally's terms are not the agreement: they are the figures a party filled in
 * on a document both signed. `parameters` names which figures those are, so the
 * reader can see the join rather than being asked to assume it.
 */
export interface AgreementDocument extends Agreement {
	version: string
	parameters: string[]
	sections: { heading: string; body: string }[]
}

/**
 * One agreed set of terms, and what it governs.
 *
 * `side` is whose willingness this is, from the reading party's point of view:
 * `mine` is what this party will let the other owe them. `governs` is the one
 * thing a reduction makes non-obvious — a reduction does not reach back, so it
 * governs activity from its effective date while what is already outstanding
 * stays under the terms it was advanced under (story 07 paths D and E).
 */
export interface TermsChange {
	id: string
	side: 'mine' | 'theirs'
	by: 'me' | 'them'
	creditLimit: Amount
	noticeDays: number
	/** When the parties agreed it. */
	agreed: CivilDate
	/** When it takes effect — later than `agreed` only for a reduction under notice. */
	effective: CivilDate
	governs: 'everything' | 'new-activity'
	restrictive?: boolean
	/** The terms the tally opened with. */
	opening?: boolean
}

/**
 * Terms proposed and not answered (story 07 path A). Deliberately not part of
 * the history: nothing about a proposal changes what either party may do today.
 */
export interface TermsProposal {
	id: string
	side: 'mine' | 'theirs'
	by: 'me' | 'them'
	creditLimit: Amount
	noticeDays: number
	proposed: CivilDate
}

export interface TermsRecord {
	/** Newest first. */
	history: TermsChange[]
	proposal?: TermsProposal
}

/**
 * A close in progress (story 05). Either party may ask, at any time, without the
 * other's agreement; the tally stays closing while any request stands.
 */
export interface Closing {
	requestedBy: 'me' | 'them' | 'both'
	requested: Instant
	/** A date they agreed to settle by, if any. Nothing is added for missing it. */
	settleBy?: CivilDate
	/**
	 * The engine's judgement that the remainder is not worth anyone's time, so
	 * the party owed it may be offered the write-off. The app does not decide
	 * this: what counts as trivial depends on the unit and the parties.
	 */
	offerWriteOff?: boolean
}

/** Work that needs the counterparty and has not reached them yet (story 04 path C). */
export interface PendingWork {
	kind: 'terms' | 'entry' | 'close'
	since: Instant
}

export interface TallyDetail {
	id: string
	counterparty: Counterparty
	unit: Unit
	balance: Balance
	state: TallyState
	waitingOn: WaitingOn
	opened: Instant
	agreement: Agreement
	/** Stated from the reading party's side: what I extend, what they extend. */
	terms: { mine: Terms; theirs: Terms }
	roomToSpend: Amount
	/**
	 * False when nothing of the counterparty's is answering. The tally still
	 * reads — it is this party's record too — and `pending` says what is stuck.
	 */
	counterpartyReachable: boolean
	pending?: PendingWork[]
	closing?: Closing
}

/** What a screen can read and do about tally. Both the mock and the engine implement it. */
export interface TallyModel {
	/**
	 * One tally, read from this party's side (stories 04, 07).
	 *
	 * Keyed by id, because a party has many and the screen is only ever asking
	 * about one of them.
	 */
	readTally(tallyId: string): Promise<Result<TallyDetail>>
	/**
	 * How a tally's terms got to where they are (story 07 steps 3-4).
	 *
	 * A tally with nothing recorded here has never been amended, which is the
	 * story's `empty` case: the two sets in force *are* the whole history, so they
	 * are derived rather than demanding a fixture that says the same thing twice.
	 */
	readTerms(tallyId: string): Promise<Result<TermsRecord>>
	/**
	 * The contract itself. Story 07's error case is this failing while the terms in
	 * force stay readable, so it is a separate read rather than part of the tally.
	 */
	readAgreement(agreementId: string): Promise<Result<AgreementDocument>>
	/**
	 * Story 05 step 1: either party may ask, without the other's agreement. A second
	 * request changes nothing (path F) — one was already enough.
	 */
	requestClose(tallyId: string): Promise<Result<TallyDetail>>
	/**
	 * Path E: a party may withdraw their own request while the tally is still
	 * closing. It stays closing while the other party's request stands.
	 */
	withdrawClose(tallyId: string): Promise<Result<TallyDetail>>
}
