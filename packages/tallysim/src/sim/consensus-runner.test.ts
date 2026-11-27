/**
 * Behavioural tests for the sequential consensus sweep runner. Each case builds a {@link SimSweepSpec} over a
 * hand-built **materialised** line network (predictable routes), pins the seeds, and asserts on the single
 * run's `ConsensusRunMetrics`. The three failure outcomes — all-commit, one refuser voiding, a sleeping
 * target stalling — are each driven by a pinned seed whose outcome is verified (and re-derivable): the
 * selected refuser / sleeping node is computed from the same compiler the runner uses, so a reviewer can see
 * exactly which node the seed picks.
 *
 * ── The pinned seeds (how they were chosen) ─────────────────────────────────────────────────────────────
 * - one refuser: `line(6)`, `refuserFraction 1/6` ⇒ exactly one refuser; `consensusSeed 0` + run seed 1
 *   selects entity **3** (an interior node of the line), so every query straddling it voids with
 *   `refused-promise`. Verified in-test via `compileConsensusConditions`.
 * - stalled: `line(6)`, `sleepingFraction 1/6` ⇒ exactly one sleeping node; `conditionsSeed 0` +
 *   `workload.seed 200` + run seed 1 yields ≥ 1 query that targets the sleeping, cut-off node — discoverable
 *   via its awake neighbour's peerMatch but un-pushable (both its links drop), so the lift stays `pending`
 *   (`stalled`). A sleeping node also cuts the line, so straddling queries just don't route (no lift).
 */

import { SeededRandom } from 'tallynet/testing'
import { FORMAT_VERSION, type Network, type Tally } from '../model.js'
import type { ConsensusSpec, SimScenario, SimSweepSpec } from '../scenario.js'
import { compileConsensusConditions } from './conditions.js'
import { runConsensusSweepToArray } from './consensus-runner.js'
import { drawCircularOrigins } from './harness.js'

