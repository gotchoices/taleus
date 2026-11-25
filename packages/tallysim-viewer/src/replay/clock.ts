/**
 * The replay clock math — the **pure** core of the play loop, with no `requestAnimationFrame`, no DOM and no
 * timers, so it is unit-testable without a browser. {@link controls.ts} owns the real `rAF` loop; each frame it
 * asks this module where the playback head moves to, then feeds that time to the `timeline` reducer's `seek`.
 *
 * ── Why the clock is separate from the reducer ─────────────────────────────────────────────────────
 * `core/timeline.ts` is a pure state machine that owns no clock; it derives the "lit" set from a `currentTime`.
 * This module is the other pure half: given the wall-clock delta between two frames and the current speed, it
 * computes the next `currentTime` in the trace's own event-time units. Keeping it pure means scrubbing (a
 * direct seek) and playing (a seek per frame) share exactly one definition of "where the head is", and the
 * backward-scrub correctness the reducer already guarantees is never undone by clock drift here.
 */

/** The trace's event-time range (from `TraceIndex.timeBounds`); the playback head never leaves `[min, max]`. */
export interface TimeBounds {
	min: number
	max: number
}

/** One frame's advance: the new (clamped) head time, and whether it has reached the end (so the UI auto-pauses). */
export interface ClockStep {
	/** The new playback-head time, clamped into `[bounds.min, bounds.max]`. */
	time: number
	/** True once the head reaches `bounds.max` — a playing clock should pause here rather than spin at the end. */
	atEnd: boolean
}

/** Clamp `time` into `[bounds.min, bounds.max]` (a scrub bar or a seek target may be out of range). */
export function clampToBounds(time: number, bounds: TimeBounds): number {
	if (time < bounds.min) {
		return bounds.min
	}
	return time > bounds.max ? bounds.max : time
}

/**
 * Advance the playback head by one frame. `realDeltaMs` is the wall-clock time since the previous frame (from
 * `rAF` timestamps); `speed` is the rate multiplier (event-time advances `speed · realDeltaMs` per frame). The
 * result is clamped to `bounds`, and `atEnd` is set once the head reaches `bounds.max` so the caller pauses
 * instead of advancing forever. A non-positive `realDeltaMs` (a duplicate or out-of-order frame) does not move
 * the head backward — it holds position — so play never rewinds.
 */
export function advanceClock(currentTime: number, speed: number, realDeltaMs: number, bounds: TimeBounds): ClockStep {
	const delta = realDeltaMs > 0 ? speed * realDeltaMs : 0
	const next = clampToBounds(currentTime + delta, bounds)
	return { time: next, atEnd: next >= bounds.max }
}

/**
 * The playback progress as a `0..1` fraction, for a scrub bar's fill and thumb. Guards a zero-length range
 * (a single-instant or empty trace) by reporting `0`, so the bar never divides by zero or shows `NaN`.
 */
export function progressFraction(time: number, bounds: TimeBounds): number {
	const span = bounds.max - bounds.min
	if (span <= 0) {
		return 0
	}
	const clamped = clampToBounds(time, bounds)
	return (clamped - bounds.min) / span
}

/** Map a scrub-bar fraction (`0..1`) back to an event time in `bounds` — the inverse of {@link progressFraction}. */
export function timeAtFraction(fraction: number, bounds: TimeBounds): number {
	const clampedFraction = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction
	return bounds.min + clampedFraction * (bounds.max - bounds.min)
}
