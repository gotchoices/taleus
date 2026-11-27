/**
 * Timeout + self-recovery scenarios at the simulator level: the three ways a stalled lift resolves itself
 * under the clock, each driven over a hand-built line `Network` and read through the 6.32 consensus metrics.
 *
 *   1. **A lift waiting on a slow voter voids by its own deadline.** A uniformly-slow network delays the
 *      completing promise past a short `ttlMs`, so the sole voter casts its vote post-expiry → `NC` → `void`.
 *   2. **A lift whose interior relayer drops the commit push recovers by the loop.** A non-relayer cut off
 *      the stranded members, who pull the settled record from the originator's contact point on the
 *      protocol's own recovery loop and commit — the simulator drives no pull.
 *   3. **A lift whose needed party never returns abandons and stays `pending`.** A dropped link to the only
 *      relayer means the promise phase never completes; the recovery loop backs off, abandons at its ceiling,
 *      and leaves the lift `pending` with credit held — the permanently-pending outcome.
 *
 * These mirror the tallynet-level proofs in `tallynet/src/testing/consensus.test.ts` (§ settling by deadline
 * ≈:1249, § a dropped push on the only path stalls ≈:400, § record availability). The one subtlety that
 * governs all three (see `participant.ts` `getRecordState`): a lift voids by deadline **only** if the promise
 * phase COMPLETES (arbitrarily late is fine) and the voter's completing vote lands post-expiry; if a needed
 * party never promises, the set never completes, no vote is ever cast, and recovery abandons → `pending`
 * (NOT `void`). That is exactly scenario 1 (promise completes, late vote) vs. scenario 3 (promise never
 * completes).
 *
 * ── Why the deadline-void scenario uses two sims over one network ──────────────────────────────────────
 * A tallysim `ConditionsSpec` latency hits BOTH discovery and the lift (one compiled per-link conditions map
 * governs `runQuery` and the push), and the latency a deadline-void needs (tens of thousands of ms) dwarfs
 * discovery's per-round budget — so a uniformly-slow network finds no route at all, and there is no lift to
 * void. The fix: run discovery on a FAST sim (empty conditions) to mint a real `QueryOutcome`, then drive the
 * lift on a SECOND sim built over the SAME `network` WITH the slow conditions. This is sound because
 * `reconstructRoute` + `buildLift` recompute the plan's path nonces from `outcome.sessionCode` + the network's
 * deterministic `linkIdForTally` (independent of which sim ran discovery), so a fast-sim outcome drives a
 * slow-sim lift byte-identically; `runLiftForOutcome` reads nothing from the slow sim's discovery state (only
 * `buildLift` → `start` → `runUntilIdle`).
 */

import type { TraceEvent } from 'tallynet'
import { FORMAT_VERSION, type Network, type Tally, cloneNetwork, serialize } from '../model.js'
import type { StructuralMetrics } from '../metrics.js'
import { type LiftResult, runLiftForOutcome } from './consensus-harness.js'
import { analyzeLift, type ConsensusLiftMetrics, summarizeConsensusMetrics } from './consensus-metrics.js'
import { buildSimNetwork, runQuery, type QuerySpec, type SimNetwork } from './harness.js'

/** The fixed consensus seed every scenario shares (deterministic keys; see `identity.ts`). */
const IDENTITY_SEED = 7

/** Provenance stub shared by the hand-built networks below. */
const META = { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION }

/**
 * The per-link latency the deadline-void scenario imposes on its slow sim (ms). Uniform + constant is
 * seed-independent (no node-pick to re-derive). Paired with {@link DEADLINE_TTL_MS} so the completing promise
 * reaches the sole voter only post-expiry.
 */
const SLOW_LATENCY_MS = 50_000

/**
 * The lift lifetime for the deadline-void scenario (ms) → the code expiry. Kept between one and two hop
 * latencies so the completing promise set returns to the voter only AFTER expiry (`SLOW_LATENCY_MS < ttl <
 * 2·SLOW_LATENCY_MS`): the voter then casts its vote through `castCommit`'s expired path (`NC`) and, as the
 * sole voter, voids the whole route by deadline. Mirrors the tallynet `consensus.test.ts` ≈:1249 ratio
 * (latency 400_000, ttl 600_000).
 */
