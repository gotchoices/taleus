import { getStateFromPath } from '@react-navigation/native'
import { fireEvent, waitFor } from '@testing-library/react-native'
import { Share } from 'react-native'

import { resetInvitations } from '../src/data/invitations'
import { buildInviteLink, inviteToken, routableLink } from '../src/data/inviteLink'
import { setVariant } from '../src/mock/variant'
import { linking } from '../src/navigation/linking'
import { CreateInvitation } from '../src/screens/CreateInvitation'
import { renderScreen, screenProps } from '../testUtils'

beforeEach(() => {
	resetInvitations()
	setVariant('happy')
})

afterEach(() => {
	jest.restoreAllMocks()
})

describe('the invitation link', () => {
	const token = 'taleus:offer:eyJ2IjoxfQ'

	test('carries the token after #, where it never reaches the server', () => {
		expect(buildInviteLink(token)).toBe(`https://sereus.org/taleus/invite/#${token}`)
		expect(inviteToken(buildInviteLink(token))).toBe(token)
	})

	test('links handed out earlier, in the path form, still read', () => {
		expect(inviteToken(`https://sereus.org/taleus/invite/${encodeURIComponent(token)}`)).toBe(token)
	})

	test('becomes the path navigation routes, and leaves every other link alone', () => {
		expect(routableLink(buildInviteLink(token))).toBe(`https://sereus.org/taleus/invite/${encodeURIComponent(token)}`)
		expect(routableLink('taleus://screen/TallyList')).toBe('taleus://screen/TallyList')
	})

	test('anything else is not an invitation', () => {
		expect(inviteToken('https://example.com/taleus/invite/#x')).toBeUndefined()
		expect(inviteToken('https://sereus.org/taleus/invite/')).toBeUndefined()
	})
})

test('the web page\'s "Open it" link reaches the invitation', () => {
	const state = getStateFromPath('invite/abc-123', linking.config)
	const tallies = state?.routes[0]
	expect(tallies?.name).toBe('Tallies')
	const review = tallies?.state?.routes.at(-1)
	expect(review).toMatchObject({ name: 'ReviewInvitation', params: { token: 'abc-123' } })
})

describe('handing an invitation over (story 01 step 8, path D)', () => {
	test('once made, it can be scanned in person or sent', async () => {
		const send = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined })
		const view = await renderScreen(<CreateInvitation {...screenProps('CreateInvitation', undefined)} />)
		await waitFor(() => expect(view.getByText('Share this invitation')).toBeTruthy())
		fireEvent.changeText(view.getByLabelText('Sam, the bike'), 'Sam, the bike')
		await waitFor(() => expect(view.getByLabelText('Sam, the bike').props.value).toBe('Sam, the bike'))
		fireEvent.press(view.getByRole('button', { name: 'Share this invitation' }))

		await waitFor(() => expect(view.getByTestId('qr-code')).toBeTruthy())
		const link = view.getByTestId('qr-code').props.children as string
		expect(link.startsWith('https://sereus.org/taleus/invite/#')).toBe(true)
		expect(view.getByText(/point their phone's camera at this/)).toBeTruthy()

		fireEvent.press(view.getByRole('button', { name: 'Send the invitation' }))
		await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ message: link })))
	})

	test('an outstanding invitation can be shared again; an expired one cannot', async () => {
		const view = await renderScreen(<CreateInvitation {...screenProps('CreateInvitation', undefined)} />)
		await waitFor(() => expect(view.getByLabelText('Share again: Sam, the bike')).toBeTruthy())
		expect(view.queryByLabelText('Share again: for the workshop counter')).toBeNull()
		fireEvent.press(view.getByLabelText('Share again: Sam, the bike'))
		await waitFor(() => expect(view.getByTestId('qr-code')).toBeTruthy())
	})
})
