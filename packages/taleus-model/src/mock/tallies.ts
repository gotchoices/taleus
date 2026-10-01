import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import type { DataError, Result, TallySummary } from '../types.js'

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

	const data = fixtureFor(getVariant())
	if (data.error) {
		return { ok: false, error: data.error }
	}
	return { ok: true, value: data.tallies ?? [] }
}

function fixtureFor(variant: string): TalliesFixture {
	switch (variant) {
		case 'empty':
			return fixture('tallies.empty') as TalliesFixture
		case 'error':
			return fixture('tallies.error') as TalliesFixture
		default:
			return fixture('tallies.happy') as TalliesFixture
	}
}
