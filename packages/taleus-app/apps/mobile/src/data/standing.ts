import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { engineAbsent, type Amount, type Instant, type Result, type Unit } from './types'

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

let written: StandingInvitation | null | undefined

export async function readStanding(): Promise<Result<StandingInvitation | null>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	if (written !== undefined) {
		return { ok: true, value: written }
	}
	return { ok: true, value: fixtureFor(getVariant()).standing }
}

export interface StandingDraft {
	unit: Unit
	creditLimit: Amount
	noticeDays: number
	agreementId: string
	disclose: string[]
}

/**
 * Publishing is the act that makes the disclosure public, so it is the point at
 * which the party has to have been told (story 11 path C step 2). The screen
 * owns the telling; this owns the record.
 */
export async function publishStanding(
	draft: StandingDraft,
): Promise<Result<StandingInvitation>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const now = Date.now()
	const token = `inv:standing-${now.toString(36)}`
	written = {
		id: `standing:${now.toString(36)}`,
		token,
		link: `https://sereus.org/taleus/invite/${encodeURIComponent(token)}`,
		state: 'published',
		published: new Date(now).toISOString(),
		...draft,
		takenUp: [],
	}
	return { ok: true, value: written }
}

/**
 * Withdrawing stops new responders. It does not touch the tallies that already
 * came from it: those stopped being this invitation's business the moment they
 * opened (story 01 path C.4).
 */
export async function withdrawStanding(): Promise<Result<StandingInvitation | null>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const current = await readStanding()
	if (!current.ok) {
		return current
	}
	written = current.value ? { ...current.value, state: 'withdrawn' } : null
	return { ok: true, value: written }
}

export function resetStanding(): void {
	written = undefined
}

function fixtureFor(variant: string): { standing: StandingInvitation | null } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/standing.empty.json') as {
				standing: StandingInvitation | null
			}
		default:
			return require('../../mock/data/standing.happy.json') as {
				standing: StandingInvitation | null
			}
	}
}
