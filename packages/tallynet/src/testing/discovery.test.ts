/**
 * End-to-end unidirectional discovery, driven from a payer's own node over the in-memory harness.
 * Where `discovery/participant.test.ts` drives one participant against a stub `queryPeer`, these
 * scenarios wire a whole graph of {@link DiscoveryNode}s and run `net.discover(...)` to completion on
 * the {@link VirtualClock} -- the originator loop, every participant's `enter`/`reenter`, the real
 * per-round time budget and the delivery model all exercised together.
 *
 * The driving pattern throughout (see {@link runDiscovery}):
 *
 *     const p = net.discover(from, target, intents)
 *     await net.clock.runUntilIdle()   // fires every delivery + budget timer, in order
 *     const result = await p
 *
 * ── Two notes for the reader ─────────────────────────────────────────────────────────────────────
 *
 * - **Trace overlap on the originator node.** The originator loop emits `round-started`/`plan-found`,
 *   and the originator's *own local participant* emits the same events for its own sub-query rounds.
 *   So the originator node shows both. This is intentional (two levels: the search round vs the
 *   participant's local round) and harmless. These tests assert **presence**, never counts, on those.
 * - **The maxDepth invariant.** A returned plan always satisfies `path.length <= maxDepth`. The
 *   *observed* tight relationship for a target reached via a peer-match terminus (a neighbour of a
 *   relay, not a relay the search enters) is one step stricter: `path.length <= maxDepth - 1`. The
 *   `maxDepth boundary` describe proves the edge empirically: a target reachable only at path length 3
 *   is missed at `maxDepth: 3` and found at `maxDepth: 4`. (`assertValidPlan` asserts only the loose
 *   `<= maxDepth` bound, which holds in every case including originator-local matches at round 0.)
 */

import { VirtualClock } from './clock.js'
import { SeededRandom } from './random.js'
import {
	InMemoryNetwork,
	negateNumericTerms,
	randomGraph,
	type LinkCondition,
	type NetworkGraph,
	type NetworkLink,
} from './network.js'
import type { DiscoveryHooks } from '../discovery/hooks.js'
import type { DiscoveryResult, OriginatorOptions } from '../discovery/originator.js'
import type { ParticipantOptions } from '../discovery/participant.js'
import type { Plan, Target } from '../discovery/types.js'
import type { TraceEvent } from '../trace.js'

type Terms = { balance: number }
type Payload = string

/* ── harness helpers ──────────────────────────────────────────────────────────────────────────── */

interface NetConfig {
	hooks?: DiscoveryHooks<Terms, Payload>
	conditions?: Record<string, LinkCondition>
	options?: Partial<OriginatorOptions & ParticipantOptions>
	seed?: number
}

/** Build a network over `graph` with a fresh virtual clock, a seeded PRNG and a captured trace log. */
function makeNet(graph: NetworkGraph<Terms>, config: NetConfig = {}): { net: InMemoryNetwork<Terms, Payload>; traces: TraceEvent[] } {
	const traces: TraceEvent[] = []
	const net = new InMemoryNetwork<Terms, Payload>({
		graph,
		clock: new VirtualClock(),
		random: new SeededRandom(config.seed ?? 1),
		invertTerms: negateNumericTerms,
		hooks: config.hooks,
		conditions: config.conditions,
		options: config.options,
		trace: (event) => traces.push(event),
	})
	return { net, traces }
}

/** Start a search and drive the clock to completion; resolves to the final {@link DiscoveryResult}. */
async function runDiscovery(
	net: InMemoryNetwork<Terms, Payload>,
	from: string,
	target: Target,
	intents: Record<string, Terms>,
	options?: Partial<OriginatorOptions>,
): Promise<DiscoveryResult<Terms, Payload>> {
	const result = net.discover(from, target, intents, options)
	await net.clock.runUntilIdle()
	return result
}

/** A plan's route identity: its path nonces in order. Two plans with the same key are the same route. */
function planPathKey(plan: Plan<Terms, Payload>): string {
	return plan.path.map((link) => link.nonce).join('|')
}

/**
 * Assert a returned plan is a valid route: no nonce repeats, it respects `maxDepth`, and -- once its
 * anonymised path nonces are resolved back to real link ids via every node's store -- its links form a
 * connected chain from `originKey` to `targetKey`, with `members` running origin-first, target-last.
 */
