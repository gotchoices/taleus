import type { Rate } from '../rates.js'
import type { Result } from '../types.js'
import { MemoryFabric, type InvitationTicket, type StoreProvider, type TallyCondition, type TallyRef } from 'taleus-core'
import tallySchema from 'taleus-core/schema-text/draft1'

import { createEngineModel, createLocalWorld, type DurableText } from './index.js'
import { offline, testContract } from '../testing/index.js'

const CONTRACT = await testContract()

const USD = { denom: 'iso4217:USD', divisor: 100 }
const usd = (units: number) => ({ units, ...USD })
const NOW = () => new Date('2026-09-07T12:00:00Z')

function must<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
	return result.value
}

async function openTally() {
	const world = await createLocalWorld({ now: NOW, documents: CONTRACT.cache, fetch: offline })
	const me = world.me.model
	expect(must(await me.party.readParty())).toBeNull()
	must(await me.party.createIdentity())
	must(await me.party.setDisplayName('Jan'))

	const invitation = must(
		await me.invitations.createInvitation({
			unit: USD,
			creditLimit: usd(50000),
			noticeDays: 21,
			agreementId: CONTRACT.cid,
			goodForDays: 7,
		}),
	)
	expect(invitation.state).toBe('outstanding')

	// The simulated counterparty reads what was offered, then takes it up.
	const them = world.counterparty.model
	const read = must(await them.invitations.readInvitation(invitation.token))
	expect(read.theirCreditLimit).toEqual(usd(50000))
	expect(read.inviter.disclosed).toEqual({ name: 'Jan' })
	// The invitee is asked for a name: it is how the inviter will see them.
	expect(read.asks).toEqual([{ field: 'name', required: true }])
	must(await them.invitations.respondToInvitation(invitation.token, 'accept', { disclose: {}, creditLimit: usd(0), noticeDays: 21 }))
	await world.settled()
	return { world, me, them, token: invitation.token }
}

describe('a tally made through the model, with a simulated counterparty', () => {
	it('forms, gets offered, and opens without anyone touching a protocol step', async () => {
		const { me } = await openTally()
		const [tally] = must(await me.tallies.listTallies())
		expect(tally).toMatchObject({
			counterparty: { name: 'Sam (simulated)' },
			unit: USD,
			state: 'Open',
			waitingOn: 'nobody',
			balance: { units: 0, perspective: 'level' },
		})
		// Taken up, it has a counterparty to name and is no longer listed as an invitation.
		expect(tally.invitation).toBeUndefined()
		const invitations = must(await me.invitations.listInvitations())
		expect(invitations[0].state).toBe('taken-up')
	})

	it('lists an invitation nobody has taken up by its note and when it was made', async () => {
		const world = await createLocalWorld({ now: NOW, documents: CONTRACT.cache, fetch: offline })
		const me = world.me.model
		must(await me.party.createIdentity())
		must(await me.party.setDisplayName('Jan'))
		must(await me.invitations.createInvitation({
			unit: USD,
			creditLimit: usd(50000),
			noticeDays: 30,
			agreementId: CONTRACT.cid,
			goodForDays: 7,
			note: 'Sam, the bike',
		}))
		const [tally] = must(await me.tallies.listTallies())
		expect(tally.state).toBe('Forming')
		expect(tally.invitation).toEqual({ note: 'Sam, the bike' })
		expect(tally.lastActivity).toBe(NOW().toISOString())
	})

	it('shows each side the credit it extends, in the tally’s own unit', async () => {
		const { me } = await openTally()
		const [{ id }] = must(await me.tallies.listTallies())
		const detail = must(await me.tally.readTally(id))
		expect(detail.terms.mine.creditLimit).toEqual(usd(50000))
		expect(detail.terms.theirs.creditLimit).toEqual(usd(0))
		expect(detail.agreement.title).toBe(CONTRACT.title)
	})

	it('moves value both ways and reads it from each side', async () => {
		const { world, me, them } = await openTally()
		const [{ id }] = must(await me.tallies.listTallies())
		must(await them.entries.recordEntry(id, { actId: 'act:1', amount: usd(1800), memo: 'March hours' }))
		await world.settled()

		const mine = must(await me.tallies.listTallies())[0]
		expect(mine.balance).toEqual({ ...usd(1800), perspective: 'owed-to-me' })
		const theirs = must(await them.tallies.listTallies())[0]
		expect(theirs.balance).toEqual({ ...usd(1800), perspective: 'owed-by-me' })

		const [entry] = must(await me.entries.listEntries(id))
		expect(entry).toMatchObject({ issuer: 'them', amount: usd(1800), memo: 'March hours' })
	})

	it('puts a request on the attention list of the party asked, and takes it off when paid', async () => {
		const { world, me, them } = await openTally()
		const [{ id }] = must(await me.tallies.listTallies())
		must(await them.entries.recordEntry(id, { actId: 'act:1', amount: usd(1800) }))
		const asked = must(await them.requests.createRequest(id, { amount: usd(500), memo: 'refund' }))
		await world.settled()

		const attention = must(await me.attention.listAttention())
		expect(attention).toEqual([
			expect.objectContaining({ kind: 'request', waitingOn: 'me', requestId: asked.id, route: 'RequestView' }),
		])
		expect(must(await me.tallies.listTallies())[0]).toMatchObject({ waitingOn: 'me', waitingReason: 'request' })

		must(await me.entries.recordEntry(id, { actId: 'act:2', amount: usd(500), answers: [asked.id] }))
		await world.settled()
		expect(must(await me.attention.listAttention())).toEqual([])
		expect(must(await me.requests.readRequest(asked.id)).state).toBe('answered')
		expect(must(await me.tallies.listTallies())[0].balance).toEqual({ ...usd(1300), perspective: 'owed-to-me' })
	})

	it('can have the counterparty take up an invitation by itself', async () => {
		const world = await createLocalWorld({ now: NOW, takeUpInvitations: true, documents: CONTRACT.cache, fetch: offline })
		const me = world.me.model
		must(await me.party.createIdentity())
		must(await me.invitations.createInvitation({ unit: USD, creditLimit: usd(20000), noticeDays: 14, agreementId: CONTRACT.cid, goodForDays: 7 }))
		await world.settled()
		// This party proposed the contract with the invitation; the simulated one accepts it.
		const [tally] = must(await me.tallies.listTallies())
		const detail = must(await me.tally.readTally(tally.id))
		expect(detail.state).toBe('Open')
		expect(detail.terms.theirs.creditLimit).toEqual(usd(20000))
	})

	it('says plainly what the engine does not do yet', async () => {
		const { me } = await openTally()
		const [{ id }] = must(await me.tallies.listTallies())
		const countered = await me.offers.respondToOffer(id, 'counter')
		expect(countered.ok ? undefined : countered.error.kind).toBe('unsupported')
		expect(countered.ok ? '' : countered.error.message).toMatch(/feat-offer-lifecycle/)
	})
})

