---
# Screenshot configuration — appId and scheme come from design/specs/project.md
appId: org.sereus.taleus
scheme: taleus

screenshots:
  - route: TallyList
    variant: happy
    file: tally-list-happy.png
    deps:
      - apps/mobile/src/screens/TallyList.tsx
      - mock/data/tallies.happy.json
  - route: TallyList
    variant: empty
    file: tally-list-empty.png
    deps:
      - apps/mobile/src/screens/TallyList.tsx
      - mock/data/tallies.empty.json
  - route: TallyView/tally%3Asam-bike
    variant: happy
    file: tally-view-happy.png
    deps:
      - apps/mobile/src/screens/TallyView.tsx
      - mock/data/tally.happy.json
      - mock/data/requests.happy.json
  - route: TallyView/tally%3Apriya-new
    variant: happy
    file: tally-view-new.png
    deps:
      - apps/mobile/src/screens/TallyView.tsx
      - mock/data/tally.happy.json
  - route: TallyView/tally%3Asam-bike
    variant: error
    file: tally-view-unreachable.png
    deps:
      - apps/mobile/src/screens/TallyView.tsx
      - mock/data/tally.error.json
  - route: TallyView/tally%3Adave-hours
    variant: happy
    file: tally-view-hours.png
    deps:
      - apps/mobile/src/components/Amount.tsx
      - mock/data/tally.happy.json
  - route: TallyHistory/tally%3Asam-bike
    variant: happy
    file: tally-history-happy.png
    deps:
      - apps/mobile/src/screens/TallyHistory.tsx
      - mock/data/entries.happy.json
      - mock/data/requests.happy.json
  - route: Attention
    variant: happy
    file: attention-happy.png
    deps:
      - apps/mobile/src/screens/Attention.tsx
      - mock/data/attention.happy.json
  - route: Position
    variant: happy
    file: position-happy.png
    deps:
      - apps/mobile/src/screens/Position.tsx
      - mock/data/position.happy.json
---

# Screenshots

Captured from a release build on `emulator-5560` (the AVD named in `.env.ports.local`), driven by
deep link — `taleus://screen/<Route>[/<id>][?variant=&locale=]`.

| Screen | Variant | Shows | Preview |
|--------|---------|-------|---------|
| Tally list | happy | six tallies, one offered and figureless | ![](tally-list-happy.png) |
| Tally list | empty | nothing yet, and what to do about it | ![](tally-list-empty.png) |
| Tally view | happy | a tally with history, terms both ways | ![](tally-view-happy.png) |
| Tally view | new tally | story 04's actual scene: zero, explained | ![](tally-view-new.png) |
| Tally view | unreachable | story 04 path C: reads anyway, pending marked | ![](tally-view-unreachable.png) |
| Tally view | hours | a unit that divides by sixty — `6 07/60` | ![](tally-view-hours.png) |
| Tally history | happy | entries with the side of each balance | ![](tally-history-happy.png) |
| Attention | happy | what waits, how long, and reachable | ![](attention-happy.png) |
| Position | happy | per unit, then a marked estimate | ![](position-happy.png) |

Notes:

- `appeus/scripts/build-images.sh` expects a debug build talking to Metro. These were captured from a
  release build instead, because the app bundles its JS and needs no dev server — simpler to
  reproduce and closer to what a reviewer would install.
- The app takes about five seconds from cold start to first paint on this AVD; a capture taken any
  sooner is a picture of the splash screen. An earlier round of these images was exactly that.
- A tally id contains a colon, which a URL path treats as a scheme separator — encode it as `%3A`
  (`taleus://screen/TallyView/tally%3Asam-bike`) or React Navigation's linking will not match.
- Cold start after a fresh install takes ~20s to first paint on this AVD; warm launches ~13s. Launch
  once to warm the app before a capture run, or the first image is a blank screen.
- Captured after the React Native 0.87 upgrade, so the tab bar has icons and the headers are React
  Navigation's own.
