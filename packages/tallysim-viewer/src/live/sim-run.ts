/**
 * The pure, DOM-free core of the live-run worker: the two bits of per-`run` logic worth testing without a
 * headless browser — minting the trace {@link TraceHeader} for a known session code, and mapping the
 * originator's found {@link QueryOutcome.plans} to the viewer's {@link RouteInput}s. The worker
 * (`sim-worker.ts`) is browser-only (it owns `self`/`postMessage`); keeping these two functions here, with no
 * worker or DOM reference, lets jest cover them directly (see `sim-run.test.ts`).
 */

import { buildTraceHeader, type QueryOutcome, type QuerySpec, type SimScenario, type TraceHeader } from 'tallysim'
import type { RouteInput } from '../replay/routes.js'

/**
 * The viewer's bundled provenance version strings, stamped into the trace header's `tallysimVersion` /
 * `tallynetVersion`.
 *
 * NOTE: these are provenance only — `parseTrace` validates the `traceFormatVersion` envelope and never these
 * two — so they record which viewer build produced the live run, not a contract. Bump them with the viewer's
 * bundled `tallysim`/`tallynet` versions if that provenance is ever wanted exact.
 */
export const VIEWER_VERSIONS = { tallysimVersion: '0.1.0', tallynetVersion: '0.1.0' }

/**
 * Build the run's {@link TraceHeader} for a minted `sessionCode`. The header embeds the full `scenario`
 * (provenance), the `runSeed`, and a single query entry `{ sessionCode, ...query }` — the same shape the Node
 * CLI's two-pass recorder stamps, so a single-query live run's header matches a `tallysim trace` of the same
 * seeds byte-for-byte.
 */
export function buildRunHeader(
	scenario: SimScenario,
	runSeed: number,
	sessionCode: string,
	query: QuerySpec,
): TraceHeader {
	return buildTraceHeader({ ...VIEWER_VERSIONS, scenario, runSeed, queries: [{ sessionCode, ...query }] })
}

/**
 * Map the originator's found plans to the full-path {@link RouteInput}s the found-routes list lights up. Each
 * plan's ordered link nonces drive exact-path isolate-on-select, and the per-hop negotiated `intents` ride
 * along as opaque `terms` (both index-aligned to `plan.path`). A self-payment's closed loop rides here too —
 * its path nonces draw the loop. Empty plans ⇒ an empty list (a not-found or degenerate run).
 */
export function plansToRoutes(plans: QueryOutcome['plans'], from: number, to: number): RouteInput[] {
	return plans.map((plan) => ({
		from,
		to,
		linkNonces: plan.path.map((link) => link.nonce),
		terms: plan.path.map((link) => link.intents),
	}))
}
