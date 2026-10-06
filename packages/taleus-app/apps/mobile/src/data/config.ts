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
 *   The engine over this phone's own cadre node (`engine-cadre.ts`): each tally a
 *   strand shared with the counterparty, kept across restarts.
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
export const USE_CADRE = true

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

/**
 * Relays a Mode C phone reserves on when it starts as a new party: what makes it reachable, so
 * that an invitation it issues can be redeemed. Empty here; set one for a device run (for two
 * emulators, a relay on the host machine at `10.0.2.2`). A phone that has started before uses
 * the relays it saved.
 */
const CADRE_RELAYS: string[] = ["/dns4/relay.sereus.org/tcp/4011/ws/p2p/12D3KooWMD7E7UH4rkCqiFE69n7FNqrKo1Xx3yDUU8JvwtaH39bD"]

/** Mode B (`engine.ts`) or Mode C (`engine-cadre.ts`), each loaded only when chosen. */
async function startEngine(): Promise<TaleusModel> {
	if (USE_CADRE) {
		const { startCadreEngine } = await import('./engine-cadre')
		return startCadreEngine(CADRE_RELAYS)
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
