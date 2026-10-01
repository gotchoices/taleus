/** entries: shapes and policy shared by every implementation of the model. */
import type { Amount, Balance, Instant, Result } from './types.js'

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

/** What an entry would do to where the parties stand, before it is signed. */
export interface Preview {
	balanceAfter: Balance
	/** What remains of what the counterparty agreed to be owed. */
	roomAfter: Amount
	/** How far past that limit this entry goes, when it goes past it. */
	beyondLimit?: Amount
}

/** What a screen can read and do about entries. Both the mock and the engine implement it. */
export interface EntriesModel {
	/** A tally's signed entries, most recent first (story 24). */
	listEntries(tallyId: string): Promise<Result<Entry[]>>
	/** One entry, for the screen that shows nothing else (story 24 path C). */
	readEntry(tallyId: string, entryId: string): Promise<Result<Entry>>
	/**
	 * Story 20 step 2: the effect is shown before the entry is signed — the balance
	 * that would result, and the room left. Derived here rather than in a screen so
	 * the arithmetic happens once, and in the same place in engine mode.
	 */
	previewEntry(tallyId: string, amount: Amount): Promise<Result<Preview>>
	/**
	 * Story 20 step 4: recording value is the giver's own act, signed in the moment.
	 * The counterparty does not agree to receive value.
	 *
	 * `actId` is the caller's idempotency key — path D requires that a retry cannot
	 * record twice. The engine will have to honour something like it
	 * (`docs/drafts/engine-api.md` question 4).
	 */
	recordEntry(tallyId: string, entry: { actId: string; amount: Amount; memo?: string; answers?: string[] }): Promise<Result<Entry>>
}
