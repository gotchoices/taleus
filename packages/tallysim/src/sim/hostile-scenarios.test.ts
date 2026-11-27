/**
 * Hand-driven hostile-actor scenarios: stage the nastiest active-emission attacks on a lift — forging
 * another member's signature, flooding a voter's commit pool with junk, replaying a settled record, and a
 * voter that signs `C` to one part of the network and `NC` to another — over **real reconstructed routes**
 * at simulator scale, and prove `tallynet`'s own defences either shrug the attack off or flag the one it
 * cannot mask (a dishonest *majority* of voters). No new protocol code: the simulator holds every node's
 * private key ({@link makeSimSigner}), so {@link signAs} / {@link forgeFace} / {@link junkCommits} mint the
 * malicious records, and the engine's existing re-verification, side-pool cap, dedupe and contradiction
 * detector do the rest.
 *
 * These are the tallysim-scale mirrors of the single-participant / whole-network proofs in
 * `tallynet/src/testing/consensus.test.ts` (§ adversarial signatures, § pre-promise pool) — the value here
 * is that each attack lands on a route a real `discover` produced, or on a line split mid-drive through the
 * live-conditions seam ({@link SimNetwork.conditions}), exactly as the network-split scenario in
 * `voter-harness.test.ts` does. See `docs/design.md` § Consensus simulation (hostile-actor scenarios).
 *
 * ── Why the equivocation scenarios are hand-driven ──────────────────────────────────────────────────────
 * Feeding divergent faces to two halves of the network cannot go through `runLiftForOutcome` (its atomic
 * `start` + single `runUntilIdle` cannot express a mid-drive partition). So those two settle each island on
 * a crafted complete record while a link is dropped, then HEAL and cross the boundary **explicitly**
 * (`serveRecord` → `update`): a dropped push is never re-queued, so a settled node will not spontaneously
 * re-push across a restored link — the explicit cross is what makes the merge/contradiction fire, and it
 * pins exactly which node sees both faces. The equivocator's two faces are god-minted into the crafted
 * records (the sim mints both genuine faces) rather than produced by a node that natively double-signs.
 */

import { MemberTypes, type MemberType, type TraceEvent, type TrxRecord, MAX_PENDING_COMMITS_PER_VOTER } from 'tallynet'
import { FORMAT_VERSION, type Network, type Tally, cloneNetwork } from '../model.js'
import { runLiftForOutcome } from './consensus-harness.js'
import { makeSimResources } from './consensus-resource.js'
import { buildSimNetwork, runQuery, type QuerySpec, type SimNetwork } from './harness.js'
import { forgeFace, junkCommits, signAs } from './hostile-records.js'
import { linkIdForTally } from './naming.js'
import type { LiftTerms } from './terms.js'

const PART: MemberType = MemberTypes.participant
const VOTER: MemberType = MemberTypes.voter

/** The fixed consensus seed every scenario shares (deterministic keys; see `identity.ts`). */
const IDENTITY_SEED = 7

/** Provenance stub shared by the hand-built networks below. */
const META = { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION }

/** A line `0 - 1 - … - (n-1)`, one tally per consecutive pair, finite symmetric credit limits. */
function lineTallies(n: number, limit = 1000): Tally[] {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return tallies
}

/** A line of `n` entities. */
function line(n: number, limit = 1000): Network {
	return { entityCount: n, tallies: lineTallies(n, limit), meta: META }
}

/**
 * A line of `routeLen` entities plus one extra ISOLATED observer (no tally), so a crafted record can be
 * delivered into a node that is NOT a lift member and that pushes to nobody — the tallysim analogue of
 * `tallynet`'s edge-less observer `X`. The observer's name is `String(routeLen)`.
 */
function lineWithObserver(routeLen: number, limit = 1000): Network {
	return { entityCount: routeLen + 1, tallies: lineTallies(routeLen, limit), meta: META }
}

/** The reasons of every `signature-rejected` trace event (mirrors tallynet's `rejectReasons`). */
function rejectReasons(events: TraceEvent[]): string[] {
	return events
		.filter((event): event is Extract<TraceEvent, { type: 'signature-rejected' }> => event.type === 'signature-rejected')
		.map((event) => event.reason)
}

