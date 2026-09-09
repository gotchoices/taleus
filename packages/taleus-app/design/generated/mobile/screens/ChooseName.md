---
provides: ["screen:ChooseName"]
mocks: [party]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/stories/mobile/10-first-run.md
  - design/stories/mobile/11-my-profile-and-disclosure.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/ChooseName.md
  - mock/data/party.happy.json
  - mock/data/party.first-run.json
depHashes: {}
---

# Consolidation: ChooseName

Built from stories 10 and 11 with no screen spec.

## What was built

`src/screens/ChooseName.tsx`, plus the navigator gate that decides whether first run is showing at
all (`src/navigation/index.tsx`).

## Decisions this slice had to make

- **Told, then asked.** Step 4 (this identity lives on this device, protect it before you hold value)
  sits above the name field rather than on its own screen. It is the last thing the party is told and
  the story says it happens "plainly and once" — a screen of its own would make it a step to dismiss
  rather than a fact to read.
- **The name is required; nothing else is.** Continue does nothing without one, and says why. Story
  10 is explicit that only a display name is wanted up front — so there is no optional field here at
  all, not even a skippable one, because an optional field is still an ask.
- **The promise about later is made here.** Story 10 step 5 and story 11 together: the party is told
  more will be asked *when it matters and by whom*. That sentence is what makes deferring everything
  else honest rather than merely convenient, so it is on screen, not in a help page.
- **A name is the first disclosure.** `setDisplayName` writes it into `disclosed` as well, because
  story 11 step 1 has Sam's name already among what Jan holds. The two are not separate acts.
- **First run is complete when an identity has a name on it** (`isOnboarded`), not when an identity
  exists. That distinction is what lets Welcome create one and still keep the party in first run.

## The navigator gate

`AppNavigator` renders the onboarding stack instead of the tabs until `isOnboarded(party)`. Two
consequences worth recording:

- **The tabs do not exist during first run.** A deep link arriving then matches nothing, so the link
  is held by the session and re-delivered once the tabs mount — story 10 path A, a party arriving via
  an invitation sets up on the way and lands on the invitation. `whenLaunchedByLink` in
  `navigation/linking.ts` is the hook; `session.remember` / `session.resume` are the two halves.
- **The onboarding stack has no linking config.** Its screens are reached by being in first run, not
  by URL; `?variant=empty` is what makes first run reachable for review.
- **Launch parameters are applied before anything reads data.** This slice is the first where that
  ordering matters and it was wrong on the first build: React Navigation asks for the initial URL
  only after the container mounts, by which time the session had already read the party from the
  *default* fixture — so `?variant=empty` produced the tabs, not first run. `applyLaunchParams()` now
  runs at the head of the session's load and the container reuses its result. Any future state that
  is read before navigation exists has the same hazard.

## Not built here

Everything else about a profile — what is held, what was disclosed to whom, adding to it later — is
story 11 and belongs to `Profile` and `DisclosureView`.

## Validation

`npx tsc --noEmit` clean; `npx jest` 37 tests, six of them covering this flow: no identity is a value
not an error, an identity is created with no choices, first run is incomplete until named, Welcome
creates nothing until told to, Continue refuses an empty name, and an established identity skips
first run entirely.
