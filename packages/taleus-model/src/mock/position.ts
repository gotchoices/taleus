import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import type { Result } from '../types.js'
import type { PositionSummary } from '../position.js'

/** The party's position: per unit, an estimate, and spending power (story 40). */
export async function readPosition(): Promise<Result<PositionSummary>> {
	return { ok: true, value: fixtureFor(getVariant()) }
}

function fixtureFor(variant: string): PositionSummary {
	switch (variant) {
		case 'empty':
			return fixture('position.empty') as PositionSummary
		default:
			return fixture('position.happy') as PositionSummary
	}
}
