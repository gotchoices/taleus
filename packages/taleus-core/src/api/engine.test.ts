import { readSchema } from '../store/schema-node.js'
import { newKey } from '../store/index.js'
import { MemoryFabric } from './store-memory.js'
import { localSigner, openTaleus } from './engine.js'
import type { Amount, Result, Taleus, Tally } from './types.js'

/**
 * The API, driven the way a consumer drives it: two parties, two engines, no shared secrets.
 *
 * Nothing in this file names a table or a constraint. That is the point -- it is the same
 * system the row-level suites test, asked in the domain's language, and every act still goes
 * to both replicas and is re-validated by each.
 *
 * Jan invites Sam and takes the stock seat. Jan lets Sam owe him 50000; Sam lets Jan owe
 * nothing, which is the ordinary asymmetry of a credit relationship.
 */

const USD = 'iso4217:USD'
const TODAY = '2026-03-02'
const usd = (units: number): Amount => ({ units, denomination: USD })

/** Unwrap a result, failing the test with the engine's own words when it refused. */
function must<T>(result: Result<T>): T {
	if (!result.ok) {
		throw new Error(`refused: ${result.refusal.code} (${result.refusal.message})`)
	}
	return result.value
}

interface World {
	jan: Taleus
	sam: Taleus
	janSid: string
	samSid: string
}

async function twoParties(): Promise<World> {
	const fabric = new MemoryFabric(readSchema('draft1'))
	let counter = 0
	const party = async (name: string) => {
		const key = newKey()
		const sid = `sid:${name}`
		return {
			sid,
			engine: await openTaleus({
				store: fabric.provider(name),
				signer: localSigner(key),
				sid,
				now: () => TODAY,
				newId: () => `${name}:${++counter}`,
			}),
		}
	}
	const jan = await party('jan')
	const sam = await party('sam')
	return { jan: jan.engine, sam: sam.engine, janSid: jan.sid, samSid: sam.sid }
}

/** Carry a tally from invitation to open, the way both parties actually would. */
async function opened(world: World): Promise<{ janTally: Tally; samTally: Tally }> {
	const invited = must(await world.jan.invite({ as: 'stock', denomination: USD }))
	const samTally = must(await world.sam.accept(invited.ticket))
	const janTally = await world.jan.open(invited.ref)

	// Only the stock party can name the tally, and only once the other seat is taken.
	must(await janTally.establish())

	must(await janTally.offerCredit({ limit: usd(50000), callDays: 21 }))
	must(await samTally.offerCredit({ limit: usd(0), callDays: 21 }))
	must(
		await janTally.offerContract({
			contractCid: 'cid:standard-tally-v1',
			denomination: USD,
			denominationScale: 2,
		}),
	)
	must(await samTally.acceptContract())
	return { janTally, samTally }
}

describe('forming a tally', () => {
	it('carries two parties from an invitation to an open tally', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)

		for (const [tally, role, mine, theirs] of [
			[janTally, 'stock', world.janSid, world.samSid],
			[samTally, 'foil', world.samSid, world.janSid],
		] as const) {
			const view = await tally.read()
			expect(view.state).toBe('open')
			expect(view.role).toBe(role)
			expect(view.denomination).toBe(USD)
			expect(view.me.sid).toBe(mine)
			expect(view.counterparty.sid).toBe(theirs)
			expect(view.balances.settled).toEqual(usd(0))
		}
	})

	it('is not a tally until the stock party names it', async () => {
		// Between the invitee seating and the inviter naming, nothing can be signed -- every
		// other signature binds the tally's id, and it does not have one yet.
		const world = await twoParties()
		const invited = must(await world.jan.invite({ as: 'stock', denomination: USD }))
		const samTally = must(await world.sam.accept(invited.ticket))
		const janTally = await world.jan.open(invited.ref)

		expect((await janTally.read()).state).toBe('forming')
		const early = await janTally.offerCredit({ limit: usd(50000), callDays: 21 })
		expect(early.ok).toBe(false)

		// And it is the stock party's act, not the invitee's.
		const wrongSide = await samTally.establish()
		expect(wrongSide.ok ? '' : wrongSide.refusal.code).toBe('not-authorized')
		must(await janTally.establish())
		expect((await janTally.read()).state).toBe('forming') // seated and named, not yet agreed
	})

	it('refuses an invitation it cannot read', async () => {
		const world = await twoParties()
		const invited = must(await world.jan.invite({ as: 'stock', denomination: USD }))
		const result = await world.sam.accept({ ref: invited.ref, encoded: 'not-a-ticket' })
		expect(result.ok ? '' : result.refusal.code).toBe('not-found')
	})

	it('shows a party its tallies without opening each one by hand', async () => {
		const world = await twoParties()
		await opened(world)
		const listed = await world.sam.tallies()
		expect(listed).toHaveLength(1)
		expect(listed[0]?.role).toBe('foil')
		expect(listed[0]?.counterparty.sid).toBe(world.janSid)
	})
})

