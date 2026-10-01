/** attention: shapes and policy shared by every implementation of the model. */
import type { Instant, Result, UnitAmount } from './types.js'

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

/** What a screen can read and do about attention. Both the mock and the engine implement it. */
export interface AttentionModel {
	/**
	 * Everything waiting on this party, across every tally (story 23).
	 *
	 * Items set aside are absent by design: the list is what the party means to
	 * deal with, not everything outstanding (path F).
	 */
	listAttention(): Promise<Result<AttentionItem[]>>
	/** What has been through the list, newest first (path E). */
	listPast(): Promise<Result<PastItem[]>>
	/**
	 * Path F. It stops asking and nothing else happens: nothing reaches the other
	 * party, nothing is answered, and what the party owes or agreed is untouched.
	 * Setting aside is not refusing, and the app must never let the two be
	 * confused — which is why this writes nowhere near the tally.
	 */
	setAside(id: string): Promise<Result<AttentionItem[]>>
	/** Path F step 4: back whenever the party likes. */
	bringBack(id: string): Promise<Result<AttentionItem[]>>
	/** Whether an item is one the party set aside, rather than one that resolved. */
	wasSetAside(id: string): boolean
}
