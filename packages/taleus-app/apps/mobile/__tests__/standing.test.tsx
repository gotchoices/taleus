import { fireEvent, waitFor } from '@testing-library/react-native'

import { publishStanding, readStanding, resetStanding, withdrawStanding } from '../src/data/standing'
import { resetProfile } from '../src/data/profile'
import { setVariant } from '../src/mock/variant'
import { StandingInvitation } from '../src/screens/StandingInvitation'
import { renderScreen, screenProps } from '../testUtils'

const props = (navigate = jest.fn()) => screenProps('StandingInvitation', undefined, navigate)

beforeEach(() => {
	resetStanding()
	resetProfile()
	setVariant('happy')
})

test('there is no directory, and the party is told so', async () => {
	const view = await renderScreen(<StandingInvitation {...props()} />)
	// Story 10 path E step 2: findable only if you hand something out.
	await waitFor(() => expect(view.getByText(/There is no directory/)).toBeTruthy())
	expect(view.getByText(/findable only if you hand something out/)).toBeTruthy()
	// Step 4: before you have ever tallied with anybody.
	expect(view.getByText(/before you have ever tallied with anybody/)).toBeTruthy()
})

test('one set of terms, and one separate tally per responder', async () => {
	const navigate = jest.fn()
	const view = await renderScreen(<StandingInvitation {...props(navigate)} />)
	await waitFor(() => expect(view.getByText('Who has taken it up')).toBeTruthy())
	// Story 01 path C.4: separate relationships, negotiable individually.
	expect(view.getByText(/none of them is bound to what you published/)).toBeTruthy()
	fireEvent.press(view.getByLabelText('Priya Raman'))
	expect(navigate).toHaveBeenCalledWith('Tallies', {
		screen: 'TallyView',
		params: { tallyId: 'tally:priya-new' },
	})
})

test('extending a stranger nothing is presented as useful, not as a lesser offer', async () => {
	const view = await renderScreen(<StandingInvitation {...props()} />)
	await waitFor(() => expect(view.getByText('What I will let a stranger owe me')).toBeTruthy())
	// Story 21 path A: they fund it themselves, and that may be worth a discount.
	expect(view.getByText(/hands you value, it is recorded, and they spend it with you from there/)).toBeTruthy()
	expect(view.getByText(/lent you the money up front/)).toBeTruthy()
})

test('the terms bind only the publisher', async () => {
	const view = await renderScreen(<StandingInvitation {...props()} />)
	// Story 01 step 4, which a standing invitation does not change.
	await waitFor(() => expect(view.getByText(/These are your numbers only/)).toBeTruthy())
	expect(view.getByText(/Whoever takes it up accepts the same one, and is free to refuse it/)).toBeTruthy()
	expect(view.getByText(/Fixed once it is published/)).toBeTruthy()
})

test('what it discloses is presented as public, on the published invitation', async () => {
	const view = await renderScreen(<StandingInvitation {...props()} />)
	await waitFor(() =>
		expect(view.getByText('What everyone who takes it up will learn about you')).toBeTruthy(),
	)
	expect(view.getByText('name, business name and phone number')).toBeTruthy()
	// Story 11 path C.
	expect(view.getByText(/It goes to every person who takes this up/)).toBeTruthy()
	expect(view.getByText(/Anything you would not put on a card, leave out/)).toBeTruthy()
})

test('a party with none is offered one, and told what it is public before publishing', async () => {
	setVariant('empty')
	const view = await renderScreen(<StandingInvitation {...props()} />)
	await waitFor(() => expect(view.getByText('You have not published one')).toBeTruthy())
	fireEvent.press(view.getByText('Publish one'))

	// The warning is on the form, before anything is chosen — afterwards is too
	// late for the only decision that mattered.
	await waitFor(() => expect(view.getByText(/It goes to every person/)).toBeTruthy())
	expect(view.getByText('What I will let a stranger owe me')).toBeTruthy()
	// Nothing is pre-selected for disclosure.
	expect(view.getByText(/Nothing at all. That is allowed/)).toBeTruthy()
})

test('publishing waits on the party saying they understand', async () => {
	setVariant('empty')
	const view = await renderScreen(<StandingInvitation {...props()} />)
	await waitFor(() => expect(view.getByText('Publish one')).toBeTruthy())
	fireEvent.press(view.getByText('Publish one'))
	await waitFor(() => expect(view.getByText('Publish it')).toBeTruthy())

	// Pressing it does nothing until the acknowledgement is ticked.
	fireEvent.press(view.getByText('Publish it'))
	await waitFor(() => expect(view.getByText('Publish it')).toBeTruthy())
	const before = await readStanding()
	expect(before.ok && before.value).toBeNull()

	fireEvent.press(view.getByLabelText('I understand this goes to everyone'))
	await waitFor(() =>
		expect(
			view.getByLabelText('I understand this goes to everyone').props.accessibilityState.checked,
		).toBe(true),
	)
	fireEvent.press(view.getByText('Publish it'))
	await waitFor(() => expect(view.getByText('Hand this out')).toBeTruthy())
})

test('what is published is a link a person can hand over', async () => {
	setVariant('empty')
	const published = await publishStanding({
		unit: { denom: 'iso4217:USD', scale: 2 },
		creditLimit: { units: 0 },
		noticeDays: 14,
		agreementId: 'cid:bafy-standard-tally-v1',
		disclose: ['name'],
	})
	expect(published.ok && published.value.link).toMatch(/^https:\/\/sereus\.org\/taleus\/invite\//)
	expect(published.ok && published.value.takenUp).toEqual([])
	expect(published.ok && published.value.state).toBe('published')
})

test('withdrawing stops new takers and leaves the tallies alone', async () => {
	const before = await readStanding()
	const takers = before.ok && before.value ? before.value.takenUp : []
	const after = await withdrawStanding()
	expect(after.ok && after.value?.state).toBe('withdrawn')
	// Story 01 path C.4: those stopped being this invitation's business when they opened.
	expect(after.ok && after.value?.takenUp).toEqual(takers)

	const view = await renderScreen(<StandingInvitation {...props()} />)
	await waitFor(() => expect(view.getByText('Withdrawn')).toBeTruthy())
	expect(view.getByText(/What came from it carries on/)).toBeTruthy()
	expect(view.queryByText('Hand this out')).toBeNull()
	expect(view.getByText('Publish a new one')).toBeTruthy()
})
