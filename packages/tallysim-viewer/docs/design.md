# TallySim Viewer design

The **TallySim Viewer** is a static, server-less browser app that *shows* a simulated Taleus tally network:
entities as nodes, tallies as edges, a payment search lighting up the graph as it spreads outward, and the
routes it finds. It is a **development tool** — a window onto what `tallysim` records — not part of the
Taleus client (`taleus-app`). It may be published to the web later, so it stays a **static build with no
server**: everything runs in the browser from files a developer loads.

This document is the canonical design and grows one ticket at a time. It currently covers the **core tier**
— the platform-neutral, headlessly-tested logic that loads and interprets a recorded run — the **graph tier**
(the `graphology` model, the seeded worker layout, and the `sigma` renderer), the **app shell** (a `Graph |
Sweep` view-mode toggle over: load a network, draw it, search it, switch theme), the **replay tier** (the
transport that plays a payment search across the graph), the **sweeps view** (parameter-sweep charts), the
**live-run tier** (generate + search a network in the browser), and the settled **stack decision**.

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
| `sweep-data.ts` | Read sweep JSON-lines + CSV to a common `SweepTable` (rows + role-classified columns), then to tidy chart series (`{seriesKey, points:{x,y}[]}`) — with non-finite **and** distribution-`count:0` values read as a gap (never `0`), repeated seeds collapsed to a mean per cell, and series aligned onto a shared x-axis. See § Sweeps view. |

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

### Camera controls

