---
provides: ["screen:TallyTerms"]
mocks: [terms]
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
  - design/stories/mobile/07-review-the-agreement.md
  - design/stories/mobile/03-negotiate-terms.md
  - design/generated/mobile/screens/TallyTerms.md
  - design/stories/mobile/08-publishers-i-trust.md
  - design/generated/mobile/screens/Agreement.md
depHashes: {}
---

# Consolidation: TallyTerms

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/TallyTerms.tsx` | The screen |
| `apps/mobile/src/data/tally.ts` | `readTerms`, `readAgreement`, and the shapes behind them |
| `mock/data/terms.{happy,error}.json` | How the terms got here, and the contract |

`TallyView` gained the row that opens it. Its terms card has been readable since the second slice
with nowhere to go from it.

## Decisions

- **Three places a figure can be, kept apart.** In force today, agreed and waiting, merely proposed.
  A raise applies at once; a reduction waits out the notice period and even then does not reach back.
  Collapsing any two of those would tell the reader they may do something they may not, or the
  reverse — which is the whole reason story 07 exists.
- **What governs what is stated, not implied.** With a balance outstanding, the screen says the
  outstanding stays under the terms it was advanced under; with nothing outstanding it says the
  opposite — there is no runway to shorten, so the reduction applies at once (paths D and E).
- **A proposal is not history.** `proposals` is a separate field for that reason. Nothing about a
  proposal changes what either party may do today, and the card says so.
- **The contract is named here and read on `Agreement`.** The card shows its title and
  `PublisherNote`, and opens `Agreement` with the tally, which reads the document from the tally
  itself (story 07 step 5). The terms in force no longer wait on the document at all, so story 07's
  error case (the contract unreadable, the terms readable) holds by construction; the failure and its
  retry are `Agreement`'s. Which figures fill the contract in is said there too.
- **Figures are rendered, never interpolated.** `amountText` returns the *spoken* form, which puts a
  decimal point back into the sentence — the one notation this app does not use. Every figure here
  goes through `Amount`, so "Becomes, on Oct 1" carries a rendered fraction rather than a string.
- **A tally with no recorded history derives its opening pair** from the terms in force. A tally
  nobody has amended has no history to show, which is story 07's `empty` case; a fixture repeating
  what `readTally` already answers would be a second copy to keep in step.

## Not built here

Changing one's own limit — story 03's proposing side. This screen reads; nothing on it binds.
A `Closed` tally: no fixture produces one, so path F is demonstrated on a `Closing` tally instead,
which exercises the same state-independence.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 116 tests in 14 suites; `npm run lint` no errors.
- Ten tests in `__tests__/terms.test.tsx`, one per acceptance criterion this screen owns.
- Captured on `emulator-5566`.

## Contracts (2026-10-11)

The inline document (flat heading/body sections) gave way to the `Agreement` screen once agreements
became Stroc documents with numbered, nested sections and a publisher's standing (story 08).
