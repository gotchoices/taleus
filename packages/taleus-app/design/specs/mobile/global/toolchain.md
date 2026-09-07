# Toolchain Spec

language: ts
runtime: bare
packageManager: npm
navigation: react-navigation
state: none — screens read through the data adapters; React context for what is genuinely app-wide
i18n: i18next + react-i18next (device locale via react-native-localize)
icons: Ionicons

notes:
- No HTTP client: all state comes from the taleus engine (`design/specs/domain/interfaces.md`).
- Three of the libraries above are not yet installed, deliberately. Each is tracked, so a slice
  meeting the gap does not have to rediscover it:
  - **react-navigation** — blocked: react-native-screens 4.27 fails codegen on RN 0.82. A local
    navigator with the same `{ route, navigation }` shape stands in. `debt-mobile-navigation-library`
  - **i18next** — the local `t()` is key-in/text-out and API-compatible; i18next earns its place when
    plurals and a second locale arrive. `debt-mobile-i18n-library`
  - **Ionicons** — needed by `global/ui.md` § Interaction (tab bar, chevron, direction, chips).
    `debt-mobile-icon-set`
- `state` was `zustand`. Nothing in the stories needs a global store; the adapters are the source and
  React context covers theme and locale. Revisit only when a story forces it.
