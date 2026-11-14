/**
 * Stack regressions between two CLI parties: faults that showed only when the scenarios were run
 * again and again, so a single run of the tally scenario can miss them. Run this file with the loop
 * (`yarn scenarios:loop`) before adopting a new stack.
 *
 * - A party restarted moments after a write must not lose that write while keeping its pending record:
 *   the strand's next writes then failed "unresolved rival action" for both parties (block stores not
 *   closed on stop; fixed in `stopPartyNode`, optimystic#54 is the same class).
 * - A read finishing while a write commits must not commit that write a second time: in offline mode
 *   that threw "entry … is already sealed" (quereus#38, fixed in 4.26).
 * - A party tells its partner's side gone from there (`reach`, from the strand's live connections),
 *   which is what the delivery watchdog counts stalls by.
 *
 * Amounts are in USD. Jan lets Sam owe him up to 500; Sam extends Jan nothing.
 */
import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'

import { startWorld, type ScenarioParty, type World } from './harness.ts'

const STEP_MS = 300_000

const only = (rows: Record<string, unknown>[]) => (rows.length === 1 ? rows[0] : undefined)
const inState = (state: string) => (rows: Record<string, unknown>[]) => only(rows)?.state === state
const balanced = (balance: string, perspective: string) => (rows: Record<string, unknown>[]) =>
	only(rows)?.balance === balance && only(rows)?.perspective === perspective

void describe('the stack under two parties', { timeout: 30 * 60_000 }, () => {
	let world: World
	let jan: ScenarioParty
	let sam: ScenarioParty

	before(async () => {
		world = await startWorld()
		jan = await world.party('Jan')
		sam = await world.party('Sam')
		await jan.ok('party name Jan')
		await sam.ok('party name Sam')
		const [invitation] = await jan.ok('invite --limit 500')
		await sam.ok(`accept "${String(invitation?.link)}" --yes`)
		await sam.ok(`wait Offered --tally Jan --timeout ${STEP_MS / 1000}`)
		await sam.ok('offer Jan accept')
		await sam.until('tallies', inState('Open'), STEP_MS)
		await jan.until('tallies', inState('Open'), STEP_MS)
	})

	after(async () => {
		await world?.stop()
	})

	void it('restarts a party right after a write, and both still trade', { timeout: STEP_MS * 3 }, async () => {
		// Each round: one party writes and is restarted at once; then both write. Sam owes 1.00 more a round.
		for (const [round, restarted] of [sam, jan, sam].entries()) {
			const payer = restarted === sam ? 'Jan' : 'Sam'
			await restarted.ok(`pay ${payer} 1 just before restart ${round}`)
			await restarted.restart()
			await sam.ok(`pay Jan 1 after restart ${round}`)
			await jan.ok(`pay Sam 1 back ${round}`)
		}
		await jan.until('tallies', balanced('1.00 USD', 'owed-to-me'), STEP_MS)
		await sam.until('tallies', balanced('1.00 USD', 'owed-by-me'), STEP_MS)
	})

	void it('takes reads overlapping a write, each write committed once', { timeout: STEP_MS }, async () => {
		const [tally] = await sam.ok('tallies')
		const tallyId = String(tally?.id)
		const model = sam.model
		for (let i = 0; i < 5; i++) {
			// The write and the reads start together: a read finishing mid-commit used to commit it again.
			const [paid, ...reads] = await Promise.all([
				model.entries.recordEntry(tallyId, { actId: `act:overlap-${i}`, amount: { units: 100 }, memo: `overlap ${i}` }),
				model.tallies.listTallies(),
				model.entries.listEntries(tallyId),
				model.requests.listRequests(tallyId),
			])
			assert.ok(paid.ok, paid.ok ? '' : paid.error.message)
			for (const read of reads) assert.ok(read.ok, read.ok ? '' : read.error.message)
		}
		await jan.until('tallies', balanced('6.00 USD', 'owed-to-me'), STEP_MS)
	})

	void it('sees the partner go away and come back', { timeout: STEP_MS * 2 }, async () => {
		const reach = (value: string) => (rows: Record<string, unknown>[]) => only(rows)?.reach === value
		await jan.until('tally Sam', reach('connected'), STEP_MS)
		await sam.stop()
		await jan.until('tally Sam', reach('partner-away'), STEP_MS)
		await sam.restart()
		await jan.until('tally Sam', reach('connected'), STEP_MS)
	})
})
