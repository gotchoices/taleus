description: The mobile app hand-rolls its screen navigation because the standard library's native dependency does not build against the React Native version we are on.
files: packages/taleus-app/apps/mobile/src/navigation/index.tsx, packages/taleus-app/design/specs/mobile/global/toolchain.md
difficulty: easy
----
## What happened

`design/specs/mobile/global/toolchain.md` names React Navigation, and the second slice needed it.
Installing it pulls `react-native-screens`, whose current release (4.27.0) fails codegen against
React Native 0.82.1:

```
Error: The first argument of method showColumn must be of type React.ElementRef<>
  at buildCommandSchemaInternal (@react-native/codegen/.../components/commands.js:35)
task ':react-native-screens:generateCodegenSchemaFromJavaScript' FAILED
```

Only nightly builds exist past 4.27.0. Rather than take a nightly native dependency at the fifth
slice, the app ships a small navigator of its own: `src/navigation/index.tsx`, about 150 lines, one
stack per tab plus deep-link parsing. It has no native dependencies and builds today.

## Why this is debt rather than a decision

The local navigator does what the app currently needs and nothing more: no gestures, no transitions,
no header customisation, no nested navigators, no state restoration. Those are the things a real
navigation library exists to get right, and the app will want them.

It was written to be replaceable: screens receive `{ route, navigation }` exactly as React Navigation
supplies, route names match `design/specs/mobile/navigation.md`, and deep links use the same URL
shapes. Swapping the library in should touch `src/navigation/` and the `ScreenProps` type alias.

## What would resolve it

- A stable `react-native-screens` that builds against the React Native version in use — check
  whether 4.28.0 has shipped.
- Then: reinstate `@react-navigation/native`, `native-stack`, and `bottom-tabs`, port the tab and
  stack definitions, and delete the local navigator.

Worth doing before the app grows screens that need real transitions or a back-stack deeper than two,
and before anyone builds on the local navigator's simplifications.
