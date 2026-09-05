import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import type { DataError, Result, TallySummary } from './types'

interface TalliesFixture {
	tallies?: TallySummary[]
	error?: DataError
}

/**
 * The party's tallies (stories 04, 06).
 *
 * Callers get a `Result` rather than an exception: a list that cannot be read
 * is a state the screen shows, not a crash.
 */
export async function listTallies(): Promise<Result<TallySummary[]>> {
	if (!mockMode) {
		return {
			ok: false,
			error: {
				kind: 'engine-absent',
				message: 'The taleus engine is not wired up yet.',
				retryable: false,
			},
		}
	}

	const data = fixtureFor(getVariant())
	if (data.error) {
		return { ok: false, error: data.error }
	}
	return { ok: true, value: data.tallies ?? [] }
}

function fixtureFor(variant: string): TalliesFixture {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/tallies.empty.json') as TalliesFixture
		case 'error':
			return require('../../mock/data/tallies.error.json') as TalliesFixture
		default:
			return require('../../mock/data/tallies.happy.json') as TalliesFixture
	}
}
