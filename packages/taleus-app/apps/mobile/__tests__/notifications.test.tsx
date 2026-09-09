import { fireEvent, waitFor } from '@testing-library/react-native'

import {
	readNotifications,
	resetNotifications,
	setDelivery,
	setNotifications,
} from '../src/data/notifications'
import { resetParty } from '../src/data/party'
import { setVariant } from '../src/mock/variant'
import { Notifications } from '../src/screens/Notifications'
import { renderScreen } from '../testUtils'

beforeEach(() => {
	resetNotifications()
	resetParty()
	setVariant('happy')
})

test('the app classifies; the phone decides what to do about it', async () => {
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText(/your phone’s decision/)).toBeTruthy())
	// Step 6: quiet hours are named only to say whose they are. There is no
	// control for them here, because a second set would fight the first.
	expect(view.getByText(/waits for your quiet hours/)).toBeTruthy()
	expect(view.queryByLabelText(/quiet hours/i)).toBeNull()
	expect(view.getByText(/say honestly which is which/)).toBeTruthy()
})

test('what needs a signature is separable from what merely finishes', async () => {
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText('Something needs your signature')).toBeTruthy())
	expect(view.getByText('Someone has asked you to pay')).toBeTruthy()
	expect(view.getByText('Something arrived')).toBeTruthy()
	// Step 5: they can be treated differently, and are.
	const after = await setDelivery('arrived', 'silent')
	expect(after.ok && after.value.classes.find(item => item.id === 'arrived')?.delivery).toBe('silent')
	expect(after.ok && after.value.classes.find(item => item.id === 'signature')?.delivery).toBe(
		'interrupt',
	)
})

test('value moving on its own never notifies, and that is not a setting', async () => {
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText('Value moved on its own')).toBeTruthy())
	// Path A: authorised already, nothing to do, there in the morning.
	expect(view.getByText(/that is not a setting/)).toBeTruthy()
	expect(view.getByText(/there in the morning if you look/)).toBeTruthy()

	const refused = await setDelivery('automatic', 'interrupt')
	expect(refused.ok).toBe(false)
	expect(!refused.ok && refused.error.kind).toBe('fixed')
})

test('a lock screen shows nothing financial, and the other choice is shown first', async () => {
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText('On a lock screen')).toBeTruthy())
	// Path C: the sample is what would actually appear, shown before the choice.
	expect(view.getByText('“Taleus · Something needs you”')).toBeTruthy()
	expect(view.getByText('“Mara’s Bike Shop asked you for $95 — 3 days”')).toBeTruthy()
	// Nothing financial is on by default.
	const settings = await readNotifications()
	expect(settings.ok && settings.value.lockScreenDetail).toBe('minimal')
	expect(view.queryByText(/where anyone standing there can read them/)).toBeNull()

	fireEvent.press(view.getByLabelText('Who, and how much'))
	await waitFor(() =>
		expect(view.getByText(/where anyone standing there can read them/)).toBeTruthy(),
	)
})

test('acting on a notice lands on the thing, and a settled one says so', async () => {
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText(/takes you to the thing itself/)).toBeTruthy())
	// Step 4 and path F.
	expect(view.getByText(/on this device or any other of yours/)).toBeTruthy()
	expect(view.getByText(/rather than sending you somewhere with nothing to do/)).toBeTruthy()
	// Path E, stated rather than offered as a toggle.
	expect(view.getByText(/not a dozen separate interruptions/)).toBeTruthy()
})

test('background participation is not a message, and is best effort', async () => {
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText('Taking part while you are not looking')).toBeTruthy())
	// Path B step 2: it shows nothing, and there is nothing to dismiss.
	expect(view.getByText(/It is not a message/)).toBeTruthy()
	// Step 3: never presented as a guarantee.
	expect(view.getByText(/Best effort, never a promise/)).toBeTruthy()
})

test('a party with something always on is told this does not rest on the phone', async () => {
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText(/Your home node stays on/)).toBeTruthy())
	expect(view.queryByText(/You have nothing that stays on/)).toBeNull()
})

test('a party with only a phone is pointed at a machine, not at a setting', async () => {
	// Story 43 path B step 4, and the reason `party.error.json` exists.
	setVariant('error')
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText(/You have nothing that stays on/)).toBeTruthy())
	expect(view.getByText(/not a setting in here/)).toBeTruthy()
	expect(view.getByText(/lives with your devices and your cadre/)).toBeTruthy()
})

test('declining participation breaks nothing and says what happens instead', async () => {
	setVariant('error')
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText(/Nothing breaks. Your tallies settle/)).toBeTruthy())
	expect(view.getByText(/anything waiting is still waiting/)).toBeTruthy()

	const on = await setNotifications({ backgroundParticipation: true })
	expect(on.ok && on.value.backgroundParticipation).toBe(true)
})

test('notifications refused: the cost is stated once, and nothing is badgered', async () => {
	setVariant('error')
	const view = await renderScreen(<Notifications />)
	await waitFor(() => expect(view.getByText('This app cannot notify you')).toBeTruthy())
	// Path D step 2.
	expect(view.getByText(/including requests with deadlines/)).toBeTruthy()
	expect(view.getByText(/you will not be asked again/)).toBeTruthy()
	// Step 3: what was waiting is still waiting.
	expect(view.getByText(/Anything that was waiting is still waiting/)).toBeTruthy()
	// And the classes still read — turning it back on is the phone's business.
	expect(view.getByText('Something needs your signature')).toBeTruthy()
	expect(view.getByText(/Your phone’s own settings/)).toBeTruthy()
})
