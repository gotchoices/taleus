import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import type { Amount, Result } from './types'

export interface AttentionItem {
	id: string
	kind: 'offer' | 'request' | 'closing' | 'invitation'
	tallyId: string
	counterparty: { name: string }
	summary: string
	amount?: Amount
	/** Present when the item is waiting on the counterparty, not on this party. */
	waitingOn?: 'them'
	waitingSince: string
	route: string
}

/** Everything waiting on this party, across every tally (story 23). */
export async function listAttention(): Promise<Result<AttentionItem[]>> {
	if (!mockMode) {
		return {
			ok: false,
			error: { kind: 'engine-absent', message: 'The taleus engine is not wired up yet.', retryable: false },
		}
	}
	const data = fixtureFor(getVariant())
	return { ok: true, value: data.items ?? [] }
}

function fixtureFor(variant: string): { items?: AttentionItem[] } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/attention.empty.json') as { items?: AttentionItem[] }
		default:
			return require('../../mock/data/attention.happy.json') as { items?: AttentionItem[] }
	}
}
