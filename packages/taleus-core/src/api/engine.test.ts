import { readSchema } from '../store/schema-node.js'
import { newKey } from '../store/index.js'
import { publishCertificate } from '../tally/certificates.js'
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
	janSigner: ReturnType<typeof localSigner>
	fabric: MemoryFabric
}

async function twoParties(): Promise<World> {
	const fabric = new MemoryFabric(readSchema('draft1'))
	let counter = 0
	const party = async (name: string) => {
		const key = newKey()
		const sid = `sid:${name}`
		const signer = localSigner(key)
		return {
			sid,
			signer,
			engine: await openTaleus({
				store: fabric.provider(name),
				signer,
				sid,
				now: () => TODAY,
				newId: () => `${name}:${++counter}`,
			}),
		}
	}
	const jan = await party('jan')
	const sam = await party('sam')
	return {
		jan: jan.engine,
		sam: sam.engine,
		janSid: jan.sid,
		samSid: sam.sid,
		janSigner: jan.signer,
		fabric,
	}
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

describe('saying who you are', () => {
	it('exchanges certificates as part of taking a seat', async () => {
		// Seating and certifying commit together -- the certificate's signature resolves against
		// a key registered in the same transaction.
		const world = await twoParties()
		const invited = must(
			await world.jan.invite({
				as: 'stock',
				denomination: USD,
				certificate: { name: 'Jan Ltd', registration: 'UK-8847123' },
			}),
		)
		const samTally = must(
			await world.sam.accept(invited.ticket, { certificate: { name: 'Sam Reyes' } }),
		)
		const janTally = await world.jan.open(invited.ref)
		must(await janTally.establish())

		expect((await samTally.read()).counterparty.certificate).toEqual({
			name: 'Jan Ltd',
			registration: 'UK-8847123',
		})
		expect((await janTally.read()).counterparty.certificate).toEqual({ name: 'Sam Reyes' })
	})

	it('is absent until someone chooses to publish one', async () => {
		// A Sid is deliberately anonymous. Saying more is a choice, not a requirement.
		const world = await twoParties()
		const { janTally } = await opened(world)
		expect((await janTally.read()).me.certificate).toBeUndefined()
	})

	it('can be revised later, and the newest is what shows', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		must(await janTally.publishCertificate({ name: 'Jan Ltd' }))
		must(await janTally.publishCertificate({ name: 'Jan Holdings Ltd', vat: 'GB4421' }))

		expect((await samTally.read()).counterparty.certificate).toEqual({
			name: 'Jan Holdings Ltd',
			vat: 'GB4421',
		})
	})

	it('is signed, so a counterparty cannot publish one on your behalf', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		must(await samTally.publishCertificate({ name: 'Sam Reyes' }))

		// Sam's certificate is filed under Sam's sid, whoever is reading.
		expect((await janTally.read()).counterparty.certificate).toEqual({ name: 'Sam Reyes' })
		expect((await janTally.read()).me.certificate).toBeUndefined()
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

describe('lift policy', () => {
	it('is unilateral, and each party keeps its own four', async () => {
		// A tally carries eight values, not four. They are not redundant: balance is one signed
		// number, but each party's variables govern its own side of zero.
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)

		must(await janTally.setTradingPolicy({ target: usd(10000), bound: usd(25000), reward: 20000 }))
		must(await samTally.setTradingPolicy({ target: usd(0), bound: usd(5000), clutch: 1000000 }))

		const janSees = await janTally.read()
		expect(janSees.trading.mine?.target).toEqual(usd(10000))
		expect(janSees.trading.mine?.reward).toBe(20000)
		expect(janSees.trading.theirs?.bound).toEqual(usd(5000))
		expect(janSees.trading.theirs?.clutch).toBe(1000000)

		// Same eight values, read from the other side.
		const samSees = await samTally.read()
		expect(samSees.trading.mine).toEqual(janSees.trading.theirs)
		expect(samSees.trading.theirs).toEqual(janSees.trading.mine)
	})

	it('means the same thing whichever seat publishes it', async () => {
		// The MyCHIPs flip is gone: `reward` is a charge on accumulation for stock and foil
		// alike, expressed from the publisher's own perspective. So identical input gives
		// identical output on both sides.
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const policy = { target: usd(3000), bound: usd(9000), reward: 15000, clutch: 5000 }
		must(await janTally.setTradingPolicy(policy))
		must(await samTally.setTradingPolicy(policy))

		const jan = (await janTally.read()).trading.mine
		const sam = (await samTally.read()).trading.mine
		expect(sam).toEqual(jan)
	})

	it('carries forward what a revision leaves out', async () => {
		// Each revision is a complete statement in the schema, so raising a bound must not
		// silently zero a reward that was set earlier.
		const world = await twoParties()
		const { janTally } = await opened(world)
		must(await janTally.setTradingPolicy({ target: usd(1000), bound: usd(4000), reward: 30000 }))
		const raised = must(await janTally.setTradingPolicy({ bound: usd(8000) }))

		expect(raised.revision).toBe(2)
		expect(raised.bound).toEqual(usd(8000))
		expect(raised.target).toEqual(usd(1000))
		expect(raised.reward).toBe(30000)
	})

	it('refuses a bound below the target', async () => {
		const world = await twoParties()
		const { janTally } = await opened(world)
		const upsideDown = await janTally.setTradingPolicy({ target: usd(9000), bound: usd(1000) })
		expect(upsideDown.ok).toBe(false)
	})

	it('prices a lift from both parties’ variables at once', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		// Jan will accumulate 10000 free and up to 25000 at 2%; Sam charges 0.5% to let go.
		must(await janTally.setTradingPolicy({ target: usd(10000), bound: usd(25000), reward: 20000 }))
		must(await samTally.setTradingPolicy({ clutch: 5000 }))

		const toJan = (await janTally.lifts.capacity()).toMe
		expect(toJan.free).toEqual(usd(10000))
		expect(toJan.rewarded).toEqual(usd(15000))
		// The receiver's reward and the *releaser's* clutch price the same movement.
		expect(toJan.reward).toBe(20000)
		expect(toJan.clutch).toBe(5000)

		// The same movement, read from Sam's end.
		const fromSam = (await samTally.lifts.capacity()).fromMe
		expect(fromSam).toEqual(toJan)
	})

	it('is capped by the credit actually granted, not only by the bound', async () => {
		// Jan's bound is 90000 but Sam only granted him nothing, and Jan's own limit of 50000
		// is what caps accumulation toward him.
		const world = await twoParties()
		const { janTally } = await opened(world)
		must(await janTally.setTradingPolicy({ target: usd(90000), bound: usd(90000) }))

		const toJan = (await janTally.lifts.capacity()).toMe
		expect(toJan.free).toEqual(usd(50000))
	})

	it('trades at zero for a party that has published nothing', async () => {
		const world = await twoParties()
		const { janTally } = await opened(world)
		expect((await janTally.read()).trading.mine).toBeUndefined()
		expect((await janTally.lifts.capacity()).toMe.free).toEqual(usd(0))
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

	it('adopts a key the counterparty asserts, which is the recovery path', async () => {
		// A sealed strand cannot re-admit a member, so a party's Sereus membership key can never
		// rotate for the life of a tally. Recovery therefore runs through the counterparty
		// vouching for a fresh key -- see `docs/identity.md`.
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const replacement = localSigner(newKey())

		// Before Jan vouches for it, Sam's new key is a stranger.
		const strangerFirst = await samTally.requestPayment({ amount: usd(100), signer: replacement })
		expect(strangerFirst.ok ? '' : strangerFirst.refusal.code).toBe('not-authorized')

		// Sam makes the claim -- only he holds the key. Jan attests it.
		const claim = await samTally.claimKey(replacement)
		must(await janTally.adoptCounterpartyKey(claim))
		must(await samTally.requestPayment({ amount: usd(100), signer: replacement }))
		expect((await samTally.keys()).some(k => k.publicKey === replacement.publicKey && k.origin === 'adopted')).toBe(true)
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

describe('how a refusal reads', () => {
	it('says a request was answered with the wrong amount', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const asked = must(await janTally.requestPayment({ amount: usd(5000) }))

		const short = await samTally.pay({ amount: usd(4000), answers: asked.id })
		expect(short.ok ? '' : short.refusal.code).toBe('request-mismatch')
		expect(short.ok ? '' : short.refusal.constraint).toBe('InvoiceLink')
	})

	it('says a record with that identity already exists', async () => {
		const world = await twoParties()
		const { janTally } = await opened(world)
		must(await janTally.requestPayment({ amount: usd(1000), id: 'inv:march' }))

		const again = await janTally.requestPayment({ amount: usd(1000), id: 'inv:march' })
		expect(again.ok ? '' : again.refusal.code).toBe('already-exists')
	})

	it('says a signature did not verify', async () => {
		// A key store that hands back a public key and the wrong secret. The key is authorized,
		// so the authorization gate passes and the signature gate is what catches it.
		const world = await twoParties()
		const { janTally } = await opened(world)
		const corrupted = {
			publicKey: world.janSigner.publicKey,
			secretKey: newKey().secretKey,
			sign: (message: Uint8Array) => world.janSigner.sign(message),
		}

		const forged = await janTally.requestPayment({ amount: usd(10), signer: corrupted })
		expect(forged.ok ? '' : forged.refusal.code).toBe('bad-signature')
		expect(forged.ok ? '' : forged.refusal.constraint).toBe('SignatureValid')
	})

	it('says terms do not hold together', async () => {
		const world = await twoParties()
		const { janTally } = await opened(world)
		// Withdrawing credit owes 21 days; naming tomorrow is not enough notice.
		const hasty = await janTally.offerCredit({
			limit: usd(0),
			callDays: 21,
			effectiveFrom: '2026-03-03',
		})
		expect(hasty.ok ? '' : hasty.refusal.code).toBe('terms')

		// And a column-level rule reads the same way: a bound cannot sit below its target.
		const upsideDown = await janTally.setTradingPolicy({ target: usd(9000), bound: usd(1000) })
		expect(upsideDown.ok ? '' : upsideDown.refusal.code).toBe('terms')
	})

	it('says when the replicas did not agree', async () => {
		// The serious one. Jan's own node has admitted something Sam's has not, so the two
		// copies hold different facts and neither should be trusted until that is understood.
		//
		// Manufactured deliberately -- nothing an engine does can produce it, because every act
		// is proposed to both. `divergeOn` writes to one replica alone, which is the only way
		// this state is reachable at all.
		const world = await twoParties()
		const { janTally } = await opened(world)
		await world.fabric.divergeOn('jan', janTally.ref, [
			publishCertificate({
				sid: world.janSid,
				revision: 1,
				certificate: '"only on Jan\'s node"',
				signer: world.janSigner,
			}),
		])

		// Jan's engine reads his own replica, sees revision 1, and writes revision 2. Sam's
		// replica has no revision 1, so revision 2 breaks its monotonic rule.
		const split = await janTally.publishCertificate({ name: 'Jan Ltd' })
		expect(split.ok ? '' : split.refusal.code).toBe('disagreement')
		expect(split.ok ? '' : split.refusal.message).toMatch(/jan accepted.*sam refused/)
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
	it('tells a party what the counterparty did, and stops when asked', async () => {
		// Jan watches; Sam acts. The event reaches Jan through his *own* replica's post-commit
		// watchers -- Quereus's `Database.watch`, the same path a replicated write will arrive
		// on once the distributed backend calls `notifyExternalTableChange`. Nothing here polls.
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const seen: string[] = []
		const stop = janTally.watch(change => seen.push(change.kind))

		must(await samTally.pay({ amount: usd(1000) }))
		stop()
		must(await samTally.pay({ amount: usd(1000) }))

		expect(seen).toEqual(['balance'])
	})

	it('says which part of the tally moved', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const seen: string[] = []
		const stop = samTally.watch(change => seen.push(change.kind))

		must(await janTally.offerCredit({ limit: usd(60000), callDays: 21 }))
		must(await janTally.requestPayment({ amount: usd(500) }))
		must(await janTally.requestClose())
		stop()

		expect(seen).toEqual(['terms', 'request', 'close'])
	})

	it('reports across every tally a party holds, from the engine', async () => {
		const world = await twoParties()
		const { samTally } = await opened(world)
		const seen: string[] = []
		const stop = world.jan.watch(change => seen.push(change.kind))
		// The engine subscribes asynchronously; let it settle before acting.
		await Promise.resolve()

		must(await samTally.pay({ amount: usd(1000) }))
		stop()
		expect(seen).toEqual(['balance'])
	})

	it('names the tally the change belongs to', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		const seen: string[] = []
		const stop = janTally.watch(change => seen.push(change.tally.id))
		must(await samTally.pay({ amount: usd(1000) }))
		stop()

		expect(seen).toEqual([janTally.ref.id])
	})
})

describe('closing handles', () => {
	it('releases a tally and an engine without disturbing the other party', async () => {
		const world = await twoParties()
		const { janTally, samTally } = await opened(world)
		must(await samTally.pay({ amount: usd(1000) }))

		await janTally.close()
		await world.jan.close()

		// Sam's side is untouched: replicas outlive any one handle.
		expect((await samTally.balances()).settled).toEqual(usd(-1000))
	})
})
