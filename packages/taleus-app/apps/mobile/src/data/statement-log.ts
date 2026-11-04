/**
 * Development only: the store's recent statements and their timings (`onStatement`), for
 * `scripts/dev-drive.mjs statements`. A bounded buffer; the oldest fall off.
 */
import type { StatementTiming } from 'taleus-sereus'

const KEEP = 4000
let kept: (StatementTiming & { at: number })[] = []

export function recordStatement(statement: StatementTiming): void {
	kept.push({ ...statement, at: Date.now() })
	if (kept.length > KEEP) kept = kept.slice(-KEEP)
}

/** What was recorded since the last reset, and optionally start afresh. */
export function takeStatements(reset: boolean): (StatementTiming & { at: number })[] {
	const taken = kept
	if (reset) kept = []
	return taken
}
