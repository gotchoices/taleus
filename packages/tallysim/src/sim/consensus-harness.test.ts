import { makeNonce, MemberTypes, type MemberType } from 'tallynet'
import type { LiftMemberSpec } from 'tallynet/testing'
import { FORMAT_VERSION, type Network, type Tally, cloneNetwork, serialize } from '../model.js'
import { runLiftForOutcome } from './consensus-harness.js'
import { makeSimResources } from './consensus-resource.js'
import { buildSimNetwork, runQuery, type QueryOutcome, type QuerySpec } from './harness.js'
import { linkIdForTally } from './naming.js'

const PART: MemberType = MemberTypes.participant
const REF: MemberType = MemberTypes.referee

/** A node's net credit position: `Σ balance where it is stock − Σ balance where it is foil` (what it is owed net). */
function netPosition(network: Network, entity: number): number {
	let pos = 0
	for (const t of network.tallies) {
		if (t.stock === entity) {
			pos += t.balance
		}
		if (t.foil === entity) {
			pos -= t.balance
		}
	}
	return pos
}

/** The consensus config every end-to-end pass uses (a fixed identity seed, cooperative unless a resource is given). */
const CONSENSUS = { identitySeed: 7 }

/**
 * A line `0 - 1 - … - (n-1)`, one tally per consecutive pair, with **finite** symmetric credit limits.
 * Finite on purpose: an `Infinity` credit limit would make the lift record's link intents carry a non-finite
 * number, which DAG-CBOR record signing rejects (see the sibling ticket's CBOR-sanitise fix).
 */
