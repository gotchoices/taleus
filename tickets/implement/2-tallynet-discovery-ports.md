description: Add the injectable clock and the optional tracing hook that let the route-finding engine run on simulated time and have every step recorded, and make sure the library never reaches for the real clock, real timers, or real randomness on its own.
prereq: tallynet-scaffold
files: packages/tallynet/src/clock.ts (new), packages/tallynet/src/trace.ts (new), packages/tallynet/src/sequencing.ts, packages/tallynet/src/session-code.ts, packages/tallynet/src/index.ts, packages/tallynet/src/no-node-globals.test.ts, packages/tallynet/package.json
difficulty: medium
----

Foundational ports for the discovery engine. These are small, self-contained, and every later discovery ticket builds on them, so they land first. Nothing here depends on the discovery types; it only retrofits the scaffold so that **all time, all timers, and all randomness are injected**, and adds a typed tracing channel.

Why this matters: a simulator (`packages/tallysim`) will run thousands of TallyNet nodes in one process on *simulated* time, and a viewer will animate a query spreading through the graph. Both use the engine exactly as shipped — no test-only forks. That is only possible if the engine never calls `Date.now`, never arms a global `setTimeout`, and never calls `Math.random` directly. This ticket makes that true for the scaffold and locks it with a test.

## Clock port

Add `src/clock.ts`:

```ts
/** Opaque handle to a scheduled timer, returned by setTimer and passed back to clearTimer. */
export type TimerHandle = unknown

/**
 * All wall-clock time and all timers in TallyNet go through a Clock. The default is real time;
 * a simulator injects a virtual clock so a whole run is reproducible on compressed time.
 */
export interface Clock {
	/** Milliseconds since the epoch (or any monotonic origin a virtual clock chooses). */
	now(): number
	/** Schedule `fn` to run after `ms`. Returns a handle for clearTimer. */
	setTimer(fn: () => void, ms: number): TimerHandle
	/** Cancel a timer scheduled by setTimer. A handle that already fired or was cleared is a no-op. */
	clearTimer(handle: TimerHandle): void
}

/** The real-time clock: Date.now + setTimeout + clearTimeout. The one place in src/ allowed to touch them. */
export const realClock: Clock
```

- `realClock` is the **only** file in `src/` permitted to reference `Date.now`, `setTimeout`, `clearTimeout` (the `no-node-globals` test enforces that below).
- Do **not** return Node's `Timeout` object shape in the public type; `TimerHandle` stays opaque (`unknown`) so a virtual clock can return whatever it likes.
- The virtual-clock implementation is **not** in this ticket — it ships in `tallynet/testing` with the engine ticket. This ticket only defines the interface and the real-time default.

## Retrofit the scaffold to the Clock

- `src/sequencing.ts`: `Pending<T>` records `t1`/`duration` with `Date.now()`, and `budgetedStep` arms a raw `setTimeout`. Both must take a `Clock`:
  - `Pending` constructor takes a `Clock` (or a `now: () => number`); `t1 = clock.now()`, `duration = clock.now() - t1`.
  - `budgetedStep(clock, budgetMs, requests, options?)` uses `clock.setTimer`/`clock.clearTimer` instead of `setTimeout`/`clearTimeout`. Keep the existing behaviour otherwise: always clears the timer when the step ends early (the leaked-timer fix the scaffold already made), still accepts the abort signal, still resolves (never rejects), still returns immediately with no timer armed for an empty `requests` set.
  - Update `sequencing.test.ts` to pass a clock. It may keep using `realClock` (fake jest timers still work through it) **or** switch to the virtual clock once that exists — but the virtual clock is a later ticket, so for this ticket use `realClock` with jest fake timers, same as today.
- `src/session-code.ts`: `generate` currently defaults its `now` to `Date.now()`. Remove the inline `Date.now()` default; route the default through `realClock.now()` (or require the caller to pass `now`). The validators already take `now` as an argument — leave those. Audit the whole file for any other `Date.now`.
- Grep the rest of `src/` for `Date.now`, `setTimeout`, `setInterval`, `Math.random` and route every one through a `Clock`/`RandomSource`, or move it into `realClock`.

## Trace port

Add `src/trace.ts`:

