import { uniform } from '../generators/index.js'
import { buildGraphView } from '../graph-view.js'
import { FORMAT_VERSION, type Network, type Tally } from '../model.js'
import { Oracle } from '../oracle.js'
import { compileConditions } from './conditions.js'
import { buildSimNetwork, runQuery } from './harness.js'

/** A materialised network from a tally list. */
function makeNetwork(entityCount: number, tallies: Tally[]): Network {
	return { entityCount, tallies, meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** A line `0 - 1 - … - (n-1)`: one tally per consecutive pair, ample symmetric credit limits, square balance. */
function line(n: number, limit = 1000): Network {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return makeNetwork(n, tallies)
}

/** Every distinct pair joined by one tally with a symmetric credit limit, square balance. */
function completeNetwork(n: number, limit: number): Network {
	const tallies: Tally[] = []
	for (let a = 0; a < n; a++) {
		for (let b = a + 1; b < n; b++) {
			tallies.push({ stock: a, foil: b, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
		}
	}
	return makeNetwork(n, tallies)
}

describe('harness — hand-built graphs', () => {
	it('line: a 2-hop route is found at exactly depth 2, at path length 2 (one round per level)', async () => {
		const sim = buildSimNetwork(line(3), {}, 0)
		const out = await runQuery(sim, { from: 0, to: 2, amount: 1, depth: 2 })
		expect(out.found).toBe(true)
		expect(out.plans[0].path).toHaveLength(2)
	})

	it('line: the same 2-hop target is missed at depth 1 — one round short of the terminus', async () => {
		// An L-hop peer-match terminus needs maxDepth ≥ L; L=2 ⇒ needs depth ≥ 2, so depth 1 misses.
		const sim = buildSimNetwork(line(3), {}, 0)
		const out = await runQuery(sim, { from: 0, to: 2, amount: 1, depth: 1 })
		expect(out.found).toBe(false)
	})

	it('diamond: both 2-hop routes 0→1→3 and 0→2→3 are found at depth 3', async () => {
		const network = makeNetwork(4, [
			{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
			{ stock: 1, foil: 3, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
			{ stock: 0, foil: 2, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
			{ stock: 2, foil: 3, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
		])
		const out = await runQuery(buildSimNetwork(network, {}, 0), { from: 0, to: 3, amount: 1, depth: 3 })
		expect(out.found).toBe(true)
		for (const plan of out.plans) {
			expect(plan.path).toHaveLength(2)
		}
	})

	it('unreachable target (isolated node): empty plans, no throw', async () => {
		// 0 - 1 - 2 connected; entity 3 isolated.
		const network = makeNetwork(4, [
			{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
			{ stock: 1, foil: 2, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
		])
		const out = await runQuery(buildSimNetwork(network, {}, 0), { from: 0, to: 3, amount: 1, depth: 5 })
		expect(out.found).toBe(false)
		expect(out.plans).toEqual([])
	})

	it('zero-capacity gate: the open direction routes; the bound direction is pruned (oracle agrees)', async () => {
		// stock 0 / foil 1, balance at the upper bound ⇒ cap(0→1)=20, cap(1→0)=0.
		const network = makeNetwork(2, [{ stock: 0, foil: 1, balance: 10, stockCreditLimit: 10, foilCreditLimit: 10 }])
		const sim = buildSimNetwork(network, {}, 0)
		const open = await runQuery(sim, { from: 0, to: 1, amount: 5, depth: 3 })
		const blocked = await runQuery(sim, { from: 1, to: 0, amount: 5, depth: 3 })
		expect(open.found).toBe(true)
		expect(blocked.found).toBe(false)
		const oracle = new Oracle(buildGraphView(network))
		expect(oracle.routeExistence(0, 1, 5, 3).exists).toBe(true)
		expect(oracle.routeExistence(1, 0, 5, 3).exists).toBe(false)
	})
})

describe('harness — rounds↔hops boundary (mirrors tallynet maxDepth boundary)', () => {
	// A straight chain 0-1-2-3: the target 3 is a peer-match terminus at path length 3 (3 hops). It is
	// found at exactly depth 3 (= hop count, one round per level) and missed at depth 2 — the protocol
	// matches the oracle at the same depth; there is no "reach is half the ceiling" undercount.
	const chain = line(4)

	it('is FOUND at exactly depth 3 (= hop count), at path length 3 — matching the oracle at the same depth', async () => {
		const out = await runQuery(buildSimNetwork(chain, {}, 0), { from: 0, to: 3, amount: 1, depth: 3 })
		expect(out.found).toBe(true)
		expect(out.plans[0].path).toHaveLength(3)
		expect(new Oracle(buildGraphView(chain)).routeExistence(0, 3, 1, 3).exists).toBe(true)
	})

	it('is MISSED one ceiling shallower (depth 2) — one round short of the 3-hop terminus; the oracle agrees', async () => {
		const out = await runQuery(buildSimNetwork(chain, {}, 0), { from: 0, to: 3, amount: 1, depth: 2 })
		expect(out.found).toBe(false)
		expect(new Oracle(buildGraphView(chain)).routeExistence(0, 3, 1, 2).exists).toBe(false)
	})

	it('every found route respects the depth bound across a sweep (the robust invariant)', async () => {
		const sim = buildSimNetwork(chain, {}, 0)
		for (const depth of [1, 2, 3, 4, 5, 6]) {
			const out = await runQuery(sim, { from: 0, to: 3, amount: 1, depth })
			for (const plan of out.plans) {
				expect(plan.path.length).toBeLessThanOrEqual(depth)
			}
		}
	})
})

describe('harness — found ⊆ oracle', () => {
	it('on a seeded uniform graph with no conditions, every found plan is an oracle-confirmed route', async () => {
		const network = uniform({ entityCount: 12, meanDegree: 4, capacity: { kind: 'uniform', min: 1, max: 10 }, seed: 99 })
		const oracle = new Oracle(buildGraphView(network))
		const sim = buildSimNetwork(network, {}, 0)
		const depth = 5
		const amount = 2
		let foundAny = false
		for (let from = 0; from < network.entityCount; from++) {
			for (let to = 0; to < network.entityCount; to++) {
				if (from === to) {
					continue
				}
				const out = await runQuery(sim, { from, to, amount, depth })
				for (const plan of out.plans) {
					foundAny = true
					expect(plan.path.length).toBeLessThanOrEqual(depth)
					for (const link of plan.path) {
						expect(link.intents.L.capFwd).toBeGreaterThanOrEqual(amount)
					}
					expect(oracle.routeExistence(from, to, amount, depth).exists).toBe(true)
				}
			}
		}
		expect(foundAny).toBe(true)
	})
})

describe('harness — degradation gap', () => {
	it('a sleeping relay on the only route blocks the protocol though the undegraded oracle routes it', async () => {
		// 0-1-2-3: the only route 0→1→2→3 must be *delivered* through relays 1 and 2 (a peer-match to the
		// target 3 is resolved from relay 2's local adjacency, so a sleeping *target* would NOT block — only a
		// sleeping non-target relay does). seed 0 with round(0.25·4)=1 asleep selects the relay node 1.
		const network = line(4)
		expect(new Oracle(buildGraphView(network)).routeExistence(0, 3, 1, 6).exists).toBe(true)
		const seed = 0
		expect([...compileConditions(network, { sleepingFraction: 0.25 }, seed).sleeping]).toEqual([1])
		const sim = buildSimNetwork(network, { sleepingFraction: 0.25 }, seed)
		const out = await runQuery(sim, { from: 0, to: 3, amount: 1, depth: 6 })
		expect(out.found).toBe(false)
	})
})

describe('harness — a late answer folds into a later round', () => {
	it('still finds the route when a large link latency exceeds a round budget, given depth and TTL', async () => {
		const network = line(3) // 0-1-2
		const sim = buildSimNetwork(
			network,
			{ lateFraction: 1, lateLatencyMs: 3000 },
			0,
			undefined,
			{ maxDepth: 8, sessionTtlMs: 600_000 },
		)
		const out = await runQuery(sim, { from: 0, to: 2, amount: 1, depth: 8 })
		expect(out.found).toBe(true)
	})
})

describe('harness — reuse and per-query amount', () => {
	it('serves many queries on one network; each reads its own amount from the query (not a closure)', async () => {
		const sim = buildSimNetwork(completeNetwork(4, 10), {}, 0)
		const small = await runQuery(sim, { from: 0, to: 1, amount: 5, depth: 3 })
		const tooBig = await runQuery(sim, { from: 0, to: 1, amount: 100, depth: 3 })
		const smallAgain = await runQuery(sim, { from: 0, to: 1, amount: 5, depth: 3 })
		expect(small.found).toBe(true)
		expect(tooBig.found).toBe(false) // 100 exceeds every edge's capacity of 10
		expect(smallAgain.found).toBe(true) // the big query did not contaminate the reused network
	})
})