/** The settled outcome of `transactionCode` at entity `e`. */
function outcomeOf(sim: SimNetwork, e: number, transactionCode: string): Promise<'commit' | 'void' | 'pending'> {
	return sim.net.consensusNode(String(e)).outcome(transactionCode)
}

/** A copy of `record` with a genuine `P` for every named participant merged — the complete promise set a commit binds. */
async function complete(record: TrxRecord<LiftTerms, unknown>, participantNames: string[]): Promise<TrxRecord<LiftTerms, unknown>> {
	const promises = await Promise.all(participantNames.map((name) => signAs(IDENTITY_SEED, name, 'P', record)))
	return { ...record, promises }
}

/** The five members of the equivocation line `0—1—2—3—4`: all participants; voters are the middle three. */
function equivocationMembers(): { name: string; roles: MemberType[] }[] {
	return [
		{ name: '0', roles: [PART] },
		{ name: '1', roles: [PART, VOTER] },
		{ name: '2', roles: [PART, VOTER] },
		{ name: '3', roles: [PART, VOTER] },
		{ name: '4', roles: [PART] },
	]
}

describe('hostile actors — a forged signature never counts (real discovered route)', () => {
	it("a commit forged in a voter's name is rejected `forged`; the genuine commit outcome stands", async () => {
		const network = lineWithObserver(5) // 0—1—2—3—4 route; node 5 is an isolated observer (unused here)
		const events: TraceEvent[] = []
		const sim = buildSimNetwork(network, {}, 0, (e) => events.push(e), undefined, { identitySeed: IDENTITY_SEED })
		const q: QuerySpec = { from: 0, to: 4, amount: 5, depth: 5 }
		const outcome = await runQuery(sim, q)
		expect(outcome.found).toBe(true)

		// The terminus (node 4) is the sole voter; drive the honest lift over the discovered route to commit.
		const result = await runLiftForOutcome(sim, network, outcome, q, { voters: [4] })
		expect(result?.outcome).toBe('commit')
		const tx = result!.transactionCode

		// Forge node 4's commit with an attacker key (the attacker never holds node 4's key), then push it,
		// alongside the genuine commit, into the already-committed originator. The promise phase is complete, so
		// the forged commit is verified-then-dropped on arrival.
		const settled = await sim.net.consensusNode('0').serveRecord(tx)
		expect(settled).toBeDefined()
		const forged = await forgeFace(IDENTITY_SEED, sim.net.memberKey('4'), 'attacker', 'C', settled!)
		await sim.net.consensusNode('0').update({ ...settled!, commits: [...settled!.commits, forged] })
		await sim.net.clock.runUntilIdle()

		expect(rejectReasons(events)).toContain('forged')
		expect(await outcomeOf(sim, 0, tx)).toBe('commit') // the outcome never moved
		const after = await sim.net.consensusNode('0').serveRecord(tx)
		expect(after!.commits.some((commit) => commit.value === forged.value)).toBe(false) // the forged value never entered the set
		expect(sim.net.deliveryErrors).toEqual([])
		expect(sim.net.clock.pendingTimers).toBe(0)
	})

	it("a promise forged in a participant's name is rejected `forged`; the record stays pending on it", async () => {
		const network = lineWithObserver(5) // node 5 is the isolated observer we deliver the forged promise into
		const events: TraceEvent[] = []
		const sim = buildSimNetwork(network, {}, 0, (e) => events.push(e), undefined, { identitySeed: IDENTITY_SEED })
		// A fresh minted record over the real route (topology only, no signatures yet).
		const { record, transactionCode: tx } = sim.net.buildLift({
			members: [
				{ name: '0', roles: [PART] },
				{ name: '1', roles: [PART] },
				{ name: '2', roles: [PART] },
				{ name: '3', roles: [PART] },
				{ name: '4', roles: [PART, VOTER] },
			],
			route: ['0', '1', '2', '3', '4'],
			routeLinkIds: ['T0', 'T1', 'T2', 'T3'],
			payload: { amount: '5' },
		})

		// `forged` (not `changed`) only arises when the victim has NO prior promise in the record, so deliver into
		// the observer (node 5), which has never seen node 1's genuine promise and, as a non-member, casts none itself.
		const forgedP = await forgeFace(IDENTITY_SEED, sim.net.memberKey('1'), 'attacker', 'P', record)
		await sim.net.consensusNode('5').update({ ...record, promises: [forgedP], commits: [] })
		await sim.net.clock.runUntilIdle()

		expect(rejectReasons(events)).toContain('forged')
		const seen = await sim.net.consensusNode('5').serveRecord(tx)
		expect(seen!.promises).toEqual([]) // the forged promise never entered the set
		expect(await outcomeOf(sim, 5, tx)).toBe('pending')
		expect(sim.net.deliveryErrors).toEqual([])
	})
})

