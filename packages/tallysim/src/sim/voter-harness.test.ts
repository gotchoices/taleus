/**
 * The voter-model behaviours wired into the running simulator: contact points + pull recovery (record
 * availability), referee nomination, the payer's plan scorer, and the stacked-voter-set refusal. These are
 * the tallysim-harness mirrors of the tallynet-level proofs in `tallynet/src/testing/consensus.test.ts`
 * (§ record availability) and `discovery.test.ts` (§ voter-model policy hooks), driven over hand-built
 * line / ring / diamond `Network`s instead of raw graphs. The pure policy functions they lean on are tested
 * in `plan-select.test.ts`, `well-known.test.ts` and `consensus-resource.test.ts`; this file proves the
 * wiring that turns them on inside a real discovery + consensus run.
 */

import { MemberTypes, type DependentMember, type DiscoveryHooks, type MemberType, type Plan } from 'tallynet'
import { FORMAT_VERSION, type Network, type Tally, cloneNetwork, serialize } from '../model.js'
import { runLiftForOutcome } from './consensus-harness.js'
import { makeSimResources, refuseStackedPlanHook, type StackedVoterPolicy } from './consensus-resource.js'
import { buildSimNetwork, runQuery, type QuerySpec, type SimNetwork } from './harness.js'
import { voterAwareScorePlan } from './plan-select.js'
import { buildCircularOutcome } from './route.js'
import type { LiftTerms } from './terms.js'
import { makeNomineesFor, wellKnownEntities } from './well-known.js'

const PART: MemberType = MemberTypes.participant
const VOTER: MemberType = MemberTypes.voter

/** The fixed consensus seed every scenario shares (deterministic keys; see `identity.ts`). */
const IDENTITY_SEED = 7

/** Provenance stub shared by the hand-built networks below. */
const META = { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION }

/** A line `0 - 1 - … - (n-1)`, one tally per consecutive pair, finite symmetric credit limits. */
function line(n: number, limit = 1000): Network {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return { entityCount: n, tallies, meta: META }
}

