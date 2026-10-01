/** standing: shapes and policy shared by every implementation of the model. */
import type { Amount, Instant, Result, Unit } from './types.js'

/** One responder, and the tally that became theirs alone. */
export interface TakenUp {
	tallyId: string
	name: string
	at: Instant
}

/**
 * A standing invitation (story 01 path C, story 10 path E).
 *
 * An ordinary invitation is one set of terms waiting for one answer. This is one
 * set of terms waiting for any number of them, each of which becomes its own
 * separate tally — so it does not expire on a timer, it stands until the party
 * withdraws it, and everything it carries goes to people the party has not met.
 */
export interface StandingInvitation {
	id: string
	token: string
	/** What the party actually hands out — printed, on a card, in a message. */
	link: string
	state: 'published' | 'withdrawn'
	published: Instant
	unit: Unit
	/** What this party will let a stranger owe them. Zero is the ordinary answer. */
	creditLimit: Amount
	noticeDays: number
	agreementId: string
	/** Fields sent to every responder — effectively public (story 11 path C). */
	disclose: string[]
	takenUp: TakenUp[]
}

export interface StandingDraft {
	unit: Unit
	creditLimit: Amount
	noticeDays: number
	agreementId: string
	disclose: string[]
}

/** What a screen can read and do about standing. Both the mock and the engine implement it. */
export interface StandingModel {
	readStanding(): Promise<Result<StandingInvitation | null>>
	/**
	 * Publishing is the act that makes the disclosure public, so it is the point at
	 * which the party has to have been told (story 11 path C step 2). The screen
	 * owns the telling; this owns the record.
	 */
	publishStanding(draft: StandingDraft): Promise<Result<StandingInvitation>>
	/**
	 * Withdrawing stops new responders. It does not touch the tallies that already
	 * came from it: those stopped being this invitation's business the moment they
	 * opened (story 01 path C.4).
	 */
	withdrawStanding(): Promise<Result<StandingInvitation | null>>
}
