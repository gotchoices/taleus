import type { Result } from '../types.js'
import { createLocalWorld, STANDARD_AGREEMENT } from './index.js'

const USD = { denom: 'iso4217:USD', scale: 2 }
const usd = (units: number) => ({ units, ...USD })
const NOW = () => new Date('2026-09-07T12:00:00Z')

function must<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
	return result.value
}

async function openTally() {
	const world = await createLocalWorld({ now: NOW })
	const me = world.me.model
	expect(must(await me.party.readParty())).toBeNull()
	must(await me.party.createIdentity())
	must(await me.party.setDisplayName('Jan'))

	const invitation = must(
		await me.invitations.createInvitation({
			unit: USD,
			creditLimit: usd(50000),
			noticeDays: 21,
			agreementId: STANDARD_AGREEMENT.id,
			goodForDays: 7,
		}),
	)
	expect(invitation.state).toBe('outstanding')

	// The simulated counterparty reads what was offered, then takes it up.
	const them = world.counterparty.model
	const read = must(await them.invitations.readInvitation(invitation.token))
	expect(read.theirCreditLimit).toEqual(usd(50000))
	expect(read.inviter.disclosed).toEqual({ name: 'Jan' })
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
		const invitations = must(await me.invitations.listInvitations())
		expect(invitations[0].state).toBe('taken-up')
	})

	it('shows each side the credit it extends, in the tally’s own unit', async () => {
		const { me } = await openTally()
		const [{ id }] = must(await me.tallies.listTallies())
		const detail = must(await me.tally.readTally(id))
		expect(detail.terms.mine.creditLimit).toEqual(usd(50000))
		expect(detail.terms.theirs.creditLimit).toEqual(usd(0))
		expect(detail.agreement.title).toBe('Standard tally')
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
		const world = await createLocalWorld({ now: NOW, takeUpInvitations: true })
		const me = world.me.model
		must(await me.party.createIdentity())
		must(await me.invitations.createInvitation({ unit: USD, creditLimit: usd(20000), noticeDays: 14, agreementId: STANDARD_AGREEMENT.id, goodForDays: 7 }))
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
