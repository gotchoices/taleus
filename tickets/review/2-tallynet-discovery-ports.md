description: Review the two injected "ports" added to the lift-routing library — a swappable clock (so the engine can run on fake, sped-up time) and an optional tracing hook (so a run can be recorded step by step) — plus the guard that stops the library from secretly reaching for the real clock, real timers, or random numbers.
prereq: tallynet-scaffold
files: packages/tallynet/src/clock.ts, packages/tallynet/src/clock.test.ts, packages/tallynet/src/trace.ts, packages/tallynet/src/trace.test.ts, packages/tallynet/src/sequencing.ts, packages/tallynet/src/sequencing.test.ts, packages/tallynet/src/session-code.ts, packages/tallynet/src/globals.d.ts, packages/tallynet/src/no-node-globals.test.ts, packages/tallynet/src/index.ts
----

# TallyNet discovery ports — review handoff

Two small, self-contained ports were added to the `tallynet` scaffold so the later discovery/consensus
engines can run under a simulator (`packages/tallysim`, thousands of nodes on compressed time) and a viewer,
**using the engine exactly as shipped — no test-only forks**. This ticket touched no discovery types; it only
retrofitted the scaffold so all time, timers and randomness are injected, and added a typed tracing channel.

**Gates:** `yarn workspace tallynet build && … test && … lint` — all green. **103 tests / 10 suites**
(was 72 / 8; +31 across the two new modules, the port-guard extension, and a virtual-clock duration case).

Treat this as a starting point: the tests below are a floor, not proof. Known gaps are called out explicitly
under *Honest gaps* — spend review effort there, not re-verifying the green gates.

## What changed

- **`clock.ts` (new) — the Clock port.** `Clock` = `{ now(), setTimer(fn, ms) -> TimerHandle, clearTimer(handle) }`.
  `TimerHandle` is `unknown` (opaque) so a virtual clock can return anything. `realClock` is the real-time
  default (`Date.now` + `setTimeout`/`clearTimeout`) and is **the one file in `src/` allowed to touch those
  globals** — the `setTimeout`/`clearTimeout` ambient declarations were moved here from `globals.d.ts` so the
  allowlist can name exactly this file. The virtual clock itself is **not** here — it ships later in
  `tallynet/testing` with the engine ticket (`2.2-tallynet-discovery`).
- **`trace.ts` (new) — the Trace port.** `TraceEvent` union (query sent/received, candidate pruned with
  `PruneReason`, plan returned/found, round started/budget-expired, late answer folded), `TraceSink` type,
  `noopTraceSink` default, and `safeTraceSink(sink)` which catches a throwing sink, logs **once per wrapped
  instance** via `console.error`, then swallows. File header states the **no-disclosure invariant** (an event
  only ever holds what the emitting node already knows) and the **name clash** with `taleus-core`'s unrelated
  accumulator `PruneReason`.
- **`sequencing.ts` retrofit.** `Pending<T>` now takes a `Clock` as a second constructor arg (`t1 = clock.now()`,
  `duration = clock.now() - t1`); `budgetedStep(clock, budgetMs, requests, options?)` takes the clock first and
  routes its budget timer through `clock.setTimer`/`clearTimer`. All prior behaviour kept (empty set arms no
  timer, abort-on-entry arms no timer, always clears on early finish, resolves-never-rejects).
- **`session-code.ts`.** The inline `Date.now()` default in `generate` now routes through `realClock.now()`;
  prose comments that named `Date.now()` were reworded so the grep guard stays clean. Validators still take
  `now` as an argument (unchanged).
