---
provides: ["screen:Cadre"]
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
  - design/stories/mobile/14-my-cadre.md
  - design/stories/mobile/51-change-my-address.md
  - design/generated/mobile/screens/Cadre.md
depHashes: {}
---

# Consolidation: Cadre

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/Cadre.tsx` | The screen |

It reads `devices.ts` — the same machines `Devices` lists, asked a different question. `Devices`
asks what can act as this party; this asks what would survive losing one.

## Decisions

- **The honest split is the screen.** Story 14 steps 3 and 4. Tallies are the less fragile part
  because the counterparty holds them too — and the very next sentence says that safety is
  *borrowed*: it rests on the other party keeping their copy and being willing to produce it. A
  partner who vanishes leaves the party with nothing of their own to point at. Saying the first half
  without the second would be the app promising something it does not control.
- **Private records are named in the party's own words.** Rates, preferences, their view of their
  affairs — not "state" or "replication". Path A asks for exactly this, and the screen contains no
  infrastructure vocabulary at all.
- **Each machine says what it does, and a phone says only one of the two.** Holds a copy; stays on;
  or both. That is the whole of why adding something changes anything.
- **Hosting by somebody else is stated with nothing to press.** Path B: a different decision from
  adding a machine of your own, with the privacy cost said plainly. The offer comes from a friend,
  not from this screen, so an action here would blur exactly what the story says not to blur.
- **Adding and retiring live on `Devices`.** One list, one place to change it. This screen owns the
  consequence — what you would give up if removing leaves you with one — and hands over.
- **Nothing to arrange, and reachability is not maintained by hand.** Paths D and E, and story 51:
  replace a phone, move a node, change providers, and no partner has to be told. The number disclosed
  to a partner is something the party *told* them; it is not how machines find each other, and the
  screen separates the two.

## Not built here

Standing up a machine, choosing a provider, and what one costs — story 14 § Open leaves all of it to
the platform. Story 50's recovery half, and the total-loss case, wait on `RecoverySetup`.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 166 tests in 18 suites; `npm run lint` no errors.
- Six tests in `__tests__/devices.test.tsx`.
- Captured on `emulator-5566`.
