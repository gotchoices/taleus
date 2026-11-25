/**
 * The trace file format: a versioned, newline-delimited JSON (NDJSON) recording of one discovery (and,
 * once ticket 3.7 lands, consensus) simulation run, plus the pure, platform-neutral machinery to read it
 * back. The viewer and the protocol-metrics tier both consume exactly this format, so a recorded run
 * **replays identically**. See `docs/design.md` § Trace & replay format.
 *
 * ── The three line kinds, in order ────────────────────────────────────────────────────────────────
 *   line 1  `header`   — format/package versions, the {@link SimScenario} that produced the run, the run
 *                        seed, and one entry per issued query (so a reader joins events back to a query).
 *   line 2  `network`  — the serialised {@link Network} (tallysim's `Infinity ↔ null` encoding), so the
 *                        reader rebuilds the exact graph the run searched.
 *   lines 3+ `event`   — one `tallynet` {@link TraceEvent} per line, in emission (= time) order, because
 *                        the `VirtualClock` fires in `(time, seq)` order.
 * The header and network come first so a streaming reader can set up before the events arrive.
 *
 * ── Versioning ────────────────────────────────────────────────────────────────────────────────────
 * {@link TRACE_FORMAT_VERSION} is checked on read; any other version is rejected with a message naming
 * the found vs the supported version. Bump it only when the **line envelopes** below change — the
 * {@link TraceEvent} union already spans discovery *and* consensus, so consensus events (ticket 3.7)
 * need no bump. This module records whatever events the sink receives and never forks or narrows the
 * union; a hand-built consensus event round-trips unchanged.
 *
 * ── One encoding for the network ──────────────────────────────────────────────────────────────────
 * The snapshot reuses `model.ts`'s {@link networkToSerialized} / {@link networkFromSerialized} (the same
 * `Infinity ↔ null` convention `serialize`/`deserialize` use) — it does not invent a second encoding.
 */

import type { TraceEvent } from 'tallynet'
import { type Network, type SerializedNetwork, networkFromSerialized, networkToSerialized } from '../model.js'
import type { SimScenario } from '../scenario.js'

/** The on-disk trace format version. Bump only when a line envelope below changes (not for new events). */
export const TRACE_FORMAT_VERSION = 1

/** One issued query, as recorded in the header so a reader can join events (by `sessionCode`) to it. */
export interface TraceQueryEntry {
	sessionCode: string
	from: number
	to: number
	amount: number
	depth: number
}

/** Line 1: the run's provenance. One `header` per file. */
export interface TraceHeader {
	kind: 'header'
	/** Always {@link TRACE_FORMAT_VERSION} at write time; checked on read. */
	traceFormatVersion: number
	/** The tallysim package version that produced the run. */
	tallysimVersion: string
	/** The tallynet package version whose protocol produced the events. */
	tallynetVersion: string
	/** The full scenario the run was built from, so the run is reproducible from the file alone. */
	scenario: SimScenario
	/** The run seed. */
	runSeed: number
	/** One entry per query recorded in this file (see the selected-query note below). */
	queries: TraceQueryEntry[]
}

/** Line 2: the exact network the run searched, in the model's `Infinity ↔ null` on-disk shape. */
export interface TraceNetworkSnapshot {
	kind: 'network'
	network: SerializedNetwork
}

/** Lines 3+: one `tallynet` trace event, verbatim. */
export interface TraceEventLine {
	kind: 'event'
	event: TraceEvent
}

/** The discriminated union of every trace line. The `kind` field is the discriminant. */
export type TraceLine = TraceHeader | TraceNetworkSnapshot | TraceEventLine

/** The parts of a {@link TraceHeader} a caller supplies; {@link buildTraceHeader} stamps the rest. */
export type TraceHeaderParts = Omit<TraceHeader, 'kind' | 'traceFormatVersion'>

/**
 * Build a {@link TraceHeader}, stamping `kind` and the current {@link TRACE_FORMAT_VERSION}. The two
 * package versions are threaded in by the caller (the Node CLI reads them from the on-disk
 * `package.json`s; the browser viewer passes its bundled versions) — this core holds no filesystem.
 */
export function buildTraceHeader(parts: TraceHeaderParts): TraceHeader {
	return {
		kind: 'header',
		traceFormatVersion: TRACE_FORMAT_VERSION,
		tallysimVersion: parts.tallysimVersion,
		tallynetVersion: parts.tallynetVersion,
		scenario: parts.scenario,
		runSeed: parts.runSeed,
		queries: parts.queries,
	}
}

