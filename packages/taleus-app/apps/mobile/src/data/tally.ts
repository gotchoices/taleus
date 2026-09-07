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
	return { ok: true, value: found }
}

function fixtureFor(variant: string): { tallies: Record<string, TallyDetail> } {
	switch (variant) {
		case 'error':
			return require('../../mock/data/tally.error.json') as { tallies: Record<string, TallyDetail> }
		default:
			return require('../../mock/data/tally.happy.json') as { tallies: Record<string, TallyDetail> }
	}
}
