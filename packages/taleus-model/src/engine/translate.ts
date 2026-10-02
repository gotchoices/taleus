/**
 * Between the core's vocabulary and the model's.
 *
 * The core speaks for one party: amounts are signed from the reader's side, states are its five
 * lifecycle words, and dates are the calendar dates its signers assert. The model speaks for a
 * screen: an amount carries its unit, a balance says whose side it is read from, and states are
 * what a person sees. Everything here is a pure function of what the core returned.
 */
import type {
	Amount as CoreAmount,
	PaymentRequest as CorePaymentRequest,
	TallyState as CoreState,
	TallyView,
} from 'taleus-core'

import type { Amount, Balance, DataError, Instant, Result, TallyState, Unit } from '../types.js'

/** The unit a tally is denominated in, as the model names it. */
export function unitOf(view: Pick<TallyView, 'denomination' | 'denominationScale'>): Unit {
	return { denom: view.denomination, scale: view.denominationScale }
}

export function amount(units: number, unit: Unit): Amount {
	return { units, denom: unit.denom, scale: unit.scale }
}

export function fromCore(value: CoreAmount, unit: Unit): Amount {
	return amount(value.units, unit)
}

export function toCore(value: Amount, denomination: string): CoreAmount {
	return { units: value.units, denomination: value.denom ?? denomination }
}

/** A signed reader-side figure as a balance: unsigned, with the side it is read from. */
export function balanceOf(signed: number, unit: Unit): Balance {
	// `+ 0` because the core reads a zero as `-0` on the foil side (test/STATUS.md § 0).
	const units = Math.abs(signed) + 0
	return {
		...amount(units, unit),
		perspective: signed > 0 ? 'owed-to-me' : signed < 0 ? 'owed-by-me' : 'level',
	}
}

const STATES: Record<CoreState, TallyState> = {
	forming: 'Forming',
	offered: 'Offered',
	open: 'Open',
	closing: 'Closing',
	closed: 'Closed',
}

export function stateOf(state: CoreState): TallyState {
	return STATES[state]
}

/**
 * A signed calendar date as a moment. The core records dates, not times -- its signers assert a
 * day, deliberately (`docs/timestamps.md`) -- so a moment derived from one is the start of that
 * day in UTC, and nothing finer should be read into it.
 */
export function instantOf(date: string): Instant {
	return date ? `${date}T00:00:00Z` : new Date(0).toISOString()
}

export function requestStateOf(state: CorePaymentRequest['state']): 'waiting' | 'answered' | 'refused' {
	// An expired request is still outstanding to the person reading it: the core's expiry is
	// advisory, and `feat-invoice-lifecycle` replaces it with ageing.
	return state === 'paid' ? 'answered' : state === 'declined' ? 'refused' : 'waiting'
}

/** A display name for a party: what they certified, else a short form of their Sid. */
export function nameOf(sid: string, certificate: unknown): string {
	const named = (certificate as { name?: unknown } | undefined)?.name
	if (typeof named === 'string' && named.length > 0) return named
	return sid ? `${sid.slice(0, 12)}…` : ''
}

/* ── results ─────────────────────────────────────────────────────────────── */

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })

export function failed<T>(kind: string, message: string, retryable = false): Result<T> {
	return { ok: false, error: { kind, message, retryable } }
}

/**
 * Something the model asks for that the core does not do yet. Named, with the ticket that would
 * provide it, so a screen can say "not yet" and a developer can find out why.
 */
export function unsupported<T>(what: string, ticket: string): Result<T> {
	return failed('unsupported', `${what} is not supported by the engine yet (${ticket}).`)
}

/** A core refusal as the model's error. The core's own code becomes the kind. */
export function refused<T>(refusal: { code: string; message: string; constraint?: string }): Result<T> {
	const error: DataError = { kind: refusal.code, message: refusal.message, retryable: false }
	return { ok: false, error }
}
