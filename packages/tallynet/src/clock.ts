/**
 * The clock port. **All** wall-clock time and **all** timers in TallyNet go through a {@link Clock}.
 * The default, {@link realClock}, is real time; a simulator injects a virtual clock so a whole run
 * of thousands of nodes is reproducible on compressed time, and a viewer can animate it. The engine
 * ships exactly as used -- no test-only forks -- which is only possible because nothing else in
 * `src/` ever calls `Date.now`, `setTimeout` or `clearTimeout` directly (enforced by
 * `no-node-globals.test.ts`, which allowlists this one file).
 *
 * The virtual-clock implementation is **not** here: it ships in `tallynet/testing` with the engine
 * ticket. This file defines only the interface and the real-time default.
 */

// The ambient timer globals. Every target (browsers, Node, Hermes/React Native) has them, but they
// live in the DOM/Node type libraries the platform-neutral build (`tsconfig.build.json`,
// `types: []`) deliberately excludes. Declared here, module-locally, because `clock.ts` is the one
// file in `src/` allowed to touch them -- keeping them out of `globals.d.ts` lets the
// no-node-globals rule allowlist exactly this file.
declare function setTimeout(handler: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

/** Opaque handle to a scheduled timer, returned by {@link Clock.setTimer} and passed back to {@link Clock.clearTimer}. */
export type TimerHandle = unknown

/**
 * All wall-clock time and all timers in TallyNet go through a Clock. The default is real time;
 * a simulator injects a virtual clock so a whole run is reproducible on compressed time.
 */
export interface Clock {
	/** Milliseconds since the epoch (or any monotonic origin a virtual clock chooses). */
	now(): number
	/**
	 * Schedule `fn` to run after `ms`. Returns a handle for {@link clearTimer}. `fn` may be async: a
	 * virtual clock tracks the returned promise and treats the system as settled only once it resolves
	 * (so a callback that schedules more timers only at the end of a long await chain is still awaited);
	 * {@link realClock} ignores the return, exactly as `setTimeout` does.
	 */
	setTimer(fn: () => void | Promise<void>, ms: number): TimerHandle
	/** Cancel a timer scheduled by {@link setTimer}. A handle that already fired or was cleared is a no-op. */
	clearTimer(handle: TimerHandle): void
}

/**
 * The real-time clock: `Date.now` + `setTimeout` + `clearTimeout`. The one place in `src/` allowed
 * to touch them. `clearTimer` on a handle that already fired (or was never a live timer) is a safe
 * no-op, as `clearTimeout` is.
 */
export const realClock: Clock = {
	now: () => Date.now(),
	// `fn` may be async (see the Clock doc); real time just runs it and discards the promise, as setTimeout does.
	setTimer: (fn, ms) => setTimeout(() => void fn(), ms),
	clearTimer: (handle) => clearTimeout(handle),
}
