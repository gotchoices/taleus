/**
 * Amounts typed and printed in a tally's unit, as written: `12.50` on a dollar tally is 1250 cents.
 * More decimal places than the unit has is refused, never rounded (`design/specs/cli/commands.md`
 * → Amounts). A unit whose divisor is not a power of ten is written as a whole and a fraction of
 * it, as the apps show it: `2 30/60` on a tally of hours counted in minutes is 150.
 */
import type { Amount, Unit } from 'taleus-model'

/** The units of `text` in `unit`, or an error saying what is wrong with it. */
export function parseAmount(text: string, unit: Pick<Unit, 'denom' | 'divisor'> & { code?: string }): Amount {
	const units = decimalPlaces(unit.divisor) === undefined ? parseFraction(text.trim(), unit) : parseDecimal(text.trim(), unit)
	if (!Number.isSafeInteger(units)) throw new Error(`${text} is too large`)
	return { units, denom: unit.denom, divisor: unit.divisor }
}

/** `units` written in `unit`: `12.50 USD`, or `2 30/60 HRS`. A negative amount keeps its sign. */
export function formatAmount(units: number, unit: Pick<Unit, 'denom' | 'divisor' | 'code'>): string {
	const sign = units < 0 ? '-' : ''
	const magnitude = Math.abs(units)
	const places = decimalPlaces(unit.divisor)
	return `${sign}${places === undefined ? fractionText(magnitude, unit.divisor) : decimalText(magnitude, places)} ${codeOf(unit)}`
}

/** What a unit is called on the command line: its code, else the last part of its denomination. */
export function codeOf(unit: Pick<Unit, 'denom'> & { code?: string }): string {
	return unit.code ?? unit.denom.split(':').pop() ?? unit.denom
}

/** The units the CLI can open a tally in, by code. */
export const UNITS: Record<string, Unit> = {
	USD: { denom: 'iso4217:USD', divisor: 100, code: 'USD' },
	CHIP: { denom: 'CHIP', divisor: 1000, code: 'CHIP' },
}

/** How many decimal places a divisor is, or undefined when it is not a power of ten. */
function decimalPlaces(divisor: number): number | undefined {
	let places = 0
	for (let rest = divisor; rest > 1; rest /= 10) {
		if (rest % 10 !== 0) return undefined
		places++
	}
	return places
}

function parseDecimal(text: string, unit: Pick<Unit, 'denom' | 'divisor'> & { code?: string }): number {
	const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
	if (!match) throw new Error(`not an amount: ${JSON.stringify(text)} (digits, and a "." before any fraction)`)
	const places = decimalPlaces(unit.divisor) ?? 0
	const fraction = match[2] ?? ''
	if (fraction.length > places) throw new Error(`${text} has ${fraction.length} decimal places; ${codeOf(unit)} has ${places}`)
	return Number(match[1]) * unit.divisor + Number(fraction.padEnd(places, '0') || '0')
}

/** `2`, `30/60` or `2 30/60`, the fraction over the unit's own divisor. */
function parseFraction(text: string, unit: Pick<Unit, 'denom' | 'divisor'> & { code?: string }): number {
	const match = /^(?:(\d+)(?:\s+(\d+)\/(\d+))?|(\d+)\/(\d+))$/.exec(text)
	if (!match) throw new Error(`not an amount: ${JSON.stringify(text)} (a whole number, then any part as n/${unit.divisor})`)
	const whole = Number(match[1] ?? '0')
	const numerator = Number(match[2] ?? match[4] ?? '0')
	const denominator = Number(match[3] ?? match[5] ?? unit.divisor)
	if (denominator !== unit.divisor) throw new Error(`${text}: ${codeOf(unit)} is counted in 1/${unit.divisor} parts`)
	if (numerator >= unit.divisor) throw new Error(`${text}: the part must be less than ${unit.divisor}/${unit.divisor}`)
	return whole * unit.divisor + numerator
}

function decimalText(magnitude: number, places: number): string {
	const digits = String(magnitude).padStart(places + 1, '0')
	return places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits
}

function fractionText(magnitude: number, divisor: number): string {
	const whole = Math.floor(magnitude / divisor)
	const part = magnitude % divisor
	return part ? `${whole} ${String(part).padStart(String(divisor - 1).length, '0')}/${divisor}` : String(whole)
}
