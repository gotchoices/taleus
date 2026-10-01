/** invitations: shapes and policy shared by every implementation of the model. */
import type { Amount, Counterparty, Instant, Result, Unit } from './types.js'

export interface Agreement {
	id: string
	title: string
	publisher: string
	language: string
	summary?: string
	recommended?: boolean
}

/** An invitation this party issued. No tally exists until someone responds. */
export interface Invitation {
	token: string
	/**
	 * The inviter's private memo — "bike, lunch Tuesday". Never a claim about who
	 * will respond: story 01 step 1 is explicit that terms are set without naming
	 * anyone, and whoever accepts becomes the other party.
	 */
	note?: string
	state: 'outstanding' | 'expired' | 'withdrawn' | 'taken-up'
	unit: Unit
	creditLimit: Amount
	noticeDays: number
	agreementId: string
	created: Instant
	expires: Instant
}

/** What the inviter would like told about whoever responds (story 02 step 5). */
export interface Ask {
	field: string
	required: boolean
}

/** An invitation as the invitee sees it, before disclosing anything. */
export interface OpenInvitation {
	token: string
	state: Invitation['state']
	/** Only what the inviter disclosed. The invitee has disclosed nothing yet. */
	inviter: Pick<Counterparty, 'sid' | 'disclosed'>
	unit: Unit
	theirCreditLimit: Amount
	theirNoticeDays: number
	agreement: Agreement
	expires: Instant
	asks: Ask[]
}

/** Terms an invitee proposes back. Zero is a normal answer (story 02 step 6). */
export interface Response {
	disclose: Record<string, string>
	creditLimit: Amount
	noticeDays: number
}

/** What a screen can read and do about invitations. Both the mock and the engine implement it. */
export interface InvitationsModel {
	listInvitations(): Promise<Result<Invitation[]>>
	listAgreements(): Promise<Result<Agreement[]>>
	/**
	 * Story 01: terms without a recipient. The token is what gets shared; whoever
	 * takes it up becomes the other party.
	 */
	createInvitation(draft: {
	note?: string
	unit: Unit
	creditLimit: Amount
	noticeDays: number
	agreementId: string
	goodForDays: number
}): Promise<Result<Invitation>>
	/** One invitation by its token — the universal-link landing (story 02). */
	readInvitation(token: string): Promise<Result<OpenInvitation>>
	/**
	 * Accept or refuse. Story 02 path B: a refusal reaches the inviter and cannot be
	 * revived; a fresh offer on new terms can always be made.
	 */
	respondToInvitation(token: string, answer: 'accept' | 'refuse', _response?: Response): Promise<Result<'accepted' | 'refused'>>
	answerTo(token: string): 'accepted' | 'refused' | undefined
}