async function assertValidPlan(
	net: InMemoryNetwork<Terms, Payload>,
	links: NetworkLink<Terms>[],
	session: string,
	plan: Plan<Terms, Payload>,
	originKey: string,
	targetKey: string,
	maxDepth: number,
): Promise<void> {
	const nonces = plan.path.map((link) => link.nonce)
	expect(new Set(nonces).size).toBe(nonces.length) // no repeated nonce (no cycle survived)
	expect(plan.path.length).toBeLessThanOrEqual(maxDepth)

	const nonceToLinkId = await net.nonceToLinkMap(session)
	const linkById = new Map(links.map((link) => [link.id, link]))
	let current = originKey
	for (const link of plan.path) {
		const linkId = nonceToLinkId[link.nonce]
		expect(linkId).toBeDefined()
		const networkLink = linkById.get(linkId)
		expect(networkLink).toBeDefined()
		expect([networkLink!.node1, networkLink!.node2]).toContain(current) // shares a node with the last hop
		current = networkLink!.node1 === current ? networkLink!.node2 : networkLink!.node1
	}
	expect(current).toBe(targetKey) // the chain lands on the target

	expect(plan.members[0].address.key).toBe(originKey)
	expect(plan.members[plan.members.length - 1].address.key).toBe(targetKey)
}

/**
 * Custom hooks replicating ChipNet's single-unit min-balance negotiation: keep only the `'L'` code,
 * require the candidate link and the want to share a sign and the link to carry at least the wanted
 * magnitude, and narrow the terms to exactly the wanted balance. A plan satisfies when every one of
 * its links carries `'L'` at (at least) the wanted balance -- so an empty-path (self-match) plan does
 * NOT satisfy under these hooks (use the defaults for the self-is-target case).
 */
function minBalanceHooks(): DiscoveryHooks<Terms, Payload> {
	return {
		negotiateIntent: ({ code, linkTerms, query }) => {
			if (code !== 'L') {
				return undefined
			}
			const want = query.intents.L as Terms | undefined
			const link = linkTerms.balance
			const need = want?.balance
			if (!need || !link) {
				return undefined
			}
			if (Math.sign(link) === Math.sign(need) && Math.abs(link) >= Math.abs(need)) {
				return { balance: Math.sign(need) * Math.min(Math.abs(link), Math.abs(need)) }
			}
			return undefined
		},
		planSatisfies: (query, plan) => {
			const want = query.intents.L as Terms | undefined
			const need = want?.balance
			if (!need) {
				return false
			}
			return (
				plan.path.length > 0 &&
				plan.path.every((link) => {
					const terms = link.intents.L as Terms | undefined
					return terms !== undefined && Math.sign(terms.balance) === Math.sign(need) && Math.abs(terms.balance) >= Math.abs(need)
				})
			)
		},
	}
}

/** The one extra `'L'` term every synthetic link carries. */
function liftTerms(balance: number): Record<string, Terms> {
	return { L: { balance } }
}

/* ── the ChipNet 6-node happy path, ported with real assertions ───────────────────────────────── */

describe('discovery end to end — ChipNet 6-node happy path', () => {
	const graph: NetworkGraph<Terms> = {
		nodes: ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'],
		links: [
			{ id: 'L1', node1: 'N1', node2: 'N2', intents: liftTerms(500) },
			{ id: 'L2', node1: 'N2', node2: 'N3', intents: liftTerms(500) },
			{ id: 'L3', node1: 'N2', node2: 'N4', intents: liftTerms(500) },
			{ id: 'L4', node1: 'N4', node2: 'N5', intents: liftTerms(500) },
			{ id: 'L5', node1: 'N3', node2: 'N6', intents: liftTerms(500) },
		],
	}

	it('finds the one route N1→N2→N3→N6, each link carrying L at the negotiated balance 100', async () => {
		const { net, traces } = makeNet(graph, { hooks: minBalanceHooks() })
		const result = await runDiscovery(net, 'N1', { address: { key: 'N6' } }, liftTerms(100))

		expect(result.plans).toHaveLength(1)
		const plan = result.plans[0]

		// path shape: three hops, each carrying exactly the single 'L' intent negotiated down to 100
		expect(plan.path).toHaveLength(3)
		expect(plan.path.every((link) => Object.keys(link.intents).length === 1)).toBe(true)
		expect(plan.path.every((link) => link.intents.L.balance === 100)).toBe(true)

		// members, in order: originator, the two relays, then the target
		expect(plan.members.map((member) => member.address.key)).toEqual(['N1', 'N2', 'N3', 'N6'])

		// the originator can map its own first-hop nonce back to its real link id (as the commit engine will)
		const map = await net.storeOf('N1').getNonceToLinkMap(result.sessionCode)
		expect(map[plan.path[0].nonce]).toBe('L1')

		// the route resolves to a valid, connected chain N1 → N2 → N3 → N6
		await assertValidPlan(net, graph.links, result.sessionCode, plan, 'N1', 'N6', 7)

		// trace events are present (presence, not counts: the originator node overlaps both roles)
		expect(traces.some((event) => event.type === 'round-started')).toBe(true)
		expect(traces.some((event) => event.type === 'plan-found')).toBe(true)
		expect(net.clock.pendingTimers).toBe(0) // no leaked timers after a full run
	})
})