describe('hostile actors — a junk-commit flood is capped and the genuine vote still counts', () => {
	it('overflow past the per-voter pool cap drops as `pool-full`; the real vote then commits', async () => {
		const network = lineWithObserver(3) // route 0—1—2; node 3 is an isolated observer to pool into
		const events: TraceEvent[] = []
		const sim = buildSimNetwork(network, {}, 0, (e) => events.push(e), undefined, { identitySeed: IDENTITY_SEED })
		const { record, transactionCode: tx } = sim.net.buildLift({
			members: [
				{ name: '0', roles: [PART] },
				{ name: '1', roles: [PART] },
				{ name: '2', roles: [PART, VOTER] },
			],
			route: ['0', '1', '2'],
			routeLinkIds: ['T0', 'T1'],
			payload: { amount: '5' },
		})
		const comp = await complete(record, ['0', '1', '2'])
		const genuineC = await signAs(IDENTITY_SEED, '2', 'C', comp)
		const junk = junkCommits(genuineC, MAX_PENDING_COMMITS_PER_VOTER + 1) // one past the cap, all distinct

		// Delivery 1 (pre-promise): no promise set yet, so the junk cannot be verified — it pools, and the one
		// past the cap drops as pool-full. The observer is a non-member, so it never casts a promise of its own.
		await sim.net.consensusNode('3').update({ ...record, promises: [], commits: junk })
		expect(await sim.net.consensusStoreOf('3').getPendingCommits(tx)).toHaveLength(MAX_PENDING_COMMITS_PER_VOTER)
		expect(rejectReasons(events)).toContain('pool-full')

		// Delivery 2 (completing): the promise set fills, so the pooled junk drains (each forged) and the genuine
		// vote verifies and counts — the cap never locked out the real vote.
		await sim.net.consensusNode('3').update({ ...comp, commits: [genuineC] })
		await sim.net.clock.runUntilIdle()
		expect(rejectReasons(events)).toContain('forged')
		expect(await outcomeOf(sim, 3, tx)).toBe('commit')
		expect(sim.net.deliveryErrors).toEqual([])
	})
})

describe('hostile actors — replaying a settled record is idempotent', () => {
	it('re-pushing a committed record releases nothing twice and moves no money (real route)', async () => {
		const network = line(3) // 0—1—2, cooperative
		const { resourceFor, handles } = makeSimResources({})
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, { identitySeed: IDENTITY_SEED, resourceFor })
		const q: QuerySpec = { from: 0, to: 2, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)
		const result = await runLiftForOutcome(sim, network, outcome, q) // default voter: the originator (node 0)
		expect(result?.outcome).toBe('commit')
		const tx = result!.transactionCode
		const balancesAfter = network.tallies.map((tally) => tally.balance)
		for (const id of [0, 1, 2]) {
			expect(handles.get(id)!.releaseSuccesses).toEqual([true]) // each member released exactly once, success
		}

		// Replay: the whole settled record arrives again at the originator.
		const rec = await sim.net.consensusNode('0').serveRecord(tx)
		await sim.net.consensusNode('0').update(rec!)
		await sim.net.clock.runUntilIdle()

		for (const id of [0, 1, 2]) {
			expect(handles.get(id)!.releaseSuccesses).toEqual([true]) // still exactly one release — deduped silently
		}
		expect(await outcomeOf(sim, 0, tx)).toBe('commit')
		expect(network.tallies.map((tally) => tally.balance)).toEqual(balancesAfter) // no money moved on replay
		expect(sim.net.deliveryErrors).toEqual([])
		expect(sim.net.clock.pendingTimers).toBe(0)
	})
})

