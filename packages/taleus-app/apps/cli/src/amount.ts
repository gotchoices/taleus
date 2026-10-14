/**
 * Amounts typed and printed in a tally's unit, as written: `12.50` on a dollar tally is 1250 cents.
 * More decimal places than the unit has is refused, never rounded (`design/specs/cli/commands.md`
 * → Amounts).
 */
import type { Amount, Unit } from 'taleus-model'

/** The units of `text` in `unit`, or an error saying what is wrong with it. */
export function parseAmount(text: string, unit: Pick<Unit, 'denom' | 'scale'>): Amount {
	const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim())
	if (!match) throw new Error(`not an amount: ${JSON.stringify(text)} (digits, and a "." before any fraction)`)
	const fraction = match[2] ?? ''
	if (fraction.length > unit.scale) throw new Error(`${text} has ${fraction.length} decimal places; ${codeOf(unit)} has ${unit.scale}`)
	const units = Number(match[1]) * 10 ** unit.scale + Number(fraction.padEnd(unit.scale, '0') || '0')
	if (!Number.isSafeInteger(units)) throw new Error(`${text} is too large`)
	return { units, denom: unit.denom, scale: unit.scale }
}

/** `units` written in `unit`: `12.50 USD`. A negative amount keeps its sign. */
export function formatAmount(units: number, unit: Pick<Unit, 'denom' | 'scale' | 'code'>): string {
	const sign = units < 0 ? '-' : ''
	const digits = String(Math.abs(units)).padStart(unit.scale + 1, '0')
	const whole = unit.scale ? digits.slice(0, -unit.scale) : digits
	const fraction = unit.scale ? `.${digits.slice(-unit.scale)}` : ''
	return `${sign}${whole}${fraction} ${codeOf(unit)}`
}

/** What a unit is called on the command line: its code, else the last part of its denomination. */
export function codeOf(unit: Pick<Unit, 'denom'> & { code?: string }): string {
	return unit.code ?? unit.denom.split(':').pop() ?? unit.denom
}

/** The units the CLI can open a tally in, by code. */
export const UNITS: Record<string, Unit> = {
	USD: { denom: 'iso4217:USD', scale: 2, code: 'USD' },
	CHIP: { denom: 'CHIP', scale: 3, code: 'CHIP' },
}
