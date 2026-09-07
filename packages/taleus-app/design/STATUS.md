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
| React Navigation | The app's React Native is older than the library requires — see below | `debt-mobile-navigation-library` |
| Icon set (Ionicons) | `global/ui.md` names four places icons belong; none are drawn yet | `debt-mobile-icon-set` |
| i18next, device-locale detection | The local `t()` meets the spec's rules today; the library earns its place at the language slice (42) | `debt-mobile-i18n-library` |
| Sort, filter, search on the tally list | Story 06's own paths; belongs to a slice of its own | — |
| Next actions on `TallyView` | Pay, Request, and Terms are unsliced; a button routing nowhere is worse than none | — |
| Progressive disclosure of captions | Right idea, wrong time — `Card` has the slot it would hang off | — |
| An iOS build | Never attempted. Android has carried every slice so far | — |
| Scenario docs under `generated/mobile/scenarios/` | Screenshots cover the same ground for now | — |
| Story 25, *My records in my books* | Waiting on how sApps share between strands | — |

## The React Native version

The app is on **0.82.1** (Oct 2025). Current is **0.87.1**.

This is the root of the navigation problem, and the diagnosis in the original ticket was backwards.
`react-native-screens` is not behind — 4.27.0 shipped in Aug 2026 and is current. It declares its
native command as `React.ComponentRef<ComponentType>`, which is what React 19 replaced `ElementRef`
with. React Native's codegen accepts `ComponentRef` from **0.84.0** onward; 0.82 and 0.83 accept
`ElementRef` only, and reject the library outright:

```
The first argument of method showColumn must be of type React.ElementRef<>
```

So the fix is not a newer `react-native-screens`. It is React Native 0.84 or later. Anything else
built for a current React Native will hit the same wall.

Decision pending — see `debt-mobile-navigation-library`.
