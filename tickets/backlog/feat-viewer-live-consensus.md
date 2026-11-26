description: Let the network viewer run a payment all the way through — not just replay a recorded file — so it generates a network, searches it, and then animates the payment being signed and settled live in the browser.
prereq:
files: packages/tallysim-viewer/src/live/controls.ts, packages/tallysim-viewer/src/live/sim-worker.ts, packages/tallysim-viewer/src/live/sim-run.ts, packages/tallysim-viewer/src/live/sim-protocol.ts, packages/tallysim-viewer/docs/design.md
difficulty: hard
----

The viewer has two ways to show a payment search: **replay** a recorded trace file, and **live-run** —
generate a network in the browser and run the real search in a Web Worker, animating it without a file. The
recorded-replay side now also animates the **consensus phase** of a payment (the sign-and-settle step after a
route is found): promises lighting each hop, the vote, then the route turning solid on commit or flashing and
clearing on cancel (ticket `tallysim-viewer-consensus`).

This ticket brings that same consensus animation to the **live-run** path: today the live worker
(`src/live/`) generates a network and runs **discovery** (the route search) in-browser, but it stops there —
it never drives the **settlement** that follows. The work is to have the live worker also run the settlement
("consensus") protocol over the found route, stream its consensus events plus the one lift-header the viewer
needs (the chosen route and the member-key↔entity map), and let the existing overlay/reducer animate the
settlement — no recorded file involved.

## Why this is its own ticket (not part of the replay work)

Recorded-trace replay already fully satisfies "the viewer animates the route settling": a developer records a
consensus run with the simulator's `trace` tool and replays it. The live path is a sizeable, self-contained
**worker** change — the worker must drive the simulator's consensus harness to settlement and build a v2 trace
header — so it is cleaner to take on its own rather than bolt onto the replay ticket.

## What it reuses vs. what is new

- **Reused unchanged** (built by `tallysim-viewer-consensus`): the consensus **overlay** (`replay/paint.ts`
  phases + the `promised`/`committed`/`voidFlash` palette), the **reducer** (`core/timeline.ts` per-lift
  settlement state), the **resolvers** (`core/trace-index.ts` member-key↔entity and `(from,to)→tally`), and the
  side-list route + outcome badge (`replay/controls.ts`). The live path feeds these the same way a file load
  does.
- **New work** (the worker): drive the simulator's consensus harness (`tallysim`'s `runLiftForOutcome` /
  consensus harness) to settlement for the picked payment, emit its consensus trace events, and build a **v2
  trace header** carrying the lift (route + `tallyPath` + `memberKeys`) — the same shape the recorded `trace`
  CLI writes. The live source then supplies the lift to the replay panel exactly as `trace-index` surfaces it
  from a loaded file.

Reference the engine it would drive: `tallysim`'s consensus harness + metrics-trace work
(`tallysim-consensus-harness-wiring`, `-drive-settle`, `-metrics-trace`) and the v2 header format
(`tallysim-consensus-trace-v2`). The live run must stay a **byte-compatible** trace (a downloaded live
consensus run reloads and replays identically), matching the determinism guarantee the discovery live-run
already honours.
