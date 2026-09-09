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
	const everything = [...asked, ...all]
	const mine = tallyId ? everything.filter(r => r.tallyId === tallyId) : everything
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

/** Requests this party made in this session, held in memory as elsewhere. */
let asked: PaymentRequest[] = []

/**
 * Story 21: a request is the requester's own statement of what they think is
 * owed. It obliges the payer to nothing by itself, and it does not tick — it
 * stands until answered or withdrawn.
 */
export async function createRequest(
	tallyId: string,
	ask: { amount: Amount; memo?: string },
): Promise<Result<PaymentRequest>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const made: PaymentRequest = {
		id: `request:new-${Date.now().toString(36)}`,
		tallyId,
		direction: 'asked-by-me',
		amount: ask.amount,
		memo: ask.memo,
		asked: new Date().toISOString(),
		outstandingDays: 0,
		applied: { units: 0 },
		stillAsked: ask.amount,
		state: 'waiting',
	}
	asked = [made, ...asked]
	return { ok: true, value: made }
}

export function resetRequests(): void {
	asked = []
}
