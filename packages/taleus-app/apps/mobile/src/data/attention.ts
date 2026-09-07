import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { daysSince, engineAbsent, type Instant, type Result, type UnitAmount } from './types'

/**
 * One thing waiting, in data only. Nothing here is prose: what an item *says*
 * is written from `kind` and `waitingOn` through `t()`, because an engine will
 * never hand the app English (`global/i18n.md`).
 */
export interface AttentionItem {
	id: string
	kind: 'offer' | 'request' | 'closing' | 'invitation'
	tallyId: string
	counterparty: { name: string }
	/** Carries its own unit; an amount with no unit is an adapter bug. */
	amount?: UnitAmount
	waitingOn: 'me' | 'them'
	waitingSince: Instant
	/** Route name from `design/specs/mobile/navigation.md`. */
	route: string
	/** Derived, like a request's ageing. */
	waitingDays: number
}

/** Everything waiting on this party, across every tally (story 23). */
export async function listAttention(): Promise<Result<AttentionItem[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const items = fixtureFor(getVariant()).items ?? []
	return { ok: true, value: items.map(item => ({ ...item, waitingDays: daysSince(item.waitingSince) })) }
}

function fixtureFor(variant: string): { items?: Omit<AttentionItem, 'waitingDays'>[] } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/attention.empty.json') as {
				items?: Omit<AttentionItem, 'waitingDays'>[]
			}
		default:
			return require('../../mock/data/attention.happy.json') as {
				items?: Omit<AttentionItem, 'waitingDays'>[]
			}
	}
}
