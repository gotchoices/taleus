description: Record the actual route a payment search found in the trace file, so a replay can draw the winning path instead of only marking where and when it was found.
files: packages/tallynet/src/trace.ts, packages/tallynet/src/discovery/originator.ts, packages/tallysim/src/sim/trace-format.ts (TRACE_FORMAT_VERSION), packages/tallysim-viewer/src/replay/routes.ts, packages/tallysim-viewer/src/replay/controls.ts
----

## Why

When the network viewer replays a recorded payment search, it can light up the graph precisely — every
explored edge, every pruned branch — because each trace event carries a nonce the viewer can decode back to
the exact tally. But it **cannot draw the route the search actually found.** A recorded trace does not contain
the winning route's path: the `tallynet` `plan-found` event is path-less, and `plan-returned` carries only a
single per-node inbound nonce. The ordered sequence of links that make up the found route is therefore not
recoverable from the event stream without *guessing* it (walking the union of returned tallies), and the
viewer's design forbids guessing — edge lighting must be precise, not inferred, and inference misorders
branching searches and multiple concurrent plans.

So today a replay of a **loaded trace file** shows only the found **markers** — which node found a route, at
what time, and how many were found — plus an honest note that the exact path is not in the format. The full
found-routes list (hop count, per-link terms, and click-to-isolate the route on the graph) only works when the
path is supplied another way: the future live-run source (which holds `QueryOutcome.plans[i].path` directly) or
a test. The whole reconstruction path in `routes.ts` is already built and tested; it just has no data to run on
for a loaded trace.

## What to build

Have the **originator** include its own found plan's ordered link-nonce path on the `plan-found` trace event.
This is safe to disclose: the originator *owns* the search result — it already holds the full plan — so putting
the plan's path on its own event reveals nothing a relay didn't already contribute. (This is unlike relay
events, which must never carry a peer's link id; that invariant still holds for every other event.)

Expected shape of the change:

- **`tallynet`** — add the path (the ordered link nonces, and ideally the per-link terms if they are already
  on the originator's plan) as an **additive** field on the `plan-found` `TraceEvent` variant. Only the
  originator populates it; no other emitter changes. Keep the disclosure invariant intact for every other
  event.
- **`tallynet` originator** — populate the new field from the plan it just selected.
- **`tallysim`** — bump `TRACE_FORMAT_VERSION` (the on-disk format changed) and make sure the header/parse path
  round-trips the new field. Existing older traces are rejected by the version check, as designed (no backwards
  compat yet).
- **`tallysim-viewer`** — once trace events carry the path, the replay can feed it straight into the existing
  `routes.ts` reconstruction (via the same `ReplayRouteSource` seam `controls.ts` already uses for the
  live-run/test case), so a loaded trace draws exact found routes with no viewer-side inference. Drop the
  markers-only note on the path that now has real data.

## Acceptance

- A trace recorded after this change carries each found route's ordered link-nonce path on its `plan-found`
  event.
- Loading that trace in the viewer draws the found route(s) exactly (hops + terms + isolate-on-select), not
  just the finder/time markers.
- The disclosure invariant is preserved for every non-`plan-found` event; `plan-found`'s path comes only from
  the originator.
- `TRACE_FORMAT_VERSION` is bumped and the parser round-trips the new field.

Context: the viewer-side gap and the markers-only fallback are documented in
`packages/tallysim-viewer/docs/design.md` § Replay tier (*Found routes — and the trace-format gap*).
