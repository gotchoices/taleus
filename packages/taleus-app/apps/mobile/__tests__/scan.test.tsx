import { act, fireEvent, waitFor } from '@testing-library/react-native'

import { buildInviteLink } from '../src/data/inviteLink'
import { Scan } from '../src/screens/Scan'
import { TallyList } from '../src/screens/TallyList'
import { setVariant } from '../src/mock/variant'
import { renderScreen, screenProps } from '../testUtils'

jest.mock('@react-navigation/native', () => ({
	...jest.requireActual('@react-navigation/native'),
	useIsFocused: () => true,
}))

describe('opening an invitation handed over in person (story 02)', () => {
	it('opens the invitation a scanned code links to', async () => {
		const navigate = jest.fn()
		const view = await renderScreen(<Scan {...screenProps('Scan', undefined, navigate)} />)
		await act(async () => view.getByTestId('code-scanner').props.scan(buildInviteLink('inv:jan-bike-7c1')))
		expect(navigate).toHaveBeenCalledWith('ReviewInvitation', { token: 'inv:jan-bike-7c1' })
	})

	it('names a code that is not an invitation, and opens nothing', async () => {
		const navigate = jest.fn()
		const view = await renderScreen(<Scan {...screenProps('Scan', undefined, navigate)} />)
		await act(async () => view.getByTestId('code-scanner').props.scan('https://example.com/menu'))
		expect(view.getByText(/not a Taleus invitation/)).toBeTruthy()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('opens a pasted link, or pasted invitation text, for review', async () => {
		const navigate = jest.fn()
		const view = await renderScreen(<Scan {...screenProps('Scan', undefined, navigate)} />)
		await fireEvent.changeText(view.getByLabelText('Invitation link'), `  ${buildInviteLink('inv:jan-bike-7c1')}  `)
		await fireEvent.press(view.getByText('Open it'))
		expect(navigate).toHaveBeenLastCalledWith('ReviewInvitation', { token: 'inv:jan-bike-7c1' })
		await fireEvent.changeText(view.getByLabelText('Invitation link'), 'inv:jan-shop-2b8')
		await fireEvent.press(view.getByText('Open it'))
		expect(navigate).toHaveBeenLastCalledWith('ReviewInvitation', { token: 'inv:jan-shop-2b8' })
	})

	it('is where "I have an invitation" goes from an empty tally list', async () => {
		setVariant('empty')
		const navigate = jest.fn()
		const view = await renderScreen(<TallyList {...screenProps('TallyList', undefined, navigate)} />)
		await waitFor(() => expect(view.getByText('I have an invitation')).toBeTruthy())
		await fireEvent.press(view.getByText('I have an invitation'))
		expect(navigate).toHaveBeenCalledWith('Scan')
		setVariant('happy')
	})
})
