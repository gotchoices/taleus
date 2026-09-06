import { render, waitFor } from '@testing-library/react-native'

import { TallyHistory } from '../src/screens/TallyHistory'

test('leaves the loading state, and keeps requests beside the ledger', async () => {
	const view = await render(
		<TallyHistory
			route={{ name: 'TallyHistory', params: { tallyId: 'tally:sam-bike' } }}
			navigation={{ navigate: jest.fn(), goBack: jest.fn() }}
		/>,
	)
	await waitFor(() => expect(view.getByText('Bike')).toBeTruthy())
	expect(view.getByText('Still being asked')).toBeTruthy()
	expect(view.getByText('Wheel truing')).toBeTruthy()
})
