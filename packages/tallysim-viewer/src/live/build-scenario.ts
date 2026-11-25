/**
 * The pure, headless bridge from the live-run **form values** to the `tallysim` run description — a
 * {@link SimScenario} (what to generate and under which conditions/budget) plus a {@link QuerySpec} (the one
 * payment to search). Keeping this translation sigma-free and DOM-free is the whole point: the worker, the
 * `postMessage` streaming and the click-to-pick are browser-only, but *this* — the shape of the scenario the
 * engine runs — is unit-tested with no browser (see `build-scenario.test.ts`).
 *
 * ── Why a nominal workload ──────────────────────────────────────────────────────────────────────────
 * A trace header embeds the full {@link SimScenario} for provenance, and a {@link SimScenario} always carries a
 * {@link WorkloadSpec}. But the live path does **not** draw a random query from that workload — it runs the one
 * explicit `from → to` the developer clicked. So the workload here is *nominal* (one `payment` query, the chosen
 * amount/depth): it makes the header a valid, self-describing scenario without being the source of the query.
 * The actual query the run animates is the separate {@link QuerySpec} (its `from`/`to` are the picked nodes),
 * recorded in the header's per-query entry — which is what the replay reads. See the file-source reload path:
 * it replays the *recorded events*, it never re-executes the workload, so the nominal workload never misleads.
 *
 * ── Seeding ─────────────────────────────────────────────────────────────────────────────────────────
 * The run seed is fixed at {@link DEFAULT_RUN_SEED} (0) and the developer's seed lives in the network source, so
 * `materializeNetwork` generates from `seed + 0 = seed` — the network is a pure function of the chosen generator
 * params + seed, the determinism the ticket's "same params + seed ⇒ byte-identical network" guarantee rests on.
 */

import {
	CLUSTERED_ID,
	SCALE_FREE_ID,
	SMALL_WORLD_ID,
	UNIFORM_ID,
	type CapacityDistribution,
	type ConditionsSpec,
	type NetworkSource,
	type QuerySpec,
	type SimScenario,
	type WorkloadSpec,
} from 'tallysim'

/** The four generators the live-run form offers, by their stable `tallysim` ids. */
export type GeneratorId = 'uniform' | 'scale-free' | 'clustered' | 'small-world'

/** The discovery time budget the form may set (maps straight onto the originator's budget options). */
export interface BudgetParams {
	initialBudgetMs?: number
	perHopBudgetMs?: number
}

/**
 * The live-run form's values, as the controls read them out of the DOM. `generatorParams` carries only the
 * generator-specific numeric params (e.g. `edgesPerNode` for scale-free) — **not** `entityCount` (shared) and
 * **not** the capacity (an object, carried separately). `from`/`to` are the click-picked payer/payee and are
 * absent until both are chosen (so {@link buildScenario} works before a query is runnable).
 */
export interface LiveRunParams {
	generator: GeneratorId
	/** Number of entities (nodes). Shared across generators. */
	entityCount: number
	/** Generator-specific numeric params only (not `entityCount`, not `capacity`). */
	generatorParams: Record<string, number>
	/** The capacity/balance distribution every tally is drawn from (`{ kind: 'unlimited' }` for the ∞ case). */
	capacity: CapacityDistribution
	/** The network generation seed (lives in the network source; the run seed is fixed at 0). */
	seed: number
	/** Optional network conditions (latency / drop / sleeping / late). Omitted ⇒ an ideal network. */
	conditions?: ConditionsSpec
	/** Seed for the conditions stream (independent of the network seed). */
	conditionsSeed?: number
	/** Optional discovery time budget. */
	budget?: BudgetParams
	/** The amount the query asks to move. */
	amount: number
	/** The query's hop-depth bound. */
	depth: number
	/** The picked payer entity id (click-to-pick); absent until chosen. */
	from?: number
	/** The picked payee entity id (click-to-pick); absent until chosen. `from === to` is a valid self-payment. */
	to?: number
}

/** The run seed the live path always uses (the developer's seed lives in the network source). */
export const DEFAULT_RUN_SEED = 0

/** Map a form {@link GeneratorId} to the canonical `tallysim` generator id constant (kept in lock-step). */
export function generatorIdOf(id: GeneratorId): string {
	switch (id) {
		case 'uniform': {
			return UNIFORM_ID
		}
		case 'scale-free': {
			return SCALE_FREE_ID
		}
		case 'clustered': {
			return CLUSTERED_ID
		}
		case 'small-world': {
			return SMALL_WORLD_ID
		}
	}
}

/**
 * Build the {@link NetworkSource} (generator recipe) from the form. `params` folds `entityCount` in with the
 * generator-specific numeric params, matching `materializeNetwork`'s spread of `{ ...params, capacity, seed }`
 * into the generator's param type.
 */
export function buildNetworkSource(params: LiveRunParams): NetworkSource {
	return {
		generator: generatorIdOf(params.generator),
		params: { entityCount: params.entityCount, ...params.generatorParams },
		capacity: params.capacity,
		seed: params.seed,
	}
}

/** Build the nominal single-query payment {@link WorkloadSpec} (see the module header on why it is nominal). */
export function buildWorkload(params: LiveRunParams): WorkloadSpec {
	return {
		kind: 'payment',
		queries: 1,
		amount: { dist: 'constant', params: { value: params.amount } },
		depth: params.depth,
		seed: 0,
	}
}

/**
 * Build the full {@link SimScenario} (network source + nominal workload + optional conditions/budget) — the
 * provenance the trace header embeds. Independent of `from`/`to`, so the controls can build it as soon as the
 * network params are set (generation needs only this), before a query is picked.
 */
export function buildScenario(params: LiveRunParams): SimScenario {
	const scenario: SimScenario = {
		network: buildNetworkSource(params),
		workload: buildWorkload(params),
	}
	if (params.conditions !== undefined) {
		scenario.conditions = params.conditions
	}
	if (params.conditionsSeed !== undefined) {
		scenario.conditionsSeed = params.conditionsSeed
	}
	if (params.budget !== undefined) {
		scenario.budget = params.budget
	}
	return scenario
}

/**
 * Build the {@link QuerySpec} for the one payment to search. Throws when a payer/payee has not been picked — a
 * guard, since the controls only enable Run once both are set; `from === to` is allowed (a self-payment /
 * clearing-style closed loop).
 */
export function buildQuery(params: LiveRunParams): QuerySpec {
	if (params.from === undefined || params.to === undefined) {
		throw new Error('buildQuery: pick a payer and a payee (click two nodes) before running')
	}
	return { from: params.from, to: params.to, amount: params.amount, depth: params.depth }
}

/** The full live run: the scenario, the query, and the fixed run seed. */
export interface LiveRun {
	scenario: SimScenario
	query: QuerySpec
	runSeed: number
}

/** Build both halves of a runnable live run at once (the controls call this on Run). */
export function buildLiveRun(params: LiveRunParams): LiveRun {
	return { scenario: buildScenario(params), query: buildQuery(params), runSeed: DEFAULT_RUN_SEED }
}
