description: Write a user-experience spec for the network viewer so a first-time user understands what they are looking at and how to drive it, from loading or generating a network through watching a payment search and settlement to comparing sweeps. Spec only; implementation follows in `tallysim-viewer-ux-implement`.
prereq: tallysim-viewer-voter-model
files: packages/tallysim-viewer/, packages/tallysim-viewer/docs/design.md, packages/tallysim/docs/design.md, packages/tallynet/docs/STATUS.md
difficulty: hard
----

**Model: run this ticket with Fable** (the developer's request, 2026-11-26). tess picks models by difficulty only, so the orchestrating session runs this one with a Fable agent instead of the tess runner. The implementation ticket runs in tess as normal.

The developer tried the viewer, generated a graph, and didn't understand how to use it. The viewer grew feature by feature (graph view, trace replay, live runs, sweep charts, consensus animation, camera controls, and the voter-model view in `tallysim-viewer-voter-model`) without an overall design for how someone new finds their way.

## Deliverable

A spec in `packages/tallysim-viewer/docs/ux.md`, linked from `docs/design.md`, that an implementing agent can build from without further questions:
- **Who and why.** The users are the developer and protocol researchers, and maybe the public later if the sim is published. The tasks: see what a network looks like, watch one payment find a route and settle, understand why one failed, and answer "how connected must a network be before payments route?" across sweeps.
- **Information architecture.** Modes and how they relate (generate/live, replay a trace, sweeps); what is on screen in each; what the user does first.
- **Onboarding.** An empty state that offers a sensible first action. A guided first run (generate a small network, run one payment, watch it). Legends for every colour, size and animation, and a hint for every control.
- **Reading a payment.** How the search, found routes, voter set, promises, votes, commit/void and the record's flow are shown and explained. Clicking a node or edge explains what it is and what happened to it.
- **Large networks.** How the UI stays legible at 2,000+ nodes: filtering, focus on the active route, level of detail. How the backlog ideas `feat-tallysim-viewer-3d` and `feat-tallysim-viewer-fisheye-lens` fit. Recommend whether either should be built before or with the implementation.
- **Sweeps.** Choosing parameters, reading the charts, and jumping from a chart point to a sample network or trace.
- Wireframes (ASCII or SVG in the doc), and a prioritised list of changes to the current viewer. Note what to remove or merge, not only what to add.

Review the current viewer first: read the code and `docs/design.md`, and drive it in a browser if one is available.
