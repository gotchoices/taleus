description: The mobile app hand-rolls its screen navigation because the app's React Native is older than the standard navigation library requires.
files: packages/taleus-app/apps/mobile/src/navigation/index.tsx, packages/taleus-app/apps/mobile/package.json, packages/taleus-app/design/specs/mobile/global/toolchain.md
difficulty: medium
----
## What happened

`design/specs/mobile/global/toolchain.md` names React Navigation, and the second slice needed it.
Installing it pulls `react-native-screens`, whose build fails against the app's React Native:

```
Error: The first argument of method showColumn must be of type React.ElementRef<>
  at buildCommandSchemaInternal (@react-native/codegen/.../components/commands.js:35)
task ':react-native-screens:generateCodegenSchemaFromJavaScript' FAILED
```

## The actual cause: the app is behind, not the library

The first reading of this — that `react-native-screens` had not caught up and only nightlies existed
past 4.27.0 — was **wrong, and backwards**. The evidence:

- `react-native-screens` 4.27.0 was published 2026-08-07 and is the current stable release. Its
  `SplitHostNativeComponent.ts` declares `showColumn: (viewRef: React.ComponentRef<ComponentType>, …)`.
  `ComponentRef` is what React 19 replaced the deprecated `ElementRef` with.
- React Native's own codegen was updated to accept `ComponentRef` in **0.84.0**. Checked directly
  against `@react-native/codegen` at each version — 0.83.10 accepts `ElementRef` only; 0.84.1, 0.85.3,
  0.86.3 and 0.87.1 all accept `ComponentRef`.
- The app is on React Native **0.82.1** (released 2025-10-20). Current is **0.87.1**.

So waiting for a newer `react-native-screens` would never have resolved this. Any current library
with a Fabric component command will hit the same wall until React Native moves.

## What would resolve it

Upgrade React Native to **0.84 or later** — 0.87.1 unless there is a reason not to — then reinstate
`@react-navigation/native`, `native-stack` and `bottom-tabs`, port the tab and stack definitions from
`src/navigation/index.tsx`, and delete the local navigator.

Arguments for doing it now rather than later:

- Five of thirty screens are built, there is no iOS build, and nothing is wired to real data. This is
  the cheapest the upgrade will ever be.
- The local navigator is a stopgap that twenty-five more screens would build on. It has no gestures,
  no transitions, no header customisation, no nested navigators, no state restoration, and no modal
  routes — `Scan` needs one, and `navigation.md` already names stand-alone notification entry points.
- The same wall will block anything else current. It is not a navigation-specific problem.

The local navigator was written to be replaced: screens receive `{ route, navigation }` exactly as
React Navigation supplies, route names match `design/specs/mobile/navigation.md`, and deep links use
the same URL shapes. The swap should touch `src/navigation/` and the `ScreenProps` type alias.

Only Android has ever been built, so an upgrade has one native tree to fix rather than two — another
reason to do it before an iOS build exists.
