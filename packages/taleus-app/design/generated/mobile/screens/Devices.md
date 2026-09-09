---
provides: ["screen:Devices"]
mocks: [party]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/domain/rules.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/generated/mobile/foundation.md
  - design/stories/mobile/13-my-devices.md
  - design/stories/mobile/12-keys-and-backup.md
  - design/generated/mobile/screens/Devices.md
depHashes: {}
---

# Consolidation: Devices

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/Devices.tsx` | The screen |
| `apps/mobile/src/data/devices.ts` | List, rename, retire, add; quiet-for; `hasAlwaysOn` |
| `apps/mobile/src/data/party.ts` | `Device` gained kind, contribution, hosting, participation |
| `mock/data/party.{happy,single-device}.json` | Three machines, and one |

`Settings` gained the row. Story 43 pointed at this screen in prose last slice and could not link.

## Decisions

- **The screen exists to teach one thing.** Settling with people the party is not directly connected
  to happens by itself, but only while something of theirs is awake — and a phone asleep in a pocket
  is not that. Nothing else on the screen tells them; they have no way to work it out from balances
  that move when they are looking and sit still when they are not.
- **Having only a phone is a consequence, not a defect.** Path A. Stated as what they miss — trades
  that could have settled overnight waiting for them — with "nothing is broken" said out loud. The
  fix is offered once, in the same card, and not repeated.
- **How long, never why.** Path B. A quiet device shows the count of days and says explicitly that
  unplugged, out of signal and gone for good are indistinguishable from here. Guessing on the party's
  behalf would be worse than silence.
- **Retiring is described before it is offered.** It stops future acts and undoes nothing already
  done, and it can be done from any other device — which is what makes it the right first move for a
  phone somebody else is holding (path C).
- **Two different failures, kept different.** The last device is refused outright with the reason
  (path D). A device that cannot be reached is retryable and says nothing changed — a refusal and a
  retry look nothing alike to a party trying to lock a thief out.
- **The provisioning is not invented.** Story 13 § Open leaves what an always-available device is, and
  how a party stands one up, to the platform. Adding one records the decision and says so.

## Not built here

Anything about keys themselves (story 12) — what this phone is actually holding, and recovery.
`RecoverySetup` is deferred on off-device custody. Story 50's loss-and-recovery half depends on the
same decision.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 166 tests in 18 suites; `npm run lint` no errors.
- Eleven tests in `__tests__/devices.test.tsx`.
- Captured on `emulator-5566`.
