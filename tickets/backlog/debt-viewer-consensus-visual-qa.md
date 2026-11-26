description: Someone needs to open the network viewer and watch a payment settle on screen to confirm the new sign-and-settle animation actually looks right — the code was built and type-checked but never run with human eyes.
files: packages/tallysim-viewer/src/replay/controls.ts, packages/tallysim-viewer/src/replay/paint.ts, packages/tallysim-viewer/src/app/theme.ts
difficulty: easy
----

## Why this exists

The consensus (sign-and-settle) animation in the tallysim-viewer replay tier (ticket
`tallysim-viewer-consensus`) was implemented and passes every automated gate — unit tests, type-check, lint,
production build. But the browser-only pieces (the transport panel in `controls.ts` and the on-screen overlay
in `paint.ts`) can only be confirmed by **looking at them running in a browser**, and that was never done — the
implementing and reviewing agents are headless. This ticket is that look. It needs a human (or a browser-driving
session) at a screen; it is not agent-runnable in the normal pipeline.

Nothing here is a known defect. It is a validation gap: confirm the thing looks and behaves as designed, and
turn any surprises into their own fix/backlog tickets.

## Recipe

1. Build a commit trace and a void trace from the sweep fixture:
   - Extract the `base` block of
     `packages/tallysim/experiments/commit-vs-found/specs/refuser-sweep.json` into a standalone scenario JSON
     (it carries `network`, `workload`, `consensus:{refuserFraction:0}`, `consensusSeed`).
   - `yarn workspace tallysim trace scenario.json --query 0 --out /tmp/commit.ndjson`
     (`refuserFraction:0` ⇒ the lift commits).
   - Raise `refuserFraction` so a referee refuses, re-run ⇒ a void trace (`/tmp/void.ndjson`).
2. `yarn workspace tallysim-viewer dev`, load each trace, press play.

## What to confirm by eye

- **Phases read in order:** promises light the route (teal/cyan) → referee vote previews (green for a
  commit-pending `C` vote, crimson for `NC`) → on commit the whole route turns solid green; on void the held
  hops flash crimson briefly then clear back to resting.
- **Scrub back across settlement un-settles** the route (it returns to the promised/in-flight look), and
  scrubbing forward re-settles it.
- **Selecting the lift in the side list isolates its route** (dims the rest); the outcome word
  (committed / voided / stalled) is correct.
- **Consensus colours visibly win over the discovery spread** on settled hops.
- **The void flash is actually brief** at the default `VOID_FLASH_MS = 400` (virtual-time ms, exported from
  `paint.ts`). If traces compress time differently than assumed, the flash may look too short or too long on
  screen — this is the one tunable to adjust if it reads wrong.
- **Colour-by-session + consensus interaction:** with colour-by-session on, the consensus layer overrides each
  session's hue on its settled hops **by design**. Confirm that still reads acceptably, or flag it.
- **Palette CVD check:** the `promised` / `committed` / `voidFlash` triad (`app/theme.ts`, light + dark) was
  chosen for colour-blind separation but **not** run through the dataviz palette validator. The one risky pair
  (committed-green vs voidFlash-red) never co-occurs (commit XOR void) and is backed by the badge text — but
  eyeball both themes and/or run the validator to confirm.
