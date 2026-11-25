import { VirtualClock } from './clock.js'
import { SeededRandom } from './random.js'
import { InMemoryNetwork, negateNumericTerms, type NetworkGraph } from './network.js'
import { generate } from '../session-code.js'
import { makeNonce } from '../nonce.js'
import { nobleHasher } from '../crypto.js'
import type { QueryRequest, UniQuery } from '../discovery/types.js'

type Terms = { balance: number }

const SESSION_TTL = 600_000

function newQuery(targetKey: string, now: number, random: SeededRandom): UniQuery<Terms> {
	return {
		target: { address: { key: targetKey } },
		sessionCode: generate(SESSION_TTL, { now, random }),
		intents: { L: { balance: 1 } },
		maxDepth: 7,
	}
}

function entrance(query: UniQuery<Terms>): QueryRequest<Terms, string> {
	return { entrance: { plan: { path: [], members: [] }, query }, budgetMs: 2_000 }
}

describe('InMemoryNetwork wiring', () => {
	it('builds one node per graph node', () => {
		const graph: NetworkGraph<Terms> = { nodes: ['N0', 'N1', 'N2'], links: [] }
		const net = new InMemoryNetwork<Terms, string>({ graph, clock: new VirtualClock(), random: new SeededRandom(1) })
		expect(net.node('N0').nodeId).toBe('N0')
		expect(net.node('N2').nodeId).toBe('N2')
		expect(() => net.node('N9')).toThrow(/no node named/)
	})

	it('reaches a neighbour over the shared link id (direct entrance against a two-node graph)', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B'],
			links: [{ id: 'L0', node1: 'A', node2: 'B', intents: { L: { balance: 100 } } }],
		}
		const clock = new VirtualClock()
		const random = new SeededRandom(1)
		const net = new InMemoryNetwork<Terms, string>({ graph, clock, random })
		const query = newQuery('B', clock.now(), random)
		const response = await net.node('A').query(entrance(query))
		expect(response.plans?.length).toBe(1)
		// the plan's only path link uses the nonce of the shared link id L0
		expect(response.plans![0].path[0].nonce).toBe(makeNonce(query.sessionCode, 'L0', nobleHasher))
		// and B (the neighbour-that-is-target) is a member of the returned plan
		expect(response.plans![0].members.some((m) => m.address.key === 'B')).toBe(true)
	})

	it('surfaces a linkId with no neighbour as a rejected sub-query, not a crash', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B'],
			links: [{ id: 'L0', node1: 'A', node2: 'B', intents: { L: { balance: 100 } } }],
		}
		const clock = new VirtualClock()
		const random = new SeededRandom(1)
		const net = new InMemoryNetwork<Terms, string>({ graph, clock, random })
		await expect(net.deliver('A', entrance(newQuery('B', clock.now(), random)), 'NOPE')).rejects.toThrow(/no neighbour/)
	})

	it('inverts a numeric balance on the node2 -> node1 view', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B'],
			links: [{ id: 'L0', node1: 'A', node2: 'B', intents: { L: { balance: 100 } } }],
		}
		const clock = new VirtualClock()
		const random = new SeededRandom(1)
		const net = new InMemoryNetwork<Terms, string>({ graph, clock, random, invertTerms: negateNumericTerms })
		// A -> B view carries the link's own terms
		const fromA = await net.node('A').query(entrance(newQuery('B', clock.now(), random)))
		expect(fromA.plans![0].path[0].intents.L.balance).toBe(100)
		// B -> A view is inverted
		const fromB = await net.node('B').query(entrance(newQuery('A', clock.now(), random)))
		expect(fromB.plans![0].path[0].intents.L.balance).toBe(-100)
	})

	it('defers a delivery by exactly its link latency', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B'],
			links: [{ id: 'L0', node1: 'A', node2: 'B', intents: { L: { balance: 100 } } }],
		}
		const clock = new VirtualClock()
		const random = new SeededRandom(1)
		const net = new InMemoryNetwork<Terms, string>({ graph, clock, random, conditions: { L0: { latencyMs: 500 } } })
		let deliveredAt = -1
		// The request itself (an empty-path entrance reached over an inbound link) is rejected by the
		// participant; what this asserts is the *timing* of the hop, so either settlement records when.
		void net.deliver('A', entrance(newQuery('B', clock.now(), random)), 'L0').then(
			() => { deliveredAt = clock.now() },
			() => { deliveredAt = clock.now() },
		)
		expect(clock.pendingTimers).toBe(1) // the request-leg timer is queued at +500
		await clock.advance(499)
		expect(deliveredAt).toBe(-1) // not yet delivered
		await clock.advance(1)
		expect(deliveredAt).toBe(500) // delivered at exactly the latency
	})

	it('a dropped link arms no timer and never delivers', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B'],
			links: [{ id: 'L0', node1: 'A', node2: 'B', intents: { L: { balance: 100 } } }],
		}
		const clock = new VirtualClock()
		const random = new SeededRandom(1)
		const net = new InMemoryNetwork<Terms, string>({ graph, clock, random, conditions: { L0: { drop: true } } })
		let settled = false
		void net.deliver('A', entrance(newQuery('B', clock.now(), random)), 'L0').then(
			() => { settled = true },
			() => { settled = true },
		)
		expect(clock.pendingTimers).toBe(0) // no delivery timer armed for a dropped link
		await clock.advance(1_000_000)
		expect(settled).toBe(false) // an eternally-sleeping delivery: never resolves, never rejects
	})

	it('drives a one-hop discovery to completion on the virtual clock', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B', 'C'],
			links: [
				{ id: 'AB', node1: 'A', node2: 'B', intents: { L: { balance: 100 } } },
				{ id: 'BC', node1: 'B', node2: 'C', intents: { L: { balance: 100 } } },
			],
		}
		const clock = new VirtualClock()
		const net = new InMemoryNetwork<Terms, string>({ graph, clock, random: new SeededRandom(7) })
		const resultP = net.discover('A', { address: { key: 'C' } }, { L: { balance: 50 } })
		await clock.runUntilIdle()
		const result = await resultP
		expect(result.plans.length).toBeGreaterThan(0)
		expect(result.plans.some((p) => p.members.some((m) => m.address.key === 'C'))).toBe(true)
		expect(clock.pendingTimers).toBe(0)
	})
})
