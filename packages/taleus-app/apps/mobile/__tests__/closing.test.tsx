import { fireEvent, waitFor } from '@testing-library/react-native'

import { recordEntry, resetEntries } from '../src/data/entries'
import { readTally, requestClose, resetCloses, withdrawClose } from '../src/data/tally'
import { setVariant } from '../src/mock/variant'
import { CloseTally } from '../src/screens/CloseTally'
import { renderScreen, screenProps } from '../testUtils'

const props = (tallyId: string, navigate = jest.fn()) =>
	screenProps('CloseTally', { tallyId }, navigate)

beforeEach(() => {
	resetCloses()
	resetEntries()
	setVariant('happy')
})

test('the consequences are stated before closing begins', async () => {
	const view = await renderScreen(<CloseTally {...props('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText('What closing does')).toBeTruthy())
	expect(view.getByText(/does not go away, and closing does not forgive it/)).toBeTruthy()
	expect(view.getByText(/They keep everything they are owed/)).toBeTruthy()
	expect(view.getByText('Ask to close it')).toBeTruthy()
})

test('either party may ask, and a second request changes nothing', async () => {
	setVariant('closing')
	// sam-bike is already closing at the other party's request.
	const first = await readTally('tally:sam-bike')
	expect(first.ok && first.value.closing?.requestedBy).toBe('them')
	const both = await requestClose('tally:sam-bike')
	expect(both.ok && both.value.closing?.requestedBy).toBe('both')
	// Still closing, not more closed.
	expect(both.ok && both.value.state).toBe('Closing')
})

test('a party can withdraw their own request; it stays closing while theirs stands', async () => {
	setVariant('closing')
	await requestClose('tally:sam-bike')
	const after = await withdrawClose('tally:sam-bike')
	expect(after.ok && after.value.closing?.requestedBy).toBe('them')
	expect(after.ok && after.value.state).toBe('Closing')
})

test('withdrawing the only request reopens the tally on the terms it always had', async () => {
	const asked = await requestClose('tally:mara-shop')
	expect(asked.ok && asked.value.state).toBe('Closing')
	const back = await withdrawClose('tally:mara-shop')
	expect(back.ok && back.value.closing).toBeUndefined()
	expect(back.ok && back.value.state).toBe('Open')
})

test('a closing tally takes what settles it and refuses what does not', async () => {
	setVariant('closing')
	// This party is owed $180, so giving value moves the balance toward zero.
	const toward = await recordEntry('tally:sam-bike', { actId: 'c1', amount: { units: 5000 } })
	expect(toward.ok).toBe(true)

	// More than is outstanding would carry it past zero.
	const past = await recordEntry('tally:sam-bike', { actId: 'c2', amount: { units: 99999 } })
	expect(past.ok).toBe(false)
	if (!past.ok) {
		expect(past.error.kind).toBe('closing-overshoot')
	}
})

test('a closing tally with nothing owed has nothing to settle', async () => {
	setVariant('closing')
	const view = await renderScreen(<CloseTally {...props('tally:priya-new')} />)
	await waitFor(() => expect(view.getByText(/Nothing is owed either way/)).toBeTruthy())
})

test('a closing tally is presented as awaiting settlement, not broken', async () => {
	setVariant('closing')
	const view = await renderScreen(<CloseTally {...props('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText('This tally is closing')).toBeTruthy())
	expect(view.getByText(/waiting on settlement, not finished and not broken/)).toBeTruthy()
	expect(view.getByText(/Anything that moves the balance toward zero/)).toBeTruthy()
})

test('the write-off is offered only to the party owed, and does not nag', async () => {
	setVariant('closing')
	const view = await renderScreen(<CloseTally {...props('tally:dave-hours')} />)
	await waitFor(() => expect(view.getByText('A remainder not worth chasing')).toBeTruthy())
	expect(view.getByText(/yours to give up, and nobody can do it for you/)).toBeTruthy()

	fireEvent.press(view.getByRole('button', { name: 'Leave it as it is' }))
	await waitFor(() => expect(view.getByText(/You will not be asked again/)).toBeTruthy())
	expect(view.queryByText('A remainder not worth chasing')).toBeNull()
})

test('a missed date is shown with nothing added to the balance for it', async () => {
	setVariant('closing')
	const tally = await readTally('tally:sam-bike')
	const before = tally.ok ? tally.value.balance.units : 0
	const view = await renderScreen(<CloseTally {...props('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText(/They agreed to settle by/)).toBeTruthy())
	const after = await readTally('tally:sam-bike')
	expect(after.ok && after.value.balance.units).toBe(before)
})

test('a remainder is named the way the unit reads, not as a bare count', async () => {
	setVariant('closing')
	const view = await renderScreen(<CloseTally {...props('tally:dave-hours')} />)
	await waitFor(() => expect(view.getByText('A remainder not worth chasing')).toBeTruthy())
	// Dave-hours divide by sixty: two units are two minutes, never "2".
	expect(view.getByText(/0 Dave-hours 2\/60 is holding this up/)).toBeTruthy()
	expect(view.queryByText('Hand back 2')).toBeNull()
})
