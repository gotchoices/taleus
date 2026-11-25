/**
 * The live-run **worker**: generate a simulated tally network and run the real `tallynet` route-discovery
 * search in the browser, off the main thread, streaming the search's trace envelope back to the page. This
 * is the engine half of the live-run feature; the page half (wiring a `new Worker(...)`, feeding the stream
 * into the replay view, click-to-pick) is the sibling `replay/controls.ts` ticket. Neither a server nor
 * Node is involved: `tallysim`'s core and `tallynet` (incl. `tallynet/testing`, pulled in transitively by
 * {@link buildSimNetwork}) are platform-neutral, so the same engine the CLI records runs here in-page.
 *
 * ── Two phases, one kept network ───────────────────────────────────────────────────────────────────
 *   - `generate` → {@link materializeNetwork} the graph once (expensive) and reply with its snapshot; the
 *     network is **kept** in worker scope so repeated runs reuse it (it is read-only — no balances move in
 *     this tier). The user-visible reuse (rendered graph + settled layout) lives on the main-thread side.
 *   - `run` → build a fresh {@link buildSimNetwork} over the kept network and {@link runQuery} the one
 *     picked payment, streaming the trace envelope. A fresh `buildSimNetwork` per run restarts the
 *     session-code RNG at its fixed seed, so each live run byte-matches a `tallysim trace` single-query
 *     trace of the same seeds — the cleanest reading of "same params + seed ⇒ byte-identical trace". (If a
 *     reviewer later prefers literal one-`InMemoryNetwork`-per-many-queries reuse, swap the per-run
 *     `buildSimNetwork` for a mutable trace-sink indirection into a single long-lived network.)
 *
 * ── Header from the first event (the determinism subtlety) ─────────────────────────────────────────
 * The trace header lists the query's session code, but a session code is minted *inside* `discover()` and
 * is not knowable synchronously. Unlike the Node CLI, the live path never needs a two-pass rerun — it
 * animates the one real run it observes — because every {@link TraceEvent} carries its `sessionCode`. So
 * the sink builds + posts the header on the **first** event (then that event and every later one). If a run
 * emits **no** events (a degenerate run — see below), the header is posted after `runQuery` resolves, using
 * `outcome.sessionCode`, so the page can still build an index.
 *
 * ── Degenerate runs never throw ────────────────────────────────────────────────────────────────────
 * `from === to` (a self-payment / clearing loop) and `< 2 entities` / an edge-less generator produce an
 * empty or circular result and possibly **zero** events; the harness tolerates all of these, so the worker
 * posts a header (from `outcome.sessionCode`), `routes` (the loop's path nonces, or `[]`), and `done`.
 */

import {
	buildSimNetwork,
	makeNetworkSnapshot,
	materializeNetwork,
	runQuery,
	type Network,
	type QuerySpec,
	type SimScenario,
} from 'tallysim'
import type { TraceSink } from 'tallynet'
import { buildRunHeader, plansToRoutes } from './sim-run.js'
import type { MainToWorker, WorkerToMain } from './sim-protocol.js'

/**
 * A minimal typed view of the worker's global scope. The viewer's tsconfig uses `lib: [ES2022, DOM,
 * DOM.Iterable]` and deliberately omits the `WebWorker` lib (it conflicts with DOM), so
 * `DedicatedWorkerGlobalScope` is not in scope. `self`, `MessageEvent` and `postMessage` all come from the
 * DOM lib, so this cast type-checks with no lib change while still typing both message channels.
 */
const ctx = self as unknown as {
	postMessage(message: WorkerToMain): void
	addEventListener(type: 'message', listener: (event: MessageEvent<MainToWorker>) => void): void
}

/** The generated network, kept across runs (read-only this tier). `undefined` until the first `generate`. */
let network: Network | undefined
/** The run seed the network was materialised at (stamped into the header). The live path always uses 0. */
let runSeed = 0

/** The message of a `TraceEvent`-less failure, flattened so `postMessage` carries a plain string. */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** Build and post the run's header for `sessionCode` (the minted code the events/outcome carry). */
function postHeader(scenario: SimScenario, sessionCode: string, query: QuerySpec): void {
	ctx.postMessage({ type: 'header', header: buildRunHeader(scenario, runSeed, sessionCode, query) })
}

/** Phase 1: materialise the network, keep it, and reply with the snapshot the page draws. */
function handleGenerate(message: Extract<MainToWorker, { type: 'generate' }>): void {
	try {
		runSeed = message.runSeed
		network = materializeNetwork(message.scenario.network, message.runSeed)
		ctx.postMessage({ type: 'network', snapshot: makeNetworkSnapshot(network) })
	} catch (error) {
		ctx.postMessage({ type: 'error', phase: 'generate', message: errorMessage(error) })
	}
}

/** Phase 2: run the one picked query over the kept network, streaming the trace envelope and the routes. */
async function handleRun(message: Extract<MainToWorker, { type: 'run' }>): Promise<void> {
	const { scenario, query } = message
	try {
		if (network === undefined) {
			throw new Error('sim-worker: received "run" before "generate" (no network materialised yet)')
		}
		// The sink mints the header lazily: the session code is only known once the first event carries it.
		let headerPosted = false
		const sink: TraceSink = (event) => {
			if (!headerPosted) {
				postHeader(scenario, event.sessionCode, query)
				headerPosted = true
			}
			ctx.postMessage({ type: 'event', event })
		}

		const conditions = scenario.conditions ?? {}
		const conditionsSeed = scenario.conditionsSeed ?? 0
		const sim = buildSimNetwork(network, conditions, conditionsSeed, sink, scenario.budget)
		const outcome = await runQuery(sim, query)

		// A zero-event run (e.g. < 2 entities, or an edge-less network) never fires the sink; mint the header
		// from the outcome's session code so the page can still build an index.
		if (!headerPosted) {
			postHeader(scenario, outcome.sessionCode, query)
		}

		// Each found plan's path lights the full found-routes list (see plansToRoutes): ordered link nonces for
		// exact-path isolate-on-select, plus the opaque per-hop terms. A self-payment's closed loop rides here too.
		const routes = plansToRoutes(outcome.plans, query.from, query.to)
		ctx.postMessage({ type: 'done', sessionCode: outcome.sessionCode, found: outcome.found, routes })
	} catch (error) {
		ctx.postMessage({ type: 'error', phase: 'run', message: errorMessage(error) })
	}
}

ctx.addEventListener('message', (event) => {
	const message = event.data
	switch (message.type) {
		case 'generate': {
			handleGenerate(message)
			break
		}
		case 'run': {
			// handleRun swallows its own errors into an `error` message, so the promise never rejects.
			void handleRun(message)
			break
		}
	}
})
