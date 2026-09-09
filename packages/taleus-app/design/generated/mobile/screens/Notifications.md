---
provides: ["screen:Notifications"]
mocks: [notifications]
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
  - design/stories/mobile/43-notifications.md
  - design/stories/mobile/23-what-needs-my-attention.md
  - design/generated/mobile/screens/Notifications.md
depHashes: {}
---

# Consolidation: Notifications

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/Notifications.tsx` | The screen |
| `apps/mobile/src/data/notifications.ts` | Classes, delivery, lock-screen detail, participation |
| `mock/data/notifications.{happy,error}.json` | Granted, and refused with the phone left out |
| `mock/data/party.error.json` | A party whose only device is the phone in their hand |

`Settings` gained the row. Six built screens promise a counterparty is told something; this is the
first that says what "told" means.

## Decisions

- **Four classes, chosen by what the party's real question is.** Not by which subsystem raised the
  event: `signature` needs them to sign, `asked` is somebody's claim on them, `arrived` is a
  courtesy, `automatic` is value moving under authority they already gave. Story 43 step 5 is
  precisely the distinction between the first and the third.
- **The app classifies; the phone decides.** Step 6. There are no quiet hours here — the party has
  them where they expect them, and a second set would fight the first. The screen says so, which is
  what makes an honest classification worth anything.
- **`automatic` is a row, not an omission.** It shows with a fixed "Nothing until I look" and the
  reason. Leaving it out would look like the app had simply not thought about it; showing it fixed
  says the app is not quietly deciding its own events deserve the party.
- **The lock-screen sample is the actual line.** Path C says the party chooses to reveal more "having
  been shown what that reveals", so each option carries the notice it would put in front of whoever
  is standing there. Minimal is the default and the only safe one.
- **Grouping and landing are stated, never offered.** Paths E and F, and step 3. A party should not
  have to ask for one interruption instead of twelve, or for a notice to lead somewhere; a toggle for
  either would imply the other behaviour was acceptable.
- **Participation is not a message, and never a promise.** Path B. Being roused shows the party
  nothing and leaves nothing to dismiss; it is best effort because a phone decides for itself what it
  will do unattended. A party who wants it dependable is pointed at a machine of theirs — read from
  their devices, not stored as a preference, because the answer is not a setting.
- **Refusal costs are stated once.** Path D. The classes still read while notifications are off:
  turning them back on is the phone's business, and the screen says where.

## Not built here

Any actual notification. Nothing in this app can raise one yet — no push transport, no permission
request, no background task. This screen is the policy those will read, which is the half that is a
design decision rather than a platform integration. Devices (13) and the cadre (14), which path B
points at, are unsliced; the screen names them in prose rather than linking into nothing.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 149 tests in 17 suites; `npm run lint` no errors.
- Ten tests in `__tests__/notifications.test.tsx`.
- Captured on `emulator-5566`.
