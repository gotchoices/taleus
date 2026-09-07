import { fireEvent, waitFor } from '@testing-library/react-native'

import { Attention } from '../src/screens/Attention'
import { Position } from '../src/screens/Position'
import { TallyHistory } from '../src/screens/TallyHistory'
import { TallyList } from '../src/screens/TallyList'
import { TallyView } from '../src/screens/TallyView'
import { noNavigation, renderScreen } from '../testUtils'

test('history keeps requests beside the ledger, each saying which way it runs', async () => {
	const view = await renderScreen(
		<TallyHistory
			route={{ name: 'TallyHistory', params: { tallyId: 'tally:sam-bike' } }}
			navigation={noNavigation}
		/>,
	)
	await waitFor(() => expect(view.getByText('Bike')).toBeTruthy())
	expect(view.getByText('Still being asked')).toBeTruthy()
	expect(view.getByText('Wheel truing')).toBeTruthy()
	// Story 21: the fixture's request is one this party asked, and the screen
	// used to file it under "being asked of you".
	expect(view.getByText(/Asked by you/)).toBeTruthy()
})

test('a balance after an entry states its side, never a bare figure', async () => {
	const view = await renderScreen(
		<TallyHistory
			route={{ name: 'TallyHistory', params: { tallyId: 'tally:sam-bike' } }}
			navigation={noNavigation}
		/>,
	)
	await waitFor(() => expect(view.getByText('Bike')).toBeTruthy())
	expect(view.getAllByText(/Balance after: .* owed to you/).length).toBeGreaterThan(0)
})

test('the tally list shows the tally asked for, not the only one in a fixture', async () => {
	const view = await renderScreen(
		<TallyView route={{ name: 'TallyView', params: { tallyId: 'tally:mara-shop' } }} navigation={noNavigation} />,
	)
	await waitFor(() => expect(view.getByText(/You owe Mara's Bike Shop/)).toBeTruthy())
})

test('both directions of terms are shown, each with its own effective date', async () => {
	const view = await renderScreen(
		<TallyView route={{ name: 'TallyView', params: { tallyId: 'tally:sam-bike' } }} navigation={noNavigation} />,
	)
	await waitFor(() => expect(view.getByText('Terms in force')).toBeTruthy())
	expect(view.getByText(/In force since Mar 2, 2026/)).toBeTruthy()
	expect(view.getByText(/In force since Nov 14, 2025/)).toBeTruthy()
})

test('an offered tally is not shown with a balance', async () => {
	const view = await renderScreen(<TallyList route={{ name: 'TallyList', params: undefined }} navigation={noNavigation} />)
	await waitFor(() => expect(view.getByText('Rae Whitfield')).toBeTruthy())
	expect(view.getByText('Offered')).toBeTruthy()
	expect(view.queryByText('0.000 CHIP')).toBeNull()
	expect(view.getByText('Nothing traded yet')).toBeTruthy()
})

test('every tally row says when it last moved', async () => {
	const view = await renderScreen(<TallyList route={{ name: 'TallyList', params: undefined }} navigation={noNavigation} />)
	await waitFor(() => expect(view.getByText('Sam Ortiz')).toBeTruthy())
	expect(view.getAllByText(/Last activity/).length).toBe(6)
})

test('attention items are reachable and say how long they have waited', async () => {
	const navigate = jest.fn()
	const view = await renderScreen(
		<Attention route={{ name: 'Attention', params: undefined }} navigation={{ ...noNavigation, navigate }} />,
	)
	await waitFor(() => expect(view.getByText('Rae Whitfield proposed terms')).toBeTruthy())
	expect(view.getAllByText(/Waiting \d+ days?/).length).toBeGreaterThan(0)
	fireEvent.press(view.getByLabelText('Rae Whitfield proposed terms'))
	expect(navigate).toHaveBeenCalled()
})

test('position separates owed from owing in the estimate too, and marks it', async () => {
	const view = await renderScreen(<Position />)
	await waitFor(() => expect(view.getByText('Estimated overall')).toBeTruthy())
	expect(view.getByText('Leaving you')).toBeTruthy()
	expect(view.queryByText('Net')).toBeNull()
	expect(view.getAllByText(/^≈/).length).toBe(3)
})
