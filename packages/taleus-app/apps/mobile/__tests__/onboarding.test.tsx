import { fireEvent, waitFor } from '@testing-library/react-native'

import { createIdentity, readParty, resetParty, setDisplayName } from '../src/data/party'
import { isOnboarded } from '../src/session'
import { setVariant } from '../src/mock/variant'
import { ChooseName } from '../src/screens/ChooseName'
import { Welcome } from '../src/screens/Welcome'
import { renderScreen } from '../testUtils'

const navigate = jest.fn()
const nav = { navigate, goBack: jest.fn() } as never

beforeEach(() => {
	resetParty()
	setVariant('happy')
	jest.clearAllMocks()
})

test('no identity is a real answer, not an error', async () => {
	setVariant('first-run')
	const result = await readParty()
	expect(result.ok).toBe(true)
	if (result.ok) {
		expect(result.value).toBeNull()
		expect(isOnboarded(result.value)).toBe(false)
	}
})

test('an identity is created without the party choosing anything', async () => {
	setVariant('first-run')
	const made = await createIdentity()
	expect(made.ok).toBe(true)
	if (made.ok) {
		expect(made.value.sid).toBeTruthy()
		// Story 10 step 5: the name is the one thing still to come.
		expect(made.value.displayName).toBe('')
		expect(isOnboarded(made.value)).toBe(false)
	}
})

test('first run is not complete until a name is on the identity', async () => {
	setVariant('first-run')
	await createIdentity()
	const before = await readParty()
	expect(before.ok && isOnboarded(before.value)).toBe(false)
	const named = await setDisplayName('Steve Ruiz')
	expect(named.ok).toBe(true)
	if (named.ok) {
		expect(isOnboarded(named.value)).toBe(true)
		// Story 11: a name is the first thing disclosed, and the only thing yet.
		expect(named.value.disclosed).toEqual({ name: 'Steve Ruiz' })
	}
})

test('Welcome explains before it asks, and creates nothing until told to', async () => {
	setVariant('first-run')
	const view = await renderScreen(<Welcome navigation={nav} route={{ name: 'Welcome' } as never} />)
	await waitFor(() => expect(view.getByText(/running account/)).toBeTruthy())
	// Story 10 path D: readable without having created anything.
	const yet = await readParty()
	expect(yet.ok && yet.value).toBeNull()

	fireEvent.press(view.getByText('Get started'))
	await waitFor(() => expect(navigate).toHaveBeenCalledWith('ChooseName'))
	const now = await readParty()
	expect(now.ok && now.value).not.toBeNull()
})

test('ChooseName will not continue without a name, and reports when it has one', async () => {
	setVariant('first-run')
	await createIdentity()
	const onDone = jest.fn()
	const view = await renderScreen(
		<ChooseName navigation={nav} route={{ name: 'ChooseName' } as never} onDone={onDone} />,
	)
	await waitFor(() => expect(view.getByText('Continue')).toBeTruthy())

	const button = () => view.getByRole('button', { name: 'Continue' })
	fireEvent.press(button())
	expect(onDone).not.toHaveBeenCalled()

	fireEvent.changeText(view.getByLabelText(/What should people/), '  Steve Ruiz  ')
	// RNTL 14 renders asynchronously: the press must follow the state it depends on.
	await waitFor(() => expect(view.getByLabelText(/What should people/).props.value).toContain('Steve'))
	fireEvent.press(button())
	await waitFor(() => expect(onDone).toHaveBeenCalled())
	const party = await readParty()
	expect(party.ok && party.value?.displayName).toBe('Steve Ruiz')
})

test('an established identity skips first run entirely', async () => {
	setVariant('happy')
	const result = await readParty()
	expect(result.ok && isOnboarded(result.value)).toBe(true)
})
