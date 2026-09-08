import { amountParts, divisorOf, namesFor } from '../src/util/amount'
import type { Unit } from '../src/data/types'

const usd: Unit = { denom: 'iso4217:USD', scale: 2 }
const chip: Unit = { denom: 'CHIP', scale: 3 }
const hours: Unit = { denom: 'cid:bafy-dave-hours', scale: 0, divisor: 60, code: 'DVH', label: 'Dave-hours' }
const whole: Unit = { denom: 'cid:bafy-widgets', scale: 0, code: 'WDG', label: 'Widgets' }

test('a decimal unit implies its denominator; the digit count says it', () => {
	const p = amountParts({ units: 18000 }, usd, 'en')
	expect(p.whole).toBe('180')
	expect(p.numerator).toBe('00')
	expect(p.denominator).toBeUndefined()
})

test('a unit that does not divide by ten shows its denominator', () => {
	const p = amountParts({ units: 367 }, hours, 'en')
	expect(p.whole).toBe('6')
	expect(p.numerator).toBe('07')
	// Without this, `6` over `07` is six-and-seven-hundredths to any reader.
	expect(p.denominator).toBe('60')
})

test('a unit with no fraction gets no fraction', () => {
	const p = amountParts({ units: 6 }, whole, 'en')
	expect(p.numerator).toBeUndefined()
	expect(p.denominator).toBeUndefined()
})

test('the sign is held aside, so amounts between -1 and 0 do not render "-0"', () => {
	const p = amountParts({ units: -50 }, usd, 'en')
	expect(p.negative).toBe(true)
	expect(p.whole).toBe('0')
	expect(p.whole.startsWith('-')).toBe(false)
	expect(p.numerator).toBe('50')
})

test('no float ever touches the split', () => {
	// 0.1 + 0.2 territory: these are exact only under integer arithmetic.
	for (const units of [1, 9, 10, 99, 100, 8_675_309, 2 ** 40 + 7]) {
		const p = amountParts({ units }, usd, 'en')
		const back = Number(p.whole.replace(/\D/g, '')) * 100 + Number(p.numerator)
		expect(back).toBe(units)
	}
})

test('the whole part is grouped for the locale, and never carries a separator role', () => {
	expect(amountParts({ units: 123456789 }, usd, 'en').whole).toBe('1,234,567')
	expect(amountParts({ units: 123456789 }, usd, 'de').whole).toBe('1.234.567')
	// The German form is only safe because no decimal separator appears anywhere.
	expect(amountParts({ units: 123456789 }, usd, 'de').numerator).toBe('89')
})

test('a standard unit takes its mark from the standard, not from the tally', () => {
	const spoofed: Unit = { ...usd, mark: '€', code: 'EUR' }
	const names = namesFor(spoofed, 'en')
	expect(names.mark).toBe('$')
	expect(names.code).toBe('USD')
	expect(names.standard).toBe(true)
})

test('a tally mark containing a currency symbol is refused', () => {
	const spoof: Unit = { denom: 'cid:bafy-fake', scale: 2, code: 'FAK', mark: 'US$', label: 'Fakes' }
	expect(namesFor(spoof, 'en').mark).toBeUndefined()
	const ok: Unit = { ...spoof, mark: 'F̵K̵' }
	expect(namesFor(ok, 'en').mark).toBe('F̵K̵')
})

test('CHIP is drawn, not typed', () => {
	const names = namesFor(chip, 'en')
	expect(names.drawn).toBe('chip')
	expect(names.code).toBe('CHIP')
})

test('divisor overrides scale, and defaults to a power of ten', () => {
	expect(divisorOf(usd)).toBe(100)
	expect(divisorOf(chip)).toBe(1000)
	expect(divisorOf(hours)).toBe(60)
	expect(divisorOf(whole)).toBe(1)
})

test('the spoken form is a sentence, never the layout', () => {
	expect(amountParts({ units: 18050 }, usd, 'en').spoken).toBe('$180.50')
	// "two oh seven sixty" would actively mislead; the sentence must not be the picture.
	expect(amountParts({ units: 127 }, hours, 'en').spoken).toBe('2 Dave-hours 7/60')
	expect(amountParts({ units: 6 }, whole, 'en').spoken).toBe('6 Widgets')
})

test('the plain form is unambiguous for anything leaving the app', () => {
	expect(amountParts({ units: -4250 }, usd, 'en').plain).toBe('-42.50 USD')
	expect(amountParts({ units: 127 }, hours, 'en').plain).toBe('2 7/60 DVH')
	expect(amountParts({ units: 1250 }, chip, 'en').plain).toBe('1.250 CHIP')
})
