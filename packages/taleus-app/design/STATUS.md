# taleus-app STATUS

App-level state: what has been deliberately deferred, and where the other trackers live. Nothing here
is a plan — plans are specs, and outstanding work is tickets. This file exists so a deferral is
recorded once, in a place that is not a spec.

## The other trackers

| File | Holds |
|------|-------|
| [`specs/mobile/STATUS.md`](specs/mobile/STATUS.md) | the mobile target's appeus phase checklist |
| [`stories/mobile/STATUS.md`](stories/mobile/STATUS.md) | which stories are written, reviewed, stubbed |
| [`../../../tickets/`](../../../tickets/) | outstanding engineering work, app and engine both |

Specs say what the app should do. They do not record what has not been done yet.

## Deferred deliberately

| Deferred | Why | Tracked as |
|----------|-----|-----------|
| An iOS build of the React Native upgrade | The upgrade diff's `ios/` hunks were not applied; the iOS tree has never been built, and patching a project file blind is worse than doing it when someone first runs `pod install` | — |
| i18next, device-locale detection | The local `t()` still meets the spec's rules, and the settings slice (42) shipped against it: with one bundle, a library would have added a dependency and no capability. It earns its place when a second locale exists | `debt-mobile-i18n-library` |
| Sort, filter, search on the tally list | Story 06's own paths; belongs to a slice of its own | — |
| `bundle install` after the Gemfile gained `nkf` | Only matters for iOS tooling, which is untouched | — |
| A `Closed` tally in the fixtures | Nothing produces one, so story 07 path F and story 24 path D are demonstrated on a tally that has stopped trading instead. The screens do not branch on the state, which is the substance of both paths | — |
| Progressive disclosure of captions | Right idea, wrong time — `Card` has the slot it would hang off | — |
| Fixtures for `Attention` and `Position` error states | Declared in their specs, nothing produces them; a storyboard cannot show a state no fixture makes | — |
| Fixtures at story scale — forty tallies, a year of entries, eleven waiting items | The happy fixtures are six, three and three; the stories describe volumes the screens have never been shown | — |
| Story 25, *My records in my books* | Waiting on how sApps share between strands | — |
| Raising an actual notification | No push transport, no permission request, no background task. `Notifications` is the policy those will read — the half that is a design decision rather than a platform integration | — |
| A printable invitation link | A token carries a colon, so a link reaches a card as `inv%3A…`. Tokens without colons is an identifier decision for the engine, not something a screen should paper over | — |
| Clipboard, share-sheet and printable codes | `CreateInvitation` and `StandingInvitation` both show a link and mark it copied. The only thing here needing a platform API rather than a decision | — |
| Migrating six screens onto the shared `Input` | `ChooseName`, `CreateInvitation`, `ReviewInvitation`, `ReviewOffer`, `PayPartner`, `CreateRequest` and `RequestView` each grew their own labelled text field before one existed. `components/Input.tsx` is now the one worth keeping; switching them over marks all six stale and is a pass of its own, not a rider on the settings slice | — |
| Choosing what to disclose while a *one-to-one* tally is being formed | Story 11 steps 3-5 and an inviter stating what they expect. `CreateInvitation` and `ReviewInvitation` were built before story 11 was sliced; the state exists in the fixtures and reads correctly, but the choice is not offered in that flow | — |

## The React Native version — resolved

The app is on **0.87.1**, upgraded from 0.82.1. That upgrade is what unblocked React Navigation and
the icon set; both tickets are in `tickets/complete/`.

The constraint worth remembering: **0.84 is the floor.** Current libraries declare native commands
with React 19's `React.ComponentRef<>`, and React Native's codegen only accepts that from 0.84
onward. Below it, anything with a Fabric component command fails to build. The original diagnosis
here — that `react-native-screens` was behind — was backwards, and would have meant waiting for a
release that was never the problem.
