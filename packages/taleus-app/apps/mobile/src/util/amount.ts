import type { Amount, Unit } from '../data/types'

/**
 * Amounts are whole numbers of a unit's smallest part (`interfaces.md`).
 * Formatting is the only place a decimal appears, and it always carries the
 * unit — a bare number means nothing on a party's mixed-unit list.
 */
export function formatAmount(amount: Amount, unit: Unit, locale = 'en'): string {
	const scale = amount.scale ?? unit.scale
	const denom = amount.denom ?? unit.denom
	const value = Math.abs(amount.units) / 10 ** scale

	const currency = denom.startsWith('iso4217:') ? denom.slice('iso4217:'.length) : undefined
	if (currency) {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			minimumFractionDigits: scale,
			maximumFractionDigits: scale,
		}).format(value)
	}

	const label = unit.label ?? denom
	const number = new Intl.NumberFormat(locale, {
		minimumFractionDigits: scale,
		maximumFractionDigits: scale,
	}).format(value)
	return `${number} ${label}`
}

/**
 * A unit as a person would say it. `iso4217:USD` is a machine's name for a
 * thing everyone else calls dollars.
 */
export function unitLabel(denom: string, label?: string, locale = 'en'): string {
	if (label) {
		return label
	}
	if (denom.startsWith('iso4217:')) {
		const code = denom.slice('iso4217:'.length)
		try {
			return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code
		} catch {
			return code
		}
	}
	if (denom.startsWith('cid:')) {
		return denom.slice('cid:'.length)
	}
	return denom
}
