/**
 * Failure-injecting consensus resource ports for the simulator, keyed by **entity id** (the sim's native
 * node identity, not the `tallynet` node name). The cooperative default — a holder that promises, releases
 * and votes commit while holding nothing real — already lives in the harness (`cooperativeResource`, used
 * when no `resourceFor` is passed). This module supplies the *refusers* a behavioural test needs: a node
 * that declines to promise, one whose `promise` throws, or a voter that votes no-commit.
 *
 * It mirrors the resource doubles in `tallynet`'s `consensus.test.ts`: each handle records the contexts its
 * `promise` saw and the `success` flag of each `release`, so a test reads back exactly what each node held
 * and how it settled (`releaseSuccesses` is `[true]` = committed once, `[false]` = voided once, `[]` = never
 * released). The map is keyed by entity id so a test specifies failures in the sim's own id space;
 * {@link buildSimNetwork}'s consensus wiring adapts entity-id → node-name at the harness boundary.
 */

import { MemberTypes, type DependentMember, type Plan, type ResourceContext, type TrxParticipantResource } from 'tallynet'
import type { LiftTerms } from './terms.js'

/**
 * The rule a payer uses to **refuse a stacked voter set** — a quorum padded with obscure referees it does
 * not recognise. A referee is a `V`-only member (a voter that is not also a participant, i.e. one vouching
 * off the money path); it is **obscure** when its entity id is not in {@link wellKnown}. The set is refused
 * when it carries more than {@link obscureTolerance} obscure referees.
 *
 * It is pure data + a resolver, so the one predicate ({@link refusesStackedVoterSet}) serves both gates
 * that enforce it: promise-time {@link TrxParticipantResource.acceptsProposal} (over a record's
 * `topology.members`) and discovery-time `negotiatePlan` (over a plan's `members`, wired next ticket).
 */
export interface StackedVoterPolicy {
	/** The entities the network recognises (the high-degree hubs; see `wellKnownEntities`). */
	wellKnown: Set<number>
	/**
	 * Resolve a member to its entity id, or `undefined` (treated as obscure). The two gates key members
	 * differently, so the caller supplies the right map: in a **discovery** plan a member's `address.key`
	 * IS its node name (`Number(key)` is the entity id); in a **consensus** record it is the member's
	 * ed25519 key, so the harness's key→entity bijection is needed (supplied by the next ticket's wiring).
	 */
	memberEntity: (member: DependentMember) => number | undefined
	/** How many obscure referees to tolerate before refusing. Default `0` (any obscure referee refuses). */
	obscureTolerance?: number
}

/** A `V`-only member: a voter that is not also a participant — a referee vouching off the money path. */
function isReferee(member: DependentMember): boolean {
	return member.types.includes(MemberTypes.voter) && !member.types.includes(MemberTypes.participant)
}

/** The count of **obscure referees** in `members`: `V`-only members whose entity is not in `policy.wellKnown`. */
export function obscureRefereeCount(members: DependentMember[], policy: StackedVoterPolicy): number {
	let count = 0
	for (const member of members) {
		if (!isReferee(member)) {
			continue
		}
		const entity = policy.memberEntity(member)
		if (entity === undefined || !policy.wellKnown.has(entity)) {
			count++
		}
	}
	return count
}

/**
 * Whether `members` is a **stacked** voter set under `policy`: its obscure-referee count exceeds the
 * tolerated number. `true` ⇒ a payer enforcing this policy refuses the set (signs `NP` at promise time, or
 * drops the plan at discovery time). A lean or well-known set (no more obscure referees than tolerated)
 * returns `false`.
 */
export function refusesStackedVoterSet(members: DependentMember[], policy: StackedVoterPolicy): boolean {
	return obscureRefereeCount(members, policy) > (policy.obscureTolerance ?? 0)
}

/**
 * How one entity's resource port misbehaves. Every flag omitted ⇒ the cooperative default (promise, hold
 * nothing, release, vote commit).
 *
 * - `shouldPromise: false` — the promise gate declines; the node signs `NP` and nothing is ever held.
 * - `promiseThrows: true` — `promise` throws (the engine catches it, signs `NP`); nothing is held.
 * - `shouldCommit: false` — a `V`-role member's vote gate declines; it signs `NC` (void).
 * - `refuseStackedVoters` — install an `acceptsProposal` gate that signs `NP` (voiding the lift) when the
 *   record's voter set is stacked under this {@link StackedVoterPolicy}. Each refusal is counted on the
 *   handle's `voterSetRefusals`, distinct from an ordinary `shouldPromise:false`.
 */