/** A host's durable slot, in memory: what a test needs to stand in for a phone's storage. */
function memorySlot(): DurableText & { text?: string } {
	const slot: DurableText & { text?: string } = {
		load: async () => slot.text,
		save: async text => {
			slot.text = text
		},
	}
	return slot
}

describe('an acceptance the inviter has not answered yet', () => {
	it('answers waiting, then finishes on its own once the tally arrives', async () => {
		const fabric = new MemoryFabric(tallySchema)
		const jan = await createEngineModel({ store: fabric.provider('jan'), now: NOW, documents: CONTRACT.cache(), fetch: offline })
		must(await jan.model.party.createIdentity())
		must(await jan.model.party.setDisplayName('Jan'))
		const invitation = must(
			await jan.model.invitations.createInvitation({
				unit: USD,
				creditLimit: usd(50000),
				noticeDays: 21,
				agreementId: CONTRACT.cid,
				goodForDays: 7,
			}),
		)

		// Sam's first join outlasts the store's patience; the request stands, and the store says so.
		const late = lateJoin(fabric.provider('sam'))
		const sam = await createEngineModel({ store: late.provider, now: NOW, documents: CONTRACT.cache(), fetch: offline })
		must(await sam.model.party.createIdentity())
		const answer = must(
			await sam.model.invitations.respondToInvitation(invitation.token, 'accept', { disclose: { name: 'Sam' }, creditLimit: usd(0), noticeDays: 21 }),
		)
		expect(answer).toBe('waiting')
		expect(sam.model.invitations.answerTo(invitation.token)).toBe('waiting')

		// Jan's side answers: the tally arrives at Sam's node, and the agent takes the seat.
		await late.answered()
		for (let i = 0; i < 100 && sam.model.invitations.answerTo(invitation.token) !== 'accepted'; i++) {
			await new Promise(resolve => setTimeout(resolve, 10))
		}
		await sam.settled()
		await jan.settled()
		expect(sam.model.invitations.answerTo(invitation.token)).toBe('accepted')
		const [tally] = must(await sam.model.tallies.listTallies())
		expect(tally.counterparty.name).toBe('Jan')
		await sam.stop()
		await jan.stop()
	})
})

