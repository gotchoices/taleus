---
provides: ["screen:StandingInvitation"]
mocks: [standing]
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
  - design/stories/mobile/01-invite-a-partner.md
  - design/stories/mobile/10-first-run.md
  - design/stories/mobile/11-my-profile-and-disclosure.md
  - design/stories/mobile/21-ask-to-be-paid.md
  - design/generated/mobile/screens/StandingInvitation.md
depHashes: {}
---

# Consolidation: StandingInvitation

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/StandingInvitation.tsx` | The screen |
| `apps/mobile/src/data/standing.ts` | `readStanding`, `publishStanding`, `withdrawStanding` |
| `mock/data/standing.{happy,empty}.json` | One published, and a party who has none |

`Settings` gained the row that opens it — `navigation.md` has listed it under that tab since the
first slice.

## Decisions

- **The disclosure warning is on the form, not on the result.** Story 11 path C says the party is
  told this is effectively public *before* publishing. Afterwards is too late for the only decision
  that mattered, so the warning sits above the picker, nothing is pre-selected, and publishing waits
  on the party saying they understand.
- **"There is no directory" is on the screen.** Story 10 path E step 2. A party who expects to be
  findable will otherwise wait to be found; the screen says the only way to be found is to hand
  something out, and what to hand out.
- **Extending nothing is the ordinary answer, and presented as useful.** Story 21 path A: the taker
  hands over value, it is recorded, and they spend it from there — which may be worth a better price,
  since they have in effect lent the money up front. A zero limit reads as a working offer, not a
  grudging one.
- **Each taker is a separate relationship from the moment it opens.** Story 01 path C.4. The list
  says none of them is bound to what was published, and each row opens its own tally.
- **Withdrawing touches nothing that came from it.** Those tallies stopped being this invitation's
  business when they opened, and the screen says so rather than leaving a party to wonder whether
  withdrawing unpicks them.
- **No expiry.** An ordinary invitation runs out on a timer because it waits for one answer. This
  waits for any number and stands until withdrawn — which is the difference the whole screen turns
  on, not a field that was left out.

## Not built here

Actually copying to the clipboard, sharing to another app, and rendering the code for print — the
screen shows the link and marks it copied. `CreateInvitation` has the same gap, and it is the one
thing here that needs a platform API rather than a decision. A printable link: a token carries a
colon, so it reaches the card as `inv%3Ajan-standing-4b2`. Fixing that means tokens without colons,
which is an identifier decision for the engine rather than something a screen should paper over. A responder's side is `ReviewInvitation`,
which already handles a token it did not expect.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 139 tests in 16 suites; `npm run lint` no errors.
- Nine tests in `__tests__/standing.test.tsx`.
- Captured on `emulator-5566`.
