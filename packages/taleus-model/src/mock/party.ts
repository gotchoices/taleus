import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import type { Result } from '../types.js'
import type { Party } from '../party.js'

/**
 * Writes in mock mode.
 *
 * The app has been read-only until now; first run is the first thing that
 * creates something. In mock mode a write is held here in memory: it is enough
 * to walk the flow and see the result, and it does not survive a restart. The
 * engine will make these durable — `feat-engine-tally-api`.
 */
let written: Party | null | undefined

export async function readParty(): Promise<Result<Party | null>> {
	if (written !== undefined) {
		return { ok: true, value: written }
	}
	return { ok: true, value: fixtureFor(getVariant()).party ?? null }
}

/**
 * Story 10 step 3: the app does this. There is no key ceremony to walk the
 * party through, no algorithm to choose, and nothing to name — they are told it
 * happened rather than asked to do it. Story 10 path C: it needs no network.
 */
export async function createIdentity(): Promise<Result<Party>> {
	const seed = fixtureFor('happy').party
	if (!seed) {
		return { ok: false, error: { kind: 'unexpected', message: 'no party fixture', retryable: false } }
	}
	written = { ...seed, displayName: '', disclosed: {} }
	return { ok: true, value: written }
}

/** Story 10 step 5: the one thing asked for up front. */
export async function setDisplayName(name: string): Promise<Result<Party>> {
	const current = written ?? fixtureFor(getVariant()).party
	if (!current) {
		return { ok: false, error: { kind: 'no-identity', message: 'No identity yet.', retryable: false } }
	}
	written = { ...current, displayName: name, disclosed: { ...current.disclosed, name } }
	return { ok: true, value: written }
}

/** Tests and scenario capture start from a known state. */
export function resetParty(): void {
	written = undefined
}

function fixtureFor(variant: string): { party: Party | null } {
	switch (variant) {
		case 'first-run':
			return fixture('party.first-run') as { party: Party | null }
		case 'naming':
			return fixture('party.naming') as { party: Party | null }
		case 'empty':
		case 'error':
			// A party whose only machine is the phone in their hand. Story 13 path A,
			// story 14 path A and story 43 path B are the same party, three screens.
			return fixture('party.single-device') as { party: Party | null }
		default:
			return fixture('party.happy') as { party: Party | null }
	}
}
