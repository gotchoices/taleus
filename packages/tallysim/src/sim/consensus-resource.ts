/**
 * Failure-injecting consensus resource ports for the simulator, keyed by **entity id** (the sim's native
 * node identity, not the `tallynet` node name). The cooperative default — a holder that promises, releases
 * and votes commit while holding nothing real — already lives in the harness (`cooperativeResource`, used
 * when no `resourceFor` is passed). This module supplies the *refusers* a behavioural test needs: a node
 * that declines to promise, one whose `promise` throws, or a referee that votes no-commit.
 *
 * It mirrors the resource doubles in `tallynet`'s `consensus.test.ts`: each handle records the contexts its
 * `promise` saw and the `success` flag of each `release`, so a test reads back exactly what each node held
 * and how it settled (`releaseSuccesses` is `[true]` = committed once, `[false]` = voided once, `[]` = never
 * released). The map is keyed by entity id so a test specifies failures in the sim's own id space;
 * {@link buildSimNetwork}'s consensus wiring adapts entity-id → node-name at the harness boundary.
 */

import type { ResourceContext, TrxParticipantResource } from 'tallynet'
import type { LiftTerms } from './terms.js'

/**
 * How one entity's resource port misbehaves. Every flag omitted ⇒ the cooperative default (promise, hold
 * nothing, release, vote commit).
 *
 * - `shouldPromise: false` — the promise gate declines; the node signs `NP` and nothing is ever held.
 * - `promiseThrows: true` — `promise` throws (the engine catches it, signs `NP`); nothing is held.
 * - `shouldCommit: false` — an `R`-role member's vote gate declines; it signs `NC` (void).
 */
export interface SimResourceSpec {
	shouldPromise?: boolean
	promiseThrows?: boolean
	shouldCommit?: boolean
}

/** One entity's resource port plus the observations a test asserts against. */
export interface SimResourceHandle {
	resource: TrxParticipantResource<LiftTerms, unknown>
	/** Contexts seen by `promise` (the hold). Empty ⇒ nothing was ever held (declined or threw). */
	promiseCtxs: ResourceContext<LiftTerms, unknown>[]
	/** The `success` flag of each `release`. `[true]` = committed once; `[false]` = voided once; `[]` = never released. */
	releaseSuccesses: boolean[]
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
	return { resource, promiseCtxs, releaseSuccesses }
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
