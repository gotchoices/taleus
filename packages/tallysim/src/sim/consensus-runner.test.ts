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

import { FORMAT_VERSION, type Network, type Tally } from '../model.js'
import type { ConsensusSpec, SimScenario, SimSweepSpec } from '../scenario.js'
import { compileConsensusConditions } from './conditions.js'
import { runConsensusSweepToArray } from './consensus-runner.js'

/** A line `0 - 1 - … - (n-1)`, one tally per consecutive pair, with finite symmetric credit limits. */
function line(n: number, limit = 1000): Network {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
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
