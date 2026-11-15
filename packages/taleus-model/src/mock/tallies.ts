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

/** In the mock, any tally can be removed from the list; nothing is held anyway. */
export async function forgetTally(_tallyId: string): Promise<Result<void>> {
	return { ok: true, value: undefined }
}

function fixtureFor(variant: string): TalliesFixture {
	switch (variant) {
		case 'empty':
			return fixture('tallies.empty') as TalliesFixture
		case 'error':
			return fixture('tallies.error') as TalliesFixture
		case 'unreadable':
			return fixture('tallies.unreadable') as TalliesFixture
		default:
			return fixture('tallies.happy') as TalliesFixture
	}
}
