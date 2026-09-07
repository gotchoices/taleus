import { getLocale } from '../i18n'
import type { CivilDate, Instant } from '../data/types'

/**
 * Two kinds of time, and they are not formatted the same way
 * (`design/specs/domain/interfaces.md` § Dates and instants).
 */

/**
 * A day in the calendar — when terms took effect, when notice runs out. Read in
 * UTC deliberately: `2026-03-02` is the second of March to both parties, and
 * putting it through the reader's zone renders it as the first.
 */
export function formatCivilDate(date: CivilDate, locale = getLocale()): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
		new Date(`${date.slice(0, 10)}T12:00:00Z`),
	)
}

/** A moment — when an entry was signed. Read in the party's own zone. */
export function formatInstant(when: Instant, locale = getLocale()): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(when))
}

export function formatInstantTime(when: Instant, locale = getLocale()): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
		new Date(when),
	)
}
