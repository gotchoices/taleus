description: Confirm by eye that the viewer's sign-and-settle animation looks right. An agent first builds two ready-made sample payments (one that commits, one that voids) that load from a menu, so the developer's check is a few clicks and a look.
prereq: tallysim-viewer-ux-implement
files: packages/tallysim-viewer/src/replay/controls.ts, packages/tallysim-viewer/src/replay/paint.ts, packages/tallysim-viewer/src/app/theme.ts, packages/tallysim-viewer/src/app/sample-network.ts, packages/tallysim-viewer/public/, packages/tallysim/experiments/commit-vs-found/specs/refuser-sweep.json
difficulty: easy
----

The consensus animation (`tallysim-viewer-consensus`) passes every automated check, but its browser-only parts (transport panel `controls.ts`, overlay `paint.ts`) have never been watched. Agents are headless, so a person has to look. Waits for the UX rework so the check happens on the final interface.

## Part 1: agent prepares (runnable in tess)

- Generate two small trace files from the refuser sweep's base scenario (`packages/tallysim/experiments/commit-vs-found/specs/refuser-sweep.json`, `yarn workspace tallysim trace`): one where the payment **commits** (no refusers), one where it **voids** (a voter refuses). Keep them small enough to read (≈30–60 nodes).
- Commit them under `packages/tallysim-viewer/public/samples/` and add them to the viewer's sample menu as **"Sample: payment commits"** and **"Sample: payment voids"**, loadable with one click (next to the existing "Load sample").
- Run the dataviz palette validator on the `promised` / `committed` / `voidFlash` colours (`app/theme.ts`, light and dark), and fix any failure.
- Then rewrite Part 2 below to match the final UI's actual button and menu names, and leave the ticket for the developer.

## Part 2: developer checks (about 5 minutes)

1. In a terminal: `yarn workspace tallysim-viewer dev`, then open the address it prints.
2. Choose **Sample: payment commits**. Press **Play**.
   - You should see: the route lights up hop by hop (promises), the votes appear, then the whole route turns solid green.
3. Drag the timeline slider back before the end, then forward again.
   - The route should go back to its pre-settled look, then turn green again.
4. Choose **Sample: payment voids**. Press **Play**.
   - The route lights up, then the reserved hops flash red briefly and go back to normal. The status should say "voided".
5. Switch the theme (light/dark) and repeat step 2 or 4. The colours should still be easy to tell apart.

Anything that looks wrong or confusing: tell the agent in a sentence or two; it files the fix.
