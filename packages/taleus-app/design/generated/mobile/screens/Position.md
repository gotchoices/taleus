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

## Revised after review

- **The estimate looks like an estimate.** `$137.50` was set exactly like the signed figures above
  it, with a 12pt caption doing all the work. `global/ui.md` now names the treatment — a leading `≈`
  and the secondary colour — and `Amount` owns it.
- **Owed and owing, separately, in the estimate too.** The fixture carried `owedToMe`/`owedByMe`/
  `net`; the screen rendered only `net`, under the label "Net" — jargon the rest of the app avoids.
  Story 40 step 2 is emphatic about this and it was being honoured per-unit but not in the estimate.
- **Zero takes no colour.** `0.000 CHIP` in red read as a warning about nothing.
- **No dollar fallback** for spending power, for the same reason as `Attention`.

## Loading

`src/hooks/useLoad.ts`. Five screens had five copies of the same state machine, and three of them
dropped `result.error` — losing both the message and the adapter's word on whether retrying could
help. One hook now owns it, so the next twenty-five screens inherit the fix rather than the bug. It
still wraps the load defensively: in a release build an unhandled rejection is silent, and a
permanent spinner is the worst of both worlds.

## Validation

- `npx tsc --noEmit` clean; `npx jest` passes.
- Captured on `emulator-5560`; the estimate names its exclusions.
- Variants via `taleus://screen/Position?variant=...`.
