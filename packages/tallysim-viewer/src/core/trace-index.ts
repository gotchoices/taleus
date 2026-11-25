/**
 * Load a recorded run (a `tallysim` NDJSON trace) and index it for playback. This wraps `tallysim`'s
 * {@link parseTrace} — it never re-implements NDJSON parsing — and turns the flat event stream into the
 * per-session, time-ordered view the playback tickets drive.
 *
 * ── What the index gives you ───────────────────────────────────────────────────────────────────────
 *   - the run `header` (its `queries[]` names every session and its `{from, to, amount, depth}`) and the
 *     rebuilt `network`;
 *   - the full event stream in time order, and the events for one `sessionCode` in time order;
 *   - the global min/max event `time` (the playback clock's bounds), or `undefined` when there are no events.
 *
 * ── Version rejection is parseTrace's job ──────────────────────────────────────────────────────────
 * {@link parseTrace} checks `traceFormatVersion` and throws a message naming the found vs. supported
 * version. {@link indexTrace} does not catch it — the clear message propagates unchanged.
 *
 * ── Incremental-friendly ───────────────────────────────────────────────────────────────────────────
 * The live-run ticket streams events as they are produced, so the index is built by a {@link TraceIndexBuilder}
 * that accepts events in chunks. {@link indexTrace} is the whole-file convenience that feeds a builder from
 * {@link parseTrace}. Events are stored in arrival order, which for a well-formed trace is emission (= time)
 * order (the trace writer emits in `(time, seq)` order); the min/max bounds are tracked by comparison, so
 * they stay correct even if a caller feeds events out of order.
 */

import { parseTrace, type Network, type TraceHeader, type TraceQueryEntry } from 'tallysim'
import type { TraceEvent } from 'tallynet'

/** The read surface a built index exposes; the playback modules depend only on this. */
export interface TraceIndex {
	readonly header: TraceHeader
	readonly network: Network
	/** Every session the header declares, in header order. */
	sessions(): readonly TraceQueryEntry[]
	/** The header entry for one session, or `undefined` if the code is not in the header. */
	queryFor(sessionCode: string): TraceQueryEntry | undefined
	/** Events for one session in time order; empty (never `undefined`) for a session with no events. */
	eventsForSession(sessionCode: string): readonly TraceEvent[]
	/** Every event across every session, in time order. */
	allEvents(): readonly TraceEvent[]
	/** The min/max event `time` (playback bounds), or `undefined` when the trace has no events. */
	timeBounds(): { min: number; max: number } | undefined
}

/** A {@link TraceIndex} that also accepts events incrementally (the live-run streaming case). */
export interface TraceIndexBuilder extends TraceIndex {
	/** Append one event, updating the per-session buckets and the time bounds in place. */
	add(event: TraceEvent): void
	/** Append many events in one call. */
	addAll(events: Iterable<TraceEvent>): void
}

/**
 * Create an empty builder over a known `header` + `network`, ready to accept events (the live-run ticket
 * feeds them as the run produces them). The per-session buckets are pre-created for every session the
 * header declares, so {@link TraceIndex.eventsForSession} returns `[]` (not `undefined`) for a session
 * whose query produced no events.
 */
export function createTraceIndex(header: TraceHeader, network: Network): TraceIndexBuilder {
	const queryByCode = new Map<string, TraceQueryEntry>()
	const eventsByCode = new Map<string, TraceEvent[]>()
	for (const query of header.queries) {
		queryByCode.set(query.sessionCode, query)
		eventsByCode.set(query.sessionCode, [])
	}
	const allEvents: TraceEvent[] = []
	let minTime: number | undefined
	let maxTime: number | undefined

	function add(event: TraceEvent): void {
		allEvents.push(event)
		let bucket = eventsByCode.get(event.sessionCode)
		if (bucket === undefined) {
			// An event whose session is not in the header (a malformed or hand-built trace). Still bucketed so
			// eventsForSession works; it just never appears in sessions().
			bucket = []
			eventsByCode.set(event.sessionCode, bucket)
		}
		bucket.push(event)
		if (minTime === undefined || event.time < minTime) {
			minTime = event.time
		}
		if (maxTime === undefined || event.time > maxTime) {
			maxTime = event.time
		}
	}

	return {
		header,
		network,
		add,
		addAll(events: Iterable<TraceEvent>): void {
			for (const event of events) {
				add(event)
			}
		},
		sessions(): readonly TraceQueryEntry[] {
			return header.queries
		},
		queryFor(sessionCode: string): TraceQueryEntry | undefined {
			return queryByCode.get(sessionCode)
		},
		eventsForSession(sessionCode: string): readonly TraceEvent[] {
			return eventsByCode.get(sessionCode) ?? []
		},
		allEvents(): readonly TraceEvent[] {
			return allEvents
		},
		timeBounds(): { min: number; max: number } | undefined {
			return minTime === undefined || maxTime === undefined ? undefined : { min: minTime, max: maxTime }
		},
	}
}

/**
 * Parse and index a whole NDJSON trace from an iterable of lines (a file read, a string split in a test).
 * Reads the header and network eagerly via {@link parseTrace} — so an unknown `traceFormatVersion` throws
 * the version-named error here — then drains the lazy event generator into a {@link createTraceIndex} builder.
 */
export function indexTrace(lines: Iterable<string>): TraceIndex {
	const parsed = parseTrace(lines)
	const builder = createTraceIndex(parsed.header, parsed.network)
	builder.addAll(parsed.events())
	return builder
}
