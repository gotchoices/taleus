import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { engineAbsent, type Amount, type Balance, type Instant, type Result } from './types'

export interface Entry {
	id: string
	/** `direct` was made by one of the two parties; `routed` arrived via a lift. */
	kind: 'direct' | 'routed'
	issuer: 'me' | 'them' | 'network'
	/**
	 * Signed from the reading party's side: positive moved value **toward** this
	 * party, negative moved it away. Never rendered as a bare figure — see
	 * `components/Amount.tsx`.
	 */
	amount: Amount
	date: Instant
	memo?: string
	/** Where the balance stood afterward, stated from the reading party's side. */
	balanceAfter: Balance
	/** Requests this entry answered, if any. */
	answers?: string[]
	/** True while a routed payment has not committed (story 24 path A). */
	unsettled?: boolean
}

/** A tally's signed entries, most recent first (story 24). */
export async function listEntries(tallyId: string): Promise<Result<Entry[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	return { ok: true, value: fixtureFor(getVariant()).entries[tallyId] ?? [] }
}

function fixtureFor(variant: string): { entries: Record<string, Entry[]> } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/entries.empty.json') as { entries: Record<string, Entry[]> }
		default:
			return require('../../mock/data/entries.happy.json') as { entries: Record<string, Entry[]> }
	}
}
