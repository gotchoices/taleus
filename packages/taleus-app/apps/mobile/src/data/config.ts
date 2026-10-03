/**
 * Data layer switches — the one place that decides where tally state comes from.
 *
 * Mode A — mock (USE_ENGINE = false)
 *   Adapters read `mock/data/<namespace>.<variant>.json`. No engine, no storage,
 *   no network. This is what design and scenario capture run against.
 *
 * Mode B — engine on a local store (USE_ENGINE = true, USE_CADRE = false)
 *   The taleus engine over a local database: one device, no peers.
 *
 * Mode C — engine in a cadre (USE_ENGINE = true, USE_CADRE = true)
 *   The engine over the embedded cadre node: real strands, peers, lifts.
 *
 * Screens and components check neither of these. They call the adapters in
 * `src/data/`, which forward to one `TaleusModel` (package `taleus-model`), and
 * this file is the only code that chooses it. See
 * `design/specs/domain/interfaces.md` § Run modes.
 */
import { createMockModel, onWorldChanged, type MockControls, type TaleusModel } from 'taleus-model'

import { fixtureSource } from './fixtures'
import { bumpGeneration } from './generation'

export const USE_ENGINE = true
export const USE_CADRE = false

/** True when adapters should serve fixtures rather than engine state. */
export const mockMode = !USE_ENGINE

const mock = createMockModel(fixtureSource)

// The model says when everything read so far is out of date (a new mock variant,
// an act by the other party); the app's answer is to have every screen read again.
onWorldChanged(bumpGeneration)

let active: TaleusModel | undefined = USE_ENGINE ? undefined : mock.model
let starting: Promise<void> | undefined

/** Whether `getModel` can answer yet. Mock mode always can, so it never waits. */
export function modelStarted(): boolean {
	return active !== undefined
}

/**
 * Bring the model up. The app waits on this once, before anything reads; it is
 * idempotent, and a no-op in mock mode.
 */
export function startModel(): Promise<void> {
	starting ??= active
		? Promise.resolve()
		: startEngine().then(model => {
				active = model
			})
	return starting
}

/** Mode B, loaded on demand (see `engine.ts`); Mode C is not built yet. */
async function startEngine(): Promise<TaleusModel> {
	if (USE_CADRE) {
		throw new Error('Mode C (engine in a cadre) is not built yet -- see tickets/backlog/feat-engine-run-modes.md')
	}
	const { startLocalEngine } = await import('./engine')
	return startLocalEngine()
}

/** The model every adapter answers from, chosen here and nowhere else. */
export function getModel(): TaleusModel {
	if (!active) throw new Error('the Taleus model is not started -- the app waits on startModel() before reading')
	return active
}

/** The mock model's controls: the variant, and resets for tests. */
export function mockControls(): MockControls {
	return mock.controls
}