describe('paying', () => {
	it('moves value, and both parties read it from their own side', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		must(await samTally.pay({ amount: usd(12000), memo: 'March hours' }))

		expect((await janTally.balances()).settled).toEqual(usd(12000))
		expect((await samTally.balances()).settled).toEqual(usd(-12000))
	})

	it('reports a refusal in the engine’s own words', async () => {
		const world = await twoParties()
		const { samTally } = await opened(world)
		const tooMuch = await samTally.pay({ amount: usd(60000) })

		expect(tooMuch.ok).toBe(false)
		if (tooMuch.ok) return
		expect(tooMuch.refusal.code).toBe('credit-limit')
		// The constraint name survives the trip up. Losing it would make the suite weaker here
		// than it is at row level, which is the one thing the API must not do.
		expect(tooMuch.refusal.constraint).toBe('WithinCreditLimits')
	})

	it('records history from the reader’s perspective', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		must(await samTally.pay({ amount: usd(12000) }))

		const [toJan] = await janTally.history()
		const [fromSam] = await samTally.history()
		expect(toJan?.direction).toBe('in')
		expect(toJan?.balanceAfter).toEqual(usd(12000))
		expect(fromSam?.direction).toBe('out')
		expect(fromSam?.balanceAfter).toEqual(usd(-12000))
	})

	it('reports capacity in both directions', async () => {
		const world = await twoParties()
		const { samTally } = await opened(world)
		must(await samTally.pay({ amount: usd(12000) }))

		const { capacity } = await samTally.balances()
		// Sam has drawn 12000 of the 50000 Jan granted, so 38000 of it is left.
		expect(capacity.canSend).toEqual(usd(38000))
		// And he can receive exactly what he owes: value coming to Sam raises his balance from
		// -12000 toward zero, and his own limit of zero is what stops it there. Granting no
		// credit does not mean being unable to be repaid.
		expect(capacity.canReceive).toEqual(usd(12000))
	})
})

describe('asking to be paid', () => {
	it('is answered by the other side, and reads as paid to both', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const asked = must(await janTally.requestPayment({ amount: usd(8000) }))
		must(await samTally.pay({ amount: usd(8000), answers: asked.id }))

		for (const tally of [janTally, samTally]) {
			const [request] = await tally.requests()
			expect(request?.state).toBe('paid')
		}
		expect((await janTally.balances()).settled).toEqual(usd(8000))
	})

	it('shows each side who is asking whom', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		must(await janTally.requestPayment({ amount: usd(8000) }))

		expect((await janTally.requests())[0]?.from).toBe('me')
		expect((await samTally.requests())[0]?.from).toBe('counterparty')
		expect((await janTally.balances()).requested.toMe).toEqual(usd(8000))
		expect((await samTally.balances()).requested.byMe).toEqual(usd(8000))
	})

	it('can be refused on the record, by the payer only', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const asked = must(await janTally.requestPayment({ amount: usd(8000) }))

		const byRequester = await janTally.declinePayment(asked.id)
		expect(byRequester.ok ? '' : byRequester.refusal.code).toBe('not-authorized')

		must(await samTally.declinePayment(asked.id))
		expect((await janTally.requests())[0]?.state).toBe('declined')
	})

	it('may ask for more than the payer can currently pay', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const asked = must(await janTally.requestPayment({ amount: usd(90000) }))
		expect((await janTally.requests())[0]?.state).toBe('open')

		const cannot = await samTally.pay({ amount: usd(90000), answers: asked.id })
		expect(cannot.ok ? '' : cannot.refusal.code).toBe('credit-limit')
	})
})

describe('credit terms', () => {
	it('takes a raise at once and holds a reduction for its notice period', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)

		must(await janTally.offerCredit({ limit: usd(80000), callDays: 21 }))
		expect((await samTally.read()).terms.theirs?.limit).toEqual(usd(80000))

		// Withdrawing owes Sam 21 days, so what binds today is still the raise.
		must(await janTally.offerCredit({ limit: usd(0), callDays: 21, effectiveFrom: '2099-01-01' }))
		const seen = (await samTally.read()).terms.theirs
		expect(seen?.limit).toEqual(usd(80000))
		expect(seen?.pending?.limit).toEqual(usd(0))
	})
})

describe('winding down', () => {
	it('freezes growth, permits payment down, and reaches closed at zero', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		must(await samTally.pay({ amount: usd(30000) }))
		must(await janTally.requestClose())

		expect((await samTally.read()).state).toBe('closing')
		const growth = await samTally.pay({ amount: usd(1000) })
		expect(growth.ok ? '' : growth.refusal.code).toBe('closing')

		must(await janTally.pay({ amount: usd(30000) }))
		for (const tally of [janTally, samTally]) {
			expect((await tally.read()).state).toBe('closed')
		}
	})
})

describe('keys', () => {
	it('adds a device key that can then sign', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const tablet = localSigner(newKey())
		must(await janTally.addKey({ key: tablet }))

		expect((await janTally.keys()).map(k => k.publicKey)).toContain(tablet.publicKey)
		// And the counterparty's engine accepts what it signs.
		must(await samTally.pay({ amount: usd(5000) }))
		must(await janTally.requestPayment({ amount: usd(1000), signer: tablet }))
	})

	it('refuses a revoked key', async () => {
		const world = await twoParties()
		const { janTally } = await opened(world)
		const tablet = localSigner(newKey())
		must(await janTally.addKey({ key: tablet }))
		must(await janTally.revokeKey({ publicKey: tablet.publicKey }))

		const stolen = await janTally.requestPayment({ amount: usd(1000), signer: tablet })
		expect(stolen.ok ? '' : stolen.refusal.code).toBe('not-authorized')
	})
})

describe('lifts', () => {
	it('declares the seam rather than hiding it', async () => {
		const world = await twoParties()
		const { janTally } = await opened(world)
		expect(await janTally.lifts.pending()).toEqual([])

		const attempt = await janTally.lifts.propose({ amount: usd(1000), direction: 'out' })
		expect(attempt.ok ? '' : attempt.refusal.code).toBe('unsupported')
	})
})

describe('watching', () => {
	it('tells a party that something moved', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const seen: string[] = []
		const stop = janTally.watch(change => seen.push(change.kind))

		must(await samTally.pay({ amount: usd(1000) }))
		stop()
		must(await samTally.pay({ amount: usd(1000) }))

		expect(seen).toEqual(['balance'])
	})
})