`render.ts` also owns the viewer's camera chrome — an on-screen button cluster, keyboard shortcuts, and a
dismissible mouse-gesture hint — built against sigma's `Camera` (`x`, `y`, `angle`, `ratio`, `animate()`,
`zoomIn()`/`zoomOut()`, `reset()`). The key insight that avoids any manual bounding-box math: sigma auto-scales
the graph's node extent to fit exactly the normalized frame `{x: 0.5, y: 0.5, ratio: 1}`
(`DEFAULT_CAMERA_STATE`), so that state *is* "whole graph, fitted to the viewport" — **Fit** is
`camera.animate({x: 0.5, y: 0.5, ratio: 1})` (keeps the current rotation angle), and **Reset** is
`camera.reset()`, the same state plus `angle: 0` (also exactly the camera's state right after mount). A rotated
non-square graph can have its corners clipped by Fit's axis-aligned re-frame — an accepted trade-off for a dev
tool, not a bug.

- **On-screen cluster**: six buttons (zoom in/out, Fit, Reset, rotate left/right) absolutely positioned in the
  graph container's bottom-right, each with an `aria-label`.
- **Keyboard shortcuts**, scoped to the graph by attaching the `keydown` listener to the container itself
  (`tabIndex = 0`) rather than `document` — a listener on an element only fires when it or a descendant has
  focus, so this is inert while a panel input is focused, with no boolean tracking needed: `+`/`=` zoom in,
  `-`/`_` zoom out, `0` reset, arrow keys pan (step scaled by the camera's current `ratio`, so pan speed stays
  proportional to zoom level), `[`/`]` rotate. Reset (not Fit) takes `0` because it is the more complete action
  — Fit stays reachable via its button for "re-frame without un-rotating".
- **Mouse-gesture hint**: a dismissible overlay naming the drag-to-pan / wheel-to-zoom gestures (not the
  keyboard shortcuts), persisted via a `tallysim-viewer:camera-hint-dismissed` `localStorage` key once
  dismissed (the same try/catch pattern as `theme.ts`'s `storeTheme`).
- **Cleanup gotcha**: the graph container is not recreated between loads (`shell.ts`'s `teardown()` only clears
  its children), so the `keydown` listener attached directly to the container — unlike the tooltip/controls/
  hint elements, which are children removed on `destroy()` — must be explicitly `removeEventListener`'d there,
  or each repeated load stacks another listener.

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

## Replay tier (`src/replay/`)

The replay tier **plays a recorded payment search across the graph**: the frontier lights up round by round,
pruned branches fade, sleeping/late nodes are marked, and the routes the search found are listed. It splits
the same way the graph tier does — the logic is pure and tested; only the transport loop and the panel touch
the browser.

| Module | Responsibility | Tested |
|---|---|---|
| `clock.ts` | The pure rAF-clock math: `advanceClock`, `clampToBounds`, `progressFraction`, `timeAtFraction`. | jest |
| `routes.ts` | Pure found-route reconstruction + the explicit `SessionFoundState` classifier. | jest |
| `paint.ts` | Pure `ActiveSet` + conditions + isolate → a plain `ReplayOverlay` (round colours, pruned fade, sleeping/late marks). No sigma. | jest |
| `controls.ts` | The rAF transport + the panel (play/pause/speed/scrub, session picker, colour-by-session, found list). Browser-only. | build + manual |

### One clock, one seek path

`core/timeline.ts` is a pure reducer that owns no clock: it derives the "active set" (lit nodes/edges, pruned
candidates, found-plan markers) from a `currentTime` by **recomputing from every event with `time ≤ t`**.
`clock.ts` is the other pure half — given the wall-clock delta between two frames and the speed, it computes
the next head time. `controls.ts` is the only browser piece: each `requestAnimationFrame` tick it advances the
clock, seeks the reducer, builds the overlay (`paint.ts`), and hands it to the renderer. Scrubbing feeds the
*same* seek path (a direct time, not a delta), so backward scrubbing is as correct as forward play — there is
no incremental cursor to rewind. A playing clock auto-pauses at the end (`advanceClock`'s `atEnd`).

### Precise edge lighting via de-anonymisation

Edge lighting is **precise, never inferred**. Each session gets its own `Timeline`, built with a
`resolveTally` bound to the whole-network `Deanonymiser` (`deanon.tallyOfNonce(code, nonce)`), so every
nonce-bearing event resolves to the exact tally edge it touched (see *The de-anonymiser insight*). A
`late-answer-folded` event re-touches an already-lit edge at a **later** round in place (the reducer keeps the
max round), and `paint.ts` colours it at that later round — so a folded late answer reads as reaching further
out, not as a duplicate.

### Overlay + palette (how the paint reaches the screen)

`paint.ts` emits a plain `ReplayOverlay` — `{ nodes: Map<nodeKey,{color?,size?}>, edges:
Map<edgeKey,{color?,size?,zIndex?,hidden?,note?}>, dim? }` — with **no** sigma import, keyed by the one
documented conventions (`edgeKeyForTally`, `entityName`). `render.ts` gains `setReplayOverlay(overlay)`; its
node/edge reducers compose three layers in order: the resting capacity style, then the overlay (the keyed
style, or the `dim` colour for everything outside a selected route), then the built-in hover/selection accent,
which **wins on top**. The overlay is a separate channel from sigma's `isHovered`/`isHighlighted` state, so the
two never collide. `theme.ts` carries the replay colours in the one shared palette: a warm, colour-blind-safe
`roundScale` (chosen to separate from the cool-blue capacity edges), plus `pruned`, `sleeping`, `late` and
`dimmed`, each with its own light and dark steps.

### Conditions-derived sleeping / late

A trace does not record which nodes slept — it records the scenario. The viewer recompiles the node conditions
to recover them: `compileConditions(index.network, header.scenario.conditions ?? {}, header.scenario.conditionsSeed ?? 0)`
returns `{ conditions, sleeping, late }` (tallysim conditions option **(b)**: the `late` set is returned
alongside `sleeping` so the viewer can render the two distinctly without re-deriving the per-link map).
**Seed note:** the CLI `cli/trace.ts` compiles with `conditionsSeed = scenario.conditionsSeed ?? 0` — *without*
the per-run offset the sweep runner applies — so the viewer must use the same seed to reproduce the exact
sets. Sleeping and late are **markers only**: a sleeping *target* does not mean the query failed (a neighbour
can resolve the peer-match); only a sleeping non-target relay actually blocks. The renderer encodes this as
colour, not as any failure semantics.

### Found routes — and the trace-format gap

The found-routes side list shows each route's hop count and per-link terms, and selecting one **isolates** it
(`routeEdgeTallies` + the overlay `dim`), dimming everything else. `routes.ts` reconstructs a route's exact
node path from its **link-nonce path** via the de-anonymiser. The catch: **a recorded trace does not carry
found-plan paths.** The `tallynet` `plan-found` event is path-less, and `plan-returned` carries only a single
per-node inbound nonce, so the winning route's ordered path cannot be recovered from the event stream without
*inferring* it — which would violate the "precise, not inferred" rule. So for a **loaded trace** the panel
shows the `plan-found` **markers** (finder node + time + count) and the honest `SessionFoundState` (loading /
searching / no-route / found), plus an explicit note that the exact path is not in the format. The full
list — with exact-path isolation — lights up only when a `ReplayRouteSource` supplies the link-nonce paths:
the live-run source (a later ticket, from `QueryOutcome.plans[i].path`) or a test.

**Deferred clean fix:** have the originator's `plan-found` event carry its own plan's path nonces. The
originator owns the search result, so this discloses nothing a relay could not already infer from its own
return — unlike relay events, it adds no disclosure. It is a cross-package change (a `tallynet` `TraceEvent`
additive field, the originator emission, and a `TRACE_FORMAT_VERSION` bump in tallysim), deliberately out of
the viewer's scope; it is filed as a backlog ticket.

**The gap is closed for a *settled lift's* route.** A v2 consensus trace records, per settled session, a
`lifts[]` header entry carrying the lift's exact `route` + `tallyPath` (see *Consensus phase* below). So the
chosen route that settled *is* in the format and is drawn precisely — no inference. What stays markers-only is
discovery's *other* found plans (a session can find several routes but settle only one); recovering those still
needs the deferred `plan-found`-carries-path fix above.

### Consensus phase

A v2 trace produced from a scenario with a `consensus` block drives each query's **lift** (the atomic
sign-and-settle across the found route) to settlement and records, per settled session, a `TraceLiftEntry` in
the header's `lifts[]`. The replay tier animates that settlement on top of the discovery spread.

**Why the header entry is needed.** A consensus `TraceEvent` (`record-pushed`, `promise-signed`,
`referee-vote`, `settled`, `resources-released`, …) addresses nodes by their **member key** (a public
per-lift address), not by entity id, and carries no link nonce. Neither the node nor the hop is placeable from
the event alone. The `TraceLiftEntry` closes this: `memberKeys` maps each member key → entity id, and the
index-aligned `route` + `tallyPath` give the `(from, to) → tally` for each hop (hop `i` joins
`route[i] ↔ route[i+1]` on `tallyPath[i]`). `core/trace-index.ts`'s `createLiftResolver` folds those into the
two resolvers (`entityOfMember`, `tallyOfEdge`), the latter keyed by an **order-independent** unordered pair —
so a circular lift's repeated originator, which sits on two *distinct* pairs, stays unambiguous.

**The reducer** (`core/timeline.ts`). A session's `Timeline` is bound to its lift (a `ConsensusBinding`); the
active set then gains a `ConsensusState` recomputed from scratch at each `currentTime` (so a backward scrub
un-settles, exactly like the discovery set). It tracks, per lift: which hops a promise has reached, each member
node's phase (promised < voted < settled, with its `C`/`NC` vote), and the settled `decision` + `settledTime`.
Edge phases follow the decision: **commit ⇒ every `tallyPath` hop is `committed`** (the whole route reads
solid); **void ⇒ only the promised hops are `released`** (flash then clear); **no decision (in-flight /
stalled) ⇒ the promised hops stay `promised`**. A member key the lift did not map lands in `unresolved` (a
malformed-trace sentinel, surfaced, never silently dropped). A v1 / discovery-only trace binds no lift, so the
active set carries no `consensus` key and discovery replay is byte-for-byte unchanged.

**The overlay** (`paint.ts` + `theme.ts`). The consensus layer composes **over** the discovery spread (it is
later in event time, so it wins the hops/nodes it touches) and is **suppressed in isolate mode** (isolate stays
the green route selection). Three palette entries carry it, each with light + dark steps:
`promised` (teal/cyan, promise in flight, keeps capacity thickness), `committed` (solid green, a size boost),
and `voidFlash` (crimson). Nodes mirror this: a `voted` node previews `committed` (vote `C`) or `voidFlash`
(vote `NC`) before the lift settles; a `settled` node is `committed` on commit, or flashes `voidFlash` on void.
The flash window is `VOID_FLASH_MS` of **virtual** (trace) time measured from `settledTime`; after it, a
released hop/node is *not keyed*, so it falls back to its resting/discovery style. (If a `settled` event sits
within that window of the trace's last event, the flash can still show at `t = max` — acceptable.)

**The side list and the closed-loop case** (`routes.ts` + `controls.ts`). When the selected session has a
lift, the found-routes list shows its chosen route from `liftRoute` (classified `path` or `loop` — a circular
lift whose `route` returns to its origin) with an outcome **badge** from `liftOutcome` (committed / voided /
stalled, the lift's final decision at its own `sessionEnd`); selecting it isolates the route via `liftIsolate`
(exact nodes + tallies from the header, no decode) and dims the rest. Multiple lifts in one trace each animate
on their own session/route; picking a session selects its lift.

## Live-run tier (`src/live/`)

The live-run tier **runs a payment search in the browser** instead of loading a recorded one: a developer picks
a generator and params, generates a network, clicks a payer and a payee, runs the real `tallynet` discovery
search, watches it animate, and downloads the run as a trace. It is the tier that finally lights up the **full**
found-routes list (exact-path isolate-on-select) — closing the loop the Replay tier's *trace-format gap* left
open (see § Found routes — and the trace-format gap), because the live source *drives* the search and so holds
each plan's link-nonce path directly.

| Module | Responsibility | Tested |
|---|---|---|
| `build-scenario.ts` | Pure form-values → `SimScenario` + `QuerySpec` translation (the nominal single-query workload, the fixed run seed). | jest |
| `sim-run.ts` | Pure per-run core: build the trace `header` for a minted session code; map found `QueryOutcome.plans` → `RouteInput`s. | jest |
| `sim-protocol.ts` | The type-only `postMessage` contract between the worker and the panel. | — |
| `sim-worker.ts` | The Web Worker: generate the network, run the discovery search, stream the trace envelope back. | build + manual |
| `controls.ts` | The panel (the form, the one worker, the generate → pick → run → download flow). Browser-only. | build + manual |

### Generate and discover in a worker

Generation (a settled graph + layout) and the discovery search are expensive and must not freeze the page, so
both run in a module Web Worker (`sim-worker.ts`). Only two things cross back to the main thread: the **network
snapshot** (drawn once) and the **streamed trace events** (one per `postMessage`, in time order). The in-worker
engine is the *same* platform-neutral `tallysim` core + `tallynet` the CLI records with — no server, no Node —
so a live run behaves exactly as a recorded one. The contract is **one run at a time** (no run-correlation id):
the panel drives each run to its `done`/`error` before issuing the next.

Two phases share one kept network: `generate` materialises it once (kept read-only in worker scope), and each
`run` builds a fresh `buildSimNetwork` over it and searches the one picked payment. A fresh `buildSimNetwork`
per run restarts the session-code RNG at its fixed seed, so a single-query live run byte-matches a
`tallysim trace` single-query trace of the same seeds — the cleanest reading of *same params + seed ⇒
byte-identical trace*.

### Header from the first event (determinism note)

A trace header lists the query's session code, but the code is minted *inside* `discover()` and is not knowable
synchronously. Unlike the Node CLI (which reruns to learn it), the live path never needs a second pass — it
animates the one real run it observes, and every `TraceEvent` carries its `sessionCode`. So the worker builds +
posts the header on the **first** event; a zero-event degenerate run (`from === to`, `< 2` entities, or an
edge-less network) posts the header from the resolved `outcome.sessionCode` instead, so the panel can still
build an index.

### The trace-envelope reuse (a live run is a byte-compatible trace)

The live path reuses the trace machinery end-to-end: `buildTraceHeader` + `makeNetworkSnapshot` +
`serializeTraceLine` produce the same `header`/`network`/`event` lines the CLI writes, and the panel feeds the
streamed events into the **same** `trace-index → timeline → paint → replay` path a file load uses (via the
incremental `TraceIndexBuilder`). So a finished live run animates through the identical replay, and **Download
trace** emits a byte-compatible NDJSON trace (reusing the kept snapshot verbatim) that, reloaded via the File
tab, replays identically — it replays the *recorded* events, it never re-runs the search.

### The panel and the shell (host contract)

`controls.ts` owns the worker and the form; it does **not** own the graph or the replay panel — the shell does.
The panel defines a `LiveRunHost` the shell implements (`renderNetwork` draws a generated network and returns
the view to wire click-to-pick onto; `mountReplay`/`mountDisabledReplay` swap the replay panel; `palette` hands
over the theme), and the shell's Source section gains a **File | Live-run** tab toggle over the two sub-panels.
Both source paths feed the one shared graph view and replay panel, so a theme toggle re-palettes a live run for
free (the picked payer/payee marks re-theme with it). Click-to-pick writes into number `from`/`to` inputs that
are the **source of truth** (the editable fallback when WebGL or clicking is unavailable); Run reads them.
**Cancel** is a hard `Worker.terminate()` + a fresh worker (which loses the kept network), followed by a
**silent** re-generate that refreshes the worker's network scope without re-drawing — so the graph and the
picks survive a cancel.

## Sweeps view (`src/sweeps/`)

The sweeps view charts a **parameter sweep**: one measured outcome against one varied parameter, one line per
series. It answers the question `tallysim` exists to ask — e.g. *how does the chance a payment routes
(`pRouteExists` / `pFoundGivenExists`) rise as the network grows more connected (`edgesPerNode`, `meanDegree`)?*
It is the second main mode of the shell, reached by the `Graph | Sweep` toggle. Like the other rendering tiers
it splits pure-from-browser: the series maths is the tested `core/sweep-data.ts`; only the loader glue and the
uPlot renderer touch the DOM.

| Module | Responsibility | Tested |
|---|---|---|
| `core/sweep-data.ts` | Read both formats to a `SweepTable`; classify columns; default the pickers; group distribution families; rows → series → mean-per-cell → aligned. | jest |
| `source.ts` | Detect a file's format (extension, else sniff) and dispatch to the right reader; carry an embedded sample sweep. | jest (`source.test.ts`) |
| `chart.ts` | The uPlot line renderer (one line per series, palette colours, gaps, live legend, resize). | build + manual |
| `view.ts` | The panel (file loader + x / metric / sub-field / series-by pickers) wiring the above to the chart. | build + manual |

### Both record kinds, read by the columns present

`tallysim` writes two record shapes and the view reads **whichever columns are present** — it never assumes one:

- an **oracle** `RunRecord` (route-existence experiments): `pRouteExists`, `routeExistsCount`, and a `pathLength`
  distribution;
- a **discovery** `SimRunRecord` (found-vs-oracle experiments): `pFoundGivenExists`, `foundCount`, cost
  distributions (`timeToFirstPlanMs`, `messages`, `nodesTouched`, …), and a `pruneReasons` numeric tally.

Both JSON-lines and the CSV summary flatten to the **same** column vocabulary (`core/sweep-data.ts` flattens the
nested JSON-lines record exactly as `tallysim`'s `serialize-records.ts` flattens it into the CSV), so a sweep
loaded from `.jsonl` and from `.csv` yields identical lines — pinned headlessly by `sweep-data.test.ts`. Each
column is classified as a `dimension` (`generator`/`capacity`), a `param`, the `seed`, or a `metric`, which
drives the pickers: the **x-axis** offers any numeric column that is not the seed (a swept param, or a headline
metric like `meanDegree`); the **metric** offers the scalar metrics plus one entry per distribution family; the
**series-by** offers the dimensions and the other varied params.

### What becomes a gap, and why never `0`

A missing point is always a **line gap**, never a plotted `0` — a `0` would read as a real measurement:

- **Non-finite values** — e.g. an unbounded `maxFlow`, serialised as JSON `null` / an empty CSV cell — are read
  as *absent* by `sweep-data`, so the point is simply omitted.
- **A distribution with no samples** is the load-bearing subtle case. `tallysim`'s `summarizeDistribution`
  reports `count: 0` with *every* scalar a finite **`0`** (not `Infinity`/`NaN`), so plotting `pathLength.mean`
  where `pathLength.count === 0` would draw a spurious `y = 0`. The view guards this with
  `SeriesSpec.gapWhenZeroColumn = ${family}.count`, so that cell becomes a gap — **except** when the chosen
  sub-field *is* `count`, where `0` is a real value and takes no guard.

### Seed handling: mean per cell, not a per-seed scatter

A sweep repeats each `(dimension, param…)` cell over several `seed`s, so a series holds several points at the
same x. The view **averages them to one mean point per `(series, x)` cell** (`meanPerCell`) and notes this under
the pickers. It deliberately does **not** scatter the raw per-seed points: uPlot's aligned-data model holds one
`y` per `x` per series, so coincident-x seeds cannot be shown without faceting, and raw points would clutter a
multi-series line chart. Aggregating-and-documenting is the chosen trade; if per-seed spread ever matters, a
min/max band per cell (a second uPlot series) is the natural extension.

### Rendering (uPlot)

`chart.ts` wraps `uPlot` (see § Stack decision). The series it draws are already tidy (`alignSeries`: a shared
ascending x-axis, `null` for a gap), so it feeds uPlot its `AlignedData` directly. Notes that bit a first
implementation: uPlot defaults the x scale to **time** (disabled via `scales.x.time = false`, since x is a
plain swept number); the legend is relocated below the plot (`legend.mount`) so a tall legend never squeezes the
plot area; `points.show` is on so a single-cell sweep shows its one point; and a `display:none` tab measures
0×0, so the shell calls `relayout()` (→ `chart.resize()`) when the Sweep tab becomes visible. Series colours are
the palette's colour-blind-safe `seriesScale`; the legend/axis text re-themes via the shell CSS variables.

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

- Jest over the headless modules — `src/core/**` (`trace-index`, `deanonymise`, `timeline`, `sweep-data`),
  `src/graph/model.ts`, the pure replay modules `src/replay/{clock,routes,paint}.ts`, and the sweep source
  loader `src/sweeps/source.ts` — with hand-built fixtures, no browser, no sigma.
- `yarn build` type-checks (`tsc --noEmit`) then produces the static bundle (`vite build`) from the app shell.
  The renderer (`render.ts`), the replay transport (`replay/controls.ts`), the sweeps chart + view
  (`sweeps/{chart,view}.ts`) and the shell (`app/**`) are **browser-only** (WebGL, `document`,
  `requestAnimationFrame`, a Web Worker); their gate is the build plus a manual interactivity check (`yarn dev` →
  "Load sample" → pan/zoom/hover/search; load a trace → play / scrub / hover a pruned edge / toggle
  colour-by-session / select a found route; switch to **Sweep** → "Load sample sweep" or a file → change the
  x / metric / sub-field / series-by pickers; confirm the same sweep loaded from `.jsonl` vs `.csv` draws the
  same lines), not jest.
- A **headless-WebGL smoke test** (rendering a trace in a real browser, asserting on the result) is **deferred**
  — it needs Playwright / headless-Chromium and is not reliably agent-runnable; it belongs with CI or a human.
