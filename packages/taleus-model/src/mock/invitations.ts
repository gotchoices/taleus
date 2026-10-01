import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import {
	type Amount,
	type Result,
	type Unit,
} from '../types.js'
import type { Agreement, Invitation, OpenInvitation, Response } from '../invitations.js'

/** Mock writes, as in `party.ts`: enough to walk the flow, gone on restart. */
let issued: Invitation[] | undefined
let answered: Record<string, 'accepted' | 'refused'> = {}

export async function listInvitations(): Promise<Result<Invitation[]>> {
	const fixture = fixtureFor(getVariant()).invitations ?? []
	return { ok: true, value: [...(issued ?? []), ...fixture] }
}

export async function listAgreements(): Promise<Result<Agreement[]>> {
	const data = fixture('agreements.happy') as { agreements: Agreement[] }
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
			return fixture('invitations.empty') as { invitations?: Invitation[] }
		default:
			return fixture('invitations.happy') as { invitations?: Invitation[] }
	}
}

function invitationFixture(variant: string): { invitations: Record<string, OpenInvitation> } {
	switch (variant) {
		case 'expired':
			return fixture('invitation.expired') as {
				invitations: Record<string, OpenInvitation>
			}
		default:
			return fixture('invitation.happy') as {
				invitations: Record<string, OpenInvitation>
			}
	}
}
