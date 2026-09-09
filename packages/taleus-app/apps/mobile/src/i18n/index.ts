import { bumpGeneration } from '../data/generation'
import en from './locales/en.json'

/**
 * Strings live here, never in screens (`design/specs/mobile/global/i18n.md`).
 *
 * This is deliberately the smallest thing that satisfies the spec's rules: keys
 * in, text out, one bundled locale, and plurals resolved by the locale's own
 * rules rather than by appending an `s`. Keys and plural suffixes follow
 * i18next's conventions exactly, so `debt-mobile-i18n-library` is a swap of the
 * implementation, not a rewrite of the call sites.
 */
type Bundle = Record<string, string>

const bundles: Record<string, Bundle> = { en }
const fallback = 'en'
let locale = fallback

/** The locale everything formats against — `Intl` included. */
export function getLocale(): string {
	return locale
}

export function setLocale(tag: string): void {
	if (!bundles[tag] || tag === locale) {
		return
	}
	locale = tag
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
	const template = lookup(pluralKey(key, params)) ?? lookup(key) ?? key
	if (!params) {
		return template
	}
	return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in params ? String(params[name]) : whole,
	)
}

function lookup(key: string): string | undefined {
	return bundles[locale]?.[key] ?? bundles[fallback][key]
}

function pluralKey(key: string, params?: Params): string {
	if (params?.count === undefined) {
		return key
	}
	try {
		return `${key}_${new Intl.PluralRules(locale).select(params.count)}`
	} catch {
		return `${key}_other`
	}
}