/** A line `0 - 1 - … - (n-1)`, one tally per consecutive pair, with finite symmetric credit limits. */
function line(n: number, limit = 1000): Network {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return { entityCount: n, tallies, meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** A ring `0 - 1 - … - (n-1) - 0`: tally `i` joins `i` to `(i + 1) mod n`, so every node has degree 2. */
function ring(n: number, limit = 1000): Network {
	const tallies: Tally[] = []
	for (let i = 0; i < n; i++) {
		tallies.push({ stock: i, foil: (i + 1) % n, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return { entityCount: n, tallies, meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** Wrap a base scenario in a one-cell sweep at one run seed (a trivial 1-value `workload.depth` vary). */
function specFor(base: SimScenario, seed: number): SimSweepSpec {
	return { base, vary: [{ path: 'workload.depth', values: [base.workload.depth] }], seeds: [seed] }
}

describe('runConsensusSweep — all cooperative', () => {
	it('every found route commits (pCommitGivenFound === 1, no voids, no pending)', async () => {
		const base: SimScenario = {
			network: { materialized: line(5) },
			workload: { kind: 'payment', queries: 10, amount: { dist: 'constant', params: { value: 5 } }, depth: 5, seed: 200 },
			consensus: {},
		}
		const records = await runConsensusSweepToArray(specFor(base, 1))
		expect(records).toHaveLength(1)
		const m = records[0].metrics
		expect(m.liftCount).toBeGreaterThanOrEqual(1)
		expect(m.commitCount).toBe(m.liftCount)
		expect(m.pCommitGivenFound).toBe(1)
		expect(m.voidCount).toBe(0)
		expect(m.pendingCount).toBe(0)
		// Provenance for a materialised network: baked generator id, capacity labelled 'materialized'.
		expect(records[0].generator).toBe('test')
		expect(records[0].capacity).toBe('materialized')
		expect(records[0].seed).toBe(1)
		expect(m.queryCount).toBe(10)
	})
})

describe('runConsensusSweep — one refuser', () => {
	it('a refuser on an interior node voids every lift that routes through it', async () => {
		const consensus: ConsensusSpec = { refuserFraction: 1 / 6, identitySeed: 7 }
		const base: SimScenario = {
			network: { materialized: line(6) },
			workload: { kind: 'payment', queries: 12, amount: { dist: 'constant', params: { value: 5 } }, depth: 6, seed: 200 },
			consensus,
			consensusSeed: 0,
		}
		// Re-derive the refuser the runner will pick (refuserSeed = consensusSeed + runSeed): entity 3, interior.
		const refusers = compileConsensusConditions(line(6), consensus, (base.consensusSeed ?? 0) + 1).refusers
		expect([...refusers]).toEqual([3])

		const records = await runConsensusSweepToArray(specFor(base, 1))
		const m = records[0].metrics
		expect(m.voidCount).toBeGreaterThanOrEqual(1)
		expect(m.voidReasons['refused-promise']).toBeGreaterThanOrEqual(1)
		// Every non-commit here is a refusal — no stalls, no no-commit votes, no expiries.
		expect(m.pendingCount).toBe(0)
		expect(m.voidReasons.stalled).toBe(0)
		expect(m.voidReasons['voted-no-commit']).toBe(0)
		expect(m.voidReasons.expired).toBe(0)
		expect(m.commitCount + m.voidCount + m.pendingCount).toBe(m.liftCount)
	})
})

describe('runConsensusSweep — stalled (sleeping target)', () => {
	it('a lift to a sleeping, cut-off target stays pending (stalled)', async () => {
		const base: SimScenario = {
			network: { materialized: line(6) },
			workload: { kind: 'payment', queries: 16, amount: { dist: 'constant', params: { value: 5 } }, depth: 6, seed: 200 },
			conditions: { sleepingFraction: 1 / 6 },
			conditionsSeed: 0,
			consensus: {},
		}
		const records = await runConsensusSweepToArray(specFor(base, 1))
		const m = records[0].metrics
		expect(m.pendingCount).toBeGreaterThanOrEqual(1)
		expect(m.voidReasons.stalled).toBeGreaterThanOrEqual(1)
		// A pending contributes a message count but no settle-time sample, so the settle distribution covers
		// only the settled (committed/voided) lifts.
		expect(m.timeToSettleMs.count).toBe(m.commitCount + m.voidCount)
		expect(m.commitCount + m.voidCount + m.pendingCount).toBe(m.liftCount)
	})
})

describe('runConsensusSweep — principle 3 completion curve (linear route)', () => {
	// The single non-relayer the 1/6 cell selects on `line(6)` is node 3 (interior): with refuserFraction
	// unset the nonRelayer draw is the first to consume the stream, so it lands on the same node the refuser
	// test's node-3 draw does (consensusSeed 0 + runSeed 1). Re-derived in-test so the pinned seed is visible.
	const nonRelayerConsensus = (contactPoints: boolean): ConsensusSpec => ({ nonRelayerFraction: 1 / 6, contactPoints, identitySeed: 7 })

	it('with contact points, cooperating completion holds at 1.0 while ≤ 1 node is a non-relayer', async () => {
		const consensus = nonRelayerConsensus(true)
		// workload.seed 1: its 12 queries straddle node 3 (so recovery is exercised) but never originate AT
		// node 3 — a non-relayer that is itself the sole-voter originator serves no pull, so a lift it starts
		// would strand its own members and is outside the principle-3 "pull routes around an interior node"
		// claim. Pinned + re-derivable; see the determinism test for the knobs' byte-stability.
		const base: SimScenario = {
			network: { materialized: line(6) },
			workload: { kind: 'payment', queries: 12, amount: { dist: 'constant', params: { value: 5 } }, depth: 6, seed: 1 },
			consensus,
			consensusSeed: 0,
		}
		const nonRelayers = compileConsensusConditions(line(6), consensus, (base.consensusSeed ?? 0) + 1).nonRelayers
		expect([...nonRelayers]).toEqual([3]) // interior node, re-derived from the pinned seed

		// Sweep the non-relayer fraction over {0, 1/6} — both cells select ≤ 1 non-relayer. With a published
		// contact point, every member an interior non-relayer strands pulls the settled record from the
		// originator's contact point and commits, so completion stays pinned at 1.0 across the curve.
		const spec: SimSweepSpec = { base, vary: [{ path: 'consensus.nonRelayerFraction', values: [0, 1 / 6] }], seeds: [1] }
		const records = await runConsensusSweepToArray(spec)
		expect(records).toHaveLength(2)
		for (const r of records) {
			expect(r.metrics.cooperatingCompletion).toBe(1)
		}
		// The 1/6 cell actually exercised recovery (members were stranded then pulled back), not a no-op.
		expect(records[1].metrics.recoveredTotal).toBeGreaterThan(0)
	})

	it('without contact points, a straight line shows the completion cliff (the documented gap)', async () => {
		const consensus = nonRelayerConsensus(false)
		const base: SimScenario = {
			network: { materialized: line(6) },
			workload: { kind: 'payment', queries: 12, amount: { dist: 'constant', params: { value: 5 } }, depth: 6, seed: 1 },
			consensus,
			consensusSeed: 0,
		}
		expect([...compileConsensusConditions(line(6), consensus, 1).nonRelayers]).toEqual([3])

		const records = await runConsensusSweepToArray(specFor(base, 1))
		const m = records[0].metrics
		// The expected gap (not a failure): members beyond the interior non-relayer have no pull path to the
		// evidence on a straight line, so they stay pending and completion falls below 1.0.
		expect(m.cooperatingCompletion).toBeLessThan(1)
		expect(m.cooperatingCompletion).toBeGreaterThan(0) // lifts not straddling node 3 still fully complete
		expect(m.recoveredTotal).toBe(0) // no contact point ⇒ nothing recovers
	})
})

describe('runConsensusSweep — circular route (no completion cliff around a non-relayer)', () => {
	// A ring routes around an interior non-relayer by pushing BOTH ways from the origin, so completion holds at
	// 1.0 even with NO contact points — the hard case a straight line cannot do (voter-harness.test § record
	// availability). The seeds are tuned so the single non-relayer the 1/RING cell selects is NEVER a drawn
	// origin: a non-relayer that is itself the sole-voter originator serves no pushes/pulls and would strand its
	// own ring, which is outside the "a ring routes around an INTERIOR non-relayer" claim. The disjointness is
	// re-derived in-test (below) so the pinned seed is visible, mirroring the linear curve's node-3 re-derivation.
	const RING = 6
	const RUN_SEED = 1

	it('a ring commits every cooperating member with no contact points while ≤ 1 node is a non-relayer', async () => {
		const consensus: ConsensusSpec = { routeShape: 'circular', nonRelayerFraction: 1 / RING, contactPoints: false, identitySeed: 7 }
		const base: SimScenario = {
			network: { materialized: ring(RING) },
			// workload.seed 20: its 12 drawn origins are {1,2,4,5} — node 3 (the sole non-relayer the 1/RING cell
			// selects at consensusSeed 0 + runSeed 1) is never an origin, so every lift strands it as an interior
			// node the ring routes around. Pinned + re-derived below; adjust the seed if the compiler's pick moves.
			workload: { kind: 'payment', queries: 12, amount: { dist: 'constant', params: { value: 5 } }, depth: RING, seed: 20 },
			consensus,
			consensusSeed: 0,
		}
		// Re-derive the pinned disjointness: the non-relayer the 1/RING cell selects must not be a drawn origin.
		const nonRelayers = compileConsensusConditions(ring(RING), consensus, (base.consensusSeed ?? 0) + RUN_SEED).nonRelayers
		const origins = new Set(drawCircularOrigins(base.workload, RING, new SeededRandom(base.workload.seed + RUN_SEED)).map((q) => q.from))
		for (const nr of nonRelayers) {
			expect(origins.has(nr)).toBe(false) // the non-relayer is never a sole-voter originator in this workload
		}

		// Sweep the non-relayer fraction over {0, 1/RING}: both cells keep completion at 1.0 — at 0 trivially, at
		// 1/RING because the ring's two-way push reaches every cooperating member without crossing the non-relayer.
		const spec: SimSweepSpec = { base, vary: [{ path: 'consensus.nonRelayerFraction', values: [0, 1 / RING] }], seeds: [RUN_SEED] }
		const records = await runConsensusSweepToArray(spec)
		expect(records).toHaveLength(2)
		for (const r of records) {
			expect(r.metrics.liftCount).toBeGreaterThanOrEqual(1) // circular origins all lie on the ring ⇒ real lifts
			expect(r.metrics.cooperatingCompletion).toBe(1) // no cliff — the ring routed around the non-relayer
		}
		expect(records[1].metrics.recoveredTotal).toBe(0) // the two-way push delivered directly; nobody needed a pull
	})
})

describe('runConsensusSweep — stacked voter sets are refused at discovery', () => {
	it('every line route is stapled with obscure referees, dropped by the scorer ⇒ refusals, no lifts', async () => {
		// `stackedVoters: 2` staples two obscure (non-well-known) referees onto every plan EVERY node folds into
		// (the originator always processes its own plan, so even a single-hop route is stapled); every route is
		// thus stacked and the counting scorer drops it (returns -Infinity, which the originator filters out) —
		// leaving no plan to lift. Each drop is counted.
		const base: SimScenario = {
			network: { materialized: line(5) },
			workload: { kind: 'payment', queries: 12, amount: { dist: 'constant', params: { value: 5 } }, depth: 5, seed: 200 },
			consensus: { stackedVoters: 2, identitySeed: 7 },
			consensusSeed: 0,
		}
		const records = await runConsensusSweepToArray(specFor(base, 1))
		const m = records[0].metrics
		expect(m.planRefusalCount).toBeGreaterThan(0) // the scorer dropped stacked plans
		expect(m.planRefusalShare).toBeGreaterThan(0)
		expect(m.liftCount).toBe(0) // every route's only plan was refused ⇒ no lift ever formed
		expect(m.commitCount).toBe(0)
	})
})

describe('runConsensusSweep — determinism', () => {
	it('replays byte-for-byte: two runs of the same spec yield identical records', async () => {
		const base: SimScenario = {
			network: { materialized: line(6) },
			workload: { kind: 'payment', queries: 12, amount: { dist: 'constant', params: { value: 5 } }, depth: 6, seed: 200 },
			consensus: { refuserFraction: 1 / 6, identitySeed: 7 },
			consensusSeed: 0,
		}
		const a = await runConsensusSweepToArray(specFor(base, 1))
		const b = await runConsensusSweepToArray(specFor(base, 1))
		expect(a).toEqual(b)
	})

	it('replays byte-for-byte with the voter-model knobs set (contact points + non-relayer + silent)', async () => {
		const base: SimScenario = {
			network: { materialized: line(6) },
			workload: { kind: 'payment', queries: 12, amount: { dist: 'constant', params: { value: 5 } }, depth: 6, seed: 200 },
			consensus: { nonRelayerFraction: 1 / 6, silentAfterPromiseFraction: 1 / 6, contactPoints: true, identitySeed: 7 },
			consensusSeed: 0,
		}
		const a = await runConsensusSweepToArray(specFor(base, 1))
		const b = await runConsensusSweepToArray(specFor(base, 1))
		expect(a).toEqual(b)
	})

	it('replays byte-for-byte with circular route + well-known nomination + stacked voters + a raised threshold', async () => {
		// Exercises every voter-model knob at once — including `cloneConsensus`'s deep-clone of `consensusMethod`
		// and the circular dummy-discovery-to-self (whose empty plans make nomination/stacked no-ops here). The
		// point is byte-stability of the whole wiring, not the behaviour of any one knob.
		const base: SimScenario = {
			network: { materialized: ring(6) },
			workload: { kind: 'payment', queries: 12, amount: { dist: 'constant', params: { value: 5 } }, depth: 6, seed: 200 },
			consensus: {
				routeShape: 'circular',
				voterNomination: 'well-known',
				wellKnownFraction: 0.3,
				stackedVoters: 2,
				consensusMethod: { weighting: 'distinct-voter', thresholdNum: 2, thresholdDen: 3 },
				identitySeed: 7,
			},
			consensusSeed: 0,
		}
		const a = await runConsensusSweepToArray(specFor(base, 1))
		const b = await runConsensusSweepToArray(specFor(base, 1))
		expect(a).toEqual(b)
	})
})

describe('runConsensusSweep — degenerate network (entityCount < 2)', () => {
	it('emits a single fully-zeroed record (no query, no lift, no throw)', async () => {
		const base: SimScenario = {
			network: { materialized: line(1) }, // one entity, no tally ⇒ no payment pair exists
			workload: { kind: 'payment', queries: 10, amount: { dist: 'constant', params: { value: 5 } }, depth: 4, seed: 200 },
			consensus: {},
		}
		const records = await runConsensusSweepToArray(specFor(base, 1))
		expect(records).toHaveLength(1)
		const m = records[0].metrics
		expect(m.queryCount).toBe(0)
		expect(m.liftCount).toBe(0)
		expect(m.commitCount).toBe(0)
		expect(m.voidCount).toBe(0)
		expect(m.pendingCount).toBe(0)
		expect(m.pCommitGivenFound).toBe(0) // 0/0 guarded to 0, never NaN
		expect(m.timeToSettleMs.count).toBe(0)
		expect(m.messagesPerLift.count).toBe(0)
	})
})

describe('runConsensusSweep — spec validation', () => {
	const base = (): SimScenario => ({
		network: { materialized: line(4) },
		workload: { kind: 'payment', queries: 4, amount: { dist: 'constant', params: { value: 5 } }, depth: 4, seed: 200 },
		consensus: { refuserFraction: 0 },
	})

	it('rejects an empty seeds array', async () => {
		const spec: SimSweepSpec = { base: base(), vary: [{ path: 'workload.depth', values: [4] }], seeds: [] }
		await expect(runConsensusSweepToArray(spec)).rejects.toThrow(/seeds/)
	})

	it('rejects a vary dimension with no values', async () => {
		const spec: SimSweepSpec = { base: base(), vary: [{ path: 'workload.depth', values: [] }], seeds: [1] }
		await expect(runConsensusSweepToArray(spec)).rejects.toThrow(/non-empty values array/)
	})

	it('rejects a structural vary path on a materialised network', async () => {
		// The widened guard still forbids reaching into the shared-by-reference network (only workload./
		// conditions./consensus.* are cloned one level deep and safe to vary).
		const spec: SimSweepSpec = { base: base(), vary: [{ path: 'network.params.meanDegree', values: [2, 3] }], seeds: [1] }
		await expect(runConsensusSweepToArray(spec)).rejects.toThrow(/must target workload\.\/conditions\.\/consensus\.\* for a materialized network/)
	})

	it('allows a consensus.* vary path on a materialised network (the widening)', async () => {
		// `consensus.refuserFraction` / `conditions.dropFraction` are the consensus CSV x-axis — the whole
		// reason the materialised-network guard is widened past `workload.*`. This must run, not throw.
		const spec: SimSweepSpec = { base: base(), vary: [{ path: 'consensus.refuserFraction', values: [0, 0.5] }], seeds: [1] }
		const records = await runConsensusSweepToArray(spec)
		expect(records).toHaveLength(2) // 2 cells × 1 seed
		expect(records.map((r) => r.params['consensus.refuserFraction'])).toEqual([0, 0.5])
	})
})
