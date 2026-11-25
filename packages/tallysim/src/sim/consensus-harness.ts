/**
 * The consensus phase of the discovery+consensus simulation: take a settled discovery {@link QueryOutcome},
 * pick one found plan, drive the real `tallynet` sign-and-settle protocol over that exact route on the
 * virtual clock, read whether it committed / voided / stalled, and — on commit — move each tally's balance
 * along the route in the network model so the next query sees the changed capacity.
 *
 * It composes the three pieces this ticket adds: {@link selectPlan} (the originator's route preference),
 * {@link reconstructRoute} (invert the plan's anonymised nonces back to a concrete tally route), and the
 * `InMemoryNetwork` consensus harness the prereq wired on. See `docs/design.md` § Consensus simulation.
 *
 * ── Three details that are easy to get wrong ───────────────────────────────────────────────────────────
 * - **Members & voters.** Every entity on the route is a participant (`['P']`); the voter set (default the
 *   originator alone) additionally gets `['R']`, so a default lift settles on the originator's own vote (the
 *   "lift voters, not referee" model — a voter set of one). A circular lift lists the originator **once** in
 *   `members` though it sits on two links; `buildLift` resolves the route pairs regardless.
 * - **CBOR-safe link intents.** `recordDigest` DAG-CBOR-encodes `topology.links[*].intents`, and DAG-CBOR
 *   throws on `Infinity` — which an `unlimited`-capacity tally carries in `capFwd`/`capBack`. So, after
 *   `buildLift` and **before** `start`, every finite-ified copy of the lift record's link intents replaces a
 *   non-finite value with `Number.MAX_SAFE_INTEGER`. TallyNet never interprets terms, every node signs the
 *   same sanitised record, and nonces are keyed by `sessionCode`+`linkId` (independent of intent values), so
 *   this is safe and leaves settlement unaffected. Only this lift record is sanitised — never the shared
 *   discovery adjacency (that would break the pinned byte-identical discovery sweep).
 * - **`pending` is a real outcome.** A stalled lift (a dropped push, or an even voter-set tie; v1 has no
 *   timeout) settles nowhere and is surfaced as `'pending'`, not thrown. A clean run leaves
 *   `net.deliveryErrors === []` even when a participant refuses (the engine catches it and signs `NP`).
 */

import { MemberTypes, type MemberType, type TrxRecord } from 'tallynet'
import type { LiftMemberSpec } from 'tallynet/testing'
import { applyLiftToBalance } from '../capacity.js'
import type { Network } from '../model.js'
import type { QueryOutcome, QuerySpec, SimNetwork } from './harness.js'
import { entityName, linkIdForTally } from './naming.js'
import { type PlanPolicy, selectPlan } from './plan-select.js'
import { reconstructRoute } from './route.js'
import type { LiftTerms } from './terms.js'

const PART: MemberType = MemberTypes.participant
const REF: MemberType = MemberTypes.referee

/** The settled result of driving one lift: the codes, the concrete route, the amount, and the outcome. */
export interface LiftResult {
	transactionCode: string
	sessionCode: string
	/** Entity ids the lift traversed, `[from, …, to]` (circular ⇒ `route[0] === route[last]`). */
	route: number[]
	/** The tally index of each hop, in order (`route.length − 1` entries). */
	tallyPath: number[]
	amount: number
	/** `commit` moved balances; `void` and `pending` left them unchanged. */
	outcome: 'commit' | 'void' | 'pending'
}

/** Tuning for {@link runLiftForOutcome}: which plan policy, and which entities vote (default: the originator). */
export interface RunLiftOptions {
	/** The originator's plan-selection policy (default `shortest`). */
	policy?: PlanPolicy
	/** The voter set (`R`-role members). Default: `[route[0]]`, the originator voting itself. */
	voters?: number[]
}

/**
 * Pick a plan from `outcome`, drive its lift to settlement, and (on commit) move balances along the route
 * in `network`. Returns the {@link LiftResult}, or `undefined` when the query found no plan (the consensus
 * phase is skipped and nothing is mutated). **Mutates `network.tallies[*].balance` in place on commit** —
 * a caller that must keep the pre-lift network should pass a {@link cloneNetwork} copy. The `sim` must have
 * been built from `network` with consensus enabled (`buildSimNetwork(network, …, { identitySeed })`).
 */
