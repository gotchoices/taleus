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

## Navigation, and why it is not React Navigation

This slice introduced the second screen, which is where a navigator earns its keep. React Navigation
is what `global/toolchain.md` names, but `react-native-screens@4.27.0` fails codegen against React
Native 0.82.1 and only nightlies exist beyond it. The app therefore carries a small navigator of its
own (`src/navigation/`) with no native dependencies: one stack per tab, deep-link parsing, and the
same `{ route, navigation }` shape screens would get from the real library. Tracked as
`debt-mobile-navigation-library`.

## Not built here

Acting on terms, closing, paying, and the amendment history (stories 03, 05, 20) — separate screens.

## Defensive loading

Each screen's load is wrapped so an unexpected throw becomes the failed state with its message,
rather than a spinner that never resolves. This came out of watching a screen hang on a device with
nothing in the log: in a release build an unhandled rejection is silent, and a permanent spinner is
the worst of both worlds — no information for the user and none for us.

## Validation

- `npx tsc --noEmit` clean; `npx jest` passes.
- Captured on `emulator-5560` via `taleus://screen/TallyView/tally%3Asam-bike`.
- Variants via `taleus://screen/TallyView?variant=...`.
