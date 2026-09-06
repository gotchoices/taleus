import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import type { Amount, Result } from './types'

export interface Entry {
	id: string
	/** `direct` was made by one of the two parties; `routed` arrived via a lift. */
	kind: 'direct' | 'routed'
	issuer: 'me' | 'them' | 'network'
	amount: Amount
	date: string
	memo?: string
	balanceAfter: Amount & { perspective: 'owed-to-me' | 'owed-by-me' | 'level' }
	/** Requests this entry answered, if any. */
	answers?: string[]
}

/** A tally's signed entries, most recent first (story 24). */
export async function listEntries(_tallyId: string): Promise<Result<Entry[]>> {
	if (!mockMode) {
		return {
			ok: false,
			error: { kind: 'engine-absent', message: 'The taleus engine is not wired up yet.', retryable: false },
		}
	}
	const data = fixtureFor(getVariant())
	return { ok: true, value: data.entries ?? [] }
}

function fixtureFor(variant: string): { entries?: Entry[] } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/entries.empty.json') as { entries?: Entry[] }
		default:
			return require('../../mock/data/entries.happy.json') as { entries?: Entry[] }
	}
}
