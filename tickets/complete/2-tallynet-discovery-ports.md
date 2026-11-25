description: Added two injected "ports" to the lift-routing library — a swappable clock (so the engine can run on fake, sped-up time) and an optional tracing hook (so a run can be recorded step by step) — plus a guard that stops the library from secretly reaching for the real clock, real timers, or random numbers. Reviewed and complete.
files: packages/tallynet/src/clock.ts, packages/tallynet/src/clock.test.ts, packages/tallynet/src/trace.ts, packages/tallynet/src/trace.test.ts, packages/tallynet/src/sequencing.ts, packages/tallynet/src/sequencing.test.ts, packages/tallynet/src/session-code.ts, packages/tallynet/src/globals.d.ts, packages/tallynet/src/no-node-globals.test.ts, packages/tallynet/src/index.ts
----

# TallyNet discovery ports — complete

Two self-contained ports were added to the `tallynet` scaffold so the later discovery/consensus
engines can run under a simulator and a viewer **using the engine exactly as shipped — no test-only
forks**:

- **Clock port** (`clock.ts`): `Clock = { now(), setTimer(fn, ms) -> TimerHandle, clearTimer(handle) }`.
  `realClock` is the real-time default and the **one file in `src/` allowed** to touch `Date.now`,
  `setTimeout`, `clearTimeout`. The virtual clock ships later in `tallynet/testing` with the engine
  ticket (`2.2-tallynet-discovery`).
- **Trace port** (`trace.ts`): a typed `TraceEvent` union, `TraceSink` type, `noopTraceSink` default,
  and `safeTraceSink(sink)` which catches a throwing sink, logs once per wrapped instance, then
  swallows. Carries a **no-disclosure invariant** (an event only holds what the emitting node already
  knows).
- **Retrofit**: `Pending`/`budgetedStep` now take an injected `Clock`; `session-code.generate` routes
  its default time through `realClock.now()`.
- **Port guard** (`no-node-globals.test.ts`): a call-form regex guard that fails if any non-`clock.ts`
  `src/` file calls `Date.now(`, `setTimeout(`, `setInterval(`, `clearTimeout(`, `clearInterval(`, or
  `Math.random(` (the last allowlisted nowhere).

**Gates (final):** `yarn workspace tallynet build && … test && … lint` — all green. **104 tests /
10 suites** (implement handoff left 103; review added 1).

## Review findings

Adversarial pass over the implement diff (`f8616a4`). Read the full source + test diff first, ran all
three gates, cross-checked `docs/design.md`.

**Checked and clean (no action):**

- **Correctness — `Pending` / `budgetedStep`.** Rejection handling leaks no unhandled rejection (the
  constructor attaches a handler; the floating `.then` resolves in both branches). Timer is **always**
  cleared in `finally`, abort listener always removed; empty / already-complete / already-aborted sets
  arm no timer. All paths resolve, never reject. Verified by reading, not just by the green suite.
- **Resource cleanup, type safety, error handling.** `TimerHandle = unknown` is the right opaque type;
  no `any`; `safeTraceSink` catches→logs-once→swallows so a throwing sink never changes engine
  behaviour. Good.
- **Port guard scope.** Scans production `src/` only (`!endsWith('.test.ts')`); `clock.ts` correctly
  allowlisted for the timer/`Date.now` set; `Math.random` allowlisted nowhere. Reused non-global regexes
  carry no `lastIndex` state bug. Fixtures pin both the catch and the no-false-positive-on-prose cases.
- **Docs.** `packages/tallynet/docs/design.md` §§ Clock port / Trace port / Determinism (lines 112–114)
  already describe both ports accurately. The doc's `TraceEvent` list names consensus events (promise,
  vote, settle, release) the union does not yet carry — expected: the timeless doc describes the full
  intended set; the union is the discovery-stage subset and extends when consensus lands in a later
  ticket. Not a discrepancy to fix now.

**Minor — fixed inline this pass:**

- **Redundant `console` ambient declaration.** `console: { error }` was declared in *both*
  `globals.d.ts` (the project's home for ambient globals) and module-locally in `trace.ts`. Removed the
  `trace.ts` duplicate; it now relies on the single global declaration. Build + 104 tests + lint stay
  green, confirming it was genuinely redundant.
- **Coverage gap on the headline claim — closed.** The ticket's central promise ("the engine runs on
  injected time, no real clock") was, for `budgetedStep`, only asserted *by construction* — every test
  drove it with `realClock` + jest fake timers. Added `sequencing.test.ts` "arms and fires its budget
  through an injected virtual clock, with no real time": a hand-driven `Clock` stashes the budget
  callback and the test fires it, with zero real/jest timers, proving the budget path runs entirely on
  injected time and still resolves (never rejects) when the request never settles. (+1 test → 104.)

**Major — none.** No new ticket filed.

**Tripwires (conditional — not ticketed):**

- **Port guard is a greppable call-form match, not a proof.** Parked as a `NOTE:` comment at the
  `PORT_RULES` docblock in `no-node-globals.test.ts`. It catches direct calls but not an alias
  (`const n = Date.now; n()`) or dynamic lookup (`globalThis['set'+'Timeout']`). Fine now (no such
  pattern exists, convention is clear); if a leak ever slips through by aliasing, tighten the rule or
  move to an AST lint rule. (Carried over from the implement handoff; comment verified present.)
- **`safeTraceSink` dedupe is per wrapped instance.** Correct usage is to wrap a sink **once** and
  reuse; re-wrapping on every emit in a hot loop would let a persistently broken sink log every time.
  Documented in the `safeTraceSink` doc comment ("wrap once per sink and reuse"). Conditional on a
  future mis-wiring; worth a glance when the engine wires tracing in `2.2`. Not ticketed.

**Carried forward for the discovery engine (`2.1`/`2.2`) — not a defect here:**

- `Pending` / `budgetedStep` taking a `Clock` is a breaking signature change. Grep confirms the only
  current callers are `sequencing.ts` and its test; the discovery engine must thread a clock into every
  `Pending` it builds. Flagged so it is not missed.
- No shared `VirtualClock` yet (deferred to `tallynet/testing` in `2.2`). The first end-to-end proof
  that the whole engine runs on injected time lands with the discovery engine's in-memory network test.

## End
