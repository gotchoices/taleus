import en from './locales/en.json'

/**
 * Strings live here, never in screens (`design/specs/mobile/global/i18n.md`).
 *
 * This is deliberately the smallest thing that satisfies the rule: keys in,
 * text out, one bundled locale. Swapping in i18next and device-locale
 * detection later is mechanical because screens only ever call `t()`.
 */
type Bundle = Record<string, string>

const bundles: Record<string, Bundle> = { en }
let locale = 'en'

export function setLocale(tag: string): void {
	if (bundles[tag]) {
		locale = tag
	}
}

export function t(key: string, params?: Record<string, string | number>): string {
	const template = bundles[locale][key] ?? bundles.en[key] ?? key
	if (!params) {
		return template
	}
	return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in params ? String(params[name]) : whole,
	)
}
