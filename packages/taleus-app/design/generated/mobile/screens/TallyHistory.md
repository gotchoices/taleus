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

## Revised after review

- **Balance-after states its side.** "Balance $180.00" put the sign back on the reader, which is the
  one thing this app does not do — and `balanceAfter.perspective` was in the fixture all along.
  Story 24 step 4 now says so explicitly.
- **Entry direction is not colour.** "Which way it went" (story 24 step 2) was green or red on the
  amount and nothing else — unreadable for the ~8% of men with red-green deficiency, and an
  inference even for everyone else, since the sign convention on `Entry.amount` was undocumented.
  It is now documented on the type, and `Amount` renders word, sign, and colour together.
- **`answers` is rendered**, and the fixture that had an entry answering a request on a *different
  tally* was corrected. Entries are now keyed by tally, so that class of mistake does not recur.
- **Requests are labelled by direction**, as on `TallyView`.

## Loading

`src/hooks/useLoad.ts`. Five screens had five copies of the same state machine, and three of them
dropped `result.error` — losing both the message and the adapter's word on whether retrying could
help. One hook now owns it, so the next twenty-five screens inherit the fix rather than the bug. It
still wraps the load defensively: in a release build an unhandled rejection is silent, and a
permanent spinner is the worst of both worlds.

## Validation

- `npx tsc --noEmit` clean; `npx jest` passes.
- Captured on device; `__tests__/TallyHistory.test.tsx` asserts the screen leaves loading and keeps requests beside the ledger.
- Variants via `taleus://screen/TallyHistory?variant=...`.
