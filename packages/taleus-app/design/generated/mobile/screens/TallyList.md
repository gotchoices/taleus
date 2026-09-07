---
provides: ["screen:TallyList"]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/domain/rules.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/screens/tally-list.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/stories/mobile/04-first-look-at-an-open-tally.md
  - design/stories/mobile/06-find-a-tally.md
  - design/generated/mobile/screens/TallyList.md
depHashes: {}
---

# Consolidation: TallyList

## What was built

`apps/mobile/src/screens/TallyList.tsx`, plus the plumbing this first slice necessarily establishes:

| File | Role |
|------|------|
| `src/data/config.ts` | The single mock/engine switch (`interfaces.md` § Run modes) |
| `src/data/types.ts` | App-side shapes mirroring `interfaces.md` |
| `src/data/tallies.ts` | `listTallies()` — fixtures in mock mode, engine later |
| `src/mock/variant.ts` | Variant selection from a deep link; screens never see it |
| `src/i18n/` | `t()` plus bundled `en` strings |
| `src/theme/tokens.ts` | Semantic tokens from `global/ui.md` |
| `src/util/amount.ts` | Whole-number amounts formatted with their unit |
| `metro.config.js` | Watches the project root so `mock/data` resolves |
| `mock/data` (symlink) | Points at the shared fixtures, as `ser/health` does |

## Decisions this slice had to make

- **Results, not exceptions.** `listTallies()` returns `{ ok }` so an unreadable list is a state the
  screen renders rather than a crash. The error variant's fixture carries `retryable`, and the retry
  affordance appears only when it is true.
- **i18n without a library.** `global/i18n.md` requires that no user-visible string sit in a screen,
  from the first slice. A minimal `t()` satisfies that today; moving to i18next is mechanical because
  screens only ever call `t()`.
- **Perspective drives the direction, not sign arithmetic.** `balance.perspective` decides the
  wording, the sign glyph, and the colour; no screen infers a direction from a number.
- **Tabular figures** on balances, per `global/ui.md` § Amounts.
- **A row that opens something looks like one.** `OpenableRow` — pressed state, chevron, 48dp — so a
  reader can tell a list of things to open from a document.

## Revised after review

- **An offer is no longer shown with a balance.** `Rae Whitfield — settled — 0.000 CHIP` was wrong
  twice: an offer has no balance and is not settled. States before `Open` now lead with the state
  chip and suppress the figure (story 06 path C).
- **`lastActivity` is rendered.** It was in the fixture and the string table and nowhere on screen —
  story 06 path B is three Chens told apart by recency.
- **States and *needs you* are chips, not grey text.** Invisible on a list of forty, which is exactly
  the case story 06 path A is about.

## Not built here

Sorting, filtering, and search (story 06); the cross-unit estimate, which belongs to `Position` and is
deliberately absent from a list where units differ.

## Loading

`src/hooks/useLoad.ts`. Five screens had five copies of the same state machine, and three of them
dropped `result.error` — losing both the message and the adapter's word on whether retrying could
help. One hook now owns it, so the next twenty-five screens inherit the fix rather than the bug. It
still wraps the load defensively: in a release build an unhandled rejection is silent, and a
permanent spinner is the worst of both worlds.

## Validation

- `npx tsc --noEmit` clean.
- `npx jest` passes (the scaffold's render test now renders `TallyList`).
- Variants exercised by `taleus://screen/TallyList?variant=happy|empty|error`.