const DEADLINE_TTL_MS = 80_000

/** A large recovery ceiling for the deadline-void sim: the loop keeps ticking past expiry and settles the lift by its deadline instead of abandoning. */
const DEADLINE_RECOVERY_GIVEUP_MS = 600_000

// NOTE: the deadline-void constants above are tuned empirically against tallynet's recovery grace/backoff
// timing (verified by running — the invariant is SLOW_LATENCY_MS < DEADLINE_TTL_MS < 2·SLOW_LATENCY_MS on a
// single slow hop). They are seed-INDEPENDENT (uniform constant latency — no node-pick to re-derive). If a
// future tallynet change moves the deadline/recovery schedule, the sole-voter vote may land pre-expiry
// (→ commit) or the loop may abandon before voting (→ pending); retune the ratio, keeping the single hop.

/** A small recovery ceiling for the permanently-stuck sim: the loop abandons quickly instead of polling a virtual hour of backoff ticks. */
const STUCK_RECOVERY_GIVEUP_MS = 60_000

/** A line `0 - 1 - … - (n-1)`, one tally per consecutive pair, finite symmetric credit limits. */
function line(n: number, limit = 1000): Network {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return { entityCount: n, tallies, meta: META }
}

/** The settled outcome of `transactionCode` at entity `e`. */
function outcomeOf(sim: SimNetwork, e: number, transactionCode: string): Promise<'commit' | 'void' | 'pending'> {
	return sim.net.consensusNode(String(e)).outcome(transactionCode)
}

/** A structural stub for {@link summarizeConsensusMetrics} — these hand-built lifts carry no real topology metric. */
const STRUCTURAL_STUB: StructuralMetrics = { meanDegree: 2, largestComponentFraction: 1 }

/** One driven scenario: the mutated network, the sim its lift ran on, the lift's trace events, result, and metrics. */
interface DrivenLift {
	network: Network
	sim: SimNetwork
	events: TraceEvent[]
	result: LiftResult
	metrics: ConsensusLiftMetrics
}

/**
 * Drive the deadline-void scenario: discover 0→1 on a fast sim, then run the lift on a slow sim (uniform
 * `SLOW_LATENCY_MS`) over the same `line(2)` so the sole voter (node 0) votes post-expiry → `void`.
 *
 * `line(2)` (a single slow hop), not a longer line: the voter here is the originator (node 0), and it votes
 * once it holds the complete promise set. On a single hop the far participant's promise is reachable for the
 * voter's post-expiry recovery pull directly; on a longer line the completing promise sits two-plus hops away
 * and the chained recovery pulls do not reconverge it to the voter within the run, leaving the lift `pending`
 * rather than `void`. One slow hop is the clean deadline-void mirror of tallynet `consensus.test.ts` ≈:1249.
 */
async function runLateVoterVoids(): Promise<DrivenLift> {
	const network = cloneNetwork(line(2))
	const q: QuerySpec = { from: 0, to: 1, amount: 5, depth: 2 }
	// Discovery on a FAST sim (empty conditions): the slow sim would find no route (latency dwarfs the budget).
	const fast = buildSimNetwork(network, {}, 0, undefined, undefined, { identitySeed: IDENTITY_SEED })
	const outcome = await runQuery(fast, q)
	// The lift on a SLOW sim over the same network: every link carries SLOW_LATENCY_MS, so the completing
	// promise reaches the sole voter only after the short ttl → NC → void by deadline. A large recovery
	// ceiling keeps the loop ticking to settlement rather than abandoning.
	const events: TraceEvent[] = []
	const slow = buildSimNetwork(
		network,
		{ latency: { kind: 'constant', value: SLOW_LATENCY_MS } },
		0,
		(e) => events.push(e),
		undefined,
		{ identitySeed: IDENTITY_SEED, recoveryGiveupMs: DEADLINE_RECOVERY_GIVEUP_MS },
	)
	const result = await runLiftForOutcome(slow, network, outcome, q, { voters: [0], ttlMs: DEADLINE_TTL_MS })
	return { network, sim: slow, events, result: result!, metrics: analyzeLift(events, result!) }
}

