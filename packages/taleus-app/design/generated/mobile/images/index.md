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
  - route: TallyView
    variant: happy
    file: tally-view-happy.png
    deps:
      - apps/mobile/src/screens/TallyView.tsx
      - mock/data/tally.happy.json
  - route: TallyHistory
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
deep link — `taleus://screen/<Route>[?variant=…]`.

| Screen | Variant | Preview |
|--------|---------|---------|
| Tally list | happy | ![](tally-list-happy.png) |
| Tally list | empty | ![](tally-list-empty.png) |
| Tally view | happy | ![](tally-view-happy.png) |
| Tally history | happy | ![](tally-history-happy.png) |
| Attention | happy | ![](attention-happy.png) |
| Position | happy | ![](position-happy.png) |

Note: `appeus/scripts/build-images.sh` expects a debug build talking to Metro. These were captured
from a release build instead, because the app bundles its JS and needs no dev server — simpler to
reproduce and closer to what a reviewer would install.
