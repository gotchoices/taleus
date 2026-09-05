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

- **No navigator yet.** `App.tsx` renders `TallyList` directly. React Navigation earns its place with
  the second screen; installing it now would add native dependencies for one route.
- **Results, not exceptions.** `listTallies()` returns `{ ok }` so an unreadable list is a state the
  screen renders rather than a crash. The error variant's fixture carries `retryable`, and the retry
  affordance appears only when it is true.
- **i18n without a library.** `global/i18n.md` requires that no user-visible string sit in a screen,
  from the first slice. A minimal `t()` satisfies that today; moving to i18next is mechanical because
  screens only ever call `t()`.
- **Perspective drives colour, not sign.** `balance.perspective` decides both the wording and whether
  the figure reads as positive or negative to this party — no screen does sign arithmetic.
- **Tabular figures** on balances, per `global/ui.md` § Amounts.

## Not built here

Sorting, filtering, and search (story 06); opening a tally (`TallyView`); the cross-unit estimate,
which belongs to `Position` and is deliberately absent from a list where units differ.

## Validation

- `npx tsc --noEmit` clean.
- `npx jest` passes (the scaffold's render test now renders `TallyList`).
- Variants exercised by `taleus://screen/TallyList?variant=happy|empty|error`.
