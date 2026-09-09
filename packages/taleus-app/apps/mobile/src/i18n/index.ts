import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import * as RNLocalize from 'react-native-localize'

import { bumpGeneration } from '../data/generation'
import { polyfilledLocales } from './intl'
import en from './locales/en.json'

/**
 * Strings, per `design/specs/mobile/global/i18n.md`.
 *
 * i18next, as the spec names, behind the same two-line surface the app has
 * always called: keys in, text out. Screens did not change when this replaced a
 * hand-written lookup, which is the point of `t()` having been the only way in
 * from the first slice.
 *
 * Keys stay flat — `screens.tally-list.title` is one string, not a path — so
 * `keySeparator` and `nsSeparator` are off. The spec's `common`/`screens`
 * namespace split is a bundle-organisation nicety for translators and is
 * deliberately not done here: it would rewrite every call site in the app for no
 * user-visible change, and there is one locale to organise.
 *
 * Plurals resolve through `Intl.PluralRules`, which i18next uses internally and
 * Hermes does not provide — see `./intl.ts`, which must be loaded first.
 */
const fallback = 'en'

export const availableLocales = ['en'] as const

/**
 * The device's own preference, where the app has that language. Story 42 step 7
 * is about a party's choice following them; this is about the app not asking in
 * English first when it does not have to.
 */
function deviceLocale(): string {
	const best = RNLocalize.findBestLanguageTag([...availableLocales])
	return best?.languageTag ?? fallback
}

void i18next.use(initReactI18next).init({
	lng: deviceLocale(),
	fallbackLng: fallback,
	resources: { en: { translation: en } },
	// A key is a whole string, not a path into nested objects.
	keySeparator: false,
	nsSeparator: false,
	interpolation: {
		// The bundle was written with single braces, and nothing in it escapes:
		// this is React Native, and there is no HTML to inject into.
		prefix: '{',
		suffix: '}',
		escapeValue: false,
	},
})

/** The locale everything formats against — `Intl` included. */
export function getLocale(): string {
	return i18next.resolvedLanguage ?? i18next.language ?? fallback
}

export function setLocale(tag: string): void {
	if (!availableLocales.includes(tag as (typeof availableLocales)[number]) || tag === getLocale()) {
		return
	}
	void i18next.changeLanguage(tag)
	// Strings and `Intl` formatting are computed during render, so a reload is
	// what gets the new locale onto screens that are already showing.
	bumpGeneration()
}

/**
 * `count` is not a placeholder like the others: its presence makes the key
 * plural (`…_one`, `…_other`), resolved by the locale's own rules.
 */
export type Params = Record<string, string | number> & { count?: number }

export function t(key: string, params?: Params): string {
	return i18next.t(key, params ?? {})
}

/**
 * Whether a locale the app carries also has its `Intl` data loaded. A bundle
 * without plural rules for its language is worse than no bundle: every count
 * would silently take the `_other` form.
 */
export function isFullySupported(tag: string): boolean {
	return polyfilledLocales.includes(tag)
}
