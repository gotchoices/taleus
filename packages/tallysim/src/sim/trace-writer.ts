/**
 * The streaming trace writer: hand it a {@link TraceHeader} and a {@link TraceNetworkSnapshot}, and it
 * returns a {@link TraceSink} for the harness plus a stats accessor. It serialises the header and network
 * up front, then one NDJSON line per event **as the event arrives**, handing each line to the supplied
 * {@link LineSink} and dropping it — it never accumulates the event list, so a 10,000-node run stays flat
 * in memory regardless of how many events it emits. See `docs/design.md` § Trace & replay format.
 *
 * The core stays platform-neutral (no `node:fs`): it emits already-serialised line strings to a
 * {@link LineSink} the caller owns. The Node CLI (`cli/trace.ts`) wires that sink to a streamed file
 * write; the browser viewer wires it to an in-memory accumulator.
 *
 * **A throwing sink never breaks the engine.** The `tallynet` discovery/consensus engines already wrap
 * the injected sink with `safeTraceSink` (see `tallynet/src/trace.ts` and both participants), so a throw
 * from this writer — or from the underlying {@link LineSink} — is caught, logged once, and swallowed by
 * the engine. This writer therefore does not double-wrap; it simply keeps its own work non-throwing
 * (serialising a flat, JSON-safe event cannot throw).
 */

import type { TraceEvent, TraceSink } from 'tallynet'
import { type TraceHeader, type TraceNetworkSnapshot, serializeTraceLine } from './trace-format.js'

/** Receives one already-serialised NDJSON line (no trailing newline); the sink owner adds the separator. */
export type LineSink = (line: string) => void

/** Tuning for {@link makeTraceWriter}. */
export interface TraceWriterOptions {
	/**
	 * Record events only for these session codes (the selected-query option: a huge run can record only a
	 * handful of queries). Omitted ⇒ every event is recorded. The header should list only the recorded
	 * sessions, so the file stays self-consistent with its events (the CLI enforces this).
	 */
	sessions?: Set<string>
}

/** Running totals so a caller can report (and, if it wants, cap on) the trace size. */
export interface TraceWriterStats {
	/** Lines written so far (header + network + every recorded event). */
	lines: number
	/** Bytes written so far, counting each line plus its one newline separator — the on-disk NDJSON size. */
	bytes: number
}

/** The writer: a {@link TraceSink} to hand the harness, and a live {@link TraceWriterStats} accessor. */
export interface TraceWriter {
	sink: TraceSink
	stats(): TraceWriterStats
}

/**
 * The UTF-8 byte length of a string, computed from its code units — so the byte stat is exact on any
 * runtime without depending on `TextEncoder` (the neutral build compiles with `types: []`, and a global
 * encoder is not guaranteed on every target). A lone surrogate counts as the 3-byte replacement.
 */
function utf8ByteLength(text: string): number {
	let bytes = 0
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i)
		if (code < 0x80) {
			bytes += 1
		} else if (code < 0x800) {
			bytes += 2
		} else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
			const low = text.charCodeAt(i + 1)
			if (low >= 0xdc00 && low <= 0xdfff) {
				bytes += 4 // a full surrogate pair → one 4-byte code point
				i++
			} else {
				bytes += 3 // lone high surrogate
			}
		} else {
			bytes += 3
		}
	}
	return bytes
}

/**
 * Create a streaming {@link TraceWriter}. Emits the `header` and `network` lines immediately (in that
 * order), then returns a `sink` that emits one `event` line per received event, filtered by
 * `options.sessions` when set.
 */
export function makeTraceWriter(
	header: TraceHeader,
	snapshot: TraceNetworkSnapshot,
	out: LineSink,
	options?: TraceWriterOptions,
): TraceWriter {
	let lines = 0
	let bytes = 0

	const emit = (line: string): void => {
		out(line)
		lines++
		// + 1 for the newline the LineSink owner appends between lines, so bytes matches the on-disk size.
		bytes += utf8ByteLength(line) + 1
	}

	emit(serializeTraceLine(header))
	emit(serializeTraceLine(snapshot))

	const sessions = options?.sessions
	const sink: TraceSink = (event: TraceEvent): void => {
		if (sessions !== undefined && !sessions.has(event.sessionCode)) {
			return
		}
		emit(serializeTraceLine({ kind: 'event', event }))
	}

	return { sink, stats: () => ({ lines, bytes }) }
}
