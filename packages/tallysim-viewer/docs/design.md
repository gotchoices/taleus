# TallySim Viewer design

The **TallySim Viewer** is a static, server-less browser app that *shows* a simulated Taleus tally network:
entities as nodes, tallies as edges, a payment search lighting up the graph as it spreads outward, and the
routes it finds. It is a **development tool** — a window onto what `tallysim` records — not part of the
Taleus client (`taleus-app`). It may be published to the web later, so it stays a **static build with no
server**: everything runs in the browser from files a developer loads.

This document is the canonical design and grows one ticket at a time. It currently covers the **core tier**
— the platform-neutral, headlessly-tested logic that loads and interprets a recorded run — the **graph tier**
(the `graphology` model, the seeded worker layout, and the `sigma` renderer), the **app shell** (load a
network, draw it, search it, switch theme), and the settled **stack decision**. The remaining rendering tiers
(replay controls, live in-browser runs, sweep charts) extend it as they land.

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

## Graph tier (`src/graph/`)

The bridge from a loaded `tallysim` `Network` to an interactive WebGL view. Three modules, split so the two
DOM-free ones stay unit-tested and only the renderer needs a browser:

| Module | Responsibility |
|---|---|
| `model.ts` | Build a `graphology` `MultiDirectedGraph` from a `Network` (headless, jest-tested). |
| `layout.ts` + `layout-worker.ts` | Seed deterministic positions, then relax with ForceAtlas2 in a Web Worker; expose a "settled" signal. |
| `render.ts` | The `sigma` 4 renderer: reducers for styling, hover tooltips, node search, WebGL-missing fallback (browser-only, not jest-tested). |

### Graph model

One **node per entity**, one **directed edge per tally**. The key conventions are the load-bearing contract
the later replay ticket relies on, so they live in exactly one place (`model.ts`):

- **Node key** = `entityName(id)` — the entity id as a string (`"0"`, `"1"`, …), the same bijection trace
  events use. The search box therefore looks a node up by the id the user types, with no extra mapping.
- **Edge key** = `linkIdForTally(i)` = `"T{i}"` — the *same* id the tally's discovery link carries, so a
  decoded tally index maps straight to a sigma edge key (no side table).
- **Orientation** is graphology-directed **stock → foil** (`source = entityName(stock)`,
  `target = entityName(foil)`). The renderer draws the arrowhead at the target, so an arrow always points from
  the stock holder to the foil holder — a fixed, readable encoding of a tally's orientation.
- Each edge carries **both directed capacities** (`capStockToFoil`, `capFoilToStock`) verbatim from
  `tallysim`'s capacity model — never re-derived here. A direction may be `0` (a valid state: a balance at a
  credit bound) or `Infinity` (an unlimited limit). Multi-edges (two tallies between one pair) and self-loops
  are permitted; the renderer curves parallels apart so they stay separable.

### Edge-capacity encoding

The renderer, not the model, maps those capacities to pixels — all of it in a sigma reducer reading a mutable
`palette` closure var and a capacity range computed **once** at setup, so a theme switch repaints without
recomputing anything structural:

- **Finite edge** → its **total swing** `capStockToFoil + capFoilToStock` is log-normalised across the finite
  edges and drives *both* thickness (1…5) and a *sequential* single-hue colour ramp (low → high). Thickness and
  colour are a deliberate redundant encoding of the same magnitude.
- **Unlimited edge** (either direction `Infinity`) → a **distinct hue** (`palette.edgeUnlimited`) and a
  **fixed, moderate thickness that is strictly below the finite maximum**. This is the headline requirement: an
  `Infinity` tally must never masquerade as a merely-large finite one, so its thickness deliberately does not
  sit at the top of the finite scale.
- **Orientation arrowhead**: every edge draws `head: 'arrow'` at the target (the foil) — the stock → foil
  direction is always visible.
- **Zero is not missing**: a direction with `0` capacity is still a present edge (drawn with its arrowhead).
  Absence of a tally is the only thing that removes an edge.
- **Hover / search** ride sigma's built-in per-item **state** (`isHovered` / `isHighlighted`), not attributes:
  a lit edge/node switches to `palette.highlight`, thickens, and rises in the depth order. The replay ticket's
  "lit route" will use *custom* state (`customNodeState` / `customEdgeState`), which composes with this because
  the two never touch the same flags.

### Worker layout + seeding

ForceAtlas2 is a physics relaxation whose final shape depends on where nodes **start**, and it is O(n log n)
per iteration — too heavy for the main thread at thousands of nodes. So:

- **Seeded start.** Initial positions are a pure function of the node set and the network's `meta.seed`:
  `seedPositions` lays nodes on a jittered phyllotaxis spiral driven by a deterministic `mulberry32` PRNG keyed
  off that seed. The same network therefore always relaxes from the same start to (modulo worker float drift)
  the same layout — the property that lets a replay of the *same* network line up frame-to-frame.
- **Off the main thread.** `layout-worker.ts` runs ForceAtlas2 in a `graphology-layout-forceatlas2` Web Worker
  that streams positions back onto the shared graph; sigma, bound to the same graph, re-renders as they arrive
  (it listens to graphology's attribute-update events). Pan/zoom stay responsive while the cloud settles.
- **The "settled" signal.** `runLayout` iterates for a size-scaled, capped wall-clock budget, then stops and
  fires `onSettled` — the stable-layout signal the replay ticket waits on before animating. An **edgeless graph
  settles immediately** (no forces to relax, so the worker never starts) and thus can never hang.

## App shell (`src/app/`)

`shell.ts`'s `mountShell` builds a top bar (title + theme toggle), a left control panel, and the graph
container, and owns the one data path this tier needs: **load a network → draw it → search it**.

- **Source.** A picked file is read as text and handed to `indexTrace` (wrapping `parseTrace`) inside a
  `try/catch`; a version/format error surfaces in the panel's status area, never the console. A "Load sample"
  button materialises a ~3000-node scale-free network in-page (`sample-network.ts`) so the view can be
  exercised without a trace file. Either way the shell tears down any prior view/worker, builds the graph,
  mounts the renderer, and starts the seeded layout with `network.meta.seed`.
- **Search** highlights and centres a node by the entity id typed (a `false` return shows a "not found" hint).
- **Theme** toggles light/dark: `storeTheme` + chrome CSS variables + the renderer's `setPalette` — **no layout
  recompute**, because positions are theme-independent.
- `styles.ts` is a CSS **string** injected via a `<style>` element (a `.css` import would need a module `.d.ts`
  shim under `NodeNext`). The live-run and sweep source tabs are marked with seam comments for later tickets.

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

- Jest over the headless modules — `src/core/**` (`trace-index`, `deanonymise`, `timeline`, `sweep-data`) and
  `src/graph/model.ts` — with hand-built fixtures, no browser, no sigma.
- `yarn build` type-checks (`tsc --noEmit`) then produces the static bundle (`vite build`) from the app shell.
  The renderer (`render.ts`) and the shell (`app/**`) are **browser-only** (WebGL, `document`, a Web Worker);
  their gate is the build plus a manual interactivity check (`yarn dev` → "Load sample" → pan/zoom/hover/search
  on ~2–5k nodes), not jest.
- A **headless-WebGL smoke test** (rendering a trace in a real browser, asserting on the result) is **deferred**
  — it needs Playwright / headless-Chromium and is not reliably agent-runnable; it belongs with CI or a human.
