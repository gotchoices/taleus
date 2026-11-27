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
 *   originator alone) additionally gets `['V']`, so a default lift settles on the originator's own vote (the
 *   voter model — a voter set of one). A circular lift lists the originator **once** in
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
 * - **Self-recovery (no manual pull).** The protocol's own deadline + recovery timers fire inside the single
 *   `net.clock.runUntilIdle()`: `VirtualClock.runUntilIdle` fires every live timer until the heap empties, so
 *   the deadline one-shot and the periodic recovery-loop ticks run there. A member an interior non-relayer cut
 *   off from the commit push still holds the record (it promised) but lacks the commit evidence, and its
 *   recovery loop pulls that evidence from a reachable contact point (`contactPoints`) or link-neighbour; a
 *   silent or split lift voids by its own deadline. So the simulator drives no pull itself —
 *   `tallynet-stalled-recovery` moved recovery into the protocol. {@link LiftResult.pullCalls} /
 *   {@link LiftResult.recovered} are therefore **deprecated**, hard-coded to `0` here and re-homed onto the
 *   protocol's own trace events in `tallysim-timeout-harness-metrics`.
 */

import { MemberTypes, type ConsensusMethod, type MemberType, type TrxRecord } from 'tallynet'
import type { LiftMemberSpec } from 'tallynet/testing'
import { applyLiftToBalance } from '../capacity.js'
import type { Network } from '../model.js'
import type { QueryOutcome, QuerySpec, SimNetwork } from './harness.js'
import { entityName, linkIdForTally } from './naming.js'
import { type PlanPolicy, selectPlan } from './plan-select.js'
import { reconstructRoute } from './route.js'
import type { LiftTerms } from './terms.js'

const PART: MemberType = MemberTypes.participant
const VOTER: MemberType = MemberTypes.voter

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
	/** Deprecated; re-homed onto trace events in `tallysim-timeout-harness-metrics` — returns 0 here. */
	pullCalls: number
	/** Deprecated; re-homed onto trace events in `tallysim-timeout-harness-metrics` — returns 0 here. */
	recovered: number
	/**
	 * Distinct route entities **not** in `options.nonCooperating` — the members that are allowed to reach
	 * commit. A non-relayer/silent node is excluded (it can never recover), so this is the honest denominator
	 * of the completion fraction, exactly as the pull pass excludes them.
	 */
	cooperatingMembers: number
	/** How many {@link LiftResult.cooperatingMembers} have `commit` outcome after settlement + recovery. */
	cooperatingCommitted: number
}