describe('hostile actors — an equivocating voter in an honest majority cannot split settlement', () => {
	it('one of three voters signs both faces; every node still commits and the equivocator is proven', async () => {
		const network = line(5) // 0—1—2—3—4, voters {1,2,3}
		const events: TraceEvent[] = []
		const sim = buildSimNetwork(network, {}, 0, (e) => events.push(e), undefined, { identitySeed: IDENTITY_SEED })
		const { record, transactionCode: tx } = sim.net.buildLift({
			members: equivocationMembers(),
			route: ['0', '1', '2', '3', '4'],
			routeLinkIds: ['T0', 'T1', 'T2', 'T3'],
			payload: { amount: '5' },
		})
		const comp = await complete(record, ['0', '1', '2', '3', '4'])
		// Node 2 equivocates (C to island L, NC to island R). Both records carry two honest C (nodes 1, 3), so
		// each island reaches a COMMIT majority independently — 3/3 on the left, 2/3 on the right.
		const cL: TrxRecord<LiftTerms, unknown> = {
			...comp,
			commits: [await signAs(IDENTITY_SEED, '1', 'C', comp), await signAs(IDENTITY_SEED, '3', 'C', comp), await signAs(IDENTITY_SEED, '2', 'C', comp)],
		}
		const cR: TrxRecord<LiftTerms, unknown> = {
			...comp,
			commits: [await signAs(IDENTITY_SEED, '1', 'C', comp), await signAs(IDENTITY_SEED, '3', 'C', comp), await signAs(IDENTITY_SEED, '2', 'NC', comp)],
		}

		sim.conditions[linkIdForTally(2)] = { drop: true } // split {0,1,2} | {3,4} before driving
		await sim.net.consensusNode('0').update(cL)
		await sim.net.consensusNode('4').update(cR)
		await sim.net.clock.runUntilIdle()
		for (const id of [0, 1, 2, 3, 4]) {
			expect(await outcomeOf(sim, id, tx)).toBe('commit') // both islands reached a commit majority
		}

		// Heal and cross the boundary explicitly (a dropped push is never re-queued): hand island R's record to
		// node 2, which now sees its own opposite (NC) face.
		delete sim.conditions[linkIdForTally(2)]
		await sim.net.consensusNode('2').update((await sim.net.consensusNode('4').serveRecord(tx))!)
		await sim.net.clock.runUntilIdle()

		expect(await outcomeOf(sim, 2, tx)).toBe('commit') // the first (commit) face stands
		expect(await sim.net.consensusNode('2').equivocators(tx)).toEqual([sim.net.memberKey('2')])
		expect(await sim.net.consensusNode('2').equivocationProof(tx, sim.net.memberKey('2'))).toHaveLength(2) // both faces retained as proof
		expect(await sim.net.consensusNode('2').contradicts(tx)).toBe(false) // both faces were commit-majority ⇒ no contradiction
		expect(sim.net.deliveryErrors).toEqual([])
	})
})

