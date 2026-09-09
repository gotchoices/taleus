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
	/** Present when the item names a request, so it can land on the request. */
	requestId?: string
	/** When it stops being answerable. Absent means open-ended. */
	expires?: Instant
	/** Derived, like a request's ageing. */
	waitingDays: number
	/**
	 * Derived from `expires`. The party should be able to tell urgent from merely
	 * open without reading dates and doing the arithmetic (story 23 path B).
	 */
	daysLeft?: number
}

/**
 * What became of something that has left the list (story 23 path E).
 *
 * Nothing quietly disappears: an item leaving is an event with an outcome. Set
 * aside is one of them, and is deliberately not an answer — nothing about it
 * reached the other party.
 */
export type Outcome = 'answered' | 'refused' | 'withdrawn' | 'lapsed' | 'set-aside'

export interface PastItem {
	id: string
	kind: AttentionItem['kind']
	tallyId: string
	counterparty: { name: string }
	amount?: UnitAmount
	route: string
	requestId?: string
	arrived: Instant
	resolved: Instant
	outcome: Outcome
}

/** A deadline this close is the difference between urgent and merely open. */
export const soonWithinDays = 7

/**
 * Everything waiting on this party, across every tally (story 23).
 *
 * Items set aside are absent by design: the list is what the party means to
 * deal with, not everything outstanding (path F).
 */
export async function listAttention(): Promise<Result<AttentionItem[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const items = fixtureFor(getVariant()).items ?? []
	return {
		ok: true,
		value: items
			.filter(item => !aside[item.id])
			.map(item => ({
				...item,
				waitingDays: daysSince(item.waitingSince),
				daysLeft: item.expires === undefined ? undefined : daysUntil(item.expires),
			})),
	}
}

/** Whole days from now until an instant; never negative. */
function daysUntil(when: Instant, now: number = Date.now()): number {
	return Math.max(0, Math.ceil((new Date(when).getTime() - now) / 86_400_000))
}

/** What has been through the list, newest first (path E). */
export async function listPast(): Promise<Result<PastItem[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const fixture = fixtureFor(getVariant())
	const items = fixture.items ?? []
	const setAsideNow: PastItem[] = items
		.filter(item => aside[item.id])
		.map(item => ({
			id: item.id,
			kind: item.kind,
			tallyId: item.tallyId,
			counterparty: item.counterparty,
			amount: item.amount,
			route: item.route,
			requestId: item.requestId,
			arrived: item.waitingSince,
			resolved: aside[item.id],
			outcome: 'set-aside' as const,
		}))
	const past = [...setAsideNow, ...(fixture.past ?? [])]
	return {
		ok: true,
		value: [...past].sort((a, b) => b.resolved.localeCompare(a.resolved)),
	}
}

/** Mock writes: which items this party has set aside, and when. */
let aside: Record<string, Instant> = {}

/**
 * Path F. It stops asking and nothing else happens: nothing reaches the other
 * party, nothing is answered, and what the party owes or agreed is untouched.
 * Setting aside is not refusing, and the app must never let the two be
 * confused — which is why this writes nowhere near the tally.
 */
export async function setAside(id: string): Promise<Result<AttentionItem[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	aside = { ...aside, [id]: new Date().toISOString() }
	return listAttention()
}

/** Path F step 4: back whenever the party likes. */
export async function bringBack(id: string): Promise<Result<AttentionItem[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	aside = Object.fromEntries(Object.entries(aside).filter(([key]) => key !== id))
	return listAttention()
}

/** Whether an item is one the party set aside, rather than one that resolved. */
export function wasSetAside(id: string): boolean {
	return aside[id] !== undefined
}

export function resetAttention(): void {
	aside = {}
}

interface AttentionFixture {
	items?: Omit<AttentionItem, 'waitingDays' | 'daysLeft'>[]
	past?: PastItem[]
}

function fixtureFor(variant: string): AttentionFixture {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/attention.empty.json') as AttentionFixture
		case 'error':
			// A week away: ten things waiting, and one whose next move is not this
			// party's (paths C and D).
			return require('../../mock/data/attention.error.json') as AttentionFixture
		default:
			return require('../../mock/data/attention.happy.json') as AttentionFixture
	}
}