export interface SimResourceSpec {
	shouldPromise?: boolean
	promiseThrows?: boolean
	shouldCommit?: boolean
	refuseStackedVoters?: StackedVoterPolicy
}

/** One entity's resource port plus the observations a test asserts against. */
export interface SimResourceHandle {
	resource: TrxParticipantResource<LiftTerms, unknown>
	/** Contexts seen by `promise` (the hold). Empty ⇒ nothing was ever held (declined or threw). */
	promiseCtxs: ResourceContext<LiftTerms, unknown>[]
	/** The `success` flag of each `release`. `[true]` = committed once; `[false]` = voided once; `[]` = never released. */
	releaseSuccesses: boolean[]
	/** How many times `acceptsProposal` refused a stacked voter set (0 unless `refuseStackedVoters` is set). */
	voterSetRefusals: number
}

/** Build one handle from its spec. `promise` throws (before recording a hold) iff `promiseThrows`. */
function makeSimResource(spec: SimResourceSpec): SimResourceHandle {
	const promiseCtxs: ResourceContext<LiftTerms, unknown>[] = []
	const releaseSuccesses: boolean[] = []
	const resource: TrxParticipantResource<LiftTerms, unknown> = {
		promise: (ctx) => {
			if (spec.promiseThrows) {
				throw new Error('sim resource: promise refused')
			}
			promiseCtxs.push(ctx)
		},
		release: (ctx) => {
			releaseSuccesses.push(ctx.success)
		},
	}
	if (spec.shouldPromise !== undefined) {
		resource.shouldPromise = () => spec.shouldPromise as boolean
	}
	if (spec.shouldCommit !== undefined) {
		resource.shouldCommit = () => spec.shouldCommit as boolean
	}
	const handle: SimResourceHandle = { resource, promiseCtxs, releaseSuccesses, voterSetRefusals: 0 }
	if (spec.refuseStackedVoters) {
		const policy = spec.refuseStackedVoters
		resource.acceptsProposal = (ctx) => {
			// Read the voter set from the record's topology (the gate's authoritative view at promise time).
			if (refusesStackedVoterSet(ctx.record.topology.members, policy)) {
				handle.voterSetRefusals++
				return false // sign NP → the lift voids; the refusal is attributable via voterSetRefusals
			}
			return true
		}
	}
	return handle
}

/**
 * A discovery-time `negotiatePlan` hook that **refuses a stacked voter set** on a found plan: it drops the
 * plan (returns `undefined`) when the plan's `members` are stacked under `policy`, and passes it through
 * otherwise. This is the discovery-time twin of the promise-time `acceptsProposal` gate ({@link
 * SimResourceSpec.refuseStackedVoters}) — both read the one predicate {@link refusesStackedVoterSet} — so a
 * payer can refuse a padded quorum at the earliest point, before ever driving the lift.
 *
 * Wire it per node through {@link ConsensusConfig.negotiatePlanFor}. In a **discovery** plan a member's
 * `address.key` IS its node name, so the policy's `memberEntity` is `(m) => Number(m.address.key)`.
 */
export function refuseStackedPlanHook(policy: StackedVoterPolicy): (plan: Plan<LiftTerms, unknown>) => Plan<LiftTerms, unknown> | undefined {
	return (plan) => (refusesStackedVoterSet(plan.members, policy) ? undefined : plan)
}

/**
 * A `resourceFor(entityId)` port that lazily mints one {@link SimResourceHandle} per entity id (default
 * spec `{}` ⇒ cooperative), plus the `handles` map so a test can read back each node's held contexts and
 * releases. Hand `resourceFor` to {@link buildSimNetwork}'s {@link ConsensusConfig} (which adapts the
 * entity-id key to the harness's node-name key).
 */
export function makeSimResources(specs: Record<number, SimResourceSpec>): {
	resourceFor: (entityId: number) => TrxParticipantResource<LiftTerms, unknown>
	handles: Map<number, SimResourceHandle>
} {
	const handles = new Map<number, SimResourceHandle>()
	const resourceFor = (entityId: number): TrxParticipantResource<LiftTerms, unknown> => {
		let handle = handles.get(entityId)
		if (!handle) {
			handle = makeSimResource(specs[entityId] ?? {})
			handles.set(entityId, handle)
		}
		return handle.resource
	}
	return { resourceFor, handles }
}
