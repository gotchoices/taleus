import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import type { Result } from '../types.js'
import type { StandingInvitation, StandingDraft } from '../standing.js'

let written: StandingInvitation | null | undefined

export async function readStanding(): Promise<Result<StandingInvitation | null>> {
	if (written !== undefined) {
		return { ok: true, value: written }
	}
	return { ok: true, value: fixtureFor(getVariant()).standing }
}

/**
 * Publishing is the act that makes the disclosure public, so it is the point at
 * which the party has to have been told (story 11 path C step 2). The screen
 * owns the telling; this owns the record.
 */
export async function publishStanding(
	draft: StandingDraft,
): Promise<Result<StandingInvitation>> {
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
			return fixture('standing.empty') as {
				standing: StandingInvitation | null
			}
		default:
			return fixture('standing.happy') as {
				standing: StandingInvitation | null
			}
	}
}
