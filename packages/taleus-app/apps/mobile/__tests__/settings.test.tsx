import { fireEvent, waitFor } from '@testing-library/react-native'

import { Amount } from '../src/components'
import { followsParty, readSettings, resetSettings, writeSettings } from '../src/data/settings'
import { setVariant } from '../src/mock/variant'
import { Settings } from '../src/screens/Settings'
import { getUnitStyle, setUnitStyle } from '../src/util/amount'
import { renderScreen, screenProps } from '../testUtils'

const props = (navigate = jest.fn()) => screenProps('Settings', undefined, navigate)

beforeEach(() => {
	resetSettings()
	setUnitStyle('mark')
	setVariant('happy')
})

test('the choices are grouped by whether they follow the party or the device', async () => {
	const view = await renderScreen(<Settings {...props()} />)
	await waitFor(() => expect(view.getByText('Follows you')).toBeTruthy())
	expect(view.getByText('This device only')).toBeTruthy()
	// Story 42 step 6 is about knowing which is which, so the app must say it.
	expect(view.getByText(/On any device you add/)).toBeTruthy()
	expect(view.getByText(/replacement phone starts fresh/)).toBeTruthy()
	// Appearance is the device's; language and the units are the party's.
	expect(followsParty).toContain('locale')
	expect(followsParty).not.toContain('appearance')
})

test('language says what it does not reach', async () => {
	const view = await renderScreen(<Settings {...props()} />)
	await waitFor(() => expect(view.getByText('English')).toBeTruthy())
	// Path A: told what there is, rather than left in a half-translated app.
	expect(view.getByText(/half-translated app would be worse/)).toBeTruthy()
	// Steps 2 and 3.
	expect(view.getByText(/stays in their words, shown as a quote/)).toBeTruthy()
	expect(view.getByText(/stays in the language it was signed in/)).toBeTruthy()
})

test('a display unit with no rate behind it is explained, with the way forward', async () => {
	const view = await renderScreen(<Settings {...props()} />)
	await waitFor(() => expect(view.getByText('Dave-hours')).toBeTruthy())
	// US dollars is priced, so nothing is wrong yet.
	expect(view.queryByText(/cannot be estimated in it/)).toBeNull()

	fireEvent.press(view.getByLabelText('Dave-hours'))
	// Path B: said plainly, and pointed at rates rather than left as a dead end.
	await waitFor(() => expect(view.getByText(/cannot be estimated in it/)).toBeTruthy())
	expect(view.getByText(/Rates live with your exchange rates/)).toBeTruthy()
})

test('per-tally units are not offered as changeable here', async () => {
	const view = await renderScreen(<Settings {...props()} />)
	await waitFor(() => expect(view.getByText(/not yours to change/)).toBeTruthy())
})

test('mark or code is the reader’s choice and reaches every figure', async () => {
	const view = await renderScreen(<Settings {...props()} />)
	await waitFor(() => expect(view.getByLabelText('Their code')).toBeTruthy())
	fireEvent.press(view.getByLabelText('Their code'))
	await waitFor(() => expect(getUnitStyle()).toBe('code'))

	// Not just this screen: the shared component every figure goes through.
	const figure = await renderScreen(
		<Amount value={{ units: 18050 }} unit={{ denom: 'iso4217:USD', scale: 2 }} />,
	)
	expect(figure.getByText('USD')).toBeTruthy()
	expect(figure.queryByText('$')).toBeNull()
})

test('agreements and signed permissions are named, not presented as preferences', async () => {
	const view = await renderScreen(<Settings {...props()} />)
	await waitFor(() => expect(view.getByText('Not settings')).toBeTruthy())
	// Path C: a party who comes looking must find the answer, not a gap.
	expect(view.getByText(/term of that tally/)).toBeTruthy()
	expect(view.getByText(/permission you sign/)).toBeTruthy()
	// And no control for either.
	expect(view.queryByLabelText(/credit/i)).toBeNull()
})

test('what follows the party is stored, so a second device starts there', async () => {
	await writeSettings({ locale: 'en', unitStyle: 'code', displayUnit: 'CHIP' })
	const again = await readSettings()
	expect(again.ok && again.value.unitStyle).toBe('code')
	expect(again.ok && again.value.displayUnit).toBe('CHIP')
})
