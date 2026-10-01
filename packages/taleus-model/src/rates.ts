/** rates: shapes and policy shared by every implementation of the model. */
import { type Instant, type Result, type Unit, type UnitAmount, daysSince } from './types.js'
import type { HeldUnit } from './settings.js'

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

/** What a screen can read and do about rates. Both the mock and the engine implement it. */
export interface RatesModel {
	readRates(): Promise<Result<RatesPage>>
	/**
	 * Step 9: signed, like anything governing movement that happens without the
	 * party being asked. Following a source signs the *instruction*, which is why
	 * `signed` stays where it was while `updated` moves.
	 */
	setRate(rate: Rate): Promise<Result<RatesPage>>
	/**
	 * Path G step 4, the last of the three ways to limit exposure: simply not
	 * pricing a unit you do not want to trade in. The holdings stay usable within
	 * their own unit.
	 */
	clearRate(denom: string): Promise<Result<RatesPage>>
}
