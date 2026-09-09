import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { engineAbsent, type Instant, type Result, type TallyState } from './types'

/** One thing a party knows about itself, or has been told about someone else. */
export interface Field {
	key: string
	value: string
	/** When it was sent or received. Absent on a field only held, never sent. */
	at?: Instant
	/** Chosen at formation, on a tally not yet countersigned. */
	pending?: boolean
}

/**
 * An ask for one field, either direction (story 11 paths B and E).
 *
 * Asking exists because absence is ambiguous: a field a party never received
 * might have been withheld or never held, and from the outside those look
 * identical. A request turns that silence into a yes or a no.
 */
export interface InfoRequest {
	id: string
	key: string
	from: 'them' | 'me'
	why: string
	asked: Instant
	answer?: { kind: 'supplied' | 'refused'; at: Instant; value?: string }
}

/** What passed between this party and one counterparty, both directions. */
export interface Disclosure {
	tallyId: string
	counterparty: { sid: string; name: string }
	state: TallyState
	/** False when a correction cannot be delivered to them right now. */
	reachable: boolean
	sent: Field[]
	/** Their claim about themselves — never something Taleus verified. */
	received: Field[]
	requests: InfoRequest[]
}

export interface Profile {
	held: Field[]
	disclosures: Disclosure[]
}

/** One counterparty's outcome when a correction is authorized for a set. */
export interface Delivery {
	tallyId: string
	name: string
	delivered: boolean
}

let written: Profile | undefined

export async function readProfile(): Promise<Result<Profile>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	if (written) {
		return { ok: true, value: written }
	}
	return { ok: true, value: fixtureFor(getVariant()).profile }
}

/**
 * Story 11 step 2: adding something to one's own record does not send it to
 * anybody. This writes `held` and nothing else — the disclosures are untouched,
 * which is the whole point of the two lists being separate.
 */
export async function setField(key: string, value: string): Promise<Result<Profile>> {
	const current = await readProfile()
	if (!current.ok) {
		return current
	}
	const held = current.value.held.some(field => field.key === key)
		? current.value.held.map(field => (field.key === key ? { ...field, value } : field))
		: [...current.value.held, { key, value }]
	written = { ...current.value, held }
	return { ok: true, value: written }
}

/**
 * Which counterparties hold a value this party has since changed (path D step
 * 2). The party is shown this set and authorizes it; nothing is sent for having
 * been asked.
 */
export function staleHolders(profile: Profile, key: string): Disclosure[] {
	const held = profile.held.find(field => field.key === key)
	if (!held) {
		return []
	}
	return profile.disclosures.filter(disclosure =>
		disclosure.sent.some(field => field.key === key && field.value !== held.value),
	)
}

/**
 * Path D: a correction goes only to the counterparties the party authorizes,
 * each one a statement they sign. Authorizing none sends nothing, and the
 * party's own record still shows the new value.
 *
 * Delivery is reported per counterparty because only some of a set will fail,
 * and a correction that did not arrive must not be shown as though it had.
 */
export async function authorizeCorrection(
	key: string,
	tallyIds: string[],
): Promise<Result<Delivery[]>> {
	const current = await readProfile()
	if (!current.ok) {
		return current
	}
	const value = current.value.held.find(field => field.key === key)?.value
	if (value === undefined) {
		return { ok: false, error: { kind: 'not-held', message: `Nothing held for ${key}.`, retryable: false } }
	}
	const at = new Date().toISOString()
	const deliveries: Delivery[] = []
	const disclosures = current.value.disclosures.map(disclosure => {
		if (!tallyIds.includes(disclosure.tallyId)) {
			return disclosure
		}
		deliveries.push({
			tallyId: disclosure.tallyId,
			name: disclosure.counterparty.name,
			delivered: disclosure.reachable,
		})
		if (!disclosure.reachable) {
			return disclosure
		}
		// A correction is a new statement, not an erasure: the old one keeps its
		// place in the list and both stay visible to both sides (path D step 4).
		return { ...disclosure, sent: [...disclosure.sent, { key, value, at }] }
	})
	written = { ...current.value, disclosures }
	return { ok: true, value: deliveries }
}

/**
 * Story 11 step 7: more disclosed than before, on the tally that already
 * exists. No new tally, no renegotiated terms — and the counterparty is
 * notified, because this is not something done silently into a record they may
 * never reread.
 */
export async function discloseMore(tallyId: string, keys: string[]): Promise<Result<Profile>> {
	const current = await readProfile()
	if (!current.ok) {
		return current
	}
	const at = new Date().toISOString()
	const disclosures = current.value.disclosures.map(disclosure => {
		if (disclosure.tallyId !== tallyId) {
			return disclosure
		}
		const added = keys
			.map(key => current.value.held.find(field => field.key === key))
			.filter((field): field is Field => field !== undefined)
			.map(field => ({ key: field.key, value: field.value, at }))
		return { ...disclosure, sent: [...disclosure.sent, ...added] }
	})
	written = { ...current.value, disclosures }
	return { ok: true, value: written }
}

/**
 * Path E step 4: asking, rather than guessing at an absence. One request per
 * field, because each gets its own answer — a single "tell me about yourself"
 * could only ever be answered as a whole.
 */
export async function askFor(
	tallyId: string,
	keys: string[],
	why: string,
): Promise<Result<Profile>> {
	const current = await readProfile()
	if (!current.ok) {
		return current
	}
	const asked = new Date().toISOString()
	const disclosures = current.value.disclosures.map(disclosure => {
		if (disclosure.tallyId !== tallyId) {
			return disclosure
		}
		const added: InfoRequest[] = keys.map(key => ({
			id: `req:${tallyId}-${key}-${asked}`,
			key,
			from: 'me',
			why,
			asked,
		}))
		return { ...disclosure, requests: [...disclosure.requests, ...added] }
	})
	written = { ...current.value, disclosures }
	return { ok: true, value: written }
}

/**
 * Path B step 3: either answer is visible to the asker. A refusal is an answer
 * and is recorded as one — it is not a failure, and the counterparty is free to
 * draw their own conclusion from it.
 */
export async function answerRequest(
	requestId: string,
	answer: { kind: 'supplied' | 'refused' },
): Promise<Result<Profile>> {
	const current = await readProfile()
	if (!current.ok) {
		return current
	}
	const at = new Date().toISOString()
	let value: string | undefined
	const disclosures = current.value.disclosures.map(disclosure => {
		const request = disclosure.requests.find(item => item.id === requestId)
		if (!request) {
			return disclosure
		}
		if (answer.kind === 'supplied') {
			value = current.value.held.find(field => field.key === request.key)?.value
		}
		const requests = disclosure.requests.map(item =>
			item.id === requestId ? { ...item, answer: { ...answer, at, value } } : item,
		)
		const sent =
			answer.kind === 'supplied' && value !== undefined
				? [...disclosure.sent, { key: request.key, value, at }]
				: disclosure.sent
		return { ...disclosure, requests, sent }
	})
	if (answer.kind === 'supplied' && value === undefined) {
		return {
			ok: false,
			error: { kind: 'not-held', message: 'Nothing held to send.', retryable: false },
		}
	}
	written = { ...current.value, disclosures }
	return { ok: true, value: written }
}

export function resetProfile(): void {
	written = undefined
}

function fixtureFor(variant: string): { profile: Profile } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/profile.empty.json') as { profile: Profile }
		case 'error':
			return require('../../mock/data/profile.error.json') as { profile: Profile }
		default:
			return require('../../mock/data/profile.happy.json') as { profile: Profile }
	}
}
