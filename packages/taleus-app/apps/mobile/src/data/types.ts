/**
 * Shapes the app asks for, mirroring `design/specs/domain/interfaces.md`.
 *
 * These are the app's reading of what the engine will one day answer. The
 * engine does not exist yet, so mock mode is where the surface is being
 * defined — see `mock/data/README.md`. When the engine's real surface differs,
 * these types and the fixtures move together.
 */

/**
 * A day in the calendar — `2026-03-02`. Reads the same to both parties wherever
 * they are, and is never rendered through a time zone (`interfaces.md`
 * § Dates and instants).
 */
export type CivilDate = string

/** A moment — `2026-03-02T16:40:00Z`. Reads in each party's own zone. */
export type Instant = string

/**
 * A whole number of a unit's smallest part. `{ units: 18000 }` on a scale-2
 * dollar tally is $180.00. Never a decimal, never combined across units except
 * through an explicit estimate.
 */
export interface Amount {
	units: number
	denom?: string
	scale?: number
}

/** An amount that carries its own unit and needs no tally to be read. */
export interface UnitAmount extends Amount {
	denom: string
	scale: number
}

/** A balance always states whose side it is read from. */
export type Perspective = 'owed-to-me' | 'owed-by-me' | 'level'

export interface Balance extends Amount {
	perspective: Perspective
}

/**
 * A unit of account, as the apps need it — `design/specs/domain/amounts.md`.
 *
 * `divisor` is how many smallest parts make one whole and is the general fact;
 * `scale` states it as a power of ten, which covers every unit the engine hands
 * over today. A unit that divides some other way — sixty minutes to an hour —
 * carries `divisor` instead, and is the reason the apps prefer it.
 */
export interface Unit {
	denom: string
	scale: number
	/** Overrides `10 ** scale`; the only way to say a non-decimal subdivision. */
	divisor?: number
	/** Short code, always safe to show. Standard units take theirs from the standard. */
	code?: string
	/**
	 * Short mark the parties write it with. Ignored if it contains a currency
	 * symbol — a counterparty cannot make a unit look like dollars.
	 */
	mark?: string
	/** Human label for a unit whose identifier is not self-explanatory. */
	label?: string
}

export interface Counterparty {
	sid: string
	name: string
	disclosed?: Record<string, string>
}

/** Derived by the engine, never stored — `interfaces.md` § Tally states. */
export type TallyState = 'Forming' | 'Offered' | 'Expired' | 'Open' | 'Amending' | 'Closing' | 'Closed'

/** Whose move it is. Drives the attention list; never a demand on the waiter. */
export type WaitingOn = 'me' | 'them' | 'nobody'

export interface TallySummary {
	id: string
	counterparty: Counterparty
	unit: Unit
	balance: Balance
	state: TallyState
	waitingOn: WaitingOn
	waitingReason?: 'offer' | 'request' | 'closing'
	lastActivity: Instant
}

/** Anything an adapter could not answer, said plainly rather than thrown away. */
export interface DataError {
	kind: string
	message: string
	retryable: boolean
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DataError }

/** The one place mock adapters say "the engine is not here yet". */
export const engineAbsent: DataError = {
	kind: 'engine-absent',
	message: 'The taleus engine is not wired up yet.',
	retryable: false,
}

/** Whole days between an instant and now — never stored, always derived. */
export function daysSince(when: Instant, now: number = Date.now()): number {
	return Math.max(0, Math.floor((now - new Date(when).getTime()) / 86_400_000))
}
