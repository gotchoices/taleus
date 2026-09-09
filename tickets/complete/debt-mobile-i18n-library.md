description: Replaced the hand-written translation function with i18next, polyfilled the Intl surface Hermes lacks, added device-locale detection and RTL, and fixed the "1 days" plural bug it was hiding.
files: packages/taleus-app/apps/mobile/src/i18n/index.ts, packages/taleus-app/apps/mobile/src/i18n/intl.ts, packages/taleus-app/apps/mobile/jest.setup.js, packages/taleus-app/design/specs/mobile/global/i18n.md
difficulty: easy
----
## What was wrong

`design/specs/mobile/global/i18n.md` names i18next + react-i18next with the device locale from
react-native-localize. Twenty-five screens shipped against a hand-written lookup instead. That
satisfied the spec's real rule — no user-visible string in a screen — and hid a defect:

**`Intl.PluralRules` does not exist on Hermes.** `pluralKey()` called it inside a `try` and fell back
to `_other` when it threw, which on the device is always. Every `_one` key in the bundle was dead
code and a one-day-old item read **"Waiting 1 days"** on a real phone. The 179 tests passed because
jest runs on Node, which has the whole `Intl` surface.

Measured on a release build, RN 0.87.1, `emulator-5566`:

```
Intl.DateTimeFormat  function      Intl.PluralRules        undefined
Intl.NumberFormat    function      Intl.DisplayNames       undefined
Intl.Collator        function      Intl.RelativeTimeFormat undefined
                                   Intl.Locale             undefined
```

## What was done

- **`src/i18n/intl.ts`** — the polyfill chain, loaded from `index.js` before anything reads a string,
  and from `jest.setup.js` after the missing constructors are deleted. **The test runtime now matches
  the device.** `RelativeTimeFormat` is deliberately left unpolyfilled: nothing uses it, and a test
  runtime ahead of the device is what caused this.
- **i18next behind the same `t()`** — no screen changed, which is what a single entry point was for.
  `keySeparator`/`nsSeparator` off so the existing flat keys keep working; single-brace interpolation
  to match the bundle.
- **Device locale** via `react-native-localize`, mocked in tests with the package's own mock.
- **RTL** — `I18nManager.allowRTL(true)`; `marginStart` for `marginLeft` in `Amount`; `textAlign:
  'center'` for `'right'` in `Options`; the chevron and the conversion arrow mirror on `isRTL`.
- **Five more "1 days" strings** found by a new guard test that fails on any count interpolated
  against a plural noun with no plural forms declared: `review-invitation.their-notice`,
  `review-offer.notice-days`, `request-view.waiting`, `standing.notice-days`,
  `tally-terms.changed-notice`. All now have `_one`/`_other` and their call sites pass `count`.
- **`@babel/plugin-transform-class-static-block`** — the formatjs packages ship untranspiled and use
  static class blocks, which the React Native preset does not transform.

## Review findings

- **i18next 26 uses `Intl.PluralRules` itself** (`node_modules/i18next/dist/cjs/i18next.js:1090`).
  This ticket previously claimed i18next "carries its own plural resolution"; it does not, at this
  version. The polyfill is load-bearing, not belt-and-braces.
- **The polyfills crash without their own prerequisites.** Both formatjs entries call
  `new Intl.Locale` inside their feature detection, via formatjs's locale matcher. On Hermes that
  threw *inside the polyfill meant to help*, and the app died at startup with a native abort — a
  white screen, not a caught error. `@formatjs/intl-getcanonicallocales` and `@formatjs/intl-locale`
  must be imported first, in that order. Found only by running it on the device.
- **Namespaces not done.** The spec names `common` and `screens`. Keys are flat strings that look
  scoped. Splitting them rewrites every call site in the app for no user-visible change, with one
  locale to organise; recorded in `design/STATUS.md` instead.
- **RTL is allowed, not exercised.** No right-to-left bundle exists to lay out, so the logical
  properties are correct by construction rather than by observation.
- **Every new locale needs its own `Intl` data**, not just a bundle — `polyfilledLocales` names what
  is loaded, and `isFullySupported()` exists so a half-supported locale can be refused rather than
  silently taking `_other` for every count.

## Verified

On device: `Waiting 1 day` / `Waiting 3 days`, locale `en` from the platform, `US Dollar` from real
`Intl.DisplayNames`. 190 tests in 20 suites, tsc clean, lint no errors, all 25 screens re-captured
where the change was visible.
