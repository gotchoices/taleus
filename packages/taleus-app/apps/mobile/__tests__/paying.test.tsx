import { fireEvent, waitFor } from '@testing-library/react-native'

import { listEntries, previewEntry, recordEntry, resetEntries } from '../src/data/entries'
import { createRequest, listRequests, resetRequests } from '../src/data/requests'
import { setVariant } from '../src/mock/variant'
import { CreateRequest } from '../src/screens/CreateRequest'
import { PayPartner } from '../src/screens/PayPartner'
import { renderScreen, screenProps } from '../testUtils'

beforeEach(() => {
	resetEntries()
	resetRequests()
	setVariant('happy')
})

test('the effect is shown before signing: balance after, and room left', async () => {
	// Mara's tally: this party owes $42.50, with $157.50 of room.
	const preview = await previewEntry('tally:mara-shop', { units: 4000 })
	expect(preview.ok).toBe(true)
	if (preview.ok) {
		expect(preview.value.balanceAfter).toEqual({ units: 8250, perspective: 'owed-by-me' })
		expect(preview.value.roomAfter.units).toBe(11750)
		expect(preview.value.beyondLimit).toBeUndefined()
	}
})

test('which side of zero it lands on is arithmetic, not a different act', async () => {
	// Sam's tally is owed-to-me $180; giving $200 crosses zero.
	const preview = await previewEntry('tally:sam-bike', { units: 20000 })
	expect(preview.ok && preview.value.balanceAfter).toEqual({ units: 2000, perspective: 'owed-by-me' })
})

test('going past the limit warns with how far, and does not block', async () => {
	const preview = await previewEntry('tally:mara-shop', { units: 20000 })
	expect(preview.ok && preview.value.beyondLimit?.units).toBe(4250)

	const view = await renderScreen(<PayPartner {...screenProps('PayPartner', { tallyId: 'tally:mara-shop' })} />)
	await waitFor(() => expect(view.getByLabelText('Amount')).toBeTruthy())
	fireEvent.changeText(view.getByLabelText('Amount'), '200')
	await waitFor(() => expect(view.getByText('This goes past what they agreed to')).toBeTruthy())
	expect(view.getByText(/a pledge is your own promise to pay/)).toBeTruthy()
	// Still signable: the limit warns, it does not wall.
	fireEvent.press(view.getByRole('button', { name: 'Sign it' }))
	await waitFor(() => expect(view.getByText('Recorded')).toBeTruthy())
})

test('an entry needs nobody else s agreement, and lands in the history', async () => {
	const made = await recordEntry('tally:sam-bike', { actId: 'a1', amount: { units: 4000 }, memo: 'Tube' })
	expect(made.ok).toBe(true)
	const entries = await listEntries('tally:sam-bike')
	expect(entries.ok && entries.value[0].memo).toBe('Tube')
	expect(entries.ok && entries.value[0].issuer).toBe('me')
})

test('with the counterparty unreachable it does not go through, and says so', async () => {
	setVariant('error')
	const made = await recordEntry('tally:sam-bike', { actId: 'a2', amount: { units: 4000 } })
	expect(made.ok).toBe(false)
	if (!made.ok) {
		expect(made.error.kind).toBe('counterparty-unreachable')
		expect(made.error.retryable).toBe(true)
	}
	// Nothing half-done: the history is unchanged.
	const entries = await listEntries('tally:sam-bike')
	expect(entries.ok && entries.value.every(e => e.id !== 'entry:a2')).toBe(true)
})

test('retrying the same act cannot record it twice', async () => {
	const first = await recordEntry('tally:sam-bike', { actId: 'same', amount: { units: 4000 } })
	const again = await recordEntry('tally:sam-bike', { actId: 'same', amount: { units: 4000 } })
	expect(first.ok && again.ok).toBe(true)
	const entries = await listEntries('tally:sam-bike')
	expect(entries.ok && entries.value.filter(e => e.id === 'entry:same').length).toBe(1)
})

test('a request obliges nothing, does not tick, and says both', async () => {
	const view = await renderScreen(
		<CreateRequest {...screenProps('CreateRequest', { tallyId: 'tally:sam-bike' })} />,
	)
	await waitFor(() => expect(view.getByText(/obliges them to nothing by itself/)).toBeTruthy())
	expect(view.getByText(/A request does not tick/)).toBeTruthy()
	// No expiry control exists, because there is nothing to set.
	expect(view.queryByLabelText(/expir/i)).toBeNull()

	fireEvent.changeText(view.getByLabelText('Amount'), '95')
	await waitFor(() => expect(view.getByLabelText('Amount').props.value).toBe('95'))
	fireEvent.press(view.getByRole('button', { name: 'Ask for it' }))
	await waitFor(() => expect(view.getByText(/They are asked to answer it/)).toBeTruthy())
})

test('a new request runs the way this party asked it', async () => {
	await createRequest('tally:sam-bike', { amount: { units: 9500 }, memo: 'Repair' })
	const list = await listRequests('tally:sam-bike')
	expect(list.ok && list.value[0].direction).toBe('asked-by-me')
	expect(list.ok && list.value[0].state).toBe('waiting')
	expect(list.ok && list.value[0].applied.units).toBe(0)
})
