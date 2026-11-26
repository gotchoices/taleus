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

import { parseTrace, type Network, type TraceHeader, type TraceLiftEntry, type TraceQueryEntry } from 'tallysim'
import type { TraceEvent } from 'tallynet'

/**
 * The two resolvers one settled lift needs to place its consensus events on the graph, built from the v2
 * header's {@link TraceLiftEntry} (see {@link createLiftResolver}). A consensus event's `nodeId`/`to`/`from`
 * are member **keys** (not entity ids) and carry no link nonce, so neither the node nor the edge is
 * placeable without the header's `memberKeys` map and `route`/`tallyPath` pair.
 */
export interface LiftResolver {
	/** The entity id a consensus member key maps to, or `undefined` if the key is not in the lift's `memberKeys`. */
	entityOfMember(memberKey: string): number | undefined
	/**
	 * The tally index of the route hop between two entities (order-independent), or `undefined` if the two are
	 * not adjacent on the lift's route. A circular lift's repeated originator sits on two distinct hops; each is
	 * a distinct unordered pair, so this stays unambiguous (see the circular-route edge case in the design doc).
	 */
	tallyOfEdge(fromEntity: number, toEntity: number): number | undefined
}

/** The canonical (order-independent) key for the undirected pair `{a, b}`. */
function pairKey(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`
}

/**
 * Build the {@link LiftResolver} for one lift from its header entry. `memberKeys` is already the
 * `memberKey → entityId` map the writer recorded; the `(from, to) → tally` map is folded from the
 * index-aligned `route` + `tallyPath` (hop `i` joins `route[i]`↔`route[i+1]` on `tallyPath[i]`).
 */
export function createLiftResolver(lift: TraceLiftEntry): LiftResolver {
	const tallyByPair = new Map<string, number>()
	for (let i = 0; i < lift.tallyPath.length; i++) {
		tallyByPair.set(pairKey(lift.route[i], lift.route[i + 1]), lift.tallyPath[i])
	}
	return {
		entityOfMember: (memberKey) => lift.memberKeys[memberKey],
		tallyOfEdge: (from, to) => tallyByPair.get(pairKey(from, to)),
	}
}

/** The read surface a built index exposes; the playback modules depend only on this. */
export interface TraceIndex {
	readonly header: TraceHeader
	readonly network: Network
	/** Every session the header declares, in header order. */
	sessions(): readonly TraceQueryEntry[]
	/** The header entry for one session, or `undefined` if the code is not in the header. */
	queryFor(sessionCode: string): TraceQueryEntry | undefined
	/**
	 * Events for one session in arrival order — which is time order for a well-formed trace (the writer emits
	 * in `(time, seq)` order); the index does not re-sort. Empty (never `undefined`) for a session with no events.
	 */
	eventsForSession(sessionCode: string): readonly TraceEvent[]
	/** Every event across every session, in arrival order (= time order for a well-formed trace; not re-sorted). */
	allEvents(): readonly TraceEvent[]
	/** The min/max event `time` (playback bounds), or `undefined` when the trace has no events. */
	timeBounds(): { min: number; max: number } | undefined
	/**
	 * Every settled lift the header recorded (consensus runs only), in header order. Empty for a v1 file and for
	 * a discovery-only v2 run (no `lifts`) — those have no consensus phase to animate.
	 */
	lifts(): readonly TraceLiftEntry[]
	/** The lift a session settled into (joined by `sessionCode`), or `undefined` if the session drove no lift. */
	liftFor(sessionCode: string): TraceLiftEntry | undefined
	/** The lift a `transactionCode` names, or `undefined` if no recorded lift carries it. */
	liftByTransaction(transactionCode: string): TraceLiftEntry | undefined
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
	// Index the recorded lifts (absent on v1 / discovery-only v2) by both join keys: `sessionCode` ties a lift
	// to its discovery session, `transactionCode` ties it to its own consensus events.
	const headerLifts = header.lifts ?? []
	const liftBySession = new Map<string, TraceLiftEntry>()
	const liftByTransaction = new Map<string, TraceLiftEntry>()
	for (const lift of headerLifts) {
		liftBySession.set(lift.sessionCode, lift)
		liftByTransaction.set(lift.transactionCode, lift)
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
		lifts(): readonly TraceLiftEntry[] {
			return headerLifts
		},
		liftFor(sessionCode: string): TraceLiftEntry | undefined {
			return liftBySession.get(sessionCode)
		},
		liftByTransaction(transactionCode: string): TraceLiftEntry | undefined {
			return liftByTransaction.get(transactionCode)
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