/**
 * Build the network-snapshot line from a {@link Network}, reusing the model's `Infinity ↔ null` encoding.
 *
 * NOTE: the snapshot is a single line held in memory while it serialises — fine for the planned network
 * sizes (the event stream, not the snapshot, is what grows without bound). If entity counts ever dwarf
 * event counts, consider chunking the snapshot across several lines.
 */
export function makeNetworkSnapshot(network: Network): TraceNetworkSnapshot {
	return { kind: 'network', network: networkToSerialized(network) }
}

/** Serialise one trace line to a single NDJSON string (no trailing newline). The round-trip partner of
 * {@link parseTrace}. Deterministic: object key order is fixed, so the same line serialises byte-identically. */
export function serializeTraceLine(line: TraceLine): string {
	return JSON.stringify(line)
}

/** A parsed trace: the header, the rebuilt network, and a lazy generator over the events in file order. */
export interface ParsedTrace {
	header: TraceHeader
	/** The deserialised {@link Network} (byte-identical to the one the run searched). */
	network: Network
	/**
	 * The events, in file order, as a lazy {@link Iterable} so a large trace is not fully materialised.
	 * Single-pass: it drives the underlying line iterator once, so iterate the result a single time.
	 */
	events(): Iterable<TraceEvent>
}

/** Parse one JSON line, adding the line's role to any JSON syntax error so the message is actionable. */
function parseLine(line: string, role: string): unknown {
	try {
		return JSON.parse(line)
	} catch (error) {
		throw new Error(`parseTrace: malformed ${role} line: ${(error as Error).message}`, { cause: error })
	}
}

/** Advance `iterator` to the next line that is not blank/whitespace-only, or `undefined` at the end. */
function nextNonBlank(iterator: Iterator<string>): string | undefined {
	for (let next = iterator.next(); !next.done; next = iterator.next()) {
		if (next.value.trim() !== '') {
			return next.value
		}
	}
	return undefined
}

/** Validate and narrow the header line, rejecting an unknown/missing version with a clear message. */
function readHeader(line: string): TraceHeader {
	const parsed = parseLine(line, 'header') as Partial<TraceHeader>
	if (parsed.kind !== 'header') {
		throw new Error(`parseTrace: first line is not a header (kind="${String(parsed.kind)}")`)
	}
	if (parsed.traceFormatVersion !== TRACE_FORMAT_VERSION) {
		throw new Error(
			`parseTrace: unsupported traceFormatVersion ${String(parsed.traceFormatVersion)} ` +
				`(this build reads ${TRACE_FORMAT_VERSION})`,
		)
	}
	return parsed as TraceHeader
}

/** Validate and rebuild the network snapshot line. */
function readNetwork(line: string): Network {
	const parsed = parseLine(line, 'network') as Partial<TraceNetworkSnapshot>
	if (parsed.kind !== 'network' || parsed.network === undefined) {
		throw new Error(`parseTrace: second line is not a network snapshot (kind="${String(parsed.kind)}")`)
	}
	return networkFromSerialized(parsed.network)
}

/** Validate and unwrap one event line. */
function readEvent(line: string): TraceEvent {
	const parsed = parseLine(line, 'event') as Partial<TraceEventLine>
	if (parsed.kind !== 'event' || parsed.event === undefined) {
		throw new Error(`parseTrace: expected an event line (kind="${String(parsed.kind)}")`)
	}
	return parsed.event
}

/**
 * Parse an NDJSON trace from an iterable of lines (the caller supplies the lines — a file read in the
 * CLI, a string split in a test). The header and network are read eagerly (so a reader can set up); the
 * events stay lazy. Throws a clear error on an unknown `traceFormatVersion` or a malformed/missing
 * header or network line.
 */
export function parseTrace(lines: Iterable<string>): ParsedTrace {
	const iterator = lines[Symbol.iterator]()
	const headerLine = nextNonBlank(iterator)
	if (headerLine === undefined) {
		throw new Error('parseTrace: empty input (no header line)')
	}
	const header = readHeader(headerLine)
	const networkLine = nextNonBlank(iterator)
	if (networkLine === undefined) {
		throw new Error('parseTrace: missing network-snapshot line (expected line 2)')
	}
	const network = readNetwork(networkLine)

	function* events(): Generator<TraceEvent> {
		for (let line = nextNonBlank(iterator); line !== undefined; line = nextNonBlank(iterator)) {
			yield readEvent(line)
		}
	}

	return { header, network, events }
}
