import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { readTally } from './tally'
import { engineAbsent, type Amount, type Balance, type Instant, type Result } from './types'

export interface Entry {
	id: string
	/** `direct` was made by one of the two parties; `routed` arrived via a lift. */
	kind: 'direct' | 'routed'
	issuer: 'me' | 'them' | 'network'
	/**
	 * Signed from the reading party's side: positive moved value **toward** this
	 * party, negative moved it away. Never rendered as a bare figure — see
	 * `components/Amount.tsx`.
	 */
	amount: Amount
	date: Instant
	memo?: string
	/** Where the balance stood afterward, stated from the reading party's side. */
	balanceAfter: Balance
	/** Requests this entry answered, if any. */
	answers?: string[]
	/** True while a routed payment has not committed (story 24 path A). */
	unsettled?: boolean
}

/** A tally's signed entries, most recent first (story 24). */
export async function listEntries(tallyId: string): Promise<Result<Entry[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	return {
		ok: true,
		value: [...(recorded[tallyId] ?? []), ...(fixtureFor(getVariant()).entries[tallyId] ?? [])],
	}
}

function fixtureFor(variant: string): { entries: Record<string, Entry[]> } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/entries.empty.json') as { entries: Record<string, Entry[]> }
		default:
			return require('../../mock/data/entries.happy.json') as { entries: Record<string, Entry[]> }
	}
}

/** What an entry would do to where the parties stand, before it is signed. */
export interface Preview {
	balanceAfter: Balance
	/** What remains of what the counterparty agreed to be owed. */
	roomAfter: Amount
	/** How far past that limit this entry goes, when it goes past it. */
	beyondLimit?: Amount
}

/**
 * Story 20 step 2: the effect is shown before the entry is signed — the balance
 * that would result, and the room left. Derived here rather than in a screen so
 * the arithmetic happens once, and in the same place in engine mode.
 */
export async function previewEntry(tallyId: string, amount: Amount): Promise<Result<Preview>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const tally = await readTally(tallyId)
	if (!tally.ok) {
		return tally
	}
	// Value given moves the balance toward the counterparty: it reduces what they
	// owe this party, or increases what this party owes them. Which side of zero
	// it lands on is arithmetic, not a different kind of act (path F).
	const signed = tally.value.balance.perspective === 'owed-by-me' ? -1 : 1
	const before = signed * tally.value.balance.units
	const after = before - amount.units
	const room = tally.value.roomToSpend.units - amount.units
	return {
		ok: true,
		value: {
			balanceAfter: {
				units: Math.abs(after),
				perspective: after > 0 ? 'owed-to-me' : after < 0 ? 'owed-by-me' : 'level',
			},
			roomAfter: { units: Math.max(0, room) },
			beyondLimit: room < 0 ? { units: -room } : undefined,
		},
	}
}

/** Mock writes, held in memory as elsewhere. */
let recorded: Record<string, Entry[]> = {}
const seen = new Set<string>()

/**
 * Story 20 step 4: recording value is the giver's own act, signed in the moment.
 * The counterparty does not agree to receive value.
 *
 * `actId` is the caller's idempotency key — path D requires that a retry cannot
 * record twice. The engine will have to honour something like it
 * (`docs/drafts/engine-api.md` question 4).
 */
export async function recordEntry(
	tallyId: string,
	entry: { actId: string; amount: Amount; memo?: string },
): Promise<Result<Entry>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const tally = await readTally(tallyId)
	if (!tally.ok) {
		return tally
	}
	// Path D: with the counterparty wholly absent there is nowhere for the entry
	// to land. It does not go through, nothing is half-done, and the party is
	// told plainly — "did that go through" gets a straight answer.
	if (!tally.value.counterpartyReachable) {
		return {
			ok: false,
			error: {
				kind: 'counterparty-unreachable',
				message: 'Nothing of theirs is reachable, so this did not go through.',
				retryable: true,
			},
		}
	}
	const already = (recorded[tallyId] ?? []).find(e => e.id === `entry:${entry.actId}`)
	if (seen.has(entry.actId) && already) {
		return { ok: true, value: already }
	}
	seen.add(entry.actId)
	const preview = await previewEntry(tallyId, entry.amount)
	const made: Entry = {
		id: `entry:${entry.actId}`,
		kind: 'direct',
		issuer: 'me',
		amount: { units: -entry.amount.units },
		date: new Date().toISOString(),
		memo: entry.memo,
		balanceAfter: preview.ok ? preview.value.balanceAfter : { units: 0, perspective: 'level' },
	}
	recorded = { ...recorded, [tallyId]: [made, ...(recorded[tallyId] ?? [])] }
	return { ok: true, value: made }
}

export function resetEntries(): void {
	recorded = {}
	seen.clear()
}
