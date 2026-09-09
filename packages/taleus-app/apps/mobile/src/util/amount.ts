import { bumpGeneration } from '../data/generation'
import { getLocale } from '../i18n'
import type { Amount, Unit } from '../data/types'

/**
 * Amounts, decomposed for display — `design/specs/domain/amounts.md`.
 *
 * A Taleus amount is a whole number of a unit's smallest part, and it is
 * written as a whole number and a common fraction, never with a decimal point:
 * `1.000 CHIP` is one CHIP to an American and a thousand to a German, and no
 * choice of separator is safe. This module produces the pieces; drawing them is
 * `components/Amount.tsx`, and no screen does either itself.
 */

/**
 * Whether a figure wears the unit's mark or its code — `amounts.md` § Code and
 * mark. This is the reader's choice, not the tally's: the default is the mark,
 * because `$180` is what people read fluently, and a party who prefers
 * `USD 180` sets it once (story 42) and gets it everywhere. Either way the unit
 * is present, which is the rule that actually matters.
 */
export type UnitStyle = 'mark' | 'code'

let unitStyle: UnitStyle = 'mark'

export function getUnitStyle(): UnitStyle {
	return unitStyle
}

export function setUnitStyle(style: UnitStyle): void {
	if (style === unitStyle) {
		return
	}
	unitStyle = style
	// Figures are composed during render, so a reload is what gets the new form
	// onto screens already showing.
	bumpGeneration()
}

/**
 * What to actually put in front of the unit's figure. A unit whose mark is
 * drawn rather than typed keeps its code under the code preference, so choosing
 * codes really does mean codes everywhere.
 */
export function unitFace(names: UnitNames, style = unitStyle): { text?: string; drawn?: 'chip' } {
	if (style === 'code') {
		return { text: names.code }
	}
	return names.drawn ? { drawn: names.drawn } : { text: names.mark ?? names.code }
}

/** How many of a unit's smallest parts make one whole. */
export function divisorOf(unit: Unit): number {
	return unit.divisor ?? 10 ** unit.scale
}

function isPowerOfTen(divisor: number): boolean {
	if (divisor < 1) {
		return false
	}
	let value = divisor
	while (value % 10 === 0) {
		value /= 10
	}
	return value === 1
}

/** A unit written two ways: the code is always safe, the mark is friendlier. */
export interface UnitNames {
	code: string
	/** A string mark, when the unit has one that is text. */
	mark?: string
	/** Set when the mark is drawn rather than typed — the app owns the figure. */
	drawn?: 'chip'
	/** The long human name, where there is room for it. */
	label: string
	/**
	 * False when the app cannot vouch for the unit, so its code or label must
	 * accompany the mark rather than the mark standing alone.
	 */
	standard: boolean
}

/**
 * A tally-supplied mark may not contain a Unicode currency symbol: a
 * counterparty writing `$` on a unit that is not dollars would misstate money
 * (`amounts.md` § A tally's mark can never impersonate a standard one).
 */
const currencySymbol = /\p{Sc}/u

export function namesFor(unit: Unit, locale = getLocale()): UnitNames {
	if (unit.denom.startsWith('iso4217:')) {
		const code = unit.denom.slice('iso4217:'.length)
		return {
			code,
			mark: currencyMark(code, locale),
			// `Intl.DisplayNames` is absent from some Hermes builds and answers with
			// the code itself. A name the unit carries beats repeating the code.
			label: currencyLabel(code, locale) === code ? (unit.label ?? code) : currencyLabel(code, locale),
			standard: true,
		}
	}
	if (unit.denom === 'CHIP') {
		return { code: 'CHIP', drawn: 'chip', label: 'CHIP', standard: true }
	}
	const mark = unit.mark && !currencySymbol.test(unit.mark) ? unit.mark : undefined
	return {
		code: unit.code ?? unit.label ?? unit.denom,
		mark,
		label: unit.label ?? unit.denom,
		standard: false,
	}
}

