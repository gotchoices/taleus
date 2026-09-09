import { fireEvent, waitFor } from '@testing-library/react-native'

import { readOffer, resetOffers } from '../src/data/offers'
import { setVariant } from '../src/mock/variant'
import { isTallyRoute } from '../src/navigation/routes'
import { ReviewOffer } from '../src/screens/ReviewOffer'
import { renderScreen, screenProps } from '../testUtils'

const props = (tallyId = 'tally:rae-offer') => screenProps('ReviewOffer', { tallyId })

beforeEach(() => {
	resetOffers()
	setVariant('happy')
})

test('what changed comes before the terms — nothing else is different', async () => {
	const view = await renderScreen(<ReviewOffer {...props()} />)
	await waitFor(() => expect(view.getByText('What changed')).toBeTruthy())
	expect(view.getByText(/Their notice period, in days: 14 → 21/)).toBeTruthy()
})

test('countering is presented as replacing the agreement, not editing it', async () => {
	const view = await renderScreen(<ReviewOffer {...props()} />)
	await waitFor(() => expect(view.getByText('Or propose different terms')).toBeTruthy())
	expect(view.getByText(/it is a new offer, and Rae Whitfield has to agree to it/)).toBeTruthy()
	// Accepting is the primary act; countering is its own section below it.
	expect(view.getByText('Accept these terms')).toBeTruthy()
})

test('a forming tally says there are no terms in force yet', async () => {
	const view = await renderScreen(<ReviewOffer {...props()} />)
	await waitFor(() => expect(view.getByText(/no terms in force yet/)).toBeTruthy())
})

test('the unit is stated as not negotiable', async () => {
	const view = await renderScreen(<ReviewOffer {...props()} />)
	await waitFor(() => expect(view.getByText(/fixed for the life of the tally/)).toBeTruthy())
	expect(view.getByText('CHIP')).toBeTruthy()
})

test('accepting signs it; countering makes it this party s offer', async () => {
	const view = await renderScreen(<ReviewOffer {...props()} />)
	await waitFor(() => expect(view.getByText('Accept these terms')).toBeTruthy())
	fireEvent.press(view.getByRole('button', { name: 'Accept these terms' }))
	await waitFor(() => expect(view.getByText(/You both hold the same terms/)).toBeTruthy())

	const second = await renderScreen(<ReviewOffer {...props()} />)
	await waitFor(() => expect(second.getByText('Send this back instead')).toBeTruthy())
	fireEvent.press(second.getByRole('button', { name: 'Send this back instead' }))
	await waitFor(() => expect(second.getByText(/This is your offer now/)).toBeTruthy())
})

test('when two offers are signed, the later-drafted one is shown in force', async () => {
	setVariant('superseded')
	const read = await readOffer('tally:rae-offer')
	expect(read.ok && read.value?.supersededBy?.id).toBe('offer:rae-3')

	const view = await renderScreen(<ReviewOffer {...props()} />)
	await waitFor(() => expect(view.getByText('Two offers were signed')).toBeTruthy())
	// Both are named, so neither party is left believing the wrong one is in force.
	expect(view.getByText(/In force — drafted/)).toBeTruthy()
	expect(view.getByText(/Superseded — drafted/)).toBeTruthy()
	expect(view.getByText(/propose again from here, or close the tally/)).toBeTruthy()
})

test('nothing pending reads as nothing to answer, not as an error', async () => {
	setVariant('empty')
	const view = await renderScreen(<ReviewOffer {...props()} />)
	await waitFor(() => expect(view.getByText('Nothing to answer')).toBeTruthy())
})

test('an attention item naming ReviewOffer now routes there', () => {
	expect(isTallyRoute('ReviewOffer')).toBe(true)
})