describe('a session kept across restarts', () => {
	it('comes back as the same party, with its device-local choices', async () => {
		const fabric = new MemoryFabric(tallySchema)
		const storage = { state: memorySlot(), identity: memorySlot() }
		const first = await createEngineModel({ store: fabric.provider('me'), now: NOW, storage, documents: CONTRACT.cache(), fetch: offline })
		const party = must(await first.model.party.createIdentity())
		must(await first.model.party.setDisplayName('Jan'))
		const invitation = must(
			await first.model.invitations.createInvitation({
				unit: USD,
				creditLimit: usd(50000),
				noticeDays: 21,
				agreementId: CONTRACT.cid,
				goodForDays: 7,
				note: 'bike',
			}),
		)
		const rate: Rate = {
			...USD,
			basis: 'fixed',
			accept: 100,
			part: 100,
			signed: '2026-09-07T12:00:00Z',
			updated: '2026-09-07T12:00:00Z',
			permitsMovement: true,
		}
		must(await first.model.rates.setRate(rate))
		must(await first.model.devices.renameDevice('this-device', 'Pixel'))
		await first.stop()
		expect(storage.identity.text).toEqual(expect.any(String))

		const second = await createEngineModel({ store: fabric.provider('me'), now: NOW, storage, documents: CONTRACT.cache(), fetch: offline })
		expect(must(await second.model.party.readParty())).toMatchObject({ sid: party.sid, displayName: 'Jan' })
		expect(must(await second.model.invitations.listInvitations())).toEqual([
			expect.objectContaining({ token: invitation.token, note: 'bike', state: 'outstanding' }),
		])
		expect(must(await second.model.rates.readRates()).rates).toEqual([expect.objectContaining({ denom: 'iso4217:USD' })])
		expect(must(await second.model.devices.listDevices())[0].name).toBe('Pixel')
	})

	it('lists a tally it cannot read as last read, says why at once, and forgets only one gone', async () => {
		const fabric = new MemoryFabric(tallySchema)
		const storage = { state: memorySlot(), identity: memorySlot() }
		const first = await createEngineModel({ store: fabric.provider('me'), now: NOW, storage, documents: CONTRACT.cache(), fetch: offline })
		must(await first.model.party.createIdentity())
		must(
			await first.model.invitations.createInvitation({
				unit: USD,
				creditLimit: usd(50000),
				noticeDays: 21,
				agreementId: CONTRACT.cid,
				goodForDays: 7,
				note: 'bike',
			}),
		)
		const [listed] = must(await first.model.tallies.listTallies())
		await first.stop()

		const restart = async (condition: TallyCondition) =>
			await createEngineModel({ store: unreadable(fabric.provider('me'), condition), now: NOW, storage, documents: CONTRACT.cache(), fetch: offline })

		const syncing = await restart({ kind: 'syncing' })
		expect(must(await syncing.model.tallies.listTallies())).toEqual([expect.objectContaining({ id: listed.id, unreadable: 'syncing' })])
		expect((await syncing.model.tallies.forgetTally(listed.id)).ok).toBe(false)
		await syncing.stop()

		const broken = await restart({ kind: 'failed', reason: 'launch refused' })
		const failing = await broken.model.tally.readTally(listed.id)
		expect(failing.ok ? undefined : failing.error).toMatchObject({ kind: 'tally-failed', retryable: true })
		await broken.stop()

		const gone = await restart({ kind: 'missing' })
		const missing = await gone.model.tally.readTally(listed.id)
		expect(missing.ok ? undefined : missing.error).toMatchObject({ kind: 'tally-missing', retryable: false })
		must(await gone.model.tallies.forgetTally(listed.id))
		expect(must(await gone.model.tallies.listTallies())).toEqual([])
		await gone.stop()
	})

	it('refuses to start over a kept identity it cannot read, rather than minting another', async () => {
		const storage = { state: memorySlot(), identity: memorySlot() }
		storage.identity.text = '{"v":2}'
		await expect(createEngineModel({ store: new MemoryFabric(tallySchema).provider('me'), storage })).rejects.toThrow(/kept identity/)
	})
})

/** `provider`, holding no tally it can read, and saying `condition` of every tally. */
function unreadable(provider: StoreProvider, condition: TallyCondition): StoreProvider {
	return {
		list: async () => [],
		open: ref => provider.open(ref),
		create: request => provider.create(request),
		join: ticket => provider.join(ticket),
		condition: async () => condition,
	}
}

/**
 * `provider`, whose first `join` the inviter's side has not answered: it fails as the cadre store
 * does (`JoinPendingError`). `answered` completes the join the way the node does once the inviter
 * answers, and announces the tally readable; a later `join` finds it joined, as the cadre store's
 * does.
 */
function lateJoin(provider: StoreProvider): { provider: StoreProvider; answered: () => Promise<void> } {
	let joined: Awaited<ReturnType<StoreProvider['join']>> | undefined
	let announce: ((ref: TallyRef) => void) | undefined
	let asked: InvitationTicket | undefined
	return {
		provider: {
			list: async () => (joined ? [{ id: joined.ref.id }] : []),
			open: ref => provider.open(ref),
			create: request => provider.create(request),
			join: async ticket => {
				asked = ticket
				if (!joined) throw Object.assign(new Error('the inviter has not answered'), { name: 'JoinPendingError' })
				return joined
			},
			condition: async () => (joined ? { kind: 'readable' } : { kind: 'starting' }),
			onReadable: listener => {
				announce = listener
				return () => (announce = undefined)
			},
		},
		answered: async () => {
			if (!asked) throw new Error('nothing asked to join')
			joined = await provider.join(asked)
			announce?.({ id: joined.ref.id })
		},
	}
}
