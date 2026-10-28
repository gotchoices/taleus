import { fireEvent, waitFor } from '@testing-library/react-native'

import { previewEntry, recordEntry, resetEntries } from '../src/data/entries'
import { readTally, requestClose, resetCloses } from '../src/data/tally'
import { setVariant } from '../src/mock/variant'
import { CloseTally } from '../src/screens/CloseTally'
import { TallyView } from '../src/screens/TallyView'
import { renderScreen, screenProps } from '../testUtils'

const props = (tallyId: string, navigate = jest.fn()) =>
	screenProps('CloseTally', { tallyId }, navigate)

beforeEach(() => {
	resetCloses()
	resetEntries()
	setVariant('happy')
})

test('requesting a close warns that it cannot be taken back', async () => {
	const view = await renderScreen(<CloseTally {...props('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText('Before you ask')).toBeTruthy())
	expect(view.getByText('A request to close cannot be taken back.')).toBeTruthy()
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

test('a closing tally still records entries, and warns when one grows the balance', async () => {
	setVariant('closing')
	// This party is owed $180, so giving value toward it moves the balance toward zero.
	const toward = await previewEntry('tally:sam-bike', { units: 5000 })
	expect(toward.ok && toward.value.growsClosing).toBeFalsy()

	// More than is outstanding carries it past zero: warned, and still recorded.
	const past = await previewEntry('tally:sam-bike', { units: 99999 })
	expect(past.ok && past.value.growsClosing).toBe(true)
	const recorded = await recordEntry('tally:sam-bike', { actId: 'c2', amount: { units: 99999 } })
	expect(recorded.ok).toBe(true)
})

test('a closed tally accepts nothing further', async () => {
	setVariant('closing')
	const closed = await readTally('tally:lee-closed')
	expect(closed.ok && closed.value.state).toBe('Closed')
	const entry = await recordEntry('tally:lee-closed', { actId: 'c3', amount: { units: 100 } })
	expect(entry.ok).toBe(false)
	if (!entry.ok) {
		expect(entry.error.kind).toBe('closed')
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
	expect(view.getByText(/only moves the balance toward zero now/)).toBeTruthy()
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

test('a closed tally offers nothing to do on it, and stays readable', async () => {
	setVariant('closing')
	const view = await renderScreen(<TallyView {...screenProps('TallyView', { tallyId: 'tally:lee-closed' })} />)
	await waitFor(() => expect(view.getByText('Closed')).toBeTruthy())
	expect(view.queryByRole('button', { name: 'Record value given' })).toBeNull()
	expect(view.queryByRole('button', { name: 'Close this tally' })).toBeNull()
	expect(view.getByRole('button', { name: 'See history' })).toBeTruthy()
	expect(view.queryByText('Room to spend')).toBeNull()
})

test('a closing tally still offers paying, and says it is winding down', async () => {
	setVariant('closing')
	const view = await renderScreen(<TallyView {...screenProps('TallyView', { tallyId: 'tally:sam-bike' })} />)
	await waitFor(() => expect(view.getByText(/winding down until the balance settles/)).toBeTruthy())
	expect(view.getByRole('button', { name: 'Close this tally' })).toBeTruthy()
})
