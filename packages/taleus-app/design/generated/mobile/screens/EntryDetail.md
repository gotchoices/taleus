---
provides: ["screen:EntryDetail"]
mocks: [entries]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/domain/rules.md
  - design/specs/domain/amounts.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/generated/mobile/foundation.md
  - design/stories/mobile/24-tally-history.md
  - design/generated/mobile/screens/EntryDetail.md
depHashes: {}
---

# Consolidation: EntryDetail

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/EntryDetail.tsx` | The screen |
| `apps/mobile/src/data/entries.ts` | `readEntry` |
| `mock/data/entries.error.json` | A routed entry that has not committed |

`TallyHistory`'s rows are pressable now. They have listed entries since the sixth slice with nothing
behind them.

## Decisions

- **Built for the entry nobody recognises.** Path C is the reason this screen exists, so it answers
  the questions a reader would ask in the order they would ask them: how much, which way, when, what
  was written down, who signed it, what it answered. The closing line says that is everything the
  record holds — an honest end to the search, rather than leaving them wondering what else to press.
- **Who signed it, and why that is the rule.** The party who gives the value signs the entry (step 3),
  so the screen states the rule alongside the name rather than only the name.
- **Routed value is said differently.** Nobody handed it over: it moved because a payment found its
  way through this tally (step 5). "You gave Mara this" would be false for it.
- **Unsettled movement was unexercised until now.** The chip and the prospective balance were built
  five slices ago and no fixture ever produced one, so `entries.error.json` now does — story 24 path
  A, and the story's own error variant.
- **The row keeps its layout.** `TallyHistory` uses a bare `Pressable`, not `OpenableRow`: what a
  reader scans there is the figure and the balance after it, and a chevron column would push both.

## Not built here

Narrowing a long history, the running balance over a period, and export (story 24 paths B and E) —
all `TallyHistory`'s, and all still deferred.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 116 tests in 14 suites; `npm run lint` no errors.
- Four tests in `__tests__/terms.test.tsx`.
- Captured on `emulator-5566`.
