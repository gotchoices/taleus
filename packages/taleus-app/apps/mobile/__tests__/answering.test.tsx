import { fireEvent, waitFor } from '@testing-library/react-native'

import { recordEntry, resetEntries } from '../src/data/entries'
import {
	declineRequest,
	listRequests,
	readRequest,
	resetRequests,
	withdrawRequest,
} from '../src/data/requests'
import { setVariant } from '../src/mock/variant'
import { RequestView } from '../src/screens/RequestView'
import { renderScreen, screenProps } from '../testUtils'

const asked = 'request:mara-95'
const mine = 'request:jan-sam-60'

beforeEach(() => {
	resetEntries()
	resetRequests()
	setVariant('happy')
})

test('a part-answered request shows what was applied and what is still asked', async () => {
	const view = await renderScreen(<RequestView {...screenProps('RequestView', { requestId: asked })} />)
	await waitFor(() => expect(view.getByText('Paid against it so far')).toBeTruthy())
	expect(view.getByText('Still asked')).toBeTruthy()
	expect(view.getByText(/Nothing pretends the part settled the whole/)).toBeTruthy()
})

test('there is no expiry anywhere — it shows how long it has waited instead', async () => {
	const view = await renderScreen(<RequestView {...screenProps('RequestView', { requestId: asked })} />)
	await waitFor(() => expect(view.getByText(/Waiting \d+ days/)).toBeTruthy())
	expect(view.queryByText(/expire|runs out|valid until/i)).toBeNull()
	expect(view.getByText(/does not lapse on its own/)).toBeTruthy()
})

test('paying hands over the requester s amount, not an empty field', async () => {
	const navigate = jest.fn()
	const view = await renderScreen(
		<RequestView {...screenProps('RequestView', { requestId: asked }, navigate)} />,
	)
	await waitFor(() => expect(view.getByText('Pay it')).toBeTruthy())
	fireEvent.press(view.getByRole('button', { name: 'Pay it' }))
	expect(navigate).toHaveBeenCalledWith('PayPartner', {
		tallyId: 'tally:mara-shop',
		amount: 25,
		answers: asked,
	})
})

test('paying part opens without an amount — the payer says which they are doing', async () => {
	const navigate = jest.fn()
	const view = await renderScreen(
		<RequestView {...screenProps('RequestView', { requestId: asked }, navigate)} />,
	)
	await waitFor(() => expect(view.getByText('Pay part of it')).toBeTruthy())
	fireEvent.press(view.getByRole('button', { name: 'Pay part of it' }))
	expect(navigate).toHaveBeenCalledWith('PayPartner', {
		tallyId: 'tally:mara-shop',
		answers: asked,
	})
})

test('an entry answering a request records what was applied against it', async () => {
	const before = await readRequest(asked)
	expect(before.ok && before.value.applied.units).toBe(7000)

	await recordEntry('tally:mara-shop', {
		actId: 'pay1',
		amount: { units: 2500 },
		answers: [asked],
	})
	const after = await readRequest(asked)
	expect(after.ok && after.value.applied.units).toBe(9500)
	expect(after.ok && after.value.stillAsked.units).toBe(0)
	expect(after.ok && after.value.state).toBe('answered')
})

test('declining moves nothing and stops it waiting', async () => {
	const declined = await declineRequest(asked, 'Quoted at $70')
	expect(declined.ok && declined.value.state).toBe('refused')
	const list = await listRequests('tally:mara-shop')
	expect(list.ok && list.value.find(r => r.id === asked)?.state).toBe('refused')
})

test('a request this party made can be taken back, not answered', async () => {
	const view = await renderScreen(<RequestView {...screenProps('RequestView', { requestId: mine })} />)
	await waitFor(() => expect(view.getByText('Take it back')).toBeTruthy())
	expect(view.queryByText('Pay it')).toBeNull()
	expect(view.queryByText('Decline it')).toBeNull()

	const gone = await withdrawRequest(mine)
	expect(gone.ok && gone.value.state).toBe('withdrawn')
})