```ts
/** Common envelope on every trace event: the clock time, the emitting node's own id, the session. */
export interface TraceBase {
	time: number
	/** The emitting node's id exactly as the host gave it to the engine. */
	nodeId: string
	sessionCode: string
}

export type TraceEvent =
	| (TraceBase & { type: 'query-sent';           nonce: string; depth: number; round: number })
	| (TraceBase & { type: 'query-received';       nonce: string; depth: number; round: number })
	| (TraceBase & { type: 'candidate-pruned';     nonce: string; reason: PruneReason })
	| (TraceBase & { type: 'plan-returned';        nonce: string })
	| (TraceBase & { type: 'plan-found' })
	| (TraceBase & { type: 'round-started';        round: number; budgetMs: number })
	| (TraceBase & { type: 'round-budget-expired'; round: number })
	| (TraceBase & { type: 'late-answer-folded';   nonce: string; round: number })

export type PruneReason =
	| 'cycle'          // candidate nonce already in the path
	| 'failed'         // sub-query errored or returned nothing usable
	| 'timed-out'      // no answer inside the round budget
	| 'max-depth'      // would exceed maxDepth
	| 'expired'        // session code expired / too little life left
	| 'no-reentrance'  // candidate returned no reentrance ticket and no plan

/** A trace sink receives every event. Default is a no-op. A throwing sink must never break the engine. */
export type TraceSink = (event: TraceEvent) => void

/** The no-op sink (default when the host injects none). */
export const noopTraceSink: TraceSink

/**
 * Wrap a sink so a throw is caught, logged **once per sink**, and swallowed — tracing is
 * instrumentation and must never change engine behaviour. The engine calls the wrapped sink.
 */
export function safeTraceSink(sink: TraceSink): TraceSink
```

- `safeTraceSink` catches any throw from the inner sink, logs it once (dedupe per wrapped instance — after the first logged error, subsequent throws from the same sink are swallowed silently), and carries on.
- Tracing is **local instrumentation and adds no disclosure**: an event only ever holds what the emitting node already knows (its own id, a nonce it already holds, the session code, a depth/round counter). It never carries a peer's link id or a neighbour's identity. State that invariant in the file header so the discovery ticket honours it.
- `PruneReason` here is the discovery-prune enum and is **distinct** from `taleus-core`'s accumulator `PruneReason` (`missing-quote`/`zero-capacity`/`insufficient-capacity`); they live in different packages and never meet. Note that in the header to forestall confusion.

## Enforce it

Extend `src/no-node-globals.test.ts` (or add a sibling test) with a rule set that fails if any `src/` file **other than `clock.ts`** contains `Date.now(`, `setTimeout(`, `setInterval(`, `clearTimeout(`, `clearInterval(`, or `Math.random(`. Allowlist exactly `clock.ts` for the timer/`Date.now` set; nothing is allowlisted for `Math.random` (randomness always comes from an injected `RandomSource` — `webRandomSource` in `crypto.ts` wraps the Web Crypto global, which is not one of these globals). Keep the existing Node-import/Buffer rules.

## Wire up exports

`src/index.ts`: add `export * from './clock.js'` and `export * from './trace.js'`.

## Edge cases & interactions

- `budgetedStep` with an empty `requests` set still arms **no** timer and resolves immediately (don't call `clock.setTimer` at all in that path).
- `budgetedStep` aborted-on-entry (signal already aborted) resolves without arming a timer.
- A virtual clock may return `now()` values that are small integers starting at 0 — `Pending.duration` must stay correct for `now()` origins other than epoch (don't assume `t1` is a large number).
- `realClock.clearTimer` on a handle that already fired must be a safe no-op.
- The `no-node-globals` test must not false-positive on these tokens appearing inside **comments or strings** that merely name them in prose (match call-shaped usage, e.g. `Date.now(`, as the existing Buffer rule does), and must still catch a real `clock.ts`-external usage.

## Tests to write

- `clock.test.ts`: `realClock.now()` is monotonic non-decreasing; `setTimer`/`clearTimer` round-trip (a cleared timer never fires) under jest fake timers.
- `trace.test.ts`: `safeTraceSink` swallows a throw, the engine-visible call still returns; the error is logged at most once across repeated throws from one wrapped sink; a non-throwing sink receives the event unchanged.
- `sequencing.test.ts`: updated to pass a clock; existing assertions (budget cutoff, no leaked timer, abort) still hold.
- `no-node-globals` extension: a fixture string containing `Date.now(` in a non-`clock.ts` path fails; `clock.ts` itself passes.

## TODO

- Add `src/clock.ts` (`Clock`, `TimerHandle`, `realClock`).
- Add `src/trace.ts` (`TraceBase`, `TraceEvent`, `PruneReason`, `TraceSink`, `noopTraceSink`, `safeTraceSink`).
- Retrofit `Pending` + `budgetedStep` in `src/sequencing.ts` to the `Clock`; update `sequencing.test.ts`.
- Remove the `Date.now()` default from `src/session-code.ts`; route through `realClock`.
- Extend `src/no-node-globals.test.ts` to forbid `Date.now`/global timers (except `clock.ts`) and `Math.random` (everywhere).
- Export the new modules from `src/index.ts`.
- `yarn workspace tallynet build && yarn workspace tallynet test` green; `yarn workspace tallynet lint` clean.
