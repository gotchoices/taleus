# TallySim Viewer design

The **TallySim Viewer** is a static, server-less browser app that *shows* a simulated Taleus tally network:
entities as nodes, tallies as edges, a payment search lighting up the graph as it spreads outward, and the
routes it finds. It is a **development tool** — a window onto what `tallysim` records — not part of the
Taleus client (`taleus-app`). It may be published to the web later, so it stays a **static build with no
server**: everything runs in the browser from files a developer loads.

This document is the canonical design and grows one ticket at a time. It currently covers the **core tier**
— the platform-neutral, headlessly-tested logic that loads and interprets a recorded run — plus the settled
**stack decision**. The rendering tiers (graph view, replay controls, live in-browser runs, sweep charts)
extend it as they land.

Read first: [`packages/tallysim/docs/design.md`](../../tallysim/docs/design.md) (the simulator whose output
this viewer reads — especially its *Trace & replay format* and *Discovery simulation* sections) and
[`packages/tallynet/docs/design.md`](../../tallynet/docs/design.md) (the lift protocol whose trace events the
viewer animates).

## What it reads

The viewer consumes exactly the artefacts `tallysim`'s CLI produces, so a recorded run **replays
identically** in the browser:

- a **trace** — a versioned NDJSON file (one `header` line, one `network` snapshot line, then one
  `tallynet` `TraceEvent` per line) recording one discovery run and the queries it issued;
- **sweep output** — JSON-lines (one `SimRunRecord` per line) and a CSV summary, for the connectivity-vs-metric
  charts.

It never re-implements a parser for these: it wraps `tallysim`'s `parseTrace` / `parseSimJsonLine` and reuses
the model's `Infinity ↔ null` serialisation convention.

## Core tier (`src/core/`)

Pure TypeScript modules with **no browser imports** (no `window`, `document`, canvas, sigma), each unit-tested
under jest with no DOM. Doing the logic first (TDD) keeps the rendering tickets focused on rendering.

| Module | Responsibility |
|---|---|
| `trace-index.ts` | Wrap `parseTrace`; index one trace into per-session, time-ordered event lists + global time bounds. Incremental-friendly (a builder accepts events in chunks for the live-run case). |
| `deanonymise.ts` | Map an anonymised trace nonce back to the exact tally edge (the load-bearing decoder — see below). |
| `timeline.ts` | A pure playback state machine: transport reducers + the derived "active set" (lit nodes/edges, pruned candidates, found plans) at any `currentTime`. |
| `sweep-data.ts` | Parse sweep JSON-lines + CSV into tidy chart series (`{seriesKey, points:{x,y}[]}`), with non-finite values read as absent (never `0`). |

### The de-anonymiser insight

Trace events carry an anonymised `nonce`, **not** a link/edge id. In `tallynet` a nonce is
`makeNonce(sessionCode, linkId)` — the protocol hides a peer's link from relays by design, because only the
link's owner holds the `linkId`. A relay therefore cannot tell which tally a nonce refers to.

The **viewer is not a relay** — it holds the whole network. So it can invert the hash it could never invert
on the wire: for a given `sessionCode` it recomputes `makeNonce(sessionCode, linkIdForTally(i))` for **every**
tally `i` and builds the reverse map `nonce → tally index`. Both ends of a tally derive the same nonce from
the same function, so the mapping is exact. Then:

- every nonce-bearing event (`query-sent`, `query-received`, `candidate-pruned`, `plan-returned`,
  `late-answer-folded`) resolves to an exact **edge**;
- a found plan's `path` (a list of link nonces) resolves to an exact **edge sequence**, which — walked from
  the known originator (`query.from`) across each tally's two endpoints — yields the exact **node path** the
  lift would take.

The reverse map is built lazily per session and cached (sessions are few). An unresolvable nonce or a
non-contiguous walk is surfaced as an explicit sentinel (`undefined`), never silently dropped — for a
well-formed trace of a network the viewer holds, either would signal a bug.

### Playback model

`timeline.ts` is a **pure reducer** the replay UI binds to; it owns no clock (the UI ticket drives time). The
transport state is `{currentTime, playing, speed}`; the **active set** at a `currentTime` is *recomputed* from
every event with `time ≤ currentTime`. Recompute-from-scratch is correct whether the UI scrubs forward or
backward — the property that makes backward seeking trivially right. Nodes and edges accumulate (the explored
subgraph grows with time); each keeps the furthest round/depth seen, and an edge also records its last event
kind. A `late-answer-folded` event re-touches an already-lit edge at a later round in place — not dropped, not
duplicated. The model emits only plain data (node ids, edge = tally index, rounds, prune reasons); all colour
and rendering belong to the graph tier.

## Stack decision

Settled here so the rendering tickets do not re-litigate it.

- **Graph: `graphology` (data model) + `sigma.js` (WebGL renderer).** The target is "usable at thousands of
  nodes." `sigma.js` renders on WebGL and is purpose-built for large graphs; `cytoscape.js` (canvas) and
  `d3-force` (SVG/DOM) both bog down well before that goal because of per-element DOM/canvas cost, so they are
  rejected for the main graph. `graphology` gives a stable in-memory model and a worker-friendly ForceAtlas2
  layout.
- **Layout: ForceAtlas2 in a Web Worker, seeded.** Run layout off the main thread so the page stays
  responsive; seed initial positions deterministically so replays of the *same* network are stable
  frame-to-frame. (Implemented in the graph-view ticket.)
- **Charts: `uPlot`.** Tiny, fast canvas line charts — right for sweep "metric vs. parameter, one line per
  series." (Implemented in the sweeps ticket.)
- **No heavy UI framework.** Controls are small; plain TypeScript modules and minimal DOM helpers keep the
  bundle lean. Revisit only if the control surface outgrows hand-rolled widgets.
- **Build: Vite + TypeScript**, producing a static `dist/` (`base: './'`, so it serves from any path). `tsc
  --noEmit` is the type-check gate; Vite (esbuild) does the bundling.
- **Accessibility:** colour-blind-safe categorical/sequential scales and light + dark themes (the dataviz
  skill's palette is a good starting point). Threaded through the rendering tickets.

## Dependencies

- **`tallysim`** (`workspace:^`) — the trace/sweep formats, the network model, `parseTrace`,
  `parseSimJsonLine`, `linkIdForTally`, and the node↔entity naming.
- **`tallynet`** (`workspace:^`) — imported directly for `makeNonce` (the de-anonymiser) and the
  `TraceEvent` / `Plan` / `PruneReason` types. `tallysim` does not re-export `makeNonce`, so the viewer
  depends on `tallynet` explicitly rather than relying on hoisting.

## Testing

- Jest over `src/core/**` (`trace-index`, `deanonymise`, `timeline`, `sweep-data`) with hand-built fixtures —
  no browser, no sigma.
- `yarn build` type-checks (`tsc --noEmit`) then produces the static bundle (`vite build`) from the app shell.
- A **headless-WebGL smoke test** (rendering a trace in a real browser) is **deferred** — it needs
  Playwright / headless-Chromium and is not reliably agent-runnable; it belongs with CI or a human once the
  graph tier exists.
