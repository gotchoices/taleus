import { fireEvent, waitFor } from '@testing-library/react-native'

import { clearRate, isStale, readRates, resetRates, setRate } from '../src/data/rates'
import { resetSettings } from '../src/data/settings'
import { setVariant } from '../src/mock/variant'
import { ExchangeRates } from '../src/screens/ExchangeRates'
import { renderScreen } from '../testUtils'

beforeEach(() => {
	resetRates()
	resetSettings()
	setVariant('happy')
})

test('a rate is the party’s own valuation, never presented as a market figure', async () => {
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() => expect(view.getByText(/Taleus has no opinion/)).toBeTruthy())
	// Path C, and § Roles: private, and nobody else's applied to their holdings.
	expect(view.getByText(/No partner sees them/)).toBeTruthy()
	expect(view.queryByText(/market value/i)).toBeNull()
})

test('an unpriced unit is shown sitting outside everything, and why', async () => {
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() => expect(view.getByText('Sitting outside everything else')).toBeTruthy())
	expect(view.getByText(/never said what Dave-hours is worth to you/)).toBeTruthy()
	// Path E: a coherent state, not a broken one.
	expect(view.getByText(/coherent place to leave it/)).toBeTruthy()
	// And the tallies themselves still work.
	expect(view.getByText(/tallies themselves work exactly as they always did/)).toBeTruthy()
})

test('both directions are asked about, and the estimate takes the worse one', async () => {
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() => expect(view.getByText('I will take one for')).toBeTruthy())
	expect(view.getByText('Parting with one costs')).toBeTruthy()
	// Step 5: the difference is the party's own reluctance, not a fee.
	expect(view.getAllByText(/your own reluctance/).length).toBeGreaterThan(0)
	// Step 6: one set of rates, and the figures take the less flattering side.
	expect(view.getByText(/no second set of numbers/)).toBeTruthy()
})

test('a rate applies to every tally in that unit, not per partner', async () => {
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() => expect(view.getByText(/on every tally you hold in it/)).toBeTruthy())
	expect(view.getByText(/that is a different unit, not a different rate/)).toBeTruthy()
})

test('following a source signs the instruction, not each day’s figure', async () => {
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() => expect(view.getByText('Following ChipNet reference index')).toBeTruthy())
	expect(view.getByText('Your margin: 4%')).toBeTruthy()
	// Step 9: signed in April, still fetching in September.
	expect(view.getByText(/You signed the instruction on Apr 18, 2026/)).toBeTruthy()
	expect(view.getByText(/What you signed is that, not each day’s figure/)).toBeTruthy()
})

test('pricing a widely-held unit is presented as a market position, with ways to limit it', async () => {
	const view = await renderScreen(<ExchangeRates />)
	// Path G: not a display preference.
	await waitFor(() => expect(view.getByText('This makes you an exchange')).toBeTruthy())
	expect(view.getByText(/anyone trading against you finds it/)).toBeTruthy()
	// Step 4 of that path: shown how to limit it, not only how to set it.
	expect(view.getByText(/Three ways to limit that/)).toBeTruthy()
})

test('what a rate enables is stated, and movement is separable from valuing', async () => {
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() => expect(view.getByText('What this lets happen')).toBeTruthy())
	expect(view.getAllByText(/count toward your overall estimate/).length).toBeGreaterThan(0)
	expect(view.getByText(/Value can move between your CHIP tallies/)).toBeTruthy()
	// Path D: the two decisions are separate, and the second lives elsewhere.
	expect(view.getAllByText(/lives with your trading settings/).length).toBeGreaterThan(0)
})

test('a source that cannot be reached says what value is still converting at', async () => {
	setVariant('error')
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() =>
		expect(view.getByText(/ChipNet reference index could not be reached/)).toBeTruthy(),
	)
	expect(view.getByText(/from Aug 27, 2026, is still what value is converting at/)).toBeTruthy()
})

test('a fixed rate left alone is a live instruction, not a dormant preference', async () => {
	setVariant('error')
	const page = await readRates()
	const hours = page.ok && page.value.rates.find(rate => rate.denom === 'cid:bafy-dave-hours')
	expect(hours && isStale(hours)).toBe(true)
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() => expect(view.getByText(/value is still moving at it/)).toBeTruthy())
	// Path B step 3: about their neglect, not a market Taleus is watching.
	expect(view.getByText(/not about a market Taleus is watching for you/)).toBeTruthy()
})

test('a unit only one circle uses is presented as the low-risk case it is', async () => {
	setVariant('error')
	const view = await renderScreen(<ExchangeRates />)
	// Path F.
	await waitFor(() => expect(view.getByText(/nobody to arbitrage against/)).toBeTruthy())
	expect(view.getByText(/this is the safe case, not a lesser one/)).toBeTruthy()
	expect(view.getByText(/A flat number is fine here and needs no source/)).toBeTruthy()
})

test('parting with a unit cannot cost less than taking it', async () => {
	const inverted = await setRate({
		denom: 'cid:bafy-dave-hours',
		scale: 0,
		divisor: 60,
		basis: 'fixed',
		accept: 2500,
		part: 2000,
		signed: '2026-09-09T00:00:00Z',
		updated: '2026-09-09T00:00:00Z',
		permitsMovement: false,
	})
	expect(inverted.ok).toBe(false)
	expect(!inverted.ok && inverted.error.kind).toBe('inverted')
})

test('setting a rate folds the unit in; clearing it puts the unit back outside', async () => {
	const set = await setRate({
		denom: 'cid:bafy-dave-hours',
		scale: 0,
		divisor: 60,
		label: 'Dave-hours',
		basis: 'fixed',
		accept: 2200,
		part: 2400,
		signed: '2026-09-09T00:00:00Z',
		updated: '2026-09-09T00:00:00Z',
		permitsMovement: false,
	})
	expect(set.ok && set.value.rates.map(rate => rate.denom)).toContain('cid:bafy-dave-hours')
	expect(set.ok && set.value.unpriced).toHaveLength(0)

	// Path G step 4: not pricing a unit is one of the three ways to limit exposure.
	const cleared = await clearRate('cid:bafy-dave-hours')
	expect(cleared.ok && cleared.value.rates.map(rate => rate.denom)).not.toContain(
		'cid:bafy-dave-hours',
	)
	expect(cleared.ok && cleared.value.unpriced.map(unit => unit.denom)).toEqual([
		'cid:bafy-dave-hours',
	])
})

test('the party chooses the basis, the source and the margin', async () => {
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() => expect(view.getByText('Say what it is worth')).toBeTruthy())
	fireEvent.press(view.getByText('Say what it is worth'))
	await waitFor(() => expect(view.getByText('How should it be worked out?')).toBeTruthy())
	// A fixed number and a source are both offered, with the trade-off stated.
	expect(view.getByText('A number I set')).toBeTruthy()
	expect(view.getByText(/goes stale unless you come back to it/)).toBeTruthy()
	expect(view.getByText('Follow a published source')).toBeTruthy()

	fireEvent.press(view.getByLabelText('Follow a published source'))
	await waitFor(() => expect(view.getByText(/The app never picks one for you/)).toBeTruthy())
})

test('what has converted says which way, at what rate, and where it came from', async () => {
	const view = await renderScreen(<ExchangeRates />)
	await waitFor(() => expect(view.getByText('What has converted')).toBeTruthy())
	expect(view.getByText(/At 1.46 · from ChipNet reference index/)).toBeTruthy()
	expect(view.getByText(/At 1.58 · from ChipNet reference index/)).toBeTruthy()
})