function line(n: number, limit = 1000): Network {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return { entityCount: n, tallies, meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** The members of a line lift: every node a participant, the terminus also the sole referee (a voter set of one). */
function lineMembers(n: number): LiftMemberSpec[] {
	return Array.from({ length: n }, (_, i) => ({ name: String(i), roles: i === n - 1 ? [PART, REF] : [PART] }))
}

/** The exact tally link ids for a line's route hops (`T0, T1, …`), matching `linkIdForTally`. */
function lineRouteLinkIds(n: number): string[] {
	return Array.from({ length: n - 1 }, (_, i) => `T${i}`)
}

describe('buildSimNetwork — consensus opt-in', () => {
	it('without a consensus config, the harness is discovery-only (no consensus nodes)', () => {
		const sim = buildSimNetwork(line(3), {}, 0)
		expect(() => sim.net.consensusNode('0')).toThrow(/consensus is not configured/)
	})

	it('with a consensus config, a hand-built lift over a cooperative line commits at every node', async () => {
		const n = 3
		const sim = buildSimNetwork(line(n), {}, 0, undefined, undefined, { identitySeed: 7 })
		const net = sim.net
		const { record, transactionCode } = net.buildLift({
			members: lineMembers(n),
			route: ['0', '1', '2'],
			routeLinkIds: lineRouteLinkIds(n), // exercise the exact-tally path on the two line hops
			payload: { amount: '5' }, // a STRING amount — keeps the signed record CBOR-safe
		})

		await net.consensusNode('0').start(record) // seed the originator; it schedules its pushes
		await net.clock.runUntilIdle() // drain every scheduled record-push in virtual time

		for (const name of ['0', '1', '2']) {
			expect(await net.consensusNode(name).outcome(transactionCode)).toBe('commit')
		}
		expect(net.deliveryErrors).toEqual([]) // a clean run leaves no receiver-side push errors
		expect(net.clock.pendingTimers).toBe(0) // nothing left in flight
	})

	it('a failure-injecting resource port (keyed by entity id) is adapted to node names and honoured', async () => {
		// Entity 1 declines to promise → the whole route voids; every node releases once, as a void. This also
		// proves the entity-id → node-name adaptation on ConsensusConfig.resourceFor.
		const n = 3
		const { resourceFor, handles } = makeSimResources({ 1: { shouldPromise: false } })
		const sim = buildSimNetwork(line(n), {}, 0, undefined, undefined, { identitySeed: 7, resourceFor })
		const net = sim.net
		const { record, transactionCode } = net.buildLift({
			members: lineMembers(n),
			route: ['0', '1', '2'],
			routeLinkIds: lineRouteLinkIds(n),
			payload: { amount: '5' },
		})

		await net.consensusNode('0').start(record)
		await net.clock.runUntilIdle()

		for (const name of ['0', '1', '2']) {
			expect(await net.consensusNode(name).outcome(transactionCode)).toBe('void')
		}
		expect(handles.get(1)!.promiseCtxs).toEqual([]) // the refuser held nothing
		expect(handles.get(0)!.releaseSuccesses).toEqual([false]) // every node released once, as a void
		expect(net.deliveryErrors).toEqual([])
	})

	it('reuses the same deterministic keys for a given identitySeed', () => {
		const a = buildSimNetwork(line(3), {}, 0, undefined, undefined, { identitySeed: 7 })
		const b = buildSimNetwork(line(3), {}, 0, undefined, undefined, { identitySeed: 7 })
		expect(a.net.memberKey('1')).toEqual(b.net.memberKey('1')) // same seed ⇒ same member key
		const c = buildSimNetwork(line(3), {}, 0, undefined, undefined, { identitySeed: 8 })
		expect(a.net.memberKey('1')).not.toEqual(c.net.memberKey('1')) // a different seed ⇒ a different key
	})
})

describe('runLiftForOutcome — discovery + consensus end to end', () => {
	it('all-cooperative: picks the shortest plan, the lift commits, balances move by the amount', async () => {
		const network = line(3)
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, CONSENSUS)
		const q: QuerySpec = { from: 0, to: 2, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)
		expect(outcome.found).toBe(true)

		const result = await runLiftForOutcome(sim, network, outcome, q)
		expect(result?.outcome).toBe('commit')
		expect(result?.route).toEqual([0, 1, 2]) // [from, …, to]
		expect(result?.tallyPath).toEqual([0, 1])
		// Value flows 0 → 1 → 2; the stock (lower id) pays on each line tally, so each balance falls by 5.
		expect(network.tallies[0].balance).toBe(-5)
		expect(network.tallies[1].balance).toBe(-5)
		expect(sim.net.deliveryErrors).toEqual([])
		expect(sim.net.clock.pendingTimers).toBe(0)
	})

	it('one refuser voids the whole route; no money moves', async () => {
		const network = line(3)
		const { resourceFor, handles } = makeSimResources({ 1: { shouldPromise: false } })
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, { ...CONSENSUS, resourceFor })
		const q: QuerySpec = { from: 0, to: 2, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)

		const result = await runLiftForOutcome(sim, network, outcome, q)
		expect(result?.outcome).toBe('void')
		expect(network.tallies[0].balance).toBe(0) // unchanged on a void
		expect(network.tallies[1].balance).toBe(0)
		expect(handles.get(1)!.promiseCtxs).toEqual([]) // the refuser held nothing
		expect(sim.net.deliveryErrors).toEqual([]) // a refusal is caught and signed NP, not a delivery error
	})

	it('a split voter set (override) stalls to pending; no money moves and nothing leaks', async () => {
		// Two voters, 0 and 2, that split 1 commit / 1 void → no strict majority → pending (not void: every
		// node promised; the stall is in the vote, so balances must stay put). Exercises both options.voters
		// and the pending branch of the money-move guard end to end.
		const network = line(3)
		const { resourceFor } = makeSimResources({ 2: { shouldCommit: false } })
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, { ...CONSENSUS, resourceFor })
		const q: QuerySpec = { from: 0, to: 2, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)

		const result = await runLiftForOutcome(sim, network, outcome, q, { voters: [0, 2] })
		expect(result?.outcome).toBe('pending') // even split, no strict majority
		expect(network.tallies[0].balance).toBe(0) // unchanged on a stall
		expect(network.tallies[1].balance).toBe(0)
		expect(sim.net.deliveryErrors).toEqual([])
		expect(sim.net.clock.pendingTimers).toBe(0) // the stall left nothing in flight
	})

	it('throws when a voter is not on the route (a misconfigured voter set, not a silent zero-referee stall)', async () => {
		const network = line(3)
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, CONSENSUS)
		const q: QuerySpec = { from: 0, to: 2, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)

		await expect(runLiftForOutcome(sim, network, outcome, q, { voters: [0, 99] })).rejects.toThrow(/voter 99 is not on the route/)
	})

	it('conservation: only payer and payee change net position; every intermediary nets zero', async () => {
		const network = line(4)
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, CONSENSUS)
		const q: QuerySpec = { from: 0, to: 3, amount: 5, depth: 4 }
		const before = [0, 1, 2, 3].map((e) => netPosition(network, e))
		const outcome = await runQuery(sim, q)

		const result = await runLiftForOutcome(sim, network, outcome, q)
		expect(result?.outcome).toBe('commit')
		const after = [0, 1, 2, 3].map((e) => netPosition(network, e))
		expect(after[0] - before[0]).toBe(-5) // payer out by the amount
		expect(after[3] - before[3]).toBe(5) // payee in by the amount
		expect(after[1] - before[1]).toBe(0) // intermediary unchanged
		expect(after[2] - before[2]).toBe(0)
	})

	it('capacity changes between lifts: a committed lift prunes a now-zero-capacity edge for the next query', async () => {
		const network = line(3, 10) // symmetric credit limits of 10
		const q: QuerySpec = { from: 0, to: 2, amount: 10, depth: 3 }

		const sim1 = buildSimNetwork(network, {}, 0, undefined, undefined, CONSENSUS)
		const r1 = await runLiftForOutcome(sim1, network, await runQuery(sim1, q), q)
		expect(r1?.outcome).toBe('commit')
		expect(network.tallies[0].balance).toBe(-10) // cap(0→1) is now 0

		// Rebuild the sim from the mutated network — an already-built InMemoryNetwork froze the old capacity.
		const sim2 = buildSimNetwork(network, {}, 0, undefined, undefined, CONSENSUS)
		const out2 = await runQuery(sim2, q)
		expect(out2.found).toBe(false) // the 0→1 edge can no longer carry 10
		const r2 = await runLiftForOutcome(sim2, network, out2, q)
		expect(r2).toBeUndefined() // no plan ⇒ the phase is skipped, nothing mutates
		expect(network.tallies[0].balance).toBe(-10) // unchanged by the second pass
	})

	it('parallel tallies: routeLinkIds drives the lift over the exact tally discovery chose', async () => {
		// Two tallies 0-1: tally 0 (the first edge, the default pick) has NO forward capacity; tally 1 carries it.
		// The lift must settle over tally 1 — if it fell back to the first edge the bound check would throw.
		const network: Network = {
			entityCount: 2,
			tallies: [
				{ stock: 0, foil: 1, balance: -1000, stockCreditLimit: 1000, foilCreditLimit: 1000 }, // cap(0→1) = 0
				{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 }, // cap(0→1) = 1000
			],
			meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION },
		}
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, CONSENSUS)
		const q: QuerySpec = { from: 0, to: 1, amount: 5, depth: 2 }
		const outcome = await runQuery(sim, q)

		const result = await runLiftForOutcome(sim, network, outcome, q)
		expect(result?.outcome).toBe('commit')
		expect(result?.tallyPath).toEqual([1]) // the capacity-bearing tally, not the first edge
		expect(network.tallies[1].balance).toBe(-5) // moved
		expect(network.tallies[0].balance).toBe(-1000) // the zero-capacity parallel tally is untouched
	})

	it('Infinity-capacity route commits (proves the link intents are CBOR-sanitised before signing)', async () => {
		const network = line(3, Infinity) // unlimited credit both sides
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, CONSENSUS)
		const q: QuerySpec = { from: 0, to: 2, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)
		expect(outcome.found).toBe(true)

		const result = await runLiftForOutcome(sim, network, outcome, q)
		expect(result?.outcome).toBe('commit') // would throw at digest time without the Infinity sanitisation
		expect(network.tallies[0].balance).toBe(-5) // balance moved by the amount
		expect(network.tallies[0].stockCreditLimit).toBe(Infinity) // the limit stays Infinity
	})

	it('determinism: the same scenario twice yields identical LiftResults and byte-identical networks', async () => {
		const base = line(3)
		const q: QuerySpec = { from: 0, to: 2, amount: 5, depth: 3 }
		async function pass() {
			const network = cloneNetwork(base)
			const sim = buildSimNetwork(network, {}, 0, undefined, undefined, CONSENSUS)
			const result = await runLiftForOutcome(sim, network, await runQuery(sim, q), q)
			return { result, serialized: serialize(network) }
		}
		const a = await pass()
		const b = await pass()
		expect(a.result).toEqual(b.result)
		expect(a.serialized).toEqual(b.serialized)
	})

	it('circular lift: a hand-chosen ring plan commits at every node; conservation holds around the loop', async () => {
		// A ring 0-1-2-0 (tally 2 closes it). Discovery for from === to is not the point here — this drives the
		// circular route reconstruction and balance walk directly, from a plan whose nonces are this session's.
		const network: Network = {
			entityCount: 3,
			tallies: [
				{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
				{ stock: 1, foil: 2, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
				{ stock: 2, foil: 0, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
			],
			meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION },
		}
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, CONSENSUS)
		const q: QuerySpec = { from: 0, to: 0, amount: 5, depth: 3 }
		const base = await runQuery(sim, q) // mints a real session code (its plans may be empty)
		const outcome: QueryOutcome = {
			sessionCode: base.sessionCode,
			plans: [{ path: [0, 1, 2].map((i) => ({ nonce: makeNonce(base.sessionCode, linkIdForTally(i)), intents: {} })), members: [] }],
			found: true,
		}

		const result = await runLiftForOutcome(sim, network, outcome, q)
		expect(result?.outcome).toBe('commit')
		expect(result?.route).toEqual([0, 1, 2, 0]) // a closed loop
		for (const e of [0, 1, 2]) {
			expect(netPosition(network, e)).toBe(0) // every node nets zero around the loop
		}
		expect(sim.net.deliveryErrors).toEqual([])
	})
})
