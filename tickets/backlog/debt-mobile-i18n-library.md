description: The mobile app ships a hand-written translation function where the spec names i18next, so plurals and device-locale detection do not work.
files: packages/taleus-app/apps/mobile/src/i18n/index.ts, packages/taleus-app/design/specs/mobile/global/i18n.md
difficulty: easy
----
## What happened

`design/specs/mobile/global/i18n.md` names i18next + react-i18next, with the device locale from
react-native-localize. The first slices shipped `src/i18n/index.ts` instead: a bundle lookup, `{name}`
interpolation, one locale. It satisfies the spec's real rule — no user-visible string is written into
a screen — and adds no native dependency, which is why it was taken.

## What it cannot do

- **Plurals.** `"{days} days"` renders "1 days". The spec now requires the locale's own rules.
- **Device locale.** Nothing reads the platform's language; `setLocale` is only called by the
  `?locale=` deep-link override.
- **Namespaces.** The spec's key style is `screens.tally-list.empty-message`; keys are flat.
- **RTL.** `I18nManager` is untouched.

## What would resolve it

Install `i18next` + `react-i18next` + `react-native-localize`, move `locales/en.json` under a
`screens` namespace, and re-export a `t()` with the same signature so screens do not change. The
plural keys are the only content edit.

Worth doing at the settings/language slice (story 42), which is the first screen that lets a party
choose a language and therefore the first place the gap is visible.
