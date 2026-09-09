import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import {
	engineAbsent,
	type Amount,
	type Counterparty,
	type Instant,
	type Result,
	type Unit,
} from './types'

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

/** Mock writes, as in `party.ts`: enough to walk the flow, gone on restart. */
let issued: Invitation[] | undefined
let answered: Record<string, 'accepted' | 'refused'> = {}

export async function listInvitations(): Promise<Result<Invitation[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const fixture = fixtureFor(getVariant()).invitations ?? []
	return { ok: true, value: [...(issued ?? []), ...fixture] }
}

export async function listAgreements(): Promise<Result<Agreement[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const data = require('../../mock/data/agreements.happy.json') as { agreements: Agreement[] }
	return { ok: true, value: data.agreements }
}

/**
 * Story 01: terms without a recipient. The token is what gets shared; whoever
 * takes it up becomes the other party.
 */
export async function createInvitation(draft: {
	note?: string
	unit: Unit
	creditLimit: Amount
	noticeDays: number
	agreementId: string
	goodForDays: number
}): Promise<Result<Invitation>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const now = Date.now()
	const invitation: Invitation = {
		token: `inv:new-${now.toString(36)}`,
		note: draft.note,
		state: 'outstanding',
		unit: draft.unit,
		creditLimit: draft.creditLimit,
		noticeDays: draft.noticeDays,
		agreementId: draft.agreementId,
		created: new Date(now).toISOString(),
		expires: new Date(now + draft.goodForDays * 86_400_000).toISOString(),
	}
	issued = [invitation, ...(issued ?? [])]
	return { ok: true, value: invitation }
}

/** One invitation by its token — the universal-link landing (story 02). */
export async function readInvitation(token: string): Promise<Result<OpenInvitation>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const found = invitationFixture(getVariant()).invitations[token]
	if (!found) {
		return {
			ok: false,
			error: { kind: 'not-found', message: `No invitation ${token}.`, retryable: false },
		}
	}
	return { ok: true, value: found }
}

/**
 * Accept or refuse. Story 02 path B: a refusal reaches the inviter and cannot be
 * revived; a fresh offer on new terms can always be made.
 */
export async function respondToInvitation(
	token: string,
	answer: 'accept' | 'refuse',
	_response?: Response,
): Promise<Result<'accepted' | 'refused'>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const outcome = answer === 'accept' ? 'accepted' : 'refused'
	answered = { ...answered, [token]: outcome }
	return { ok: true, value: outcome }
}

export function answerTo(token: string): 'accepted' | 'refused' | undefined {
	return answered[token]
}

/** Tests and scenario capture start from a known state. */
export function resetInvitations(): void {
	issued = undefined
	answered = {}
}

function fixtureFor(variant: string): { invitations?: Invitation[] } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/invitations.empty.json') as { invitations?: Invitation[] }
		default:
			return require('../../mock/data/invitations.happy.json') as { invitations?: Invitation[] }
	}
}

function invitationFixture(variant: string): { invitations: Record<string, OpenInvitation> } {
	switch (variant) {
		case 'expired':
			return require('../../mock/data/invitation.expired.json') as {
				invitations: Record<string, OpenInvitation>
			}
		default:
			return require('../../mock/data/invitation.happy.json') as {
				invitations: Record<string, OpenInvitation>
			}
	}
}
