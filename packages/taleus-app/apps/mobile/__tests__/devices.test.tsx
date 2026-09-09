import { fireEvent, waitFor } from '@testing-library/react-native'

import {
	addDevice,
	hasAlwaysOn,
	listDevices,
	renameDevice,
	resetDevices,
	retireDevice,
} from '../src/data/devices'
import { resetParty } from '../src/data/party'
import { setVariant } from '../src/mock/variant'
import { Cadre } from '../src/screens/Cadre'
import { Devices } from '../src/screens/Devices'
import { renderScreen, screenProps } from '../testUtils'

const cadreProps = (navigate = jest.fn()) => screenProps('Cadre', undefined, navigate)

beforeEach(() => {
	resetDevices()
	resetParty()
	setVariant('happy')
})

test('everything that can act as this party, recognisably', async () => {
	const view = await renderScreen(<Devices />)
	await waitFor(() => expect(view.getByText('Jan’s phone')).toBeTruthy())
	expect(view.getByText('Kitchen tablet')).toBeTruthy()
	expect(view.getByText('Home node')).toBeTruthy()
	// Names a person chose, and the one in their hand marked as such.
	expect(view.getByText('The one in your hand')).toBeTruthy()
})

test('a device not carried in months is obvious, without the app guessing why', async () => {
	const view = await renderScreen(<Devices />)
	// Step 2 and path B: how long, never why.
	await waitFor(() => expect(view.getByText(/^Quiet for \d+ days$/)).toBeTruthy())
	expect(view.getByText(/Unplugged, out of signal, or gone for good/)).toBeTruthy()
	expect(view.getByText(/will not guess for you/)).toBeTruthy()
})

test('automatic settling depends on something being awake, and it is not the phone', async () => {
	const view = await renderScreen(<Devices />)
	await waitFor(() => expect(view.getByText(/only while something of yours is awake/)).toBeTruthy())
	expect(view.getByText(/asleep in your pocket is not that/)).toBeTruthy()
	// Jan has a node, so he is told it is handled rather than told off.
	expect(view.getByText(/Your Home node stays on/)).toBeTruthy()
	expect(view.queryByText(/you are just the slow part/)).toBeNull()
})

test('only a phone is a consequence, not a defect', async () => {
	setVariant('empty')
	const view = await renderScreen(<Devices />)
	// Path A: stated in terms of what is missed, and offered a fix.
	await waitFor(() => expect(view.getByText(/wait for you to open the app instead/)).toBeTruthy())
	expect(view.getByText(/Nothing is broken; you are just the slow part/)).toBeTruthy()
	expect(view.getByText(/stays on and is not your phone/)).toBeTruthy()
})

test('a party can see their always-on machine taking part', async () => {
	const view = await renderScreen(<Devices />)
	// Step 7.
	await waitFor(() => expect(view.getByText(/Last took part in settling/)).toBeTruthy())
	expect(view.getByText('You run it')).toBeTruthy()
})

test('retiring is described accurately, and can be done from any other device', async () => {
	const view = await renderScreen(<Devices />)
	// Once, not once per device — the sentence is the same for all of them.
	await waitFor(() => expect(view.getByText(/Everything it already did stands/)).toBeTruthy())
	// Path C: the right first move for a device you no longer control.
	expect(view.getByText(/from any other device of yours/)).toBeTruthy()
})

test('the last remaining device cannot be retired, and the reason is given', async () => {
	setVariant('empty')
	const view = await renderScreen(<Devices />)
	// Path D.
	await waitFor(() => expect(view.getByText(/it is not offered/)).toBeTruthy())
	expect(view.getByText(/unable to act as yourself at all/)).toBeTruthy()

	const refused = await retireDevice('dev:phone-1')
	expect(refused.ok).toBe(false)
	expect(!refused.ok && refused.error.kind).toBe('last-device')
})

test('a device that cannot be reached is a retry, not a refusal', async () => {
	// Story 13's error variant, reached by acting rather than by a different world.
	const failed = await retireDevice('dev:tablet-1')
	expect(failed.ok).toBe(false)
	expect(!failed.ok && failed.error.kind).toBe('unreachable')
	expect(!failed.ok && failed.error.retryable).toBe(true)
	// Nothing changed.
	const after = await listDevices()
	expect(after.ok && after.value.map(device => device.id)).toContain('dev:tablet-1')
})

test('retiring one that answers removes it and leaves the rest', async () => {
	const after = await retireDevice('dev:node-1')
	expect(after.ok && after.value.map(device => device.id)).toEqual([
		'dev:phone-1',
		'dev:tablet-1',
	])
	expect(after.ok && hasAlwaysOn(after.value)).toBe(false)
})

