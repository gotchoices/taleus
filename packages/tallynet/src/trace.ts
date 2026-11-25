/**
 * The trace port. An optional {@link TraceSink} receives a typed {@link TraceEvent} at every step of
 * discovery and consensus, so a simulator can record a run and a viewer can animate a query
 * spreading through the graph. The default sink is a no-op; a host opts in by injecting one.
 *
 * **Tracing is local instrumentation and adds no disclosure.** Every event holds only what the
 * emitting node already knows: its own id, a nonce it already holds, the session code, and a
 * depth/round counter. It never carries a peer's link id, a neighbour's identity, or anything a
 * node would not otherwise have. The discovery and consensus engines must honour this invariant --
 * if an event would need a neighbour's secret to populate, it does not belong here.
 *
 * **Tracing must never change engine behaviour.** A sink that throws is caught, logged once, and
 * swallowed (see {@link safeTraceSink}); the engine always calls the *wrapped* sink.
 *
 * Note: {@link PruneReason} here is the discovery-prune enum. It is **distinct** from
 * `taleus-core`'s accumulator `PruneReason` (`missing-quote` / `zero-capacity` /
 * `insufficient-capacity`); the two live in different packages and never meet.
 */

/** The narrow `console` slice this module logs through; every target has it. */
declare const console: { error(...args: unknown[]): void }

/** Common envelope on every trace event: the clock time, the emitting node's own id, the session. */
export interface TraceBase {
	time: number
	/** The emitting node's id exactly as the host gave it to the engine. */
	nodeId: string
	sessionCode: string
}

/** Why a discovery candidate was dropped rather than pursued. */
export type PruneReason =
	| 'cycle'          // candidate nonce already in the path
	| 'failed'         // sub-query errored or returned nothing usable
	| 'timed-out'      // no answer inside the round budget
	| 'max-depth'      // would exceed maxDepth
	| 'expired'        // session code expired / too little life left
	| 'no-reentrance'  // candidate returned no reentrance ticket and no plan

export type TraceEvent =
	| (TraceBase & { type: 'query-sent';           nonce: string; depth: number; round: number })
	| (TraceBase & { type: 'query-received';       nonce: string; depth: number; round: number })
	| (TraceBase & { type: 'candidate-pruned';     nonce: string; reason: PruneReason })
	| (TraceBase & { type: 'plan-returned';        nonce: string })
	| (TraceBase & { type: 'plan-found' })
	| (TraceBase & { type: 'round-started';        round: number; budgetMs: number })
	| (TraceBase & { type: 'round-budget-expired'; round: number })
	| (TraceBase & { type: 'late-answer-folded';   nonce: string; round: number })

/** A trace sink receives every event. Default is a no-op. A throwing sink must never break the engine. */
export type TraceSink = (event: TraceEvent) => void

/** The no-op sink (default when the host injects none). */
export const noopTraceSink: TraceSink = () => {}

/**
 * Wrap a sink so a throw is caught, logged **once per sink**, and swallowed -- tracing is
 * instrumentation and must never change engine behaviour. The engine calls the wrapped sink.
 *
 * The first throw from a given wrapped sink is logged; every subsequent throw from that same sink
 * is swallowed silently, so a persistently broken sink cannot flood the log.
 */
export function safeTraceSink(sink: TraceSink): TraceSink {
	let logged = false
	return (event) => {
		try {
			sink(event)
		} catch (error) {
			if (!logged) {
				logged = true
				console.error('[tallynet] trace sink threw; further errors from this sink are swallowed', error)
			}
		}
	}
}
