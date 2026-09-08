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
| i18next, device-locale detection | The local `t()` meets the spec's rules today; the library earns its place at the language slice (42) | `debt-mobile-i18n-library` |
| Sort, filter, search on the tally list | Story 06's own paths; belongs to a slice of its own | — |
| `bundle install` after the Gemfile gained `nkf` | Only matters for iOS tooling, which is untouched | — |
| Next actions on `TallyView` | Pay, Request, and Terms are unsliced; a button routing nowhere is worse than none | — |
| Progressive disclosure of captions | Right idea, wrong time — `Card` has the slot it would hang off | — |
| Scenario docs under `generated/mobile/scenarios/` | Waiting on an appeus preview upgrade so a storyboard's links can reach the device — `tmp/appeus-preview-spec.md` | — |
| Fixtures for `Attention` and `Position` error states | Declared in their specs, nothing produces them; a storyboard cannot show a state no fixture makes | — |
| Fixtures at story scale — forty tallies, a year of entries, eleven waiting items | The happy fixtures are six, three and three; the stories describe volumes the screens have never been shown | — |
| Story 25, *My records in my books* | Waiting on how sApps share between strands | — |

## The React Native version — resolved

The app is on **0.87.1**, upgraded from 0.82.1. That upgrade is what unblocked React Navigation and
the icon set; both tickets are in `tickets/complete/`.

The constraint worth remembering: **0.84 is the floor.** Current libraries declare native commands
with React 19's `React.ComponentRef<>`, and React Native's codegen only accepts that from 0.84
onward. Below it, anything with a Fabric component command fails to build. The original diagnosis
here — that `react-native-screens` was behind — was backwards, and would have meant waiting for a
release that was never the problem.
