# tallysim-viewer

A static, server-less browser app that draws a **simulated** Taleus tally network and animates a payment
search spreading across it — entities as nodes, tallies as edges, the discovery wavefront lighting up the
graph, and the routes it finds. It is a **development tool** for understanding `tallysim` runs, not part of
the Taleus client app. It may be published to the web later, so it stays a plain static build.

**Status:** scaffold + headless **core** tier only. The core (trace indexing, nonce de-anonymisation,
playback state, sweep parsing) is built and unit-tested; the graph view, replay controls, live in-browser
runs and sweep charts land in later tickets, which replace the current app-shell stub.

It reads exactly what `tallysim`'s CLI writes: a replayable **trace** (versioned NDJSON) and **sweep** output
(JSON-lines + CSV). It never re-implements those parsers — it wraps `tallysim`'s `parseTrace` /
`parseSimJsonLine`.

```
yarn workspace tallysim-viewer dev     # local dev server (Vite)
yarn workspace tallysim-viewer build   # type-check (tsc --noEmit) + static build into dist/
yarn workspace tallysim-viewer test    # jest over the headless src/core modules
yarn workspace tallysim-viewer lint    # eslint ./src
```

**Stack (settled):** Vite + TypeScript; `graphology` + `sigma.js` (WebGL) for the graph; `uPlot` for sweep
charts; no heavy UI framework. See [docs/design.md](docs/design.md) for the full design, the stack rationale,
and the de-anonymiser insight that lets the viewer map an on-the-wire nonce back to the exact tally edge.
