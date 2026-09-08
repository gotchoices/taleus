---
provides: ["screen:TallyView"]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/domain/rules.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/screens/tally-view.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/stories/mobile/04-first-look-at-an-open-tally.md
  - design/stories/mobile/07-review-the-agreement.md
  - design/generated/mobile/screens/TallyView.md
depHashes: {}
---

# Consolidation: TallyView

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/TallyView.tsx` | The screen |
| `apps/mobile/src/data/tally.ts` | `readTally()` — terms both directions, agreement, disclosure |
| `apps/mobile/src/components/Screen.tsx` | Shared loading / failed / empty states |
| `apps/mobile/src/util/date.ts` | Dates in the reader's locale |

## Decisions

- **Terms are rendered from the reader's side**, each row labelled by who extended it. The fixture carries `terms.mine` and `terms.theirs` already oriented, so no screen computes a perspective.
- **Room to spend is its own row**, captioned as credit the counterparty extended rather than value held — story 04 step 6 and the rule in `rules.md` § Credit.
- **Disclosure carries a caveat line**: what is absent may be withheld or never held. Story 11's correction, surfaced where a reader would otherwise draw a conclusion.
- **Requests are a section, not a ledger line**, with a note that only signed entries move the balance (story 24, `rules.md` § Requests).
- Sections are plain cards; `global/ui.md` owns the tokens and nothing here hardcodes a colour.

## Navigation

This slice introduced the second screen, which is where a navigator earns its keep. It first shipped
with a hand-rolled one, because `react-native-screens` failed codegen against the React Native the
app was on. That turned out to be the app's problem rather than the library's — current libraries
declare native commands with React 19's `React.ComponentRef<>`, which React Native's codegen accepts
only from 0.84 onward.

React Native was upgraded 0.82.1 → 0.87.1 and the local navigator deleted. `src/navigation/` is now
React Navigation: a bottom-tab navigator over three native stacks, deep links in `linking.ts`, route
types in `routes.ts`. Screens were written against `{ route, navigation }` from the start, so the
swap did not touch them. `debt-mobile-navigation-library` carries the detail.

## Not built here

Acting on terms, closing, paying, and the amendment history (stories 03, 05, 20) — separate screens.

## Revised after review

- **Both effective dates.** The screen printed `terms.mine.effective` and dropped `terms.theirs`,
  which is a different day. Story 07 step 3 wants the date the terms took effect; there are two.
- **Dates are dates.** `effective` is a calendar day, not an instant: `2026-03-02` rendered through
  the reader's zone came out as March 1. `interfaces.md` § Dates and instants now says which is
  which, and `formatCivilDate` reads days in UTC while `formatInstant` reads moments locally.
- **Unreachable is not unreadable.** The error variant rendered *this tally could not be read*, which
  story 04 path C explicitly rules out — it is this party's record too. The fixture now returns the
  tally with `counterpartyReachable: false` and a list of what is pending, and the screen says so
  without hiding anything. The story's own variant line said "terms cannot be read"; that line was
  the root of the defect and was fixed too.
- **Requests say which way they run.** The section was headed "Being asked of you" and listed a
  request this party had made. `PaymentRequest.direction` was typed, in the fixture, and never read.
- **Next actions** remain absent, deliberately: Pay, Request, and Terms are unsliced, and a button
  that routes nowhere is worse than no button. Recorded here rather than stubbed.

## Amount notation

Figures are written as a whole number and a common fraction, per
[`domain/amounts.md`](../../../specs/domain/amounts.md) — no decimal point anywhere, because
`1.000 CHIP` is one CHIP to an American and a thousand to a German. `src/util/amount.ts` splits by
integer arithmetic (quotient and remainder against the unit's divisor, sign held aside) and
`components/Amount.tsx` draws it. No screen does either itself.

## Loading

`src/hooks/useLoad.ts`. Five screens had five copies of the same state machine, and three of them
dropped `result.error` — losing both the message and the adapter's word on whether retrying could
help. One hook now owns it, so the next twenty-five screens inherit the fix rather than the bug. It
still wraps the load defensively: in a release build an unhandled rejection is silent, and a
permanent spinner is the worst of both worlds.

## Validation

- `npx tsc --noEmit` clean; `npx jest` passes.
- Captured on `emulator-5560` via `taleus://screen/TallyView/tally%3Asam-bike`.
- Variants via `taleus://screen/TallyView?variant=...`.
