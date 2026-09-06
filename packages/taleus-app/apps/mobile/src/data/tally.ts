import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import type { Amount, Counterparty, DataError, Result, TallyState, Unit, WaitingOn } from './types'

export interface Terms {
	creditLimit: Amount
	noticeDays: number
	effective: string
	/** Set when a change has been agreed but has not yet taken effect. */
	pending?: { creditLimit: Amount; noticeDays: number; effective: string }
}

export interface Agreement {
	id: string
	title: string
	publisher: string
	language: string
}

export interface TallyDetail {
	id: string
	counterparty: Counterparty
	unit: Unit
	balance: Amount & { perspective: 'owed-to-me' | 'owed-by-me' | 'level' }
	state: TallyState
	waitingOn: WaitingOn
	opened: string
	agreement: Agreement
	/** Stated from the reading party's side: what I extend, what they extend. */
	terms: { mine: Terms; theirs: Terms }
	roomToSpend: Amount
	requestsOutstanding: number
}

interface TallyFixture {
	error?: DataError
	[key: string]: unknown
}

/** One tally, read from this party's side (stories 04, 07). */
export async function readTally(_tallyId: string): Promise<Result<TallyDetail>> {
	if (!mockMode) {
		return {
			ok: false,
			error: { kind: 'engine-absent', message: 'The taleus engine is not wired up yet.', retryable: false },
		}
	}

	const data = fixtureFor(getVariant())
	if (data.error) {
		return { ok: false, error: data.error }
	}
	return { ok: true, value: data as unknown as TallyDetail }
}

function fixtureFor(variant: string): TallyFixture {
	switch (variant) {
		case 'error':
			return require('../../mock/data/tally.error.json') as TallyFixture
		default:
			return require('../../mock/data/tally.happy.json') as TallyFixture
	}
}