/** A ring `0 - 1 - … - (n-1) - 0`: tally `i` joins `i` to `(i + 1) mod n`, so `T0{0,1} … T(n-1){n-1,0}`. */
function ring(n: number, limit = 1000): Network {
	const tallies: Tally[] = []
	for (let i = 0; i < n; i++) {
		tallies.push({ stock: i, foil: (i + 1) % n, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return { entityCount: n, tallies, meta: META }
}

/** A symmetric diamond `0→1→3` and `0→2→3` (both two hops): arm A through node 1, arm B through node 2. */
function diamond(limit = 1000): Network {
	const edge = (stock: number, foil: number): Tally => ({ stock, foil, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	return { entityCount: 4, tallies: [edge(0, 1), edge(1, 3), edge(0, 2), edge(2, 3)], meta: META }
}

/** A node's net credit position: `Σ balance where stock − Σ balance where foil`. */
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

/** The settled outcome of `transactionCode` at entity `e`. */
function outcomeOf(sim: SimNetwork, e: number, transactionCode: string): Promise<'commit' | 'void' | 'pending'> {
	return sim.net.consensusNode(String(e)).outcome(transactionCode)
}

/** Count the voter-only (`[V]`, referee) members a discovered plan carries. */
function refereeCount(plan: Plan<LiftTerms, unknown>): number {
	return plan.members.filter((m) => m.types.includes(VOTER) && !m.types.includes(PART)).length
}

describe('voter harness — record availability (principle 3: a pull routes around an interior non-relayer)', () => {
	it('with contact points the members an interior non-relayer cut off pull the settled record and commit', async () => {
		// 0—1—2—3—4, node 2 refuses to relay the commit phase. The originator (node 0) is the sole voter and
		// publishes a contact point; the commit reaches 0,1,2 by push but node 2 forwards nothing, so 3 and 4
		// are stranded — then pull node 0's settled record over its contact point and settle.
		const network = line(5)
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, { identitySeed: IDENTITY_SEED, refuseRelayFor: (id) => id === 2 })
		const q: QuerySpec = { from: 0, to: 4, amount: 5, depth: 5 }
		const outcome = await runQuery(sim, q)
		expect(outcome.found).toBe(true)

		const result = await runLiftForOutcome(sim, network, outcome, q, { contactPoints: true, nonCooperating: [2] })
		expect(result?.outcome).toBe('commit')
		expect(result?.recovered).toBe(2) // nodes 3 and 4 were stranded, then recovered by pull
		expect(result?.pullCalls).toBeGreaterThan(0)
		for (const e of [0, 1, 2, 3, 4]) {
			expect(await outcomeOf(sim, e, result!.transactionCode)).toBe('commit')
		}
		for (const t of network.tallies) {
			expect(t.balance).toBe(-5) // money moved the full route
		}
		expect(sim.net.deliveryErrors).toEqual([])
		expect(sim.net.clock.pendingTimers).toBe(0)
	})

	it('without contact points the far members stay pending (the documented gap), yet the originator commits and money moves', async () => {
		// Same chain and refuser, but no contact point: node 3's only peers are the refuser (serves no pull) and
		// node 4 (also pending), so neither 3 nor 4 can reach the commit evidence. The originator is the sole
		// voter and commits regardless, so the money still moves — the lift is logically committed, two members
		// just have not learned it. This is the hard case principle 3 names: a straight line cannot route around.
		const network = line(5)
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, { identitySeed: IDENTITY_SEED, refuseRelayFor: (id) => id === 2 })
		const q: QuerySpec = { from: 0, to: 4, amount: 5, depth: 5 }
		const outcome = await runQuery(sim, q)

		const result = await runLiftForOutcome(sim, network, outcome, q, { contactPoints: false, nonCooperating: [2] })
		expect(result?.outcome).toBe('commit')
		expect(result?.recovered).toBe(0) // no path to the evidence for 3 or 4
		expect(await outcomeOf(sim, 3, result!.transactionCode)).toBe('pending')
		expect(await outcomeOf(sim, 4, result!.transactionCode)).toBe('pending')
		expect(network.tallies[0].balance).toBe(-5) // money still moved on the originator's commit
		expect(network.tallies[3].balance).toBe(-5)
		expect(sim.net.deliveryErrors).toEqual([])
		expect(sim.net.clock.pendingTimers).toBe(0)
	})

	it('a circular lift routes around one non-relayer with no contact points at all', async () => {
		// Ring 0—1—2—0, node 1 refuses to relay. The originator (sole voter) pushes its commit to BOTH neighbours
		// directly over the ring's two incident links, so node 2 is reached over T2 without ever going through
		// node 1. The whole cooperating ring commits with nobody stranded. Mirrors tallynet consensus.test :1143.
		const network = ring(3)
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, { identitySeed: IDENTITY_SEED, refuseRelayFor: (id) => id === 1 })
		const q: QuerySpec = { from: 0, to: 0, amount: 5, depth: 3 }
		const base = await runQuery(sim, q) // mint a real session code (its discovery plans may be empty)
		const outcome = buildCircularOutcome(network, base.sessionCode, 0)
		expect(outcome).toBeDefined()

		const result = await runLiftForOutcome(sim, network, outcome!, q, { contactPoints: false, nonCooperating: [1] })
		expect(result?.outcome).toBe('commit')
		expect(result?.route).toEqual([0, 1, 2, 0]) // the closed loop the circular finder built
		expect(result?.recovered).toBe(0) // the ring delivered directly — nobody stranded
		expect(await outcomeOf(sim, 0, result!.transactionCode)).toBe('commit')
		expect(await outcomeOf(sim, 2, result!.transactionCode)).toBe('commit')
		for (const e of [0, 1, 2]) {
			expect(netPosition(network, e)).toBe(0) // conservation around the loop
		}
		expect(sim.net.deliveryErrors).toEqual([])
	})
})

describe('voter harness — a voter-set tie settles nowhere (a clean third outcome, not a hang)', () => {
	it('a 2-voter set split one commit / one NC reaches neither majority ⇒ pending', async () => {
		// line(3): 0—1—2, both 0 and 1 are voters. Node 1 declines its commit vote (signs NC); node 0 votes
		// commit. With a 2-voter set the strict-majority floor is count·2 > W=2 ⇒ count ≥ 2, so one commit +
		// one NC reaches neither the commit nor the void side — the lift settles nowhere and is `pending`.
		const network = line(3)
		const { resourceFor } = makeSimResources({ 1: { shouldCommit: false } })
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, { identitySeed: IDENTITY_SEED, resourceFor })
		const q: QuerySpec = { from: 0, to: 2, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)

		const result = await runLiftForOutcome(sim, network, outcome, q, { voters: [0, 1] })
		expect(result?.outcome).toBe('pending') // not a throw, not a hang — the tie is a real third outcome
		expect(network.tallies[0].balance).toBe(0) // nothing settled ⇒ no money moved
		expect(sim.net.deliveryErrors).toEqual([])
		expect(sim.net.clock.pendingTimers).toBe(0)
	})
})

describe('voter harness — referee nomination folds a well-known hub into the discovered plan', () => {
	it('every participant nominates the one off-route hub, which surfaces as a [V] member', async () => {
		// Payment path 0—1—2; node 3 is a high-degree hub OFF that path (edges to 0, 4, 5, 6 — none of which
		// reach node 2), so the only route to 2 is 0—1—2 and the hub never lands ON it. With the well-known
		// nomination policy, every participant nominates the hub, which folds into the plan once as a [V] referee.
		const edge = (stock: number, foil: number): Tally => ({ stock, foil, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 })
		const network: Network = {
			entityCount: 7,
			tallies: [edge(0, 1), edge(1, 2), edge(3, 0), edge(3, 4), edge(3, 5), edge(3, 6)],
			meta: META,
		}
		const wellKnown = wellKnownEntities(network, 0.2) // round(0.2 · 7) = 1 → the single highest-degree hub
		expect(wellKnown).toEqual(new Set([3]))

		const nomineesFor = makeNomineesFor(network, wellKnown, 'well-known')
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, {
			identitySeed: IDENTITY_SEED,
			nomineesFor,
			scorePlan: voterAwareScorePlan(wellKnown),
		})
		const q: QuerySpec = { from: 0, to: 2, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)
		expect(outcome.found).toBe(true)

		const plan = outcome.plans[0]
		expect(refereeCount(plan)).toBe(1) // the hub, folded once
		const referees = plan.members.filter((m) => m.types.includes(VOTER) && !m.types.includes(PART))
		expect(referees.map((m) => m.address.key)).toEqual(['3']) // the hub (node 3) is the nominated referee
	})
})

