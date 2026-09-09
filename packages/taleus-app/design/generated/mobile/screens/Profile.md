---
provides: ["screen:Profile"]
mocks: [profile]
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
  - design/stories/mobile/11-my-profile-and-disclosure.md
  - design/generated/mobile/screens/Profile.md
depHashes: {}
---

# Consolidation: Profile

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/Profile.tsx` | The screen |
| `apps/mobile/src/data/profile.ts` | The record, the disclosures, corrections, requests |
| `apps/mobile/src/util/fields.ts` | The field vocabulary both directions read |
| `apps/mobile/src/components/Input.tsx` | A labelled text field |
| `mock/data/profile.{happy,empty,error}.json` | Jan's record and six counterparties |

## Decisions

- **Two lists, because step 2 is a promise.** What the party holds and what the party has sent are
  separate in the shape, not merely separate on the screen: a single list would break the promise
  whatever the adapter did. The card says it in words as well — writing something down tells nobody.
- **A correction is offered, never assumed.** Path D. Changing a value others hold raises a card
  naming who has the old one, with each of them pickable; authorizing none sends nothing and the
  party's own record still shows the new value. Nothing is sent for having been listed.
- **Delivery is reported per counterparty.** Only some of a set will reach, and a correction that did
  not arrive must not be shown as though it had. The `error` fixture makes one counterparty
  unreachable, which is story 11's own error variant.
- **The old statement stays.** A correction is a new statement, not an erasure (path D step 4), so
  both remain in `sent` and `DisclosureView` marks the earlier one rather than dropping it.
- **The field vocabulary is fixed.** "You have no address for them" is only sayable against a list of
  what could have been there. Two string families per field — a heading form and a sentence form —
  because which words a language capitalises mid-sentence is the language's business, not a
  transformation this app can make.

## Not built here

Choosing what to disclose **at formation** (steps 3-5): `CreateInvitation` and `ReviewInvitation`
were generated before this slice and do not offer it. The `rae-offer` fixture carries `pending: true`
disclosure so the state exists and reads correctly; wiring the choice into those two screens marks
them stale and belongs with them. Path C — a standing invitation's disclosure being effectively
public — belongs to `StandingInvitation`.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 102 tests in 13 suites; `npm run lint` no errors.
- Fourteen tests in `__tests__/disclosure.test.tsx` cover this screen and `DisclosureView` together,
  because the story's claims span both.
- Captured on `emulator-5566`.
