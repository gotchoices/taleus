# Target STATUS (phase checklist)

This file tracks progress for a single app target (`<target>`). It is meant to be updated by the human (with agent assistance).

Phases are defined in `appeus/docs/DESIGN.md` (authoritative).

## Bootstrap / Discovery (shared)
- [x] `design/specs/project.md` is complete enough to proceed
- [x] (Mobile targets) App id applied in the native build trees — `org.sereus.taleus`

## Story Generation (this target)
- [x] Stories exist under `design/stories/mobile/` — 29 written and human-reviewed, three rounds of
  feedback processed; only `25-my-records-in-my-books` remains a stub, deferred until cross-app
  sharing on the platform is understood

## Navigation Planning (this target)
- [x] `design/specs/mobile/navigation.md` exists — derived from the stories, awaiting human review
- [x] `design/specs/mobile/screens/index.md` lists 30 screens/routes, with a suggested slice order

## Domain Contract (shared)
- [x] `design/specs/domain/` is sufficient for this target's early slices — `rules.md` and
  `interfaces.md`, the latter now carrying what the apps ask of the engine

## Screen/Component Slicing (this target)
- [x] Five screens sliced end to end — `TallyList`, `TallyView`, `TallyHistory`, `Attention`,
  `Position` — each with a spec, a consolidation, generated code, a registry entry, and hashed
  dependencies. All five read `false | hash` from `check-stale.sh`.
- [x] All five re-generated against `design/ui-review.md` — correctness fixes, the shared UI
  foundation (`useLoad`, `useTokens`, `Amount`, `Card`/`Row`, `Chip`), hardware back, touch targets,
  and accessibility roles. Responses and deferrals: `design/ui-review-response.md`.
- [x] React Native upgraded 0.82.1 → 0.87.1, which unblocked React Navigation and Ionicons. The
  hand-rolled navigator is deleted; the tab bar has icons; back is the platform's own.
- [x] The shared layer every screen sits on is recorded in
  [`design/generated/mobile/foundation.md`](../../generated/mobile/foundation.md) and is a dependency
  of all five slices, so changing it marks them stale
- [x] `Welcome` and `ChooseName` — first run, built from story 10 with **no screen spec**: the story
  was enough, so nothing was written to override it
- [x] `CreateInvitation` and `ReviewInvitation` — a tally coming into existence, from both sides,
  built from stories 01 and 02 with no screen specs
- [x] `ReviewOffer` — countering, and the case where two offers end up signed at once. The invitation
  arc is complete: a tally can be offered, answered, negotiated and read
- [ ] The remaining 20 screens in `screens/index.md`; next is the paying arc — `PayPartner`,
  `CreateRequest`, `RequestView` (stories 20, 21, 22)

## Mock mode (this target)
- [x] `mock/data/` carries the first fixtures — party, tallies, tally, entries, requests, attention,
  position — shaped to the domain contract, standing in for an engine that does not exist yet
- [x] The data layer's single switch point exists — `apps/mobile/src/data/config.ts`
- [x] Mock fixtures are registered as slice dependencies, so editing one marks its screen stale

## Scenario / Peer Review (optional)
- [x] Screenshots for eight screen/variant pairs under `design/generated/mobile/images/`, captured
  from a release build by deep link — including story 04's own two scenes, a new tally and an
  unreachable counterparty
- [x] Scenario docs under `design/generated/mobile/scenarios/` — one per story, covering every story a
  coded screen serves (04, 06, 07, 10, 23, 24, 40). Sixteen linked states, each verified to land on
  the device through `preview-scenarios.sh`.

## Final wiring
- [ ] Production data wiring is implemented and tested

Deliberate deferrals are recorded in [`design/STATUS.md`](../../STATUS.md), not here.


