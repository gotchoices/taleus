import { fireEvent, waitFor } from '@testing-library/react-native'

import { createInvitation, listInvitations, readInvitation, resetInvitations, respondToInvitation } from '../src/data/invitations'
import { setVariant } from '../src/mock/variant'
import { CreateInvitation } from '../src/screens/CreateInvitation'
import { ReviewInvitation } from '../src/screens/ReviewInvitation'
import { renderScreen, screenProps } from '../testUtils'

beforeEach(() => {
	resetInvitations()
	setVariant('happy')
})

test('an invitation names nobody — whoever accepts becomes the other party', async () => {
	const made = await createInvitation({
		unit: { denom: 'iso4217:USD', scale: 2 },
		creditLimit: { units: 50000 },
		noticeDays: 14,
		agreementId: 'cid:bafy-standard-tally-v1',
		goodForDays: 1,
	})
	expect(made.ok).toBe(true)
	if (made.ok) {
		expect(made.value).not.toHaveProperty('counterparty')
		expect(made.value).not.toHaveProperty('invitee')
		expect(made.value.state).toBe('outstanding')
		expect(new Date(made.value.expires).getTime()).toBeGreaterThan(Date.now())
	}
})

test('the private note is a memo, not a claim about who responds', async () => {
	await createInvitation({
		note: 'bike, lunch Tuesday',
		unit: { denom: 'iso4217:USD', scale: 2 },
		creditLimit: { units: 50000 },
		noticeDays: 14,
		agreementId: 'cid:bafy-standard-tally-v1',
		goodForDays: 1,
	})
	const list = await listInvitations()
	expect(list.ok && list.value[0].note).toBe('bike, lunch Tuesday')
})

test('an invitee sees the terms and the agreement before disclosing anything', async () => {
	const view = await renderScreen(
		<ReviewInvitation {...screenProps('ReviewInvitation', { token: 'inv:jan-bike-7c1' })} />,
	)
	await waitFor(() => expect(view.getByText(/Jan Kessler is inviting you/)).toBeTruthy())
	expect(view.getByText('Standard Tally Agreement')).toBeTruthy()
	expect(view.getByText('You have disclosed nothing so far.')).toBeTruthy()
	// Story 02 step 5: needed is distinguishable from offered.
	expect(view.getAllByText(/needed/).length).toBeGreaterThan(0)
	expect(view.getAllByText(/your choice/).length).toBe(2)
})

test('accepting needs a name; zero credit back is a normal answer', async () => {
	const view = await renderScreen(
		<ReviewInvitation {...screenProps('ReviewInvitation', { token: 'inv:jan-bike-7c1' })} />,
	)
	await waitFor(() => expect(view.getByText('Accept')).toBeTruthy())
	expect(view.getByText('A name is needed before you can accept.')).toBeTruthy()

	fireEvent.changeText(view.getByLabelText('Name'), 'Sam Ortiz')
	await waitFor(() => expect(view.queryByText('A name is needed before you can accept.')).toBeNull())
	// The limit field is left at its default of zero, untouched.
	fireEvent.press(view.getByRole('button', { name: 'Accept' }))
	await waitFor(() => expect(view.getByText(/Accepted/)).toBeTruthy())
})

test('a refusal is final for that offer, and says so', async () => {
	const answer = await respondToInvitation('inv:jan-bike-7c1', 'refuse')
	expect(answer.ok && answer.value).toBe('refused')
	const view = await renderScreen(
		<ReviewInvitation {...screenProps('ReviewInvitation', { token: 'inv:jan-bike-7c1' })} />,
	)
	await waitFor(() => expect(view.getByText('Refuse')).toBeTruthy())
	fireEvent.press(view.getByRole('button', { name: 'Refuse' }))
	await waitFor(() => expect(view.getByText(/This offer is finished/)).toBeTruthy())
})

test('an expired invitation is explained, with a way forward — not an error', async () => {
	setVariant('expired')
	const read = await readInvitation('inv:jan-bike-7c1')
	expect(read.ok && read.value.state).toBe('expired')
	const view = await renderScreen(
		<ReviewInvitation {...screenProps('ReviewInvitation', { token: 'inv:jan-bike-7c1' })} />,
	)
	await waitFor(() => expect(view.getByText('This invitation has expired')).toBeTruthy())
	expect(view.getByText('Ask for another')).toBeTruthy()
})

test('the unit is chosen at invitation time and the party is warned it is permanent', async () => {
	const view = await renderScreen(<CreateInvitation {...screenProps('CreateInvitation', undefined)} />)
	await waitFor(() => expect(view.getByText('What does this tally count in?')).toBeTruthy())
	expect(view.getByText('This cannot be changed once the tally exists.')).toBeTruthy()
	expect(view.getByLabelText('USD')).toBeTruthy()
	expect(view.getByLabelText('CHIP')).toBeTruthy()
})
