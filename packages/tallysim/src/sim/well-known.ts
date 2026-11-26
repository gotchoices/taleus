/**
 * Who the network **recognises**, derived purely from structure — the first input the simulator's
 * voter-model policy needs. A payer that prefers (or demands) well-known voters first has to be able to
 * say which nodes are well-known; this module answers that, plus builds the referee nominations a run
 * wires onto the discovery harness.
 *
 * ── "Well-known" = high-degree hub (a deliberate choice) ───────────────────────────────────────────
 * There is no "well-known" flag in the {@link Network} model, and we do not add one: baking a flag into
 * the model would ripple through serialisation and perturb the pinned, byte-identical discovery sweep.
 * Instead "well-known" is **measured from the graph**: the highest-degree nodes are the ones the rest of
 * the network is most likely to recognise, so {@link wellKnownEntities} returns the top fraction of
 * entities by degree. This keeps the model untouched, stays fully deterministic (ties broken by lower
 * id), and makes "trusted voter" an observable property (a hub) rather than an injected label. If an
 * experiment ever needs *explicit* marking, that is a separate model change.
 *
 * Both pieces here are **pure** (network + fraction/policy in, data out) with no clock, network, or
 * harness wiring — that wiring (entity-id → node-name adaptation, handing the result to the harness) is
 * the next ticket's job.
 */

import type { RefereeNomination } from 'tallynet/testing'
import type { Network } from '../model.js'
import { degreeSequence } from '../structure.js'
import { entityName } from './naming.js'

/**
 * The `round(fraction · entityCount)` highest-degree entities, as a `Set` of entity ids. Degree is the
 * count of incident tally endpoints ({@link degreeSequence}); ties are broken by **lower id**, so the
 * set is deterministic for a given network. `fraction ≤ 0` (or a network with no entities) ⇒ the empty
 * set; `fraction ≥ 1` ⇒ every entity. The count is rounded (`round`, not floor/ceil), so e.g. a
 * fraction of `0.4` over `5` entities marks exactly the top `2`.
 */
export function wellKnownEntities(network: Network, fraction: number): Set<number> {
	const count = Math.round(fraction * network.entityCount)
	if (count <= 0) {
		return new Set()
	}
	const degrees = degreeSequence(network)
	const ranked = degrees.map((degree, id) => ({ degree, id }))
	// Highest degree first; a degree tie keeps the lower id first (stable, id-ordered tiebreak).
	ranked.sort((a, b) => b.degree - a.degree || a.id - b.id)
	return new Set(ranked.slice(0, count).map((entry) => entry.id))
}

/** The highest-degree entity among `candidates` (ties → lowest id), or `undefined` when the set is empty. */
function highestDegreeEntity(network: Network, candidates: Set<number>): number | undefined {
	if (candidates.size === 0) {
		return undefined
	}
	const degrees = degreeSequence(network)
	// Iterate ids ascending so a strict `>` keeps the lowest id on a degree tie (Set order is insertion,
	// not sorted, so it cannot be relied on for the tiebreak).
	const ids = [...candidates].sort((a, b) => a - b)
	let best = ids[0]
	for (const id of ids) {
		if ((degrees[id] ?? 0) > (degrees[best] ?? 0)) {
			best = id
		}
	}
	return best
}

/**
 * Which voter a participant nominates as a referee:
 *
 * - `self` — the participant nominates **itself** as a voter (the voter-set-of-one default: each node on
 *   the route votes for its own leg).
 * - `well-known` — every participant nominates the one **most well-known hub** in `wellKnown` (highest
 *   degree, ties → lowest id): a single trusted third-party voter the whole route recognises.
 */
export type NominationPolicy = 'self' | 'well-known'

/**
 * Build the `nomineesFor(entityId) => RefereeNomination[]` function a run hands the harness (the next
 * ticket adapts the entity-id key to the harness's node-name key). The output is `tallynet`'s
 * {@link RefereeNomination} shape, keyed by node **name** (`entityName(id)`), so a nominee folds into a
 * discovered plan as a `V` member exactly as a real participant nominating a referee would. Pure: it reads
 * only `network` (for the `well-known` hub) and `wellKnown`, and returns a fresh array per call.
 *
 * - `self` ⇒ `(id) => [{ name: entityName(id) }]`.
 * - `well-known` ⇒ every id nominates the one hub {@link highestDegreeEntity} picks from `wellKnown`;
 *   when `wellKnown` is empty there is no hub to name, so every id nominates **nobody** (`[]`).
 *
 * `physical` is left to the harness default (a nominee gets a dial address so its vote can return), which
 * a `well-known` referee off the money path needs.
 */
export function makeNomineesFor(
	network: Network,
	wellKnown: Set<number>,
	policy: NominationPolicy,
): (entityId: number) => RefereeNomination[] {
	// NOTE: the harness folds a nominee as a SEPARATE voter-only (`[V]`) member (prependMatch) and only
	// de-duplicates against members already on the plan. Nominating a node that is ALSO on the money path
	// therefore does not upgrade it to `[P,V]`: `self` nominates the node itself, which at its own prepend
	// is not yet present, so it is added twice (`[P]` + `[V]`, same key) → tallynet's NoDuplicateMembers
	// rule rejects the record and the lift never forms; `well-known` nominates a high-degree hub that is
	// frequently an on-path participant, so its vote is silently dropped (stays `[P]`). Both are fine ONLY
	// when the nominee is OFF the route. When the harness-drive ticket wires these, the voter-set model must
	// mark participants `[P,V]` directly rather than route on-path votes through referee nomination — see
	// tickets/backlog/debt-voter-nomination-on-path-composition.md.
	switch (policy) {
		case 'self': {
			return (id) => [{ name: entityName(id) }]
		}
		case 'well-known': {
			const hub = highestDegreeEntity(network, wellKnown)
			return hub === undefined ? () => [] : (_id) => [{ name: entityName(hub) }]
		}
		default: {
			// Exhaustiveness guard: a new NominationPolicy value must add its own case here.
			throw new Error(`makeNomineesFor: unknown nomination policy ${String(policy)}`)
		}
	}
}
