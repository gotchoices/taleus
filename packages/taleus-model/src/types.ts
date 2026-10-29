/**
 * Shapes the Taleus apps ask for, mirroring `design/specs/domain/interfaces.md`.
 *
 * These are the app model's terms, not taleus-core's: what a screen needs to say, shaped for
 * saying it. Mock mode answers them from fixtures; engine mode answers them from taleus-core.
 * When the two disagree, these types and the fixtures move together.
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
 * A whole number of a unit's smallest part. `{ units: 18000 }` on a dollar
 * tally (divisor 100) is $180.00. Never a decimal, never combined across units
 * except through an explicit estimate.
 */
export interface Amount {
	units: number
	denom?: string
	divisor?: number
}

/**
 * An amount that carries its own unit and needs no tally to be read.
 *
 * It has to carry the *whole* unit, not just the denomination: a figure in a
 * unit that divides by sixty renders as six hundred rather than ten without its
 * divisor, and one with a mark of its own loses it.
 */
export interface UnitAmount extends Amount {
	denom: string
	divisor: number
	code?: string
	mark?: string
	label?: string
}

/** The unit an amount carries, for handing to `Amount`. */
export function unitOf(amount: UnitAmount): Unit {
	return {
		denom: amount.denom,
		divisor: amount.divisor,
		code: amount.code,
		mark: amount.mark,
		label: amount.label,
	}
}

/** A balance always states whose side it is read from. */
export type Perspective = 'owed-to-me' | 'owed-by-me' | 'level'

export interface Balance extends Amount {
	perspective: Perspective
}

/**
 * A unit of account, as the apps need it — `design/specs/domain/amounts.md`.
 *
 * `divisor` is how many smallest parts make one whole — any whole number, so a
 * unit that divides by sixty is said as plainly as one that divides by a hundred.
 * It is the tally contract's own `DenominationDivisor`.
 */
export interface Unit {
	denom: string
	/** How many of its smallest parts make one whole: 100 for cents, 60 for minutes of an hour. */
	divisor: number
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
	/**
	 * Set while the tally is this party's invitation nobody has taken up yet: there is no
	 * counterparty to name, so the party's own note (who it is for) stands in.
	 */
	invitation?: { note?: string }
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

/** How an amount's unit is written: its own mark, or its code. A party's display preference. */
export type UnitStyle = 'mark' | 'code'