/* ── seeded random graph (hundreds of nodes): plan validity ───────────────────────────────────── */

describe('discovery end to end — seeded random graph (300 nodes)', () => {
	/** A 300-node random graph with a guaranteed 4-hop route N0 → N75 → N150 → N225 → N299 embedded. */
	function graph300(): NetworkGraph<Terms> {
		const base = randomGraph<Terms>(300, 600, new SeededRandom(2024), (r) => ({ balance: r.nextFloat() * 1000 - 500 }))
		base.links.push(
			{ id: 'G0', node1: 'N0', node2: 'N75', intents: liftTerms(500) },
			{ id: 'G1', node1: 'N75', node2: 'N150', intents: liftTerms(500) },
			{ id: 'G2', node1: 'N150', node2: 'N225', intents: liftTerms(500) },
			{ id: 'G3', node1: 'N225', node2: 'N299', intents: liftTerms(500) },
		)
		return base
	}

	it('returns only valid routes to the target — distinct path keys, each a chain ending at N299', async () => {
		const graph = graph300()
		const { net } = makeNet(graph, { seed: 7 })
		const result = await runDiscovery(net, 'N0', { address: { key: 'N299' } }, liftTerms(1))

		expect(result.plans.length).toBeGreaterThan(0)
		// no two returned plans are the same route (the same path must never surface twice)
		const keys = result.plans.map(planPathKey)
		expect(new Set(keys).size).toBe(keys.length)
		for (const plan of result.plans) {
			await assertValidPlan(net, graph.links, result.sessionCode, plan, 'N0', 'N299', 7)
		}
		expect(net.clock.pendingTimers).toBe(0)
	}, 30_000)
})

/* ── self-is-target (circular) ────────────────────────────────────────────────────────────────── */

describe('discovery end to end — self is the target (circular lift)', () => {
	it('matches at round 0 with an empty path and [self] members, never throwing', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B'],
			links: [{ id: 'AB', node1: 'A', node2: 'B', intents: liftTerms(500) }],
		}
		const { net } = makeNet(graph) // default hooks: an empty-path plan satisfies vacuously
		const result = await runDiscovery(net, 'A', { address: { key: 'A' } }, liftTerms(100))

		expect(result.plans).toHaveLength(1)
		expect(result.plans[0].path).toHaveLength(0)
		expect(result.plans[0].members.map((member) => member.address.key)).toEqual(['A'])
		expect(net.clock.pendingTimers).toBe(0)
	})
})

/* ── not found / unreachable ──────────────────────────────────────────────────────────────────── */

describe('discovery end to end — not found', () => {
	it('a target that is not in the graph yields empty plans and never throws', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B'],
			links: [{ id: 'AB', node1: 'A', node2: 'B', intents: liftTerms(500) }],
		}
		const { net } = makeNet(graph)
		const result = await runDiscovery(net, 'A', { address: { key: 'Z' } }, liftTerms(1))

		expect(result.plans).toEqual([])
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a target in a disconnected component yields empty plans and never throws', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B', 'C', 'D'],
			links: [
				{ id: 'AB', node1: 'A', node2: 'B', intents: liftTerms(500) },
				{ id: 'CD', node1: 'C', node2: 'D', intents: liftTerms(500) },
			],
		}
		const { net } = makeNet(graph)
		const result = await runDiscovery(net, 'A', { address: { key: 'D' } }, liftTerms(1))

		expect(result.plans).toEqual([])
		expect(net.clock.pendingTimers).toBe(0)
	})
})

