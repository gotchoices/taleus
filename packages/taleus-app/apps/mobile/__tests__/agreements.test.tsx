import { fireEvent, waitFor } from '@testing-library/react-native'

import { PublisherNote } from '../src/components'
import type { Agreement as AgreementShape } from '../src/data/invitations'
import * as invitations from '../src/data/invitations'
import { listTrusted, resetPublishers } from '../src/data/publishers'
import { setVariant } from '../src/mock/variant'
import { Agreement } from '../src/screens/Agreement'
import { ReviewInvitation } from '../src/screens/ReviewInvitation'
import { TrustedPublishers } from '../src/screens/TrustedPublishers'
import { renderScreen, screenProps } from '../testUtils'

beforeEach(() => {
	setVariant('happy')
	resetPublishers()
})

afterEach(() => {
	jest.restoreAllMocks()
})

// First on purpose: after the invitation tests below, this screen's next render came back empty
// (stray updates from an accept finishing after its test). Order is the cheap fix; the cause is
// worth a look if another suite hits it.
describe('the publishers a party trusts', () => {
	test('sereus.org is built in; another can be added by name and removed again', async () => {
		const view = await renderScreen(<TrustedPublishers {...screenProps('TrustedPublishers', undefined)} />)
		await waitFor(() => expect(view.getByText('sereus.org')).toBeTruthy())
		expect(view.getByText('Makes Taleus · always trusted')).toBeTruthy()
		fireEvent.changeText(view.getByLabelText('Its name'), 'fair-n-square.org')
		await waitFor(() => expect(view.getByLabelText('Its name').props.value).toBe('fair-n-square.org'))
		fireEvent.press(view.getByRole('button', { name: 'Trust this publisher' }))
		await waitFor(() => expect(view.getByText('fair-n-square.org')).toBeTruthy())
		fireEvent.press(view.getAllByRole('button', { name: 'Stop trusting' })[0])
		await waitFor(() => expect(view.getByText(/carry on unchanged/)).toBeTruthy())
		fireEvent.press(view.getAllByRole('button', { name: 'Stop trusting' })[0])
		await waitFor(() => expect(view.queryByText('fair-n-square.org')).toBeNull())
	})
})

describe('an agreement, read in full', () => {
	test('numbered as published, joined to the tally’s figures', async () => {
		const view = await renderScreen(
			<Agreement {...screenProps('Agreement', { agreementId: 'cid:bafy-standard-tally-v1', tallyId: 'tally:sam-bike' })} />,
		)
		await waitFor(() => expect(view.getByText('Standard Tally Agreement')).toBeTruthy())
		expect(view.getByText('Published by taleus.org')).toBeTruthy()
		expect(view.getByText('1  What this is')).toBeTruthy()
		expect(view.getByText(/what fills it in: creditLimit, noticeDays/)).toBeTruthy()
	})

	test('one that cannot be read in full says so', async () => {
		setVariant('error')
		const view = await renderScreen(<Agreement {...screenProps('Agreement', { agreementId: 'cid:bafy-standard-tally-v1' })} />)
		await waitFor(() => expect(view.getByText('This agreement cannot be read in full')).toBeTruthy())
	})
})

describe('who stands behind an agreement (story 08)', () => {
	const agreement = (standing: AgreementShape['standing'], publisher = 'fair-n-square.org'): AgreementShape => ({
		id: 'cid:x',
		title: 'An agreement',
		publisher,
		language: 'en',
		standing,
	})
	const note = (shape: AgreementShape) => renderScreen(<PublisherNote agreement={shape} />)

	test('sereus.org is named as the maker of Taleus', async () => {
		const view = await note(agreement({ publisherConfirms: 'yes', trust: 'built-in', recommendedBy: [], status: 'current' }, 'sereus.org'))
		expect(view.getByText('Published by sereus.org, which makes Taleus')).toBeTruthy()
	})

	test('an untrusted publisher, and who recommends it: information, not trust', async () => {
		const view = await note(agreement({ publisherConfirms: 'yes', trust: 'none', recommendedBy: ['sereus.org'], status: 'current' }))
		expect(view.getByText('Published by fair-n-square.org')).toBeTruthy()
		expect(view.getByText('Not a publisher you trust.')).toBeTruthy()
		expect(view.getByText('Recommended by sereus.org, which you trust.')).toBeTruthy()
	})

	test('a claim that does not hold is the strongest warning, and nothing else is said of trust', async () => {
		const view = await note(agreement({ publisherConfirms: 'no', trust: 'none', recommendedBy: [], status: 'unknown' }, 'sereus.org'))
		expect(view.getByText(/does not list this agreement as its own/)).toBeTruthy()
		expect(view.queryByText('Not a publisher you trust.')).toBeNull()
	})

	test('a publisher that could not be asked is not reassured', async () => {
		const view = await note(agreement({ publisherConfirms: 'unknown', trust: 'publisher', recommendedBy: [], status: 'unknown' }))
		expect(view.getByText(/could not be checked right now/)).toBeTruthy()
	})

	test('an agreement its publisher withdrew says so', async () => {
		const view = await note(agreement({ publisherConfirms: 'yes', trust: 'publisher', recommendedBy: [], status: 'withdrawn' }))
		expect(view.getByText('fair-n-square.org no longer recommends this agreement.')).toBeTruthy()
	})
})

describe('accepting an invitation under an agreement', () => {
	const token = 'inv:jan-bike-7c1'
	const withAgreement = async (change: Partial<AgreementShape>) => {
		const read = await invitations.readInvitation(token)
		if (!read.ok) throw new Error('fixture invitation unreadable')
		jest.spyOn(invitations, 'readInvitation').mockResolvedValue({
			ok: true,
			value: { ...read.value, agreement: { ...read.value.agreement, ...change } },
		})
	}

	test('cannot accept an agreement that cannot be read in full', async () => {
		await withAgreement({ readable: false })
		const view = await renderScreen(<ReviewInvitation {...screenProps('ReviewInvitation', { token })} />)
		await waitFor(() => expect(view.getByText(/cannot be read in full, so you cannot agree to it/)).toBeTruthy())
		expect(view.getByText(/the other party will learn the agreement was the problem/)).toBeTruthy()
	})

	test('asks, as it accepts, whether to trust a publisher it has not met', async () => {
		await withAgreement({
			publisher: 'fair-n-square.org',
			standing: { publisherConfirms: 'yes', trust: 'none', recommendedBy: [], status: 'current' },
		})
		const respond = jest.spyOn(invitations, 'respondToInvitation').mockResolvedValue({ ok: true, value: 'accepted' })
		const view = await renderScreen(<ReviewInvitation {...screenProps('ReviewInvitation', { token })} />)
		await waitFor(() => expect(view.getByText('Trust neither')).toBeTruthy())
		fireEvent.press(view.getByText('Trust everything fair-n-square.org publishes for tallies'))
		fireEvent.changeText(view.getByLabelText('Name'), 'Sam')
		await waitFor(() => expect(view.queryByText('A name is needed before you can accept.')).toBeNull())
		fireEvent.press(view.getByRole('button', { name: 'Accept' }))
		await waitFor(() => expect(respond).toHaveBeenCalled())
		await waitFor(async () => {
			const trusted = await listTrusted()
			expect(trusted.ok && trusted.value.map(p => p.domain)).toEqual(['sereus.org', 'fair-n-square.org'])
		})
		view.unmount()
	})
})
