/**
 * The contract: what every screen relies on, whatever answers it.
 *
 * Run against both implementations. The mock answers from the design fixtures; the engine answers
 * from a scripted world built with the simulated counterparty. A check that fails on the mock
 * means the fixtures describe something the engine could never produce -- which is how mock and
 * engine stop drifting apart.
 */
import { createLocalWorld, STANDARD_AGREEMENT } from './engine/index.js'
import { createMockModel } from './mock/index.js'
import type { TaleusModel } from './model.js'
import { diskFixtures, tallySchema } from './test-fixtures.js'
import type { Result, TallySummary } from './types.js'

const STATES = ['Forming', 'Offered', 'Expired', 'Open', 'Amending', 'Closing', 'Closed']
const ROUTES = ['ReviewOffer', 'RequestView', 'TallyView', 'ReviewInvitation']

function must<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
	return result.value
}

async function mockWorld(): Promise<TaleusModel> {
	const { model, controls } = createMockModel(diskFixtures)
	controls.setVariant('happy')
	controls.reset()
	return model
}

/** Two tallies with the simulated counterparty, value moved both ways, a request standing. */
async function engineWorld(): Promise<TaleusModel> {
	const USD = { denom: 'iso4217:USD', scale: 2 }
	const CHIP = { denom: 'CHIP', scale: 3 }
	const world = await createLocalWorld({ schema: tallySchema(), now: () => new Date('2026-09-07T12:00:00Z') })
	const me = world.me.model
	const them = world.counterparty.model
	must(await me.party.createIdentity())
	must(await me.party.setDisplayName('Jan'))
	for (const unit of [USD, CHIP]) {
		const made = must(await me.invitations.createInvitation({ unit, creditLimit: { units: 50000, ...unit }, noticeDays: 21, agreementId: STANDARD_AGREEMENT.id, goodForDays: 7 }))
		must(await them.invitations.respondToInvitation(made.token, 'accept', { disclose: {}, creditLimit: { units: 20000, ...unit }, noticeDays: 21 }))
		await world.settled()
	}
	const tallies = must(await me.tallies.listTallies())
	const usdTally = tallies.find(t => t.unit.denom === USD.denom) as TallySummary
	const chipTally = tallies.find(t => t.unit.denom === CHIP.denom) as TallySummary
	must(await them.entries.recordEntry(usdTally.id, { actId: 'a1', amount: { units: 4200, ...USD }, memo: 'materials' }))
	must(await me.entries.recordEntry(usdTally.id, { actId: 'a2', amount: { units: 1200, ...USD } }))
	must(await me.entries.recordEntry(chipTally.id, { actId: 'a3', amount: { units: 7000, ...CHIP } }))
	must(await them.requests.createRequest(usdTally.id, { amount: { units: 300, ...USD }, memo: 'deposit' }))
	await world.settled()
	return me
}

/**
 * Places where the design fixtures describe something the engine cannot produce. The suite
 * fails on any drift *not* listed here, so the list can only shrink; it is empty, and a fixture
 * that adds to it is a design question, not a typo.
 */
const KNOWN_FIXTURE_DRIFT: string[] = []

/** Every place the model contradicts itself or the protocol, as one line each. */
async function drift(model: TaleusModel): Promise<string[]> {
	const out: string[] = []
	for (const t of must(await model.tallies.listTallies())) {
		const detail = must(await model.tally.readTally(t.id))
		if (detail.state !== t.state) out.push(`state ${t.id}: list ${t.state}, detail ${detail.state}`)
		if (t.state === 'Closing' && t.balance.units === 0) out.push(`closing-at-zero ${t.id}`)
		for (const e of must(await model.entries.listEntries(t.id))) {
			// Signed from the reader's side: a party's own direct entry moved value away from it.
			if (e.kind === 'direct' && e.amount.units < 0 !== (e.issuer === 'me')) {
				out.push(`issuer ${t.id} ${e.id}: ${e.issuer} ${e.amount.units}`)
			}
		}
	}
	return out
}

