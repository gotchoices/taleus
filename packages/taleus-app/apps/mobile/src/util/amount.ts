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
