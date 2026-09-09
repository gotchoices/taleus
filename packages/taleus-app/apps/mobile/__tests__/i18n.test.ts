import { getLocale, t } from '../src/i18n'

/**
 * These are about the runtime, not about the strings.
 *
 * "Waiting 1 days" shipped for nineteen slices because `Intl.PluralRules` is
 * absent on Hermes, was called inside a `try`, and jest ran on Node where it
 * exists. `jest.setup.js` now removes what the device lacks before loading the
 * app's polyfills, so a suite that passes here is a suite that would pass on the
 * phone.
 */
describe('the runtime the device actually has', () => {
	test('Hermes-absent Intl constructors stay absent unless the app polyfills them', () => {
		// Polyfilled, because the app needs them.
		expect(typeof Intl.PluralRules).toBe('function')
		expect(typeof Intl.DisplayNames).toBe('function')
		// Not polyfilled, because nothing uses it — and a test runtime ahead of the
		// device is how the last defect hid.
		expect((Intl as { RelativeTimeFormat?: unknown }).RelativeTimeFormat).toBeUndefined()
	})

	test('what Hermes does have is untouched', () => {
		expect(typeof Intl.DateTimeFormat).toBe('function')
		expect(typeof Intl.NumberFormat).toBe('function')
		expect(typeof Intl.Collator).toBe('function')
	})
})

describe('plurals', () => {
	test('one is one, and not "1 days"', () => {
		// The exact string that shipped wrong.
		expect(t('screens.attention.waiting-days', { count: 1, days: 1 })).toBe('Waiting 1 day')
		expect(t('screens.attention.waiting-days', { count: 3, days: 3 })).toBe('Waiting 3 days')
	})

	test('every plural key in the bundle has both forms', () => {
		const bundle = require('../src/i18n/locales/en.json') as Record<string, string>
		const singulars = Object.keys(bundle).filter(key => key.endsWith('_one'))
		expect(singulars.length).toBeGreaterThan(0)
		for (const singular of singulars) {
			// The array form: `toHaveProperty('a.b')` would read the dots as a path,
			// and every key in this bundle contains dots.
			expect(bundle).toHaveProperty([singular.replace(/_one$/, '_other')])
		}
	})

	test('a singular form is reachable for every one of them', () => {
		const bundle = require('../src/i18n/locales/en.json') as Record<string, string>
		for (const key of Object.keys(bundle).filter(k => k.endsWith('_one'))) {
			const base = key.replace(/_one$/, '')
			// Whatever the placeholder is called, `count` is what selects the form.
			const rendered = t(base, { count: 1, days: 1, applied: '1' })
			expect(rendered).not.toBe(base)
			expect(rendered).toBe(
				bundle[key].replace('{days}', '1').replace('{count}', '1').replace('{applied}', '1'),
			)
		}
	})

	test('no count is rendered against a plural noun without plural forms', () => {
		// The family this slice found: "{days} days" called with no `count` reads
		// "1 days" for a single day, and nothing in English makes that visible
		// until somebody hits a one.
		const bundle = require('../src/i18n/locales/en.json') as Record<string, string>
		const unpluralised = Object.entries(bundle)
			.filter(([key]) => !key.endsWith('_one') && !key.endsWith('_other'))
			.filter(([, value]) => /\{\w+\}\s+(days?|partners?|things?|times?)\b/.test(value))
			.map(([key]) => key)
		expect(unpluralised).toEqual([])
	})
})

describe('the surface screens call', () => {
	test('a key with no string returns the key rather than blank', () => {
		expect(t('screens.nothing.here-at-all')).toBe('screens.nothing.here-at-all')
	})

	test('single-brace interpolation, as the bundle is written', () => {
		expect(t('screens.settings.no-rate', { unit: 'Dave-hours' })).toContain('Dave-hours')
		expect(t('screens.settings.no-rate', { unit: 'Dave-hours' })).not.toContain('{unit}')
	})

	test('a placeholder with no value is left alone rather than emptied', () => {
		expect(t('screens.settings.no-rate')).toContain('{unit}')
	})

	test('the device’s language is what the app starts in', () => {
		// The mock reports en-US; the app carries en.
		expect(getLocale()).toBe('en')
	})
})

describe('currency names', () => {
	test('a standard currency has a name, not just a code', () => {
		// `Intl.DisplayNames` is absent on Hermes; the polyfill is what makes this
		// answer at all, and without it the app fell back to a fixture label.
		expect(new Intl.DisplayNames(['en'], { type: 'currency' }).of('USD')).toBe('US Dollar')
	})
})
