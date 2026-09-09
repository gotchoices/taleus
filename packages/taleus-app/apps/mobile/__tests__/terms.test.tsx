import { fireEvent, waitFor } from '@testing-library/react-native'

import { readAgreement, readTerms } from '../src/data/tally'
import { setVariant } from '../src/mock/variant'
import { EntryDetail } from '../src/screens/EntryDetail'
import { TallyTerms } from '../src/screens/TallyTerms'
import { renderScreen, screenProps } from '../testUtils'

const termsProps = (tallyId: string, navigate = jest.fn()) =>
	screenProps('TallyTerms', { tallyId }, navigate)
const entryProps = (tallyId: string, entryId: string, navigate = jest.fn()) =>
	screenProps('EntryDetail', { tallyId, entryId }, navigate)

beforeEach(() => {
	setVariant('happy')
})

test('terms in force read from this party’s own side, both directions', async () => {
	const view = await renderScreen(<TallyTerms {...termsProps('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText('In force today')).toBeTruthy())
	// The same label appears again under what is coming and in the history, so
	// the assertion is that it is here at all, not that it is unique.
	expect(view.getAllByText('I let Sam Ortiz owe me').length).toBeGreaterThan(0)
	expect(view.getAllByText('Sam Ortiz lets me owe them').length).toBeGreaterThan(0)
	// Each side took effect on its own day, so each carries its own date.
	expect(view.getByText(/21 days’ notice · Since Mar 2, 2026/)).toBeTruthy()
	expect(view.getByText(/21 days’ notice · Since Nov 14, 2025/)).toBeTruthy()
})

test('a reduction shows what applies today, what will apply, and when', async () => {
	const view = await renderScreen(<TallyTerms {...termsProps('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText('Agreed, not yet in force')).toBeTruthy())
	// Path B: the figure that governs today is still the one above.
	expect(view.getByText('Becomes, on Sep 23, 2026')).toBeTruthy()
	expect(view.getByText(/waits out the notice period/)).toBeTruthy()
})

test('reductions stack on the future, and neither reaches back', async () => {
	const view = await renderScreen(<TallyTerms {...termsProps('tally:sam-bike')} />)
	// Path E: a second cut before the first has taken hold — both visible.
	await waitFor(() => expect(view.getByText('Becomes, on Oct 1, 2026')).toBeTruthy())
	expect(view.getByText(/Each reduction stacks on the future/)).toBeTruthy()
	// Path D step 2: $180 is outstanding, so it stays under the terms it was
	// advanced under.
	expect(view.getByText(/already outstanding stays under the terms it was advanced under/)).toBeTruthy()
	expect(view.queryByText(/applies as soon as it is agreed/)).toBeNull()
})

test('a proposal is distinct from anything that binds', async () => {
	const view = await renderScreen(<TallyTerms {...termsProps('tally:mara-shop')} />)
	await waitFor(() => expect(view.getByText('Proposed, not agreed')).toBeTruthy())
	expect(view.getByText(/You proposed this on Sep 4, 2026. Waiting on Mara's Bike Shop/)).toBeTruthy()
	// Path A step 3.
	expect(view.getByText(/changes what either of you may do today/)).toBeTruthy()
	// And it is not in the history, which is only what was agreed.
	expect(view.queryByText(/Takes effect Sep 4, 2026/)).toBeNull()
})

test('previous terms show what changed and when it took effect', async () => {
	const view = await renderScreen(<TallyTerms {...termsProps('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText('How the terms got here')).toBeTruthy())
	// What changed is rendered as a figure, not spelled into a sentence.
	expect(view.getAllByText('Limit was').length).toBe(4)
	expect(view.getByText('Notice 14 → 21 days')).toBeTruthy()
	expect(view.getAllByText(/Took effect Dec 8, 2025/).length).toBeGreaterThan(0)
	expect(view.getAllByText('What the tally opened with').length).toBe(2)
})

test('a tally nobody has amended says so, without a fixture saying it twice', async () => {
	const terms = await readTerms('tally:priya-new')
	expect(terms.ok && terms.value.history.every(change => change.opening)).toBe(true)
	const view = await renderScreen(<TallyTerms {...termsProps('tally:priya-new')} />)
	await waitFor(() => expect(view.getByText(/Neither of you has changed them/)).toBeTruthy())
})

test('the contract is identifiable, readable, and joined to the figures', async () => {
	const view = await renderScreen(<TallyTerms {...termsProps('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText('Standard Tally Agreement')).toBeTruthy())
	expect(view.getByText(/taleus.org · version 1.0 · en/)).toBeTruthy()
	// Step 5: the terms are arguments to it, and the reader can see which.
	expect(view.getByText(/what you filled in on it: the limit, the notice period/)).toBeTruthy()
	expect(view.getByText('What each may be owed')).toBeTruthy()
})

test('a contract that cannot be fetched leaves the terms readable', async () => {
	setVariant('error')
	const document = await readAgreement('cid:bafy-standard-tally-v1')
	expect(document.ok).toBe(false)
	const view = await renderScreen(<TallyTerms {...termsProps('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText(/could not be fetched right now/)).toBeTruthy())
	// The terms in force are this party's own record and do not depend on it.
	expect(view.getByText('In force today')).toBeTruthy()
	expect(view.getAllByText('I let Sam Ortiz owe me').length).toBeGreaterThan(0)
	expect(view.getByText('Try again')).toBeTruthy()
})

test('the counterparty’s disclosure is their claim, and openable', async () => {
	const navigate = jest.fn()
	const view = await renderScreen(<TallyTerms {...termsProps('tally:sam-bike', navigate)} />)
	await waitFor(() => expect(view.getByText('Who Sam Ortiz says they are')).toBeTruthy())
	expect(view.getByText(/Taleus has not checked any of it/)).toBeTruthy()
	// Path C: absence is not evidence, and asking is the way past it.
	expect(view.getByText(/withheld or never written down/)).toBeTruthy()
	fireEvent.press(view.getByLabelText('What we know of each other'))
	expect(navigate).toHaveBeenCalledWith('SettingsTab', {
		screen: 'DisclosureView',
		params: { tallyId: 'tally:sam-bike' },
	})
})

test('a tally that is no longer trading stays fully reviewable', async () => {
	// `Closing` only materialises in the closing world; the happy fixture reads
	// every tally as open.
	setVariant('closing')
	const view = await renderScreen(<TallyTerms {...termsProps('tally:dave-hours')} />)
	await waitFor(() => expect(view.getByText(/Everything about it stays readable/)).toBeTruthy())
	expect(view.getByText('In force today')).toBeTruthy()
	expect(view.getByText('Standard Tally Agreement')).toBeTruthy()
	expect(view.getByText('How the terms got here')).toBeTruthy()
})

test('one entry says who signed it and what it answered', async () => {
	const navigate = jest.fn()
	const view = await renderScreen(
		<EntryDetail {...entryProps('tally:mara-shop', 'entry:0101', navigate)} />,
	)
	await waitFor(() => expect(view.getByText('Toward the brake service')).toBeTruthy())
	// Step 3: the one who gave the value signed it.
	expect(view.getByText(/You did. The party who gives the value signs the entry/)).toBeTruthy()
	// Step 6: recognisably tied to the request it answered, not just money that
	// moved that day.
	expect(view.getByText('What it answered')).toBeTruthy()
	fireEvent.press(view.getByText('Open the request'))
	expect(navigate).toHaveBeenCalledWith('RequestView', { requestId: 'request:mara-95' })
})

test('an entry neither party typed says so', async () => {
	const view = await renderScreen(<EntryDetail {...entryProps('tally:sam-bike', 'entry:0005')} />)
	await waitFor(() =>
		expect(view.getByText(/a payment found its way through your tally/)).toBeTruthy(),
	)
	expect(view.getByText('Value left through this tally')).toBeTruthy()
})

test('movement that has not committed is visibly unfinished', async () => {
	// Story 24 path A, and the only fixture that produces it.
	setVariant('error')
	const view = await renderScreen(<EntryDetail {...entryProps('tally:sam-bike', 'entry:0007')} />)
	await waitFor(() => expect(view.getByText('Not finished')).toBeTruthy())
	// Not misled into thinking it is done, nor that the tally is broken.
	expect(view.getByText(/what it would come to; nothing is wrong, and it is not done/)).toBeTruthy()
})

test('an entry the reader does not recognise is told everything held about it', async () => {
	const view = await renderScreen(<EntryDetail {...entryProps('tally:mara-shop', 'entry:0100')} />)
	await waitFor(() => expect(view.getByText('Brake service')).toBeTruthy())
	expect(view.getByText(/Mara's Bike Shop did/)).toBeTruthy()
	expect(view.getByText(/Nothing in the history is anonymous/)).toBeTruthy()
	expect(view.getByText('Where the balance stood after')).toBeTruthy()
})
