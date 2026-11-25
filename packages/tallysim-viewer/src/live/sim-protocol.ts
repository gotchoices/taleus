/**
 * The message contract between the live-run **worker** (`sim-worker.ts`, which generates the network and
 * drives the real `tallynet` discovery search off the main thread) and the **controls** on the page
 * (`replay/controls.ts`, the sibling ticket, which feeds the stream into the replay view). It is a
 * **type-only** module so both sides share one source of truth for the shapes that cross `postMessage` —
 * there is no runtime code here, nothing to bundle into either side.
 *
 * ── The two phases ─────────────────────────────────────────────────────────────────────────────────
 * The main thread drives two steps, because generation (a settled graph + layout, expensive, user-visible)
 * happens once and then many queries can run against it:
 *   1. `generate` — materialise the network; the worker replies `network` (the snapshot the page draws).
 *   2. `run` — search one picked payment; the worker streams `header`, then one `event` per trace event,
 *      then a single `done` carrying the found routes (with their exact paths — see below).
 * Either step may reply `error` instead; the controls surface it rather than hang.
 *
 * NOTE: the contract is **one run at a time** — these messages carry no run-correlation id, so the controls
 * must await a run's `done`/`error` before issuing the next `run` (overlapping runs would interleave two
 * `header`/`event`/`done` streams indistinguishably). The `run` message also re-supplies the full `scenario`
 * for the header; it must be the **same** scenario the preceding `generate` built the kept network from, or
 * the header's provenance would not match the network the page drew. If the controls ever need concurrent
 * runs, add a session/run id to every `run`/`header`/`event`/`done`/`error`.
 *
 * ── Why `done` carries full `RouteInput`s ──────────────────────────────────────────────────────────
 * A recorded trace file cannot reconstruct a found route's ordered path (`plan-found` is path-less; see
 * `replay/routes.ts`). The live path *drives* the search, so it holds each plan's `QueryOutcome.plans[i]`
 * directly — link nonces and the per-hop negotiated terms. Passing those as {@link RouteInput}s is how the
 * live source lights up the full found-routes list (with exact-path isolate-on-select) that a loaded trace
 * cannot. `Infinity` in the terms (an unlimited `capFwd`/`capBack`) survives structured clone unchanged.
 */

import type { TraceEvent } from 'tallynet'
import type { QuerySpec, SimScenario, TraceHeader, TraceNetworkSnapshot } from 'tallysim'
import type { RouteInput } from '../replay/routes.js'

/** A message the page sends into the worker. */
export type MainToWorker =
	/** Materialise `scenario.network` at `runSeed` and reply with its {@link TraceNetworkSnapshot}. */
	| { type: 'generate'; scenario: SimScenario; runSeed: number }
	/** Run the one picked `query` against the already-generated network, streaming the trace envelope back. */
	| { type: 'run'; scenario: SimScenario; query: QuerySpec }

/** A message the worker sends back to the page. */
export type WorkerToMain =
	/** The generated network (reply to `generate`); the page draws it and holds it until the header arrives. */
	| { type: 'network'; snapshot: TraceNetworkSnapshot }
	/** The run's header (first thing on a `run`, before any event); the page builds the trace index from it. */
	| { type: 'header'; header: TraceHeader }
	/** One trace event, in emission (= time) order. */
	| { type: 'event'; event: TraceEvent }
	/** The run finished: the minted session code, whether a route was found, and the found routes' exact paths. */
	| { type: 'done'; sessionCode: string; found: boolean; routes: RouteInput[] }
	/** A failure in the named phase; the controls surface `message` instead of hanging. */
	| { type: 'error'; phase: 'generate' | 'run'; message: string }