export interface AmountParts {
	negative: boolean
	/** The whole part, grouped for the reader's locale. Never has a separator. */
	whole: string
	/** Zero-padded; absent when the unit has no fraction. */
	numerator?: string
	/** Present only when the divisor is not a power of ten. */
	denominator?: string
	unit: UnitNames
	/** What assistive technology says — an ordinary sentence, never the layout. */
	spoken: string
	/** The unambiguous form for anything leaving the app. */
	plain: string
}

export function amountParts(amount: Amount, unit: Unit, locale = getLocale()): AmountParts {
	const divisor = divisorOf({ ...unit, scale: amount.scale ?? unit.scale, divisor: unit.divisor })
	const names = namesFor({ ...unit, denom: amount.denom ?? unit.denom }, locale)
	const units = Math.trunc(amount.units)

	// Sign is held aside rather than taken from the quotient: deriving it there
	// renders any amount between −1 and 0 with a whole part of "−0".
	const negative = units < 0
	const magnitude = Math.abs(units)
	const whole = Math.floor(magnitude / divisor)
	const remainder = magnitude % divisor
	const width = String(divisor - 1).length

	return {
		negative,
		whole: new Intl.NumberFormat(locale, { useGrouping: true }).format(whole),
		numerator: divisor === 1 ? undefined : String(remainder).padStart(width, '0'),
		denominator: divisor === 1 || isPowerOfTen(divisor) ? undefined : String(divisor),
		unit: names,
		spoken: speak(negative, whole, remainder, divisor, names, locale),
		plain: plainForm(negative, whole, remainder, divisor, names),
	}
}

/**
 * The ordinary sentence. A reader who cannot see the layout must not be handed
 * "one eighty fifty" — and for a sixty-part unit must not be handed "two oh
 * seven sixty", which would actively mislead.
 */
function speak(
	negative: boolean,
	whole: number,
	remainder: number,
	divisor: number,
	names: UnitNames,
	locale: string,
): string {
	const sign = negative ? '-' : ''
	if (divisor === 1) {
		return `${sign}${whole} ${names.label}`
	}
	if (isPowerOfTen(divisor)) {
		const value = whole + remainder / divisor
		if (names.standard && names.code.length === 3 && names.mark) {
			return new Intl.NumberFormat(locale, { style: 'currency', currency: names.code }).format(
				negative ? -value : value,
			)
		}
		return `${sign}${value.toFixed(String(divisor - 1).length)} ${names.label}`
	}
	return `${sign}${whole} ${names.label} ${remainder}/${divisor}`
}

/** For export, clipboard, and anything else another system will read. */
function plainForm(
	negative: boolean,
	whole: number,
	remainder: number,
	divisor: number,
	names: UnitNames,
): string {
	const sign = negative ? '-' : ''
	if (divisor === 1) {
		return `${sign}${whole} ${names.code}`
	}
	if (isPowerOfTen(divisor)) {
		const width = String(divisor - 1).length
		return `${sign}${whole}.${String(remainder).padStart(width, '0')} ${names.code}`
	}
	return `${sign}${whole} ${remainder}/${divisor} ${names.code}`
}

function currencyMark(code: string, locale: string): string | undefined {
	try {
		const part = new Intl.NumberFormat(locale, { style: 'currency', currency: code })
			.formatToParts(0)
			.find(p => p.type === 'currency')
		// Intl falls back to the code itself when it has no symbol; that is a
		// code, not a mark, and the caller already has it.
		return part && part.value !== code ? part.value : undefined
	} catch {
		return undefined
	}
}

function currencyLabel(code: string, locale: string): string {
	try {
		return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code
	} catch {
		return code
	}
}

/** A unit as a person would say it, for headings and labels. */
export function unitLabel(denom: string, label?: string, locale = getLocale()): string {
	return namesFor({ denom, scale: 0, label }, locale).label
}
