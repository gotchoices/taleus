# Toolchain Spec

language: ts
runtime: bare
packageManager: npm
reactNative: 0.87
navigation: react-navigation (native-stack per tab, bottom-tabs)
state: none — screens read through the data adapters; React context for what is genuinely app-wide
i18n: i18next + react-i18next (device locale via react-native-localize)
icons: Ionicons (`@react-native-vector-icons/ionicons`)

notes:
- No HTTP client: all state comes from the taleus engine (`design/specs/domain/interfaces.md`).
- **React Native 0.84 is the floor.** Current libraries declare native commands with React 19's
  `React.ComponentRef<>`, which React Native's codegen only accepts from 0.84 onward. Below that,
  anything with a Fabric component command — `react-native-screens` included — fails to build.
- `i18next` is named above but not yet installed: the local `t()` does namespaced keys and
  `Intl.PluralRules`, which is what `global/i18n.md` actually requires. The library earns its place
  at the language slice (42). `debt-mobile-i18n-library`
- `state` was `zustand`. Nothing in the stories needs a global store; the adapters are the source and
  React context covers theme and locale. Revisit only when a story forces it.
