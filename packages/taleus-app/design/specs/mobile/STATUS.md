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
- [ ] Key screens/components have specs under `design/specs/mobile/screens/` and `.../components/`
- [ ] Slices are being generated one at a time with test/commit pauses

## Mock mode (this target)
- [x] `mock/data/` carries the first fixtures — party, tallies, tally, entries, requests, attention,
  position — shaped to the domain contract, standing in for an engine that does not exist yet
- [ ] The data layer's single switch point exists in `apps/mobile/src/data/` (lands with the first slice)

## Scenario / Peer Review (optional)
- [ ] Scenario docs/images exist under `design/generated/<target>/scenarios/` and `design/generated/<target>/images/`

## Final wiring
- [ ] Production data wiring is implemented and tested


