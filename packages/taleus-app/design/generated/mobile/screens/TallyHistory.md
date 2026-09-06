---
provides: ["screen:TallyHistory"]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/domain/rules.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/screens/tally-history.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/stories/mobile/24-tally-history.md
  - design/generated/mobile/screens/TallyHistory.md
depHashes: {}
---

# Consolidation: TallyHistory

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/TallyHistory.tsx` | The screen |
| `apps/mobile/src/data/entries.ts` | `listEntries()` — signed entries with resulting balance |
| `apps/mobile/src/data/requests.ts` | `listRequests()` — outstanding and part-answered requests |

## Decisions

- **Requests render in the list header, not as rows.** The story is emphatic that a request sits beside the ledger; making it a header rather than an entry is how that reads without a caption doing the work alone.
- **Every entry shows the balance that resulted**, so the current figure can be followed back — story 24's reason for existing.
- **Routed entries are labelled** distinctly from ones a party made, since a passer-through never chose it.
- Part-answered requests show what was applied and the days outstanding, per the invoice rework in stories 21 and 22.

## Not built here

Narrowing by period, size, exact amount, or purpose; entry detail; export (story 24 paths B, C, E).

## Defensive loading

Each screen's load is wrapped so an unexpected throw becomes the failed state with its message,
rather than a spinner that never resolves. This came out of watching a screen hang on a device with
nothing in the log: in a release build an unhandled rejection is silent, and a permanent spinner is
the worst of both worlds — no information for the user and none for us.

## Validation

- `npx tsc --noEmit` clean; `npx jest` passes.
- Captured on device; `__tests__/TallyHistory.test.tsx` asserts the screen leaves loading and keeps requests beside the ledger.
- Variants via `taleus://screen/TallyHistory?variant=...`.