test('a party names their own devices', async () => {
	const renamed = await renameDevice('dev:tablet-1', 'The one in the kitchen')
	expect(renamed.ok && renamed.value.find(d => d.id === 'dev:tablet-1')?.name).toBe(
		'The one in the kitchen',
	)

	setVariant('empty')
	const view = await renderScreen(<Devices />)
	await waitFor(() => expect(view.getAllByText('Rename').length).toBeGreaterThan(0))
	fireEvent.press(view.getAllByText('Rename')[0])
	await waitFor(() => expect(view.getByText(/is a list that helps nobody/)).toBeTruthy())
})

test('adding something that stays on contributes both, a handheld only one', async () => {
	setVariant('empty')
	const node = await addDevice({ name: 'Shed box', kind: 'node' })
	const added = node.ok && node.value.find(device => device.name === 'Shed box')
	expect(added && added.alwaysOn).toBe(true)
	expect(added && added.contributes).toEqual(['durability', 'availability'])

	const tablet = await addDevice({ name: 'Old tablet', kind: 'tablet' })
	const second = tablet.ok && tablet.value.find(device => device.name === 'Old tablet')
	expect(second && second.alwaysOn).toBe(false)
	expect(second && second.contributes).toEqual(['durability'])
})

test('the cadre splits what survives elsewhere from what does not', async () => {
	const view = await renderScreen(<Cadre {...cadreProps()} />)
	await waitFor(() => expect(view.getByText('Your tallies are the less fragile part')).toBeTruthy())
	// Step 3: safety, and the condition on it.
	expect(view.getByText(/survives your phone going under a bus/)).toBeTruthy()
	expect(view.getByText(/That safety is borrowed/)).toBeTruthy()
	expect(view.getByText(/their favour/)).toBeTruthy()
	// Step 4: in the party's own terms, not in infrastructure terms.
	expect(view.getByText('Your own records are the fragile part')).toBeTruthy()
	expect(view.getByText(/What you have valued things at, what you prefer/)).toBeTruthy()
	expect(view.queryByText(/replicat/i)).toBeNull()
})

test('each machine says what it contributes', async () => {
	const view = await renderScreen(<Cadre {...cadreProps()} />)
	await waitFor(() => expect(view.getByText('Holds a copy, and stays on')).toBeTruthy())
	expect(view.getAllByText('Holds a copy of your records').length).toBe(2)
})

test('a party running only a phone is told once, and the risk is theirs alone', async () => {
	setVariant('empty')
	const view = await renderScreen(<Cadre {...cadreProps()} />)
	await waitFor(() => expect(view.getByText('One machine: the phone in your hand.')).toBeTruthy())
	// Path A: what they would lose, said once, no nagging.
	expect(view.getByText('And right now that is one machine.')).toBeTruthy()
	expect(view.getAllByText(/And right now that is one machine/).length).toBe(1)
})

test('somebody else hosting is a separate decision with its cost stated', async () => {
	const view = await renderScreen(<Cadre {...cadreProps()} />)
	// Path B.
	await waitFor(() => expect(view.getByText('Someone offering to host it for you')).toBeTruthy())
	expect(view.getByText(/is not the same decision as a machine of your own/)).toBeTruthy()
	expect(view.getByText(/sit on somebody else’s hardware/)).toBeTruthy()
})

test('nothing has to be arranged with counterparties, ever', async () => {
	const view = await renderScreen(<Cadre {...cadreProps()} />)
	// Path D, path E, and story 51.
	await waitFor(() => expect(view.getByText(/You do not add your partners’ machines/)).toBeTruthy())
	expect(view.getByText(/no partner has to be told/)).toBeTruthy()
	// Story 51: what was disclosed is not how machines find each other.
	expect(view.getByText(/It is not how their machines find yours/)).toBeTruthy()
})

test('removing down to one machine is warned about before it happens', async () => {
	const navigate = jest.fn()
	await retireDevice('dev:tablet-1').catch(() => undefined)
	const remaining = await listDevices()
	expect(remaining.ok && remaining.value).toHaveLength(3)

	// Two machines left is where the warning belongs — step 7.
	await retireDevice('dev:node-1')
	const view = await renderScreen(<Cadre {...cadreProps(navigate)} />)
	await waitFor(() => expect(view.getByText(/would exist in exactly one place/)).toBeTruthy())
	fireEvent.press(view.getByText('Add or retire a machine'))
	expect(navigate).toHaveBeenCalledWith('Devices')
})