describe('hostile actors — a voter MAJORITY that equivocates is the one attack the protocol cannot mask', () => {
	it('two of three voters sign both faces; the islands settle oppositely and the contradiction is detected', async () => {
		// THE DOCUMENTED BOUNDARY the parent plan names: zero inconsistent settlements UNLESS a voter *majority*
		// equivocates. Here nodes 1 AND 2 (a majority of the 3-voter set) sign both faces; node 3 is honest. The
		// protocol does not hide the resulting split — two honest members settle opposite ways — it DETECTS it.
		const network = line(5)
		const events: TraceEvent[] = []
		const sim = buildSimNetwork(network, {}, 0, (e) => events.push(e), undefined, { identitySeed: IDENTITY_SEED })
		const { record, transactionCode: tx } = sim.net.buildLift({
			members: equivocationMembers(),
			route: ['0', '1', '2', '3', '4'],
			routeLinkIds: ['T0', 'T1', 'T2', 'T3'],
			payload: { amount: '5' },
		})
		const comp = await complete(record, ['0', '1', '2', '3', '4'])
		const cL: TrxRecord<LiftTerms, unknown> = {
			...comp, // 3 C ⇒ commit
			commits: [await signAs(IDENTITY_SEED, '3', 'C', comp), await signAs(IDENTITY_SEED, '1', 'C', comp), await signAs(IDENTITY_SEED, '2', 'C', comp)],
		}
		const cR: TrxRecord<LiftTerms, unknown> = {
			...comp, // 1 C + 2 NC ⇒ void majority
			commits: [await signAs(IDENTITY_SEED, '3', 'C', comp), await signAs(IDENTITY_SEED, '1', 'NC', comp), await signAs(IDENTITY_SEED, '2', 'NC', comp)],
		}

		sim.conditions[linkIdForTally(2)] = { drop: true }
		await sim.net.consensusNode('0').update(cL)
		await sim.net.consensusNode('4').update(cR)
		await sim.net.clock.runUntilIdle()
		for (const id of [0, 1, 2]) {
			expect(await outcomeOf(sim, id, tx)).toBe('commit') // island L: three commits
		}
		for (const id of [3, 4]) {
			expect(await outcomeOf(sim, id, tx)).toBe('void') // island R: a no-commit majority — the genuine inconsistent settlement
		}

		// Heal and cross the boundary both ways (capture both island records first, then exchange them): the
		// opposing settled records meet at the boundary nodes and the contradiction surfaces.
		delete sim.conditions[linkIdForTally(2)]
		const recFrom2 = (await sim.net.consensusNode('2').serveRecord(tx))!
		const recFrom3 = (await sim.net.consensusNode('3').serveRecord(tx))!
		await sim.net.consensusNode('3').update(recFrom2)
		await sim.net.consensusNode('2').update(recFrom3)
		await sim.net.clock.runUntilIdle()

		expect(await sim.net.consensusNode('2').contradicts(tx)).toBe(true) // committed node saw the void record
		expect(await sim.net.consensusNode('3').contradicts(tx)).toBe(true) // voided node saw the commit record
		expect(events.some((event) => event.type === 'contradiction-detected')).toBe(true)
		// Both equivocators (nodes 1 and 2) are proven at a node that saw both faces.
		expect(new Set(await sim.net.consensusNode('2').equivocators(tx))).toEqual(new Set([sim.net.memberKey('1'), sim.net.memberKey('2')]))
		expect(sim.net.deliveryErrors).toEqual([]) // the equivocation rejections are caught, never thrown back
	})
})

describe('hostile actors — determinism', () => {
	it('the voter-majority equivocation reproduces identical contradiction + proof across two runs', async () => {
		async function pass(): Promise<{ reasons: string[]; contradicts2: boolean; contradicts3: boolean; equivocators2: string[] }> {
			const network = cloneNetwork(line(5))
			const events: TraceEvent[] = []
			const sim = buildSimNetwork(network, {}, 0, (e) => events.push(e), undefined, { identitySeed: IDENTITY_SEED })
			const { record, transactionCode: tx } = sim.net.buildLift({
				members: equivocationMembers(),
				route: ['0', '1', '2', '3', '4'],
				routeLinkIds: ['T0', 'T1', 'T2', 'T3'],
				payload: { amount: '5' },
			})
			const comp = await complete(record, ['0', '1', '2', '3', '4'])
			const cL: TrxRecord<LiftTerms, unknown> = {
				...comp,
				commits: [await signAs(IDENTITY_SEED, '3', 'C', comp), await signAs(IDENTITY_SEED, '1', 'C', comp), await signAs(IDENTITY_SEED, '2', 'C', comp)],
			}
			const cR: TrxRecord<LiftTerms, unknown> = {
				...comp,
				commits: [await signAs(IDENTITY_SEED, '3', 'C', comp), await signAs(IDENTITY_SEED, '1', 'NC', comp), await signAs(IDENTITY_SEED, '2', 'NC', comp)],
			}
			sim.conditions[linkIdForTally(2)] = { drop: true }
			await sim.net.consensusNode('0').update(cL)
			await sim.net.consensusNode('4').update(cR)
			await sim.net.clock.runUntilIdle()
			delete sim.conditions[linkIdForTally(2)]
			const recFrom2 = (await sim.net.consensusNode('2').serveRecord(tx))!
			const recFrom3 = (await sim.net.consensusNode('3').serveRecord(tx))!
			await sim.net.consensusNode('3').update(recFrom2)
			await sim.net.consensusNode('2').update(recFrom3)
			await sim.net.clock.runUntilIdle()
			return {
				reasons: rejectReasons(events).sort(),
				contradicts2: await sim.net.consensusNode('2').contradicts(tx),
				contradicts3: await sim.net.consensusNode('3').contradicts(tx),
				equivocators2: (await sim.net.consensusNode('2').equivocators(tx)).sort(),
			}
		}
		const a = await pass()
		const b = await pass()
		expect(b).toEqual(a) // same keys + same seeds ⇒ byte-identical signatures ⇒ identical trace and settlement
	})
})
