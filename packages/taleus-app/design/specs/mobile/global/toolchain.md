# Toolchain Spec

language: ts
runtime: bare
packageManager: npm
reactNative: 0.87
navigation: react-navigation (native-stack per tab, bottom-tabs)
state: none — screens read through the data adapters; React context for what is genuinely app-wide
i18n: i18next + react-i18next (device locale via react-native-localize)
icons: Ionicons (`@react-native-vector-icons/ionicons`)
vectorGraphics: react-native-svg — for the chit mark, and drawn marks generally

notes:
- No HTTP client: all state comes from the taleus engine (`design/specs/domain/interfaces.md`).
- **React Native 0.84 is the floor.** Current libraries declare native commands with React 19's
  `React.ComponentRef<>`, which React Native's codegen only accepts from 0.84 onward. Below that,
  anything with a Fabric component command — `react-native-screens` included — fails to build.
- **Hermes ships four fewer `Intl` constructors than Node**: no `PluralRules`, `DisplayNames`,
  `RelativeTimeFormat` or `Locale`. i18next calls `Intl.PluralRules` itself, so the app polyfills the
  surface it needs in `src/i18n/intl.ts`, loaded from `index.js` before anything reads a string. The
  order in that file is not cosmetic — the formatjs polyfills call `new Intl.Locale` inside their own
  feature detection and abort the app at startup without it. `jest.setup.js` strips the same four so
  the suite runs the runtime the device has.
- **`@babel/plugin-transform-class-static-block` is required**, because those polyfills ship
  untranspiled and the React Native preset does not transform static class blocks. **A running Metro
  reads `babel.config.js` once at startup**, so adding a plugin needs
  `npm start -- --reset-cache`; a release build spawns its own Metro and picks it up either way.
- `state` was `zustand`. Nothing in the stories needs a global store; the adapters are the source and
  React context covers theme and locale. Revisit only when a story forces it.
