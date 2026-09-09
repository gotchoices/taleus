---
provides: ["screen:AttentionHistory"]
mocks: [attention]
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
  - design/stories/mobile/23-what-needs-my-attention.md
  - design/generated/mobile/screens/AttentionHistory.md
depHashes: {}
---

# Consolidation: AttentionHistory

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/AttentionHistory.tsx` | The screen |
| `apps/mobile/src/data/attention.ts` | `listPast`, `setAside`, `bringBack`, `soonWithinDays` |
| `mock/data/attention.{happy,empty,error}.json` | Outcomes, deadlines, and a week's backlog |

`Attention` gained what a history needs to be about: deadlines, setting aside, and routing to the
request itself.

## Decisions

- **Every entry names an outcome.** The story's sentence is the design: nothing quietly disappears,
  and an item leaving the list is an event with an outcome rather than an absence.
- **The two outcomes that are not answers say so.** One that ran out unanswered is marked as having
  stopped being answerable, which is not the same as being handled. One the party set aside is still
  unanswered, with nothing having reached the other side. Both would otherwise read as "dealt with".
- **Setting aside writes nowhere near the tally.** Path F step 3 forbids confusing it with a refusal,
  so the adapter records it in the attention layer alone, and the wording says what did *not* happen —
  nothing reached the counterparty, nothing was answered, nothing owed or agreed changed.
- **Urgency is derived, not read.** `expires` becomes `daysLeft`, and a deadline inside a week is
  coloured. Path B is explicit that the party should not be doing date arithmetic to tell a request
  that runs out on Friday from an offer good for another month.
- **A request item lands on the request.** Items now carry `requestId`. The old comment saying those
  routes were unsliced was three slices stale; `RequestView` exists and this is where the story sends
  the party.
- **A session count, not a persisted one.** Path C asks that a party working through eleven things
  can tell what they have already handled *this session*. It resets when they leave, because that is
  what the sentence means.

## Fixed along the way

**An amount that carries its own unit could not carry a non-decimal one.** `UnitAmount` held only
`denom` and `scale`, so ten Dave-hours rendered as six hundred and a unit's own mark was lost. It now
carries the whole unit, and `unitOf` moved into `data/types.ts` from a private copy in `Position`
that had the same gap. Latent until this slice put an hours figure in a cross-tally list.

## Not built here

Story 23 path G — dealing with something on one device settling it on every device — needs the engine.
The screen is written so that arriving with an item already resolved reads correctly.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 179 tests in 19 suites; `npm run lint` no errors.
- Thirteen tests in `__tests__/attention.test.tsx`, covering both screens.
- Captured on `emulator-5566`.
