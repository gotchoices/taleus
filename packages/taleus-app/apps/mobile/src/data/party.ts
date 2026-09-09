import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { engineAbsent, type Instant, type Result } from './types'

export interface Device {
	id: string
	name: string
	lastActive: Instant
	/** A device that stays reachable — a node rather than a phone. */
	alwaysOn?: boolean
}

/**
 * Who this party is, from their own side (stories 10, 11, 42).
 *
 * `null` is a real answer, not an error: before first run completes there is no
 * identity, and that is the state story 10 is about.
 */
export interface Party {
	sid: string
	/** Empty until the party chooses one — story 10 step 5. */
	displayName: string
	displayUnit: string
	disclosed: Record<string, string>
	devices: Device[]
}

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
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
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
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const seed = fixtureFor('happy').party
	if (!seed) {
		return { ok: false, error: { kind: 'unexpected', message: 'no party fixture', retryable: false } }
	}
	written = { ...seed, displayName: '', disclosed: {} }
	return { ok: true, value: written }
}

/** Story 10 step 5: the one thing asked for up front. */
export async function setDisplayName(name: string): Promise<Result<Party>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
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
			return require('../../mock/data/party.first-run.json') as { party: Party | null }
		case 'naming':
			return require('../../mock/data/party.naming.json') as { party: Party | null }
		case 'error':
			// A party whose only device is the phone in their hand — story 43 path B.
			return require('../../mock/data/party.error.json') as { party: Party | null }
		default:
			return require('../../mock/data/party.happy.json') as { party: Party | null }
	}
}