describe.each([
	['mock', mockWorld, KNOWN_FIXTURE_DRIFT],
	['engine', engineWorld, []],
])('the model contract, answered by the %s', (_name, makeWorld, knownDrift) => {
	let model: TaleusModel
	beforeAll(async () => {
		model = await makeWorld()
	}, 120_000)

	it('lists well-formed tallies', async () => {
		const tallies = must(await model.tallies.listTallies())
		expect(tallies.length).toBeGreaterThan(0)
		for (const t of tallies) {
			expect(STATES).toContain(t.state)
			expect(['me', 'them', 'nobody']).toContain(t.waitingOn)
			expect(t.unit.denom).toBeTruthy()
			expect(Number.isInteger(t.balance.units) && t.balance.units >= 0).toBe(true)
			expect(t.balance.perspective === 'level').toBe(t.balance.units === 0)
			if (t.waitingOn === 'nobody') expect(t.waitingReason).toBeUndefined()
		}
	})

	it('drifts from the protocol only where already known', async () => {
		expect(await drift(model)).toEqual(knownDrift)
	})

	it('reads each listed tally in detail, agreeing with the list on what it shows', async () => {
		for (const t of must(await model.tallies.listTallies())) {
			const detail = must(await model.tally.readTally(t.id))
			expect([detail.id, detail.balance, detail.counterparty.sid]).toEqual([t.id, t.balance, t.counterparty.sid])
		}
	})

	it('ends each tally’s entries at its balance', async () => {
		for (const t of must(await model.tallies.listTallies())) {
			const entries = must(await model.entries.listEntries(t.id))
			for (const e of entries) {
				expect(Number.isInteger(e.amount.units) && e.amount.units !== 0).toBe(true)
			}
			if (entries.length > 0) {
				const newest = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0]
				expect([newest.balanceAfter.units, newest.balanceAfter.perspective]).toEqual([t.balance.units, t.balance.perspective])
			}
		}
	})

	it('keeps every request tied to a tally, and its arithmetic whole', async () => {
		const ids = new Set(must(await model.tallies.listTallies()).map(t => t.id))
		for (const r of must(await model.requests.listRequests())) {
			expect(ids.has(r.tallyId)).toBe(true)
			expect(r.applied.units + r.stillAsked.units).toBe(r.amount.units)
			if (r.state === 'answered') expect(r.stillAsked.units).toBe(0)
			expect(must(await model.requests.readRequest(r.id))).toEqual(r)
		}
	})

	it('points every attention item at something that exists', async () => {
		const ids = new Set(must(await model.tallies.listTallies()).map(t => t.id))
		const requests = new Set(must(await model.requests.listRequests()).map(r => r.id))
		const items = must(await model.attention.listAttention())
		for (const item of items) {
			expect(ROUTES).toContain(item.route)
			expect(['me', 'them']).toContain(item.waitingOn)
			if (item.kind !== 'invitation') expect(ids.has(item.tallyId)).toBe(true)
			if (item.requestId) expect(requests.has(item.requestId)).toBe(true)
		}
	})

	it('sets an item aside and brings it back, touching nothing else', async () => {
		const items = must(await model.attention.listAttention())
		if (items.length === 0) return
		const before = must(await model.tallies.listTallies())
		const id = items[0].id
		expect(must(await model.attention.setAside(id)).some(i => i.id === id)).toBe(false)
		expect(model.attention.wasSetAside(id)).toBe(true)
		expect(must(await model.tallies.listTallies())).toEqual(before)
		expect(must(await model.attention.bringBack(id)).some(i => i.id === id)).toBe(true)
	})

	it('sums the position from the tallies, per unit', async () => {
		const position = must(await model.position.readPosition())
		const tallies = must(await model.tallies.listTallies()).filter(t => t.state !== 'Forming')
		for (const row of position.perUnit) {
			const owed = tallies
				.filter(t => t.unit.denom === row.denom && t.balance.perspective === 'owed-to-me')
				.reduce((sum, t) => sum + t.balance.units, 0)
			expect([row.denom, row.owedToMe.units]).toEqual([row.denom, owed])
		}
	})
})
