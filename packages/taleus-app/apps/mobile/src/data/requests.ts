import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { daysSince, engineAbsent, type Amount, type Instant, type Result } from './types'

/** Which way a request runs, from the reading party's side (story 21). */
export type RequestDirection = 'asked-of-me' | 'asked-by-me'

export interface PaymentRequest {
	id: string
	tallyId: string
	direction: RequestDirection
	requester?: { sid: string; name: string }
	amount: Amount
	memo?: string
	asked: Instant
	/**
	 * How long it has been outstanding. Derived here rather than stored: the
	 * engine hands over `asked`, and the same derivation runs in engine mode.
	 * Requests age; they do not expire.
	 */
	outstandingDays: number
	applied: Amount
	stillAsked: Amount
	state: 'waiting' | 'part-answered' | 'answered' | 'refused' | 'withdrawn'
}

/** Requests on a tally, or across all tallies when no tally is named (21, 22, 24). */
export async function listRequests(tallyId?: string): Promise<Result<PaymentRequest[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const all = fixtureFor(getVariant()).requests ?? []
	const mine = tallyId ? all.filter(r => r.tallyId === tallyId) : all
	return { ok: true, value: mine.map(age) }
}

function age(request: Omit<PaymentRequest, 'outstandingDays'>): PaymentRequest {
	return { ...request, outstandingDays: daysSince(request.asked) }
}

function fixtureFor(variant: string): { requests?: PaymentRequest[] } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/requests.empty.json') as { requests?: PaymentRequest[] }
		default:
			return require('../../mock/data/requests.happy.json') as { requests?: PaymentRequest[] }
	}
}
