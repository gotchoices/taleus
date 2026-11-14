/** tallies: shapes and policy shared by every implementation of the model. */
import type { Result, TallySummary } from './types.js'

/** What a screen can read and do about tallies. Both the mock and the engine implement it. */
export interface TalliesModel {
	/**
	 * The party's tallies (stories 04, 06).
	 *
	 * Callers get a `Result` rather than an exception: a list that cannot be read
	 * is a state the screen shows, not a crash.
	 */
	listTallies(): Promise<Result<TallySummary[]>>
	/**
	 * Stop listing a tally this device no longer holds (`unreadable: 'missing'`). Refused for any
	 * other tally: one that is only slow or failing is still this party's record.
	 */
	forgetTally(tallyId: string): Promise<Result<void>>
}
