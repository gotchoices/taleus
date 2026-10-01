import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import { daysSince, type Instant, type Result } from '../types.js'
import type { AttentionItem, PastItem } from '../attention.js'

/**
 * Everything waiting on this party, across every tally (story 23).
 *
 * Items set aside are absent by design: the list is what the party means to
 * deal with, not everything outstanding (path F).
 */
export async function listAttention(): Promise<Result<AttentionItem[]>> {
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
	aside = { ...aside, [id]: new Date().toISOString() }
	return listAttention()
}

/** Path F step 4: back whenever the party likes. */
export async function bringBack(id: string): Promise<Result<AttentionItem[]>> {
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
			return fixture('attention.empty') as AttentionFixture
		case 'error':
			// A week away: ten things waiting, and one whose next move is not this
			// party's (paths C and D).
			return fixture('attention.error') as AttentionFixture
		default:
			return fixture('attention.happy') as AttentionFixture
	}
}
