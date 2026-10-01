/** profile: shapes and policy shared by every implementation of the model. */
import type { Instant, Result, TallyState } from './types.js'

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

/** What a screen can read and do about profile. Both the mock and the engine implement it. */
export interface ProfileModel {
	readProfile(): Promise<Result<Profile>>
	/**
	 * Story 11 step 2: adding something to one's own record does not send it to
	 * anybody. This writes `held` and nothing else — the disclosures are untouched,
	 * which is the whole point of the two lists being separate.
	 */
	setField(key: string, value: string): Promise<Result<Profile>>
	/**
	 * Path D: a correction goes only to the counterparties the party authorizes,
	 * each one a statement they sign. Authorizing none sends nothing, and the
	 * party's own record still shows the new value.
	 *
	 * Delivery is reported per counterparty because only some of a set will fail,
	 * and a correction that did not arrive must not be shown as though it had.
	 */
	authorizeCorrection(key: string, tallyIds: string[]): Promise<Result<Delivery[]>>
	/**
	 * Story 11 step 7: more disclosed than before, on the tally that already
	 * exists. No new tally, no renegotiated terms — and the counterparty is
	 * notified, because this is not something done silently into a record they may
	 * never reread.
	 */
	discloseMore(tallyId: string, keys: string[]): Promise<Result<Profile>>
	/**
	 * Path E step 4: asking, rather than guessing at an absence. One request per
	 * field, because each gets its own answer — a single "tell me about yourself"
	 * could only ever be answered as a whole.
	 */
	askFor(tallyId: string, keys: string[], why: string): Promise<Result<Profile>>
	/**
	 * Path B step 3: either answer is visible to the asker. A refusal is an answer
	 * and is recorded as one — it is not a failure, and the counterparty is free to
	 * draw their own conclusion from it.
	 */
	answerRequest(requestId: string, answer: { kind: 'supplied' | 'refused' }): Promise<Result<Profile>>
}