describe('voter harness — the payer vets the voter set at discovery', () => {
	/** Default-plus-extras: a node that staples `extras` voter-only members onto every plan it folds into. */
	function stackingHook(extras: DependentMember[]): DiscoveryHooks<LiftTerms, unknown>['negotiatePlan'] {
		return (plan) => ({ ...plan, members: [...plan.members, ...extras] })
	}

	it('scorePlan ranks the lean voter set ahead of a stacked one (winner at plans[0])', async () => {
		// Diamond: node 1 (arm A) stacks two obscure referees; node 2 (arm B) stays lean. Both arms are two
		// hops, so the voter count is the only differentiator and the lean arm must rank first. Mirrors
		// tallynet discovery.test :507.
		const network = diamond()
		const extras: DependentMember[] = [0, 1].map((i) => ({ types: [VOTER], address: { key: `bv${i}` } }))
		const negotiatePlanFor = (id: number) => (id === 1 ? stackingHook(extras) : undefined)
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, {
			identitySeed: IDENTITY_SEED,
			negotiatePlanFor,
			scorePlan: voterAwareScorePlan(new Set()),
		})
		const q: QuerySpec = { from: 0, to: 3, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)

		expect(outcome.plans).toHaveLength(2) // both arms surface; scoring ranks, it does not drop here
		expect(refereeCount(outcome.plans[0])).toBe(0) // winner: the lean arm
		expect(refereeCount(outcome.plans[1])).toBe(2) // passed over: the stacked arm
	})

	it('refuseStackedPlanHook drops just the arm padded with an obscure referee', async () => {
		// Node 1 (arm A) stacks one obscure referee `bad0`; the originator refuses any plan carrying an obscure
		// referee, so arm A is dropped and only the lean arm B survives. Mirrors tallynet discovery.test :550.
		const network = diamond()
		const bad: DependentMember[] = [{ types: [VOTER], address: { key: 'bad0' } }]
		const policy: StackedVoterPolicy = { wellKnown: new Set([0, 1, 2, 3]), memberEntity: (m) => Number(m.address.key) }
		const negotiatePlanFor = (id: number) => {
			if (id === 1) {
				return stackingHook(bad)
			}
			if (id === 0) {
				return refuseStackedPlanHook(policy)
			}
			return undefined
		}
		const sim = buildSimNetwork(network, {}, 0, undefined, undefined, { identitySeed: IDENTITY_SEED, negotiatePlanFor })
		const q: QuerySpec = { from: 0, to: 3, amount: 5, depth: 3 }
		const outcome = await runQuery(sim, q)

		expect(outcome.plans).toHaveLength(1) // just the padded arm was dropped, not both
		expect(outcome.plans[0].members.some((m) => m.address.key === 'bad0')).toBe(false) // the survivor is lean
	})
})

describe('voter harness — determinism', () => {
	it('the contact-point recovery scenario reproduces identical results and byte-identical networks', async () => {
		const q: QuerySpec = { from: 0, to: 4, amount: 5, depth: 5 }
		async function pass() {
			const network = cloneNetwork(line(5))
			const sim = buildSimNetwork(network, {}, 0, undefined, undefined, { identitySeed: IDENTITY_SEED, refuseRelayFor: (id) => id === 2 })
			const result = await runLiftForOutcome(sim, network, await runQuery(sim, q), q, { contactPoints: true, nonCooperating: [2] })
			return { result, serialized: serialize(network) }
		}
		const a = await pass()
		const b = await pass()
		expect(a.result).toEqual(b.result) // identical LiftResult, including pullCalls and recovered
		expect(a.serialized).toEqual(b.serialized)
	})
})