/** Tuning for {@link runLiftForOutcome}: plan policy, voter set, contact points, and the non-cooperating set. */
export interface RunLiftOptions {
	/** The originator's plan-selection policy (default `shortest`). */
	policy?: PlanPolicy
	/** The voter set (`V`-role members). Default: `[route[0]]`, the originator voting itself. */
	voters?: number[]
	/**
	 * Give the originator and every voter a `physical` contact point (a dial address every record-holder can
	 * reach), so a member the commit push could not reach can still pull the settled record from one of them.
	 * Default `false` (no contact points — only link-neighbours and existing physical members are reachable).
	 */
	contactPoints?: boolean
	/**
	 * Entity ids that never relay or serve the commit phase (the network's `refuseRelayFor` /
	 * `silentAfterPromiseFor` nodes). They are **excluded from the completion count**: a non-relayer serves no
	 * pull, so it can never recover and must not count as stranded. MUST match the network's injected set.
	 */
	nonCooperating?: number[]
	/** The well-known entity set for the `voter-aware` policy (passed to {@link selectPlan}). Default: none. */
	wellKnown?: Set<number>
	/**
	 * The {@link ConsensusMethod} this lift settles under, threaded onto `buildLift`. Omitted ⇒ `buildLift`'s
	 * own default (`DEFAULT_CONSENSUS_METHOD`, a plain strict-majority `1/2`), byte-identical to not passing it.
	 * A raised threshold (e.g. `2/3`) can leave a split voter set settling nowhere (`pending`).
	 */
	consensusMethod?: ConsensusMethod
	/**
	 * The lift code lifetime in ms → the deadline (the session + transaction code expiry minted by `buildLift`),
	 * and so the point its recovery loop anchors on. Omitted ⇒ `buildLift`'s own `600_000` default, byte-identical
	 * to not passing it. Must exceed the happy-path settle time but stay inside a stalled scenario's run budget,
	 * so a genuinely-stuck lift reaches its deadline and abandons well before the test timeout.
	 */
	ttlMs?: number
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
	const plan = selectPlan(outcome.plans, options?.policy ?? 'shortest', options?.wellKnown)
	if (!plan) {
		return undefined
	}
	const { tallyPath, route } = reconstructRoute(network, outcome.sessionCode, q.from, plan)
	const net = sim.net
	const voters = new Set(options?.voters ?? [route[0]])
	const onRoute = new Set(route)
	for (const voter of voters) {
		// A voter off the route is never emitted as a member (liftMembers walks the route), so it would
		// silently carry no voter role — leaving the lift with too few (possibly zero) voters and a
		// confusing `pending`. Fail loudly instead; the voter set must be a subset of the route.
		if (!onRoute.has(voter)) {
			throw new Error(`runLiftForOutcome: voter ${voter} is not on the route [${route.join(', ')}]`)
		}
	}
	const { record, transactionCode } = net.buildLift({
		members: liftMembers(route, voters, options?.contactPoints ?? false),
		route: route.map(entityName),
		routeLinkIds: tallyPath.map(linkIdForTally),
		// Reuse the discovery session; let buildLift mint the transaction code off the shared seeded random.
		sessionCode: outcome.sessionCode,
		// A STRING amount: DAG-CBOR rejects a bigint/number caveat on the payload; a string round-trips cleanly.
		payload: { amount: String(q.amount) },
		// Omitted ⇒ buildLift's DEFAULT_CONSENSUS_METHOD (1/2); a raised threshold can leave a split set pending.
		method: options?.consensusMethod,
		// Omitted ⇒ buildLift's 600_000 ms default; the spread keeps the no-ttl path byte-identical.
		...(options?.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
	})
	sanitiseRecordIntents(record)

	// The one drive to idle fires EVERY live timer — the protocol's own deadline one-shot and its periodic
	// recovery-loop ticks included — so the protocol self-recovers here: a member an interior non-relayer cut
	// off from the commit push pulls the evidence from a reachable contact point/link-neighbour on its recovery
	// loop, and a silent or split lift voids by its own deadline. The simulator drives no pull of its own
	// (recovery moved into the protocol by `tallynet-stalled-recovery`).
	await net.consensusNode(entityName(route[0])).start(record)
	await net.clock.runUntilIdle()

	// Read the settlement off the originator, then move money on a commit — the money-move keys off the
	// originator's own view, as the discovery-only path did.
	const settled = await net.consensusNode(entityName(route[0])).outcome(transactionCode)
	if (settled === 'commit') {
		settleRoute(network, route, tallyPath, q.amount)
	}
	// The principle-3 completion count: of the cooperating members (those not cut out as non-relayers/silent,
	// which can never recover), how many actually reached commit — the honest completion numerator. The
	// `nonCooperating` set is the network's injected non-relayer/silent set, excluded from the denominator.
	const nonCooperating = options?.nonCooperating ?? []
	const { members: cooperatingMembers, committed: cooperatingCommitted } = await countCommitted(net, route, transactionCode, nonCooperating)
	return {
		transactionCode,
		sessionCode: outcome.sessionCode,
		route,
		tallyPath,
		amount: q.amount,
		outcome: settled,
		// Deprecated; the protocol self-recovers, so no manual pass runs. Re-homed in tallysim-timeout-harness-metrics.
		pullCalls: 0,
		recovered: 0,
		cooperatingMembers,
		cooperatingCommitted,
	}
}

/**
 * The distinct route entities that are allowed to reach commit: each entity on `route` once (a circular
 * route's repeated origin deduped), minus the `nonCooperating` set (non-relayers / silent nodes, which can
 * never recover). The one place this member set is derived — the honest denominator of the completion count.
 */
function cooperatingRoute(route: number[], nonCooperating: number[]): number[] {
	const nonCoop = new Set(nonCooperating)
	return [...new Set(route)].filter((entity) => !nonCoop.has(entity))
}

/**
 * Count the cooperating members (see {@link cooperatingRoute}) and how many of them read `commit` for
 * `transactionCode`. Used once at the end of a lift to fill {@link LiftResult.cooperatingMembers} /
 * {@link LiftResult.cooperatingCommitted} — the numerator and denominator of the completion fraction.
 */
async function countCommitted(
	net: SimNetwork['net'],
	route: number[],
	transactionCode: string,
	nonCooperating: number[],
): Promise<{ members: number; committed: number }> {
	const members = cooperatingRoute(route, nonCooperating)
	let committed = 0
	for (const entity of members) {
		if ((await net.consensusNode(entityName(entity)).outcome(transactionCode)) === 'commit') {
			committed++
		}
	}
	return { members: members.length, committed }
}

/**
 * The lift's members: each distinct entity on the route once, as a participant; an entity in `voters`
 * additionally carries the voter role. Order follows first appearance on the route (the originator first),
 * which is deterministic. A circular route's repeated originator is emitted once. With `contactPoints`, the
 * originator and every voter also publish a `physical` dial address, so a member stranded by an interior
 * non-relayer can pull the settled record from one of them on the protocol's recovery loop.
 */
function liftMembers(route: number[], voters: Set<number>, contactPoints: boolean): LiftMemberSpec[] {
	const members: LiftMemberSpec[] = []
	const seen = new Set<number>()
	for (const id of route) {
		if (seen.has(id)) {
			continue
		}
		seen.add(id)
		const physical = contactPoints && (id === route[0] || voters.has(id))
		members.push({ name: entityName(id), roles: voters.has(id) ? [PART, VOTER] : [PART], ...(physical ? { physical: true } : {}) })
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