/* ── maxDepth boundary (proves path.length ≤ maxDepth is tight) ────────────────────────────────── */

describe('discovery end to end — maxDepth boundary', () => {
	// A straight chain N0-N1-N2-N3; the target N3 is reachable only at path length 3 (peer-match at N2).
	const chain: NetworkGraph<Terms> = {
		nodes: ['N0', 'N1', 'N2', 'N3'],
		links: [
			{ id: 'E01', node1: 'N0', node2: 'N1', intents: liftTerms(500) },
			{ id: 'E12', node1: 'N1', node2: 'N2', intents: liftTerms(500) },
			{ id: 'E23', node1: 'N2', node2: 'N3', intents: liftTerms(500) },
		],
	}

	it('stops at the ceiling with candidates still open and returns what it found (none) — no throw', async () => {
		// A path-length-3 peer-match terminus (N3 via N2) needs maxDepth ≥ 4; at maxDepth 3 it is missed.
		const { net, traces } = makeNet(chain)
		const result = await runDiscovery(net, 'N0', { address: { key: 'N3' } }, liftTerms(1), { maxDepth: 3 })

		expect(result.plans).toEqual([])
		expect(traces.some((event) => event.type === 'candidate-pruned' && event.reason === 'max-depth')).toBe(true)
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('one deeper ceiling finds the same target at exactly path length 3', async () => {
		const { net } = makeNet(chain)
		const result = await runDiscovery(net, 'N0', { address: { key: 'N3' } }, liftTerms(1), { maxDepth: 4 })

		expect(result.plans).toHaveLength(1)
		expect(result.plans[0].path).toHaveLength(3)
		await assertValidPlan(net, chain.links, result.sessionCode, result.plans[0], 'N0', 'N3', 4)
		expect(net.clock.pendingTimers).toBe(0)
	})
})

/* ── direct peer & multiple distinct routes ───────────────────────────────────────────────────── */

describe('discovery end to end — direct peer and multiple routes', () => {
	it('a target that is a direct peer is found at path length 1', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B'],
			links: [{ id: 'AB', node1: 'A', node2: 'B', intents: liftTerms(500) }],
		}
		const { net } = makeNet(graph)
		const result = await runDiscovery(net, 'A', { address: { key: 'B' } }, liftTerms(100))

		expect(result.plans).toHaveLength(1)
		expect(result.plans[0].path).toHaveLength(1)
		expect(result.plans[0].members.map((member) => member.address.key)).toEqual(['A', 'B'])
	})

	it('the same target reachable by two different paths surfaces two distinct candidates', async () => {
		// A diamond: A→B→T and A→C→T. Both paths are length 2 and found in the same round.
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B', 'C', 'T'],
			links: [
				{ id: 'AB', node1: 'A', node2: 'B', intents: liftTerms(500) },
				{ id: 'AC', node1: 'A', node2: 'C', intents: liftTerms(500) },
				{ id: 'BT', node1: 'B', node2: 'T', intents: liftTerms(500) },
				{ id: 'CT', node1: 'C', node2: 'T', intents: liftTerms(500) },
			],
		}
		const { net } = makeNet(graph)
		const result = await runDiscovery(net, 'A', { address: { key: 'T' } }, liftTerms(100))

		expect(result.plans).toHaveLength(2)
		const keys = result.plans.map(planPathKey)
		expect(new Set(keys).size).toBe(2) // two distinct routes, no duplicate of either
		for (const plan of result.plans) {
			await assertValidPlan(net, graph.links, result.sessionCode, plan, 'A', 'T', 7)
		}
		expect(net.clock.pendingTimers).toBe(0)
	})
})

/* ── latency, drop and sleeping links ─────────────────────────────────────────────────────────── */

