description: React Native upgraded 0.82.1 → 0.87.1, which unblocked React Navigation; the hand-rolled navigator is gone and the tab bar has icons.
files: packages/taleus-app/apps/mobile/package.json, packages/taleus-app/apps/mobile/src/navigation/index.tsx, packages/taleus-app/apps/mobile/src/navigation/routes.ts, packages/taleus-app/apps/mobile/src/navigation/linking.ts, packages/taleus-app/apps/mobile/android/build.gradle, packages/taleus-app/apps/mobile/android/gradle.properties, packages/taleus-app/design/specs/mobile/global/toolchain.md
----

## What landed

React Native **0.82.1 → 0.87.1**, then React Navigation 7 (`native`, `native-stack`, `bottom-tabs`)
with `react-native-screens` 4.27.0, `react-native-gesture-handler`, and
`@react-native-vector-icons/ionicons`. `src/navigation/index.tsx` is now one bottom-tab navigator
holding three native stacks; the ~150-line local navigator is deleted. Deep links moved to
`src/navigation/linking.ts`, and route types to `src/navigation/routes.ts`, matching the layout in
`appeus/reference/frameworks/react-native.md`.

## The diagnosis this ticket originally got wrong

The first version of this ticket said `react-native-screens` had not caught up and only nightlies
existed past 4.27.0. That was backwards, and it would have meant waiting forever for a release that
was never the problem.

- `react-native-screens` 4.27.0 (2026-08-07) is the current stable. Its `SplitHostNativeComponent.ts`
  declares `showColumn: (viewRef: React.ComponentRef<ComponentType>, …)`. `ComponentRef` is what
  React 19 replaced the deprecated `ElementRef` with.
- React Native's codegen accepts `ComponentRef` from **0.84.0**. Verified directly against
  `@react-native/codegen` at each version: 0.83.10 rejects it; 0.84.1, 0.85.3, 0.86.3 and 0.87.1
  accept it (the error string itself changed to "must be of type React.ElementRef<> or
  React.ComponentRef<>").
- The app was on 0.82.1 (2025-10-20) — eleven months and five minors behind.

So the app was too old, not the library too new. Confirmed empirically: after the upgrade,
`./gradlew :react-native-screens:generateCodegenSchemaFromJavaScript` — the exact task that failed —
reports `BUILD SUCCESSFUL`.

## The upgrade itself

Applied from the rn-diff-purge 0.82.1..0.87.1 diff. Small: Gradle 9.0.0 → 9.4.1, `buildToolsVersion`
and `compileSdkVersion` 36 → 37, Kotlin 2.1.20 → 2.2.0, `edgeToEdgeEnabled` true, the AGP 9 opt-outs
(`android.builtInKotlin=false`, `android.newDsl=false`), `proguard-android-optimize.txt`, and the
`@react-native/jest-preset` rename. React 19.1.1 → 19.2.3, TypeScript 5.9 → 6.0.

Six source changes were needed for 0.87 API tightenings, all small:

| Change | Where |
|--------|-------|
| `StatusBar` lost `backgroundColor` (edge-to-edge draws behind it) | `App.tsx` |
| `StyleSheet.NamedStyles` is no longer exported | `src/theme/index.tsx` |
| `Linking.getInitialURL()` resolves `string \| null \| undefined` | `src/navigation/linking.ts` |
| `FlatList` header/footer take `undefined`, not `null` | `Attention.tsx`, `TallyHistory.tsx` |

Jest needed `transformIgnorePatterns` widened for `@react-navigation` and the icon package, plus an
asset stub — the Ionicons package `require`s its own `.ttf`, which jest cannot parse.

## What this unblocked

- **Hardware and gesture back**, for free and correctly: verified on device that backing out of a
  deep-linked `TallyHistory` lands on `TallyList` rather than leaving the app, and that a second back
  from the tab root exits. `initialRouteName` on the tallies stack is what puts the list underneath a
  deep link.
- **Tab-bar icons** — `debt-mobile-icon-set`, closed alongside this. Icon and label together, per
  `global/ui.md`.
- Modal routes for `Scan`, real transitions, and state restoration, which the local navigator had
  none of and which twenty-five more screens would otherwise have been built without.

## Verification

`npx tsc --noEmit` clean. 19 jest tests pass. Release APK builds and installs; all eight
screen/variant screenshots recaptured under `design/generated/mobile/images/`. All five generated
screens still read `false | hash` from `check-stale.sh`.

## Gaps, honestly

- **iOS is untouched.** The diff's `ios/` hunks (`project.pbxproj`, `Info.plist`) were not applied,
  because the iOS tree has never been built and applying a project-file diff blind is worse than
  doing it when someone first runs `pod install`. Recorded in `design/STATUS.md`.
- **The `Gemfile` gained `gem 'nkf'`** per the diff, but `bundle install` has not been run.
- One Metro warning survives the upgrade: a dependency imports
  `react-native/src/private/featureflags/ReactNativeFeatureFlags`, which is not in React Native's
  `exports`. It falls back to file-based resolution and builds; it is a library's problem, not ours.
