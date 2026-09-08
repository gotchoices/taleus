import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { engineAbsent, type Amount, type Result, type UnitAmount } from './types'

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

/** The party's position: per unit, an estimate, and spending power (story 40). */
export async function readPosition(): Promise<Result<PositionSummary>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	return { ok: true, value: fixtureFor(getVariant()) }
}

function fixtureFor(variant: string): PositionSummary {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/position.empty.json') as PositionSummary
		default:
			return require('../../mock/data/position.happy.json') as PositionSummary
	}
}
