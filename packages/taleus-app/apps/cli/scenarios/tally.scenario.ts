/**
 * A tally's life between two CLI parties, Jan (who invites) and Sam, through a relay: formed, traded
 * on, billed, restarted, closed. One tally carries every step, in order -- forming one costs most of
 * the run, and later steps are only meaningful on top of earlier ones.
 *
 *   yarn scenarios                                    # a loopback relay of its own
 *   TALEUS_SCENARIO_RELAY=<multiaddr> yarn scenarios  # e.g. relay.sereus.org
 *
 * Amounts are in USD. Jan lets Sam owe him up to 500; Sam extends Jan nothing.
 */
import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'

import { startWorld, type ScenarioParty, type World } from './harness.ts'

const STEP_MS = 300_000

/** The one tally a party holds, as `tallies` lists it. */
const only = (rows: Record<string, unknown>[]) => (rows.length === 1 ? rows[0] : undefined)
const inState = (state: string) => (rows: Record<string, unknown>[]) => only(rows)?.state === state
const balanced = (balance: string, perspective: string) => (rows: Record<string, unknown>[]) =>
	only(rows)?.balance === balance && only(rows)?.perspective === perspective

void describe('a tally between two parties', { timeout: 30 * 60_000 }, () => {
	let world: World
	let jan: ScenarioParty
	let sam: ScenarioParty

	before(async () => {
		world = await startWorld()
		jan = await world.party('Jan')
		sam = await world.party('Sam')
		await jan.ok('party name Jan')
		await sam.ok('party name Sam')
	})

	after(async () => {
		await world?.stop()
	})

	void it('forms: invite, accept, the inviter offers terms, both see it open', { timeout: STEP_MS * 2 }, async () => {
		const [invitation] = await jan.ok('invite --limit 500 --note "for Sam"')
		const link = invitation?.link
		assert.equal(typeof link, 'string')
		await sam.ok(`accept "${String(link)}" --yes`)
		await sam.ok(`wait Offered --tally Jan --timeout ${STEP_MS / 1000}`)
		await sam.ok('offer Jan accept')
		await sam.until('tallies', inState('Open'), STEP_MS)
		await jan.until('tallies', inState('Open'), STEP_MS)
	})

	void it('pays: both parties read the same balance, each from its own side', { timeout: STEP_MS }, async () => {
		await sam.ok('pay Jan 120 March hours')
		await jan.until('tallies', balanced('120.00 USD', 'owed-to-me'), STEP_MS)
		const [samSide] = await sam.ok('tallies')
		assert.equal(samSide?.balance, '120.00 USD')
		assert.equal(samSide?.perspective, 'owed-by-me')
	})

	void it('pays past the credit limit: a chit is never refused for its amount', { timeout: STEP_MS }, async () => {
		await sam.ok('pay Jan 400 tools')
		await jan.until('tallies', balanced('520.00 USD', 'owed-to-me'), STEP_MS)
	})

	void it('answers a request: the payment names it, and it reads answered on both sides', { timeout: STEP_MS }, async () => {
		const [asked] = await jan.ok('request Sam 20 delivery')
		const id = String(asked?.id)
		await sam.until('requests', rows => rows.some(row => row.id === id && row.state === 'waiting'), STEP_MS)
		await sam.ok(`pay Jan 20 --answers ${id} delivery`)
		await jan.until('requests', rows => rows.some(row => row.id === id && row.state === 'answered'), STEP_MS)
		await jan.until('tallies', balanced('540.00 USD', 'owed-to-me'), STEP_MS)
	})

	void it('declines a request: nothing moves, and the requester sees it refused', { timeout: STEP_MS }, async () => {
		const [asked] = await jan.ok('request Sam 999 "a bit much"')
		const id = String(asked?.id)
		await sam.until('requests', rows => rows.some(row => row.id === id && row.state === 'waiting'), STEP_MS)
		await sam.ok(`decline ${id} no`)
		await jan.until('requests', rows => rows.some(row => row.id === id && row.state === 'refused'), STEP_MS)
		const [janSide] = await jan.ok('tallies')
		assert.equal(janSide?.balance, '540.00 USD')
	})

	void it('restarts: a party stopped and started again holds its tally and trades on it', { timeout: STEP_MS }, async () => {
		await sam.restart()
		await sam.until('tallies', balanced('540.00 USD', 'owed-by-me'), STEP_MS)
		await sam.ok('pay Jan 10 after restart')
		await jan.until('tallies', balanced('550.00 USD', 'owed-to-me'), STEP_MS)
	})

	void it('closes: chits either way while closing, closed at zero, then nothing more', { timeout: STEP_MS * 2 }, async () => {
		await jan.ok('close Sam')
		await sam.until('tallies', inState('Closing'), STEP_MS)
		// Closing gates lifts, never a direct chit: Sam may still add to what he owes.
		await sam.ok('pay Jan 50 one more')
		await jan.until('tallies', balanced('600.00 USD', 'owed-to-me'), STEP_MS)
		// Jan, who is owed, closes it with a chit for the outstanding balance.
		await jan.ok('pay Sam 600 settled in kind')
		await jan.until('tallies', inState('Closed'), STEP_MS)
		await sam.until('tallies', inState('Closed'), STEP_MS)
		// Closed is terminal: even a duly signed chit is refused.
		const late = await sam.run('pay Jan 1 too late')
		assert.notEqual(late.code, 0)
		assert.match(late.notes.join(' '), /closed/i)
	})
})