/**
 * Drive the dropped-push-recovers scenario: `line(5)` with node 2 a non-relayer and the originator
 * publishing a contact point, so nodes 3 and 4 (cut off from the commit push) pull the settled record and
 * commit on the protocol's own recovery loop.
 */
async function runDroppedPushRecovers(): Promise<DrivenLift> {
	const network = cloneNetwork(line(5))
	const events: TraceEvent[] = []
	const sim = buildSimNetwork(network, {}, 0, (e) => events.push(e), undefined, {
		identitySeed: IDENTITY_SEED,
		refuseRelayFor: (id) => id === 2,
	})
	const q: QuerySpec = { from: 0, to: 4, amount: 5, depth: 5 }
	const outcome = await runQuery(sim, q)
	const result = await runLiftForOutcome(sim, network, outcome, q, { contactPoints: true, nonCooperating: [2] })
	return { network, sim, events, result: result!, metrics: analyzeLift(events, result!) }
}

/**
 * Drive the permanently-stuck scenario: discover 0→1 on a fast sim, then run the lift on a slow sim whose
 * only link DROPS, so the push to the payee never arrives, the promise phase never completes, and the
 * recovery loop abandons at its (small) ceiling → `pending`, credit held.
 */
async function runPermanentlyStuck(): Promise<DrivenLift> {
	const network = cloneNetwork(line(2))
	const q: QuerySpec = { from: 0, to: 1, amount: 5, depth: 2 }
	// Discovery finds the route on a fast sim (the payee is a direct peer-match terminus — the dropped link is
	// never exercised in discovery). The lift then runs on a sim whose sole link drops: `dropFraction: 1` on a
	// one-link network picks that link deterministically (no node to re-derive from a seed).
	const fast = buildSimNetwork(network, {}, 0, undefined, undefined, { identitySeed: IDENTITY_SEED })
	const outcome = await runQuery(fast, q)
	const events: TraceEvent[] = []
	const dropped = buildSimNetwork(network, { dropFraction: 1 }, 0, (e) => events.push(e), undefined, {
		identitySeed: IDENTITY_SEED,
		recoveryGiveupMs: STUCK_RECOVERY_GIVEUP_MS,
	})
	const result = await runLiftForOutcome(dropped, network, outcome, q, { voters: [0] })
	return { network, sim: dropped, events, result: result!, metrics: analyzeLift(events, result!) }
}

describe('consensus timeout — a lift waiting on a slow voter voids by its own deadline', () => {
	it('the completing promise lands post-expiry, the sole voter votes NC, and the route voids (no money moves)', async () => {
		const { network, sim, result, metrics } = await runLateVoterVoids()
		expect(result.outcome).toBe('void') // self-voided by the deadline, not a hang and not a throw
		expect(metrics.voidReason).toBe('voted-no-commit') // a deadline void surfaces as a voter-vote NC, never `expired`
		for (const t of network.tallies) {
			expect(t.balance).toBe(0) // nothing committed ⇒ no balance moved
		}
		// The lift SETTLED (by its deadline), so it contributes a time-to-settle sample — the span is defined.
		expect(metrics.timeToSettleMs).toBeGreaterThan(0)
		expect(sim.net.deliveryErrors).toEqual([]) // latency is not an error
		expect(sim.net.clock.pendingTimers).toBe(0) // the void clears every recovery loop; the heap drains
	})
})

describe('consensus timeout — a dropped commit-push recovers by the protocol recovery loop', () => {
	it('every member an interior non-relayer cut off pulls the settled record and commits (completion 1.0)', async () => {
		const { sim, result, metrics } = await runDroppedPushRecovers()
		expect(result.outcome).toBe('commit')
		// Every cooperating member (the route minus the non-relayer) reached commit: completion 1.0.
		expect(result.cooperatingMembers).toBe(4) // {0,1,3,4} — node 2 is the excluded non-relayer
		expect(result.cooperatingCommitted).toBe(result.cooperatingMembers)
		for (const e of [0, 1, 2, 3, 4]) {
			expect(await outcomeOf(sim, e, result.transactionCode)).toBe('commit')
		}
		// The protocol's OWN recovery loop (a record-pulled / recovery-tick fired), not a manual pull, healed the
		// stranded members: `recovered === 1` is the per-lift proof the loop ran during the settle.
		expect(metrics.recovered).toBe(1)
		expect(metrics.pullMessages).toBeGreaterThanOrEqual(1) // the stranded members pulled the evidence
		expect(sim.net.deliveryErrors).toEqual([])
		expect(sim.net.clock.pendingTimers).toBe(0)
	})
})

