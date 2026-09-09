---
# Screenshot configuration — appId and scheme come from design/specs/project.md
appId: org.sereus.taleus
scheme: taleus

screenshots:
  - route: Welcome
    variant: first-run
    file: welcome-first-run.png
    deps:
      - apps/mobile/src/screens/Welcome.tsx
      - mock/data/party.first-run.json
  - route: ChooseName
    variant: naming
    file: choose-name.png
    deps:
      - apps/mobile/src/screens/ChooseName.tsx
      - mock/data/party.naming.json
  - route: CreateInvitation
    variant: happy
    file: create-invitation.png
    deps:
      - apps/mobile/src/screens/CreateInvitation.tsx
      - mock/data/agreements.happy.json
      - mock/data/invitations.happy.json
  - route: CreateInvitation
    variant: empty
    file: create-invitation-first.png
    deps:
      - apps/mobile/src/screens/CreateInvitation.tsx
      - mock/data/invitations.empty.json
  - route: ReviewInvitation/inv%3Ajan-bike-7c1
    variant: happy
    file: review-invitation.png
    deps:
      - apps/mobile/src/screens/ReviewInvitation.tsx
      - mock/data/invitation.happy.json
  - route: ReviewInvitation/inv%3Ajan-bike-7c1
    variant: expired
    file: review-invitation-expired.png
    deps:
      - apps/mobile/src/screens/ReviewInvitation.tsx
      - mock/data/invitation.expired.json
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
  - route: TallyList
    variant: error
    file: tally-list-error.png
    deps:
      - apps/mobile/src/screens/TallyList.tsx
      - mock/data/tallies.error.json
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
  - route: Attention
    variant: empty
    file: attention-empty.png
    deps:
      - apps/mobile/src/screens/Attention.tsx
      - mock/data/attention.empty.json
  - route: Position
    variant: empty
    file: position-empty.png
    deps:
      - apps/mobile/src/screens/Position.tsx
      - mock/data/position.empty.json
  - route: TallyHistory/tally%3Apriya-new
    variant: happy
    file: tally-history-empty.png
    deps:
      - apps/mobile/src/screens/TallyHistory.tsx
      - mock/data/entries.happy.json
  - route: TallyView/tally%3Amara-shop
    variant: happy
    capture: false
    note: the other side of a balance — what this party owes
  - route: TallyView/tally%3Asupplier-parts
    variant: happy
    capture: false
    note: a tally that is closing
  - route: TallyHistory/tally%3Amara-shop
    variant: happy
    file: tally-history-answered.png
    deps:
      - apps/mobile/src/screens/TallyHistory.tsx
      - mock/data/entries.happy.json
      - mock/data/requests.happy.json
  - route: TallyList
    variant: happy
    locale: en
    capture: false
    note: locale override, for checking a translation
---

# Screenshots

Captured from a release build on `emulator-5560` (the AVD named in `.env.ports.local`), driven by
deep link — `taleus://screen/<Route>[/<id>][?variant=&locale=]`.

| Screen | Variant | Shows | Preview |
|--------|---------|-------|---------|
| Welcome | first run | what this is, before anything is asked | ![](welcome-first-run.png) |
| Choose name | naming | told it exists and lives here; asked one thing | ![](choose-name.png) |
| Create invitation | happy | terms, and nobody's name | ![](create-invitation.png) |
| Create invitation | first | the party's first-ever invitation | ![](create-invitation-first.png) |
| Review invitation | happy | the invitee's side, before disclosing | ![](review-invitation.png) |
| Review invitation | expired | explained, with a way forward | ![](review-invitation-expired.png) |
| Tally list | happy | six tallies, one offered and figureless | ![](tally-list-happy.png) |
| Tally list | empty | nothing yet, and what to do about it | ![](tally-list-empty.png) |
| Tally view | happy | a tally with history, terms both ways | ![](tally-view-happy.png) |
| Tally view | new tally | story 04's actual scene: zero, explained | ![](tally-view-new.png) |
| Tally view | unreachable | story 04 path C: reads anyway, pending marked | ![](tally-view-unreachable.png) |
| Tally view | hours | a unit that divides by sixty — `6 07/60` | ![](tally-view-hours.png) |
| Tally history | happy | entries with the side of each balance | ![](tally-history-happy.png) |
| Tally history | answered | an entry recognisably tied to the request it answered | ![](tally-history-answered.png) |
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
- **Capture does not restart the app**, and a variant change is ignored by a route that is already
  mounted: `?variant=error` on a warm `TallyList` re-renders the happy list. Force-stop between
  captures that change variant on the same route.
- First run is reachable with `?variant=first-run`, not `empty`: a variant applies to every namespace
  at once, and a party with no identity gates the whole app into onboarding — so `?variant=empty`
  aimed at one screen's empty state would show first run instead. The `ChooseName` captures are taken by walking the
  flow (`input tap`), not by deep link: onboarding screens have no linking config, by design.
- Captured after the React Native 0.87 upgrade, so the tab bar has icons and the headers are React
  Navigation's own.
