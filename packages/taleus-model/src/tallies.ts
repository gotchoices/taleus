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
}