- **`globals.d.ts`.** Removed the timer declarations (now in `clock.ts`); added a narrow `console` (for
  `safeTraceSink`'s one log line).
- **`no-node-globals.test.ts` extension.** New `injected ports (src/)` describe: a regex guard that fails if
  any non-`clock.ts` `src/` file contains a **call-form** `Date.now(`, `setTimeout(`, `setInterval(`,
  `clearTimeout(`, `clearInterval(`, or `Math.random(`. `clock.ts` is allowlisted for the timer/`Date.now`
  set; `Math.random` is allowlisted nowhere. Call-form matching (like the existing Buffer rule) means a prose
  comment naming the bare symbol is not a false positive.
- **`index.ts`.** Exports `./clock.js` and `./trace.js`.

## Use cases to validate (reviewer's checklist)

These are the behaviours a downstream consumer (the discovery engine, the simulator) relies on. Each has a
test; confirm the test actually pins the claim, and probe the edges.

- **A virtual clock drives `Pending`/`budgetedStep` with no real time.** `budgetedStep` must arm its budget
  only through `clock.setTimer`. Check: the engine ticket can hand a virtual clock (origin 0, hand-advanced)
  and get a fully deterministic step. (Here: `sequencing.test.ts` still uses `realClock` + jest fake timers —
  see *Honest gaps*.)
- **`Pending.duration` is origin-independent.** A virtual clock may count from 0, not the epoch. Pinned by
  `sequencing.test.ts` "measures duration from a clock origin other than the epoch" (t1=1000 → duration=250).
- **Empty / already-complete / already-aborted `budgetedStep` arms no timer.** Pinned via `jest.getTimerCount()`.
- **`realClock.clearTimer` on an already-fired or bogus handle is a safe no-op.** Pinned in `clock.test.ts`.
- **A throwing `TraceSink` never breaks the caller, and floods nothing.** `safeTraceSink` swallows, returns
  `undefined`, logs at most once per wrapped instance, and still delivers later non-throwing calls. A *fresh*
  wrapper logs again (dedupe is per-instance, not global). All pinned in `trace.test.ts`.
- **The port guard both catches and doesn't false-positive.** `no-node-globals.test.ts` has fixtures: a real
  `Date.now(` / `setTimeout(` / `clearTimeout(` outside `clock.ts` fails; the same inside `clock.ts` passes;
  `Math.random(` fails everywhere incl. `clock.ts`; a prose comment naming the symbols (no parens) passes.

## Honest gaps (spend review budget here)

- **No real virtual clock is exercised end-to-end.** The Clock *interface* is validated only by (a) `realClock`
  under jest fake timers and (b) a one-off hand-rolled `{ now, setTimer, clearTimer }` literal in the
  duration test. There is no shared `VirtualClock` yet (deferred to `tallynet/testing` in `2.2`). So "the whole
  engine runs on injected time" is asserted by construction, not demonstrated. The first real proof lands with
  the discovery engine's in-memory network test.
- **`Pending` taking a `Clock` is a breaking API change with no current external callers.** Verified by grep:
  only `sequencing.ts`/its test construct `Pending`/`budgetedStep`. The discovery engine (`2.1`/`2.2`) must
  thread a clock into every `Pending` it builds — flagged so it isn't missed.
- **`safeTraceSink` dedupe is per wrapped instance.** If a future caller re-wraps the sink on every emit
  (`safeTraceSink(sink)(event)` in a hot loop), a persistently broken sink logs every time. Correct usage is to
  wrap **once** per sink and reuse. Worth a glance when the engine wires tracing in.
- **The port guard is a regex grep, not an AST rule** — see the tripwire below.
- **`console` is declared narrowly (`{ error }`).** `safeTraceSink` is the only `console` user. If later code
  needs `console.warn`/`log`, the declaration must widen (or the build under `types: []` won't compile).

## Review findings

- **Tripwire — the injected-port guard is a greppable call-form match, not a proof.** Parked as a
  `NOTE:` comment in `no-node-globals.test.ts` (at the `PORT_RULES` docblock). It catches direct calls but not
  an alias (`const n = Date.now; n()`) or a dynamic lookup. Fine now (the codebase has no such pattern and the
  convention is clear); if a leak ever slips through by aliasing, tighten the rule or move to an AST lint rule.
  Not ticketed — conditional.
