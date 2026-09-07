---
provides: ["screen:Attention"]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/domain/rules.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/screens/attention.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/stories/mobile/23-what-needs-my-attention.md
  - design/generated/mobile/screens/Attention.md
depHashes: {}
---

# Consolidation: Attention

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/Attention.tsx` | The screen |
| `apps/mobile/src/data/attention.ts` | `listAttention()` — items across all tallies |

## Decisions

- **Two lists, not one with a badge.** Items waiting on this party are the body; items waiting on somebody else are a footer section, visible but never a demand (story 23 path D).
- **Nothing about automated settling appears.** The fixture deliberately contains no lift item — the absence is the specified behaviour, so a future adapter that surfaced them would fail this screen's intent.
- Empty state reads as a good state, per the story's acceptance criterion.

## Not built here

Setting items aside, deadline urgency, cross-device dismissal, and the history of past items (story 23 paths B, C, E, F, G).

## Revised after review

- **Items are reachable.** Every item was a `Pressable` with no `onPress`, while `route` sat unused
  in the fixture — story 23 step 4 is *getting to the thing*. Routes the app does not have yet fall
  back to the tally the item belongs to rather than navigating into nothing.
- **Ageing is shown.** `waitingSince` was in the fixture and unused; story 23 step 3 asks how long it
  has been waiting. Days are derived in the adapter, not stored, so the same derivation runs when the
  engine hands over a timestamp.
- **No English in the data.** `attention.happy.json` carried sentences (`"Closing — waiting on them
  to settle"`) that the screen printed verbatim, which `global/i18n.md` forbids and an engine will
  never do. The summary is now written from `kind` through `t()`, and the fixture carries data only.
- **No dollar fallback.** `denom ?? 'iso4217:USD'` privileged a unit that `rules.md` does not. The
  amount type now requires its unit, so the case is a compile error rather than a silent dollar.

## Loading

`src/hooks/useLoad.ts`. Five screens had five copies of the same state machine, and three of them
dropped `result.error` — losing both the message and the adapter's word on whether retrying could
help. One hook now owns it, so the next twenty-five screens inherit the fix rather than the bug. It
still wraps the load defensively: in a release build an unhandled rejection is silent, and a
permanent spinner is the worst of both worlds.

## Validation

- `npx tsc --noEmit` clean; `npx jest` passes.
- Captured on `emulator-5560`; the fixture deliberately contains no automated settling.
- Variants via `taleus://screen/Attention?variant=...`.
