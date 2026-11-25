import { MemberTypes, type MemberType } from 'tallynet'
import type { LiftMemberSpec } from 'tallynet/testing'
import { FORMAT_VERSION, type Network, type Tally } from '../model.js'
import { makeSimResources } from './consensus-resource.js'
import { buildSimNetwork } from './harness.js'

const PART: MemberType = MemberTypes.participant
const REF: MemberType = MemberTypes.referee

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
