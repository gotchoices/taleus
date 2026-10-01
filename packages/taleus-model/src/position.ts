/** position: shapes and policy shared by every implementation of the model. */
import type { Amount, Result, UnitAmount } from './types.js'

export interface PerUnitPosition {
	denom: string
	scale: number
	divisor?: number
	code?: string
	mark?: string
	label?: string
	owedToMe: Amount
	owedByMe: Amount
}

export interface Estimate {
	unit: string
	scale: number
	owedToMe: Amount
	owedByMe: Amount
	net: Amount
	/** Units the estimate accounts for. */
	covers: string[]
	/** Units left out for want of a rate, named rather than silently dropped. */
	excluded: { denom: string; label?: string; reason: string }[]
	/** Always the less favourable side of a two-way rate. */
	direction: 'conservative'
}

/** Both figures carry their own unit; the screen must never guess one. */
export interface SpendingPower {
	heldByOthers: UnitAmount
	creditExtendedToMe: UnitAmount
}

export interface PositionSummary {
	displayUnit: string
	perUnit: PerUnitPosition[]
	estimate: Estimate | null
	spendingPower: SpendingPower | null
}

/** What a screen can read and do about position. Both the mock and the engine implement it. */
export interface PositionModel {
	/** The party's position: per unit, an estimate, and spending power (story 40). */
	readPosition(): Promise<Result<PositionSummary>>
}
