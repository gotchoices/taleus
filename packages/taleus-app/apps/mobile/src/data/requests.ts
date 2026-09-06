import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import type { Amount, Result } from './types'

export interface PaymentRequest {
	id: string
	tallyId: string
	direction: 'asked-of-me' | 'asked-by-me'
	requester?: { sid: string; name: string }
	amount: Amount
	memo?: string
	asked: string
	/** How long it has been outstanding. Requests age; they do not expire. */
	outstandingDays: number
	applied: Amount
	stillAsked: Amount
	state: 'waiting' | 'part-answered' | 'answered' | 'refused' | 'withdrawn'
}

/** Requests on a tally, or across all tallies when no tally is named (21, 22, 24). */
export async function listRequests(tallyId?: string): Promise<Result<PaymentRequest[]>> {
	if (!mockMode) {
		return {
			ok: false,
			error: { kind: 'engine-absent', message: 'The taleus engine is not wired up yet.', retryable: false },
		}
	}
	const all = fixtureFor(getVariant()).requests ?? []
	return { ok: true, value: tallyId ? all.filter(r => r.tallyId === tallyId) : all }
}

function fixtureFor(variant: string): { requests?: PaymentRequest[] } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/requests.empty.json') as { requests?: PaymentRequest[] }
		default:
			return require('../../mock/data/requests.happy.json') as { requests?: PaymentRequest[] }
	}
}