describe('consensus timeout — a needed party that never returns abandons and stays pending', () => {
	it('the promise phase never completes, the recovery loop abandons, and the lift is permanently pending', async () => {
		const { network, sim, events, result, metrics } = await runPermanentlyStuck()
		expect(result.outcome).toBe('pending') // no decision ever reached — settled nowhere, surfaced not thrown
		expect(metrics.voidReason).toBe('stalled') // a pending is always `stalled`, whatever stray events fired
		expect(events.some((e) => e.type === 'recovery-abandoned')).toBe(true) // the loop gave up after the ceiling
		expect(metrics.permanentlyPending).toBe(true) // pending AND resources never released ⇒ credit tied up for good
		expect(network.tallies[0].balance).toBe(0) // nothing settled ⇒ no money moved
		expect(sim.net.deliveryErrors).toEqual([]) // a dropped push is not a delivery error
		expect(sim.net.clock.pendingTimers).toBe(0) // the abandoned loop drained the heap
	})
})

describe('consensus timeout — the 6.32 metrics read end-to-end over the three self-resolving lifts', () => {
	it('time-to-settle spans the deadline void, credit-held reflects the settled lifts, and the pending lift is counted', async () => {
		const voidLift = await runLateVoterVoids()
		const commitLift = await runDroppedPushRecovers()
		const stuckLift = await runPermanentlyStuck()
		const lifts = [voidLift.metrics, commitLift.metrics, stuckLift.metrics]

		const run = summarizeConsensusMetrics(lifts, STRUCTURAL_STUB, /* queryCount */ 3)
		expect(run.liftCount).toBe(3)
		expect(run.commitCount).toBe(1)
		expect(run.voidCount).toBe(1)
		expect(run.pendingCount).toBe(1)

		// Time-to-resolution now spans timeout-driven settlements: the SETTLED lifts (commit + void) each
		// contribute a sample; the pending one contributes none. The deadline void is a `void`, so it is in here.
		expect(run.timeToSettleMs.count).toBe(2)
		expect(run.timeToSettleMs.max).toBeGreaterThan(0)
		expect(run.voidReasons['voted-no-commit']).toBe(1) // the deadline void
		expect(run.voidReasons.stalled).toBe(1) // the permanently-stuck lift

		// Credit-held duration: the two lifts that promised `P` and then released (commit + void) each carry a
		// defined span; the stuck lift never released, so it contributes no credit-held sample.
		expect(run.creditHeldMsPerLift.count).toBe(2)

		// The never-resolved lift is counted: one permanently-pending lift out of three.
		expect(run.permanentlyPendingCount).toBe(1)
		expect(run.permanentlyPendingFraction).toBeCloseTo(1 / 3)
	})
})

describe('consensus timeout — determinism over the deadline + recovery timers', () => {
	it('the deadline-void scenario replays identical result and metrics (the timers do not perturb the session-code random)', async () => {
		const a = await runLateVoterVoids()
		const b = await runLateVoterVoids()
		expect(a.result).toEqual(b.result) // identical LiftResult (outcome, route, counts)
		expect(a.metrics).toEqual(b.metrics) // identical time-to-settle + credit-held + void reason
		expect(serialize(a.network)).toEqual(serialize(b.network)) // byte-identical network (no money moved, both unchanged)
	})

	it('the permanently-stuck scenario replays identical result and metrics (abandonment is deterministic)', async () => {
		const a = await runPermanentlyStuck()
		const b = await runPermanentlyStuck()
		expect(a.result).toEqual(b.result)
		expect(a.metrics).toEqual(b.metrics)
		expect(serialize(a.network)).toEqual(serialize(b.network))
	})
})
