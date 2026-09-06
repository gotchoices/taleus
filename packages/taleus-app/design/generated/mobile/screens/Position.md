---
provides: ["screen:Position"]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/domain/rules.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/screens/position.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/stories/mobile/40-my-position.md
  - design/stories/mobile/41-my-exchange-rates.md
  - design/generated/mobile/screens/Position.md
depHashes: {}
---

# Consolidation: Position

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/Position.tsx` | The screen |
| `apps/mobile/src/data/position.ts` | `readPosition()` — per unit, estimate, spending power |

## Decisions

- **Owed and owing are separate rows per unit**, never pre-netted — story 40 step 2.
- **The estimate names its exclusions** from the fixture's `excluded` list, so a smaller number is never mistaken for a poorer party.
- **The estimate's caption states the conservative direction**, matching `rules.md` § Amounts.
- **Spending power is a separate card** in two parts — held by others, credit extended — with a note that credit is somebody's willingness and that spending it elsewhere depends on reach.

## Not built here

Position over time, concentration by counterparty, unsettled movement, and setting rates (stories 40 paths C-E, 41).

## Defensive loading

Each screen's load is wrapped so an unexpected throw becomes the failed state with its message,
rather than a spinner that never resolves. This came out of watching a screen hang on a device with
nothing in the log: in a release build an unhandled rejection is silent, and a permanent spinner is
the worst of both worlds — no information for the user and none for us.

## Validation

- `npx tsc --noEmit` clean; `npx jest` passes.
- Captured on `emulator-5560`; the estimate names its exclusions.
- Variants via `taleus://screen/Position?variant=...`.
