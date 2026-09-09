import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import {
	engineAbsent,
	type Amount,
	type Balance,
	type CivilDate,
	type Counterparty,
	type Instant,
	type Result,
	type TallyState,
	type Unit,
	type WaitingOn,
} from './types'

export interface Terms {
	creditLimit: Amount
	noticeDays: number
	/** A calendar date, not an instant — the notice rule counts days, not hours. */
	effective: CivilDate
	/** Set when a change has been agreed but has not yet taken effect. */
	pending?: { creditLimit: Amount; noticeDays: number; effective: CivilDate }
}

export interface Agreement {
	id: string
	title: string
	publisher: string
	language: string
}

/**
 * A close in progress (story 05). Either party may ask, at any time, without the
 * other's agreement; the tally stays closing while any request stands.
 */
export interface Closing {
	requestedBy: 'me' | 'them' | 'both'
	requested: Instant
	/** A date they agreed to settle by, if any. Nothing is added for missing it. */
	settleBy?: CivilDate
	/**
	 * The engine's judgement that the remainder is not worth anyone's time, so
	 * the party owed it may be offered the write-off. The app does not decide
	 * this: what counts as trivial depends on the unit and the parties.
	 */
	offerWriteOff?: boolean
}

/** Work that needs the counterparty and has not reached them yet (story 04 path C). */
export interface PendingWork {
	kind: 'terms' | 'entry' | 'close'
	since: Instant
}

export interface TallyDetail {
	id: string
	counterparty: Counterparty
	unit: Unit
	balance: Balance
	state: TallyState
	waitingOn: WaitingOn
	opened: Instant
	agreement: Agreement
	/** Stated from the reading party's side: what I extend, what they extend. */
	terms: { mine: Terms; theirs: Terms }
	roomToSpend: Amount
	/**
	 * False when nothing of the counterparty's is answering. The tally still
	 * reads — it is this party's record too — and `pending` says what is stuck.
	 */
	counterpartyReachable: boolean
	pending?: PendingWork[]
	closing?: Closing
}

/**
 * One tally, read from this party's side (stories 04, 07).
 *
 * Keyed by id, because a party has many and the screen is only ever asking
 * about one of them.
 */
export async function readTally(tallyId: string): Promise<Result<TallyDetail>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}

	const found = fixtureFor(getVariant()).tallies[tallyId]
	if (!found) {
		return {
			ok: false,
			error: { kind: 'not-found', message: `No tally ${tallyId}.`, retryable: false },
		}
	}
	const close = closes[tallyId]
	const closing = close === undefined ? found.closing : (close ?? undefined)
	return {
		ok: true,
		value: {
			...found,
			closing,
			state: closing ? 'Closing' : found.state === 'Closing' ? 'Open' : found.state,
		},
	}
}

/** Mock writes, held in memory as elsewhere. */
let closes: Record<string, Closing | null> = {}

/**
 * Story 05 step 1: either party may ask, without the other's agreement. A second
 * request changes nothing (path F) — one was already enough.
 */
export async function requestClose(tallyId: string): Promise<Result<TallyDetail>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const current = await readTally(tallyId)
	if (!current.ok) {
		return current
	}
	const already = current.value.closing
	closes = {
		...closes,
		[tallyId]: {
			requestedBy: already ? (already.requestedBy === 'me' ? 'me' : 'both') : 'me',
			requested: already?.requested ?? new Date().toISOString(),
			settleBy: already?.settleBy,
			offerWriteOff: already?.offerWriteOff,
		},
	}
	return readTally(tallyId)
}

/**
 * Path E: a party may withdraw their own request while the tally is still
 * closing. It stays closing while the other party's request stands.
 */
export async function withdrawClose(tallyId: string): Promise<Result<TallyDetail>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const current = await readTally(tallyId)
	if (!current.ok) {
		return current
	}
	const already = current.value.closing
	closes = {
		...closes,
		[tallyId]: already && already.requestedBy === 'both'
			? { ...already, requestedBy: 'them' }
			: null,
	}
	return readTally(tallyId)
}

export function resetCloses(): void {
	closes = {}
}

function fixtureFor(variant: string): { tallies: Record<string, TallyDetail> } {
	switch (variant) {
		case 'closing':
			return require('../../mock/data/tally.closing.json') as {
				tallies: Record<string, TallyDetail>
			}
		case 'error':
			return require('../../mock/data/tally.error.json') as { tallies: Record<string, TallyDetail> }
		default:
			return require('../../mock/data/tally.happy.json') as { tallies: Record<string, TallyDetail> }
	}
}