describe('discovery end to end — link conditions', () => {
	// The only route to T runs A →(slow)→ B → T. The slow leg outlasts several round budgets.
	const chainToTarget: NetworkGraph<Terms> = {
		nodes: ['A', 'B', 'T'],
		links: [
			{ id: 'AB', node1: 'A', node2: 'B', intents: liftTerms(500) },
			{ id: 'BT', node1: 'B', node2: 'T', intents: liftTerms(500) },
		],
	}

	it('a slow link (latency past a round budget) still folds its answer into a later round — the plan surfaces exactly once', async () => {
		// latency 10_000ms spans rounds 1-3 (cumulative budgets 3.5s, 8.5s, 15s), so B answers in round 3.
		const { net, traces } = makeNet(chainToTarget, { conditions: { AB: { latencyMs: 10_000 } } })
		const result = await runDiscovery(net, 'A', { address: { key: 'T' } }, liftTerms(100))

		expect(result.plans).toHaveLength(1) // folded in once — never double-counted
		expect(result.plans[0].members.map((member) => member.address.key)).toEqual(['A', 'B', 'T'])
		expect(traces.some((event) => event.type === 'late-answer-folded')).toBe(true)
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a dropped link never answers, so its route never produces a plan — the search ends cleanly at the ceiling', async () => {
		const { net } = makeNet(chainToTarget, { conditions: { AB: { drop: true } } })
		const result = await runDiscovery(net, 'A', { address: { key: 'T' } }, liftTerms(100))

		expect(result.plans).toEqual([])
		expect(net.clock.pendingTimers).toBe(0) // a dropped delivery arms no timer; nothing leaks
	})
})

/* ── concurrency: independent originators do not interfere ─────────────────────────────────────── */

describe('discovery end to end — concurrent searches', () => {
	it('two originators searching the same graph at once each find their own target', async () => {
		const graph: NetworkGraph<Terms> = {
			nodes: ['A', 'B', 'C', 'D'],
			links: [
				{ id: 'AB', node1: 'A', node2: 'B', intents: liftTerms(500) },
				{ id: 'BC', node1: 'B', node2: 'C', intents: liftTerms(500) },
				{ id: 'CD', node1: 'C', node2: 'D', intents: liftTerms(500) },
			],
		}
		const { net } = makeNet(graph)

		// Start both searches, then drive the one shared clock once: it interleaves both.
		const fromA = net.discover('A', { address: { key: 'D' } }, liftTerms(100))
		const fromD = net.discover('D', { address: { key: 'A' } }, liftTerms(100))
		await net.clock.runUntilIdle()
		const resultA = await fromA
		const resultD = await fromD

		expect(resultA.plans).toHaveLength(1)
		expect(resultA.plans[0].members.map((member) => member.address.key)).toEqual(['A', 'B', 'C', 'D'])
		expect(resultD.plans).toHaveLength(1)
		expect(resultD.plans[0].members.map((member) => member.address.key)).toEqual(['D', 'C', 'B', 'A'])

		// distinct sessions, independent routes — neither leaked into the other
		expect(resultA.sessionCode).not.toBe(resultD.sessionCode)
		await assertValidPlan(net, graph.links, resultA.sessionCode, resultA.plans[0], 'A', 'D', 7)
		await assertValidPlan(net, graph.links, resultD.sessionCode, resultD.plans[0], 'D', 'A', 7)
		expect(net.clock.pendingTimers).toBe(0)
	})
})

/* ── 1,000-node scale smoke test ──────────────────────────────────────────────────────────────── */

describe('discovery end to end — 1,000-node scale', () => {
	it('completes on the virtual clock and returns only valid routes', async () => {
		// 1,000 nodes, 2,000 random links, plus a guaranteed 4-hop route so a plan is always found. The
		// scale invariant under test: a search touches only a node's own links and its per-session
		// contexts — never O(total nodes) — so this finishes in a few seconds on compressed time.
		const graph = randomGraph<Terms>(1000, 2000, new SeededRandom(99), (r) => ({ balance: r.nextFloat() * 1000 - 500 }))
		graph.links.push(
			{ id: 'G0', node1: 'N0', node2: 'N250', intents: liftTerms(500) },
			{ id: 'G1', node1: 'N250', node2: 'N500', intents: liftTerms(500) },
			{ id: 'G2', node1: 'N500', node2: 'N750', intents: liftTerms(500) },
			{ id: 'G3', node1: 'N750', node2: 'N999', intents: liftTerms(500) },
		)
		const { net } = makeNet(graph, { seed: 5 })
		const result = await runDiscovery(net, 'N0', { address: { key: 'N999' } }, liftTerms(1))

		expect(result.plans.length).toBeGreaterThan(0)
		for (const plan of result.plans) {
			await assertValidPlan(net, graph.links, result.sessionCode, plan, 'N0', 'N999', 7)
		}
		expect(net.clock.pendingTimers).toBe(0)
	}, 120_000)
})
