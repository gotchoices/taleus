import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { readSettings, type HeldUnit } from './settings'
import { engineAbsent, daysSince, type Instant, type Result, type Unit, type UnitAmount } from './types'

/** A published price the party has chosen to follow, and its own margin. */
export interface RateSource {
	id: string
	name: string
	lastFetched: Instant
	reachable: boolean
	/** In the smallest parts of the unit rates are quoted against. */
	price?: number
}

/**
 * What one unit is worth to this party, in the unit their overall figures are
 * read in (story 41).
 *
 * Not a market price and not a display setting: it is the price at which value
 * will actually convert through them, and it stands until they change it. Two
 * parties can value identical holdings differently and both be right — Taleus
 * has no opinion of its own (path C).
 */
export interface Rate extends Unit {
	basis: 'fixed' | 'source'
	/** Smallest parts of `against` the party will take one whole of this unit for. */
	accept: number
	/**
	 * What parting with one costs. Never less than `accept`: the difference is
	 * the party's own reluctance to let it go, not a fee anyone charges them.
	 */
	part: number
	source?: RateSource
	marginPercent?: number
	/** When the party signed the instruction — not when today's figure arrived. */
	signed: Instant
	updated: Instant
	/** Whether value may route across this unit, or it is priced for figures only. */
	permitsMovement: boolean
	/** Many people hold it, so a stale rate is somebody else's opportunity. */
	widelyTraded?: boolean
	/** Used inside one pair or one circle; there is nobody to arbitrage against. */
	circleOnly?: boolean
}

export interface Conversion {
	id: string
	from: string
	to: string
	fromAmount: UnitAmount
	toAmount: UnitAmount
	at: Instant
	rate: number
	basis: 'fixed' | 'source'
	sourceName?: string
}

export interface RatesPage {
	/** The unit rates are quoted against — the party's display unit. */
	against: string
	rates: Rate[]
	/** Units the party holds and has never priced. Held, and outside everything. */
	unpriced: HeldUnit[]
	conversions: Conversion[]
}

/** A fixed rate nobody has looked at in this long is worth surfacing. */
export const staleAfterDays = 180

export function isStale(rate: Rate, now: number = Date.now()): boolean {
	return rate.basis === 'fixed' && daysSince(rate.updated, now) > staleAfterDays
}

let written: Record<string, Rate> = {}
let removed: string[] = []

export async function readRates(): Promise<Result<RatesPage>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
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
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
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
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
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
			return require('../../mock/data/rates.error.json') as RatesFixture
		default:
			return require('../../mock/data/rates.happy.json') as RatesFixture
	}
}
