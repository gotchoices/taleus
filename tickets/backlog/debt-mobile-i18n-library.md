description: The mobile app ships a hand-written translation function where the spec names i18next; plurals silently fall back on device because Hermes has no Intl.PluralRules, and device-locale detection and RTL are absent.
files: packages/taleus-app/apps/mobile/src/i18n/index.ts, packages/taleus-app/apps/mobile/src/util/amount.ts, packages/taleus-app/design/specs/mobile/global/i18n.md
difficulty: easy
----
## What happened

`design/specs/mobile/global/i18n.md` names i18next + react-i18next, with the device locale from
react-native-localize. The first slices shipped `src/i18n/index.ts` instead: a bundle lookup, `{name}`
interpolation, one locale. It satisfies the spec's real rule — no user-visible string is written into
a screen — and adds no native dependency, which is why it was taken.

Twenty-five screens later that rule still holds: no screen contains a user-visible string, every
figure and date goes through `Intl` against the active locale, and 22 keys carry `_one`/`_other`
plural forms. What does not hold is everything that needs a platform capability the app does not
have.

## Verified on device (`emulator-5566`, release build, RN 0.87.1, Hermes)

```
Intl.DateTimeFormat  function      Intl.PluralRules       undefined
Intl.NumberFormat    function      Intl.DisplayNames      undefined
Intl.Collator        function      Intl.RelativeTimeFormat undefined
```

Node — and therefore jest — has all six. **Every plural and every currency name is exercised in
tests against a richer runtime than the app actually runs on.**

## What it cannot do

- **Plurals, on device.** `pluralKey()` calls `new Intl.PluralRules(...)` inside a `try` and falls
  back to `_other` when it throws. On Hermes it always throws, so `screens.attention.waiting-days_one`
  is dead code and a one-day-old item reads **"Waiting 1 days"**. The tests pass because Node
  resolves `_one` correctly. This is the failure this ticket previously claimed was fixed.
- **Currency names.** `namesFor()` calls `Intl.DisplayNames`, which is absent, so a unit's long name
  falls back to `unit.label` from the fixture (`"US dollars"`) or to its code. In a second locale that
  name would stay English. Same test-versus-device divergence.
- **Device locale.** Nothing reads the platform's language; `setLocale` is called only by the
  `?locale=` deep-link override and by the settings screen (story 42).
- **Namespaces.** The spec's key style is `screens.tally-list.empty-message`; keys are flat strings
  that merely look scoped.
- **RTL.** `I18nManager` is untouched. Two components use `marginLeft` and one uses
  `textAlign: 'right'`, which would need logical properties.

## What would resolve it

1. Install `i18next` + `react-i18next` + `react-native-localize`, move `locales/en.json` under a
   `screens` namespace, and re-export a `t()` with the same signature so no screen changes. i18next
   carries its own plural resolution and does not depend on `Intl.PluralRules`.
2. Decide the `Intl.DisplayNames` gap deliberately: either a polyfill (`@formatjs/intl-displaynames`)
   or keep unit names as fixture/tally data, which `design/specs/mobile/global/i18n.md` § Rules
   arguably already implies for units of account.
3. Make the test environment match the device, or the next gap will hide the same way — either run
   the suite with the missing `Intl` constructors deleted, or assert the fallbacks directly.
4. RTL: `I18nManager.allowRTL`, and logical margins in `Amount` and `Options`.

Worth doing before a second locale is contributed. Until then the visible defect is the English
plural above.