export async function runLiftForOutcome(
	sim: SimNetwork,
	network: Network,
	outcome: QueryOutcome,
	q: QuerySpec,
	options?: RunLiftOptions,
): Promise<LiftResult | undefined> {
	const plan = selectPlan(outcome.plans, options?.policy ?? 'shortest')
	if (!plan) {
		return undefined
	}
	const { tallyPath, route } = reconstructRoute(network, outcome.sessionCode, q.from, plan)
	const net = sim.net
	const voters = new Set(options?.voters ?? [route[0]])
	const onRoute = new Set(route)
	for (const voter of voters) {
		// A voter off the route is never emitted as a member (liftMembers walks the route), so it would
		// silently carry no referee role — leaving the lift with too few (possibly zero) voters and a
		// confusing `pending`. Fail loudly instead; the voter set must be a subset of the route.
		if (!onRoute.has(voter)) {
			throw new Error(`runLiftForOutcome: voter ${voter} is not on the route [${route.join(', ')}]`)
		}
	}
	const { record, transactionCode } = net.buildLift({
		members: liftMembers(route, voters),
		route: route.map(entityName),
		routeLinkIds: tallyPath.map(linkIdForTally),
		// Reuse the discovery session; let buildLift mint the transaction code off the shared seeded random.
		sessionCode: outcome.sessionCode,
		// A STRING amount: DAG-CBOR rejects a bigint/number caveat on the payload; a string round-trips cleanly.
		payload: { amount: String(q.amount) },
	})
	sanitiseRecordIntents(record)

	await net.consensusNode(entityName(route[0])).start(record)
	await net.clock.runUntilIdle()
	const settled = await net.consensusNode(entityName(route[0])).outcome(transactionCode)

	if (settled === 'commit') {
		settleRoute(network, route, tallyPath, q.amount)
	}
	return { transactionCode, sessionCode: outcome.sessionCode, route, tallyPath, amount: q.amount, outcome: settled }
}

/**
 * The lift's members: each distinct entity on the route once, as a participant; an entity in `voters`
 * additionally carries the referee role. Order follows first appearance on the route (the originator first),
 * which is deterministic. A circular route's repeated originator is emitted once.
 */
function liftMembers(route: number[], voters: Set<number>): LiftMemberSpec[] {
	const members: LiftMemberSpec[] = []
	const seen = new Set<number>()
	for (const id of route) {
		if (seen.has(id)) {
			continue
		}
		seen.add(id)
		members.push({ name: entityName(id), roles: voters.has(id) ? [PART, REF] : [PART] })
	}
	return members
}

/**
 * Rewrite every lift link's intents to a CBOR-safe finite copy in place, replacing a non-finite capacity
 * (an `unlimited` tally's `Infinity`) with `Number.MAX_SAFE_INTEGER`. Done before signing: DAG-CBOR throws
 * on `Infinity`, and the signed preimage encodes these intents (see the module header).
 */
function sanitiseRecordIntents(record: TrxRecord<LiftTerms, unknown>): void {
	for (const nonce of Object.keys(record.topology.links)) {
		record.topology.links[nonce].intents = sanitiseIntents(record.topology.links[nonce].intents)
	}
}

/** A finite-ified copy of one link's per-code terms (non-finite → `Number.MAX_SAFE_INTEGER`). */
function sanitiseIntents(intents: Record<string, LiftTerms>): Record<string, LiftTerms> {
	const out: Record<string, LiftTerms> = {}
	for (const [code, terms] of Object.entries(intents)) {
		out[code] = { capFwd: cborSafe(terms.capFwd), capBack: cborSafe(terms.capBack), amount: cborSafe(terms.amount) }
	}
	return out
}

/** A DAG-CBOR-encodable number: a finite value unchanged, a non-finite one replaced with the max safe int. */
function cborSafe(value: number): number {
	return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

/**
 * Move each hop's tally balance for a committed lift: value flows `route[i] → route[i+1]` across tally
 * `tallyPath[i]`. The payer `route[i]` is the tally's stock or foil; `applyLiftToBalance` moves the balance
 * accordingly. Asserts the payer is actually an endpoint of the tally and that the balance stays within
 * `[-foilCreditLimit, stockCreditLimit]` after each hop — a violation is a route-reconstruction or
 * direction bug (discovery already guaranteed enough capacity for a single lift over the found route).
 */
function settleRoute(network: Network, route: number[], tallyPath: number[], amount: number): void {
	for (let i = 0; i < tallyPath.length; i++) {
		const payer = route[i]
		const tally = network.tallies[tallyPath[i]]
		if (tally.stock !== payer && tally.foil !== payer) {
			throw new Error(`settleRoute: hop ${i} payer ${payer} is neither stock nor foil of tally ${tallyPath[i]}`)
		}
		applyLiftToBalance(tally, tally.stock === payer, amount)
		if (tally.balance < -tally.foilCreditLimit || tally.balance > tally.stockCreditLimit) {
			throw new Error(
				`settleRoute: tally ${tallyPath[i]} balance ${tally.balance} out of bounds ` +
					`[${-tally.foilCreditLimit}, ${tally.stockCreditLimit}] after hop ${i}`,
			)
		}
	}
}
