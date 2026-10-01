/**
 * Shapes the app asks for -- defined in the shared app model (package
 * `taleus-model`), re-exported so screens keep importing from `src/data`.
 */
export { daysSince, engineAbsent, unitOf } from 'taleus-model'
export type {
	Amount,
	Balance,
	CivilDate,
	Counterparty,
	DataError,
	Instant,
	Perspective,
	Result,
	TallyState,
	TallySummary,
	Unit,
	UnitAmount,
	UnitStyle,
	WaitingOn,
} from 'taleus-model'
