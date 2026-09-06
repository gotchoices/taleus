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

## Defensive loading

Each screen's load is wrapped so an unexpected throw becomes the failed state with its message,
rather than a spinner that never resolves. This came out of watching a screen hang on a device with
nothing in the log: in a release build an unhandled rejection is silent, and a permanent spinner is
the worst of both worlds — no information for the user and none for us.

## Validation

- `npx tsc --noEmit` clean; `npx jest` passes.
- Captured on `emulator-5560`; the fixture deliberately contains no automated settling.
- Variants via `taleus://screen/Attention?variant=...`.
