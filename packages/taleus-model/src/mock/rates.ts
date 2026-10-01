import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import { readSettings } from './settings.js'
import type { Result } from '../types.js'
import type { Rate, Conversion, RatesPage } from '../rates.js'

let written: Record<string, Rate> = {}
let removed: string[] = []

export async function readRates(): Promise<Result<RatesPage>> {
	const settings = await readSettings()
	if (!settings.ok) {
		return settings
	}
	const fixture = fixtureFor(getVariant())
	const fromFixture = fixture.rates.filter(
		rate => !removed.includes(rate.denom) && !written[rate.denom],
	)
	const rates = [...fromFixture, ...Object.values(written)]
	const priced = new Set(rates.map(rate => rate.denom))
	return {
		ok: true,
		value: {
			against: settings.value.displayUnit,
			rates,
			// Everything held, priced or not, comes from one list: a unit the party
			// holds and cannot price is a coherent state, not a missing record.
			unpriced: settings.value.unitsHeld.filter(
				unit => unit.denom !== settings.value.displayUnit && !priced.has(unit.denom),
			),
			conversions: fixture.conversions,
		},
	}
}

/**
 * Step 9: signed, like anything governing movement that happens without the
 * party being asked. Following a source signs the *instruction*, which is why
 * `signed` stays where it was while `updated` moves.
 */
export async function setRate(rate: Rate): Promise<Result<RatesPage>> {
	if (rate.part < rate.accept) {
		return {
			ok: false,
			error: {
				kind: 'inverted',
				message: 'Parting with a unit cannot cost less than taking it.',
				retryable: false,
			},
		}
	}
	const now = new Date().toISOString()
	written = { ...written, [rate.denom]: { ...rate, signed: now, updated: now } }
	removed = removed.filter(denom => denom !== rate.denom)
	return readRates()
}

/**
 * Path G step 4, the last of the three ways to limit exposure: simply not
 * pricing a unit you do not want to trade in. The holdings stay usable within
 * their own unit.
 */
export async function clearRate(denom: string): Promise<Result<RatesPage>> {
	written = Object.fromEntries(Object.entries(written).filter(([key]) => key !== denom))
	removed = [...removed, denom]
	return readRates()
}

export function resetRates(): void {
	written = {}
	removed = []
}

interface RatesFixture {
	against: string
	rates: Rate[]
	conversions: Conversion[]
}

function fixtureFor(variant: string): RatesFixture {
	switch (variant) {
		case 'error':
			return fixture('rates.error') as RatesFixture
		default:
			return fixture('rates.happy') as RatesFixture
	}
}
