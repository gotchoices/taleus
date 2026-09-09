/**
 * The `Intl` surface the app can actually rely on.
 *
 * Hermes ships three constructors and not the rest. Measured on a release build,
 * React Native 0.87.1, `emulator-5566`:
 *
 * ```
 * Intl.DateTimeFormat  function      Intl.PluralRules        undefined
 * Intl.NumberFormat    function      Intl.DisplayNames       undefined
 * Intl.Collator        function      Intl.RelativeTimeFormat undefined
 *                                    Intl.Locale             undefined
 * ```
 *
 * Node — and therefore jest — has all six, which is how a real defect hid for
 * nineteen slices: `Intl.PluralRules` was called inside a `try`, always threw on
 * the device, and every plural silently fell back to the `_other` form. A
 * one-day-old item read "Waiting 1 days" on a phone while the tests passed.
 *
 * So the two the app needs are polyfilled here, and this module is imported by
 * `index.js` *and* by the jest setup — the tests exercise the same `Intl` the
 * device has. `RelativeTimeFormat` is deliberately not polyfilled: nothing uses
 * it, and adding it would put the tests back ahead of the device.
 *
 * The `/polyfill` entries install only when the constructor is missing, so a
 * runtime that has them keeps its own.
 */
// Order matters, and it is not optional. Each polyfill's own feature detection
// calls `new Intl.Locale` through formatjs's locale matcher, so a runtime
// without `Intl.Locale` — which Hermes is — crashes *inside the polyfill that
// was meant to help*. `getCanonicalLocales` underpins `Locale` the same way.
// This cost one white-screen crash on device to discover.
//
// The `.js` suffixes are required too: these packages declare an `exports` map
// naming `./polyfill.js` and `./locale-data/*` exactly, and a bare specifier
// does not resolve.
import '@formatjs/intl-getcanonicallocales/polyfill.js'
import '@formatjs/intl-locale/polyfill.js'

import '@formatjs/intl-pluralrules/polyfill.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'

import '@formatjs/intl-displaynames/polyfill.js'
import '@formatjs/intl-displaynames/locale-data/en.js'

/**
 * Every locale the app carries needs its plural rules and display names loaded
 * alongside its bundle: a polyfill without locale data is a constructor that
 * throws on everything but English.
 */
export const polyfilledLocales = ['en']

