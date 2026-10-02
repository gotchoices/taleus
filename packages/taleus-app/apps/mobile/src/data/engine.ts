/**
 * Engine mode's start: the only module that imports the engine. `config.ts`
 * loads it on demand, so mock mode -- and every test -- never evaluates
 * taleus-core or Quereus. It lives in the app (not a direct dynamic import of
 * `taleus-model/engine`) because Metro serves a lazily loaded module at a URL
 * under the project root, and the model package is outside it.
 */
import { createLocalWorld } from 'taleus-model/engine'
import type { TaleusModel } from 'taleus-model'

/**
 * Mode B: this party and a simulated counterparty, who takes up every
 * invitation, on one in-memory fabric. Nothing persists yet: each launch is a
 * first run.
 */
export async function startLocalEngine(): Promise<TaleusModel> {
	const world = await createLocalWorld({ takeUpInvitations: true })
	return world.me.model
}
