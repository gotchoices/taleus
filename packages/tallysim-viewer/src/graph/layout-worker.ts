/**
 * The Web-Worker boundary for the force-directed layout. ForceAtlas2 is O(n²) (or O(n log n) with
 * Barnes–Hut) per iteration and must not run on the main thread, or a large graph would freeze pan/zoom while
 * it settles. `graphology-layout-forceatlas2/worker` spawns a dedicated worker, runs the iterations there, and
 * streams node positions back onto the graph in place — sigma, bound to the same graph, re-renders as they
 * arrive. This module is the thin, browser-only wrapper the orchestrator in `layout.ts` drives; the seeding
 * and settle policy live there so they stay testable without a worker.
 *
 * ── Interop note ───────────────────────────────────────────────────────────────────────────────────
 * `graphology-layout-forceatlas2` is a CommonJS package whose `/worker` entry does `module.exports = Class`
 * but ships a `.d.ts` typed as `export default class`. Under `NodeNext` TypeScript therefore does not see the
 * default import as constructable, so we import it and re-type it against a locally-declared supervisor
 * interface. At runtime (esbuild/Vite interop) the default import is the class, so `new` works.
 */

import FA2Default from 'graphology-layout-forceatlas2/worker.js'
import { inferSettings, type ForceAtlas2Settings } from 'graphology-layout-forceatlas2'
import type { TallyGraph } from './model.js'

/** The subset of `FA2LayoutSupervisor` we use. */
interface Fa2Supervisor {
	isRunning(): boolean
	start(): void
	stop(): void
	kill(): void
}

/** Constructor shape for the supervisor (see the interop note above). */
type Fa2SupervisorCtor = new (graph: TallyGraph, params?: { settings?: ForceAtlas2Settings }) => Fa2Supervisor

const FA2LayoutSupervisor = FA2Default as unknown as Fa2SupervisorCtor

/** A running layout worker: stop it when the graph has settled or the view is torn down. */
export interface LayoutWorkerHandle {
	/** Is the worker still iterating? */
	isRunning(): boolean
	/** Pause iteration (positions keep their last value); safe to call more than once. */
	stop(): void
	/** Stop and release the worker thread. Call on teardown. */
	kill(): void
}

/**
 * Start ForceAtlas2 in a worker over `graph`, writing positions back onto it as they are computed. Settings
 * default to `inferSettings(graph)` (graphology's size-scaled defaults) and can be overridden. The caller
 * ({@link import('./layout.js')}) decides when to {@link LayoutWorkerHandle.stop} it.
 */
export function startLayoutWorker(graph: TallyGraph, overrides: Partial<ForceAtlas2Settings> = {}): LayoutWorkerHandle {
	const settings: ForceAtlas2Settings = { ...inferSettings(graph), ...overrides }
	const supervisor = new FA2LayoutSupervisor(graph, { settings })
	supervisor.start()
	return {
		isRunning: () => supervisor.isRunning(),
		stop: () => supervisor.stop(),
		kill: () => supervisor.kill(),
	}
}
