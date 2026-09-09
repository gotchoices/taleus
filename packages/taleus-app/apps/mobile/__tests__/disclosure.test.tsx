import { fireEvent, waitFor } from '@testing-library/react-native'

import {
	answerRequest,
	askFor,
	authorizeCorrection,
	discloseMore,
	readProfile,
	resetProfile,
	setField,
	staleHolders,
} from '../src/data/profile'
import { setVariant } from '../src/mock/variant'
import { DisclosureView } from '../src/screens/DisclosureView'
import { Profile } from '../src/screens/Profile'
import { renderScreen, screenProps } from '../testUtils'

const profileProps = (navigate = jest.fn()) => screenProps('Profile', undefined, navigate)
const disclosureProps = (tallyId: string, navigate = jest.fn()) =>
	screenProps('DisclosureView', { tallyId }, navigate)

beforeEach(() => {
	resetProfile()
	setVariant('happy')
})

test('holding something is not disclosing it', async () => {
	const before = await readProfile()
	const mara = before.ok && before.value.disclosures.find(d => d.tallyId === 'tally:mara-shop')
	expect(mara && mara.sent.map(f => f.key)).toEqual(['name'])

	// Jan holds an address; Mara has never been sent one, and adding a new field
	// changes that for nobody (story 11 step 2).
	await setField('taxId', '12-3456789')
	const after = await readProfile()
	const maraAfter = after.ok && after.value.disclosures.find(d => d.tallyId === 'tally:mara-shop')
	expect(maraAfter && maraAfter.sent.map(f => f.key)).toEqual(['name'])

	const view = await renderScreen(<Profile {...profileProps()} />)
	await waitFor(() => expect(view.getByText('What I hold')).toBeTruthy())
	expect(view.getByText(/Writing it down tells nobody/)).toBeTruthy()
})

test('who has what is answerable after the fact', async () => {
	const navigate = jest.fn()
	const view = await renderScreen(<Profile {...profileProps(navigate)} />)
	await waitFor(() => expect(view.getByText('Northwind Parts')).toBeTruthy())
	// Story 11 step 6: different people have different things.
	expect(view.getByText('They have name, business name and address')).toBeTruthy()
	expect(view.getAllByText('They have name').length).toBe(2)

	fireEvent.press(view.getByLabelText('Northwind Parts'))
	expect(navigate).toHaveBeenCalledWith('DisclosureView', { tallyId: 'tally:supplier-parts' })
})

test('a correction goes only where it is authorized', async () => {
	await setField('phone', '+1-555-0199')
	const record = await readProfile()
	expect(record.ok).toBe(true)
	if (!record.ok) {
		return
	}
	// Sam and Dave hold the old number; Mara never had one.
	const holders = staleHolders(record.value, 'phone').map(h => h.tallyId)
	expect(holders).toEqual(['tally:sam-bike', 'tally:dave-hours'])

	// Authorizing one sends to one. Nothing is sent for having been listed.
	const sent = await authorizeCorrection('phone', ['tally:sam-bike'])
	expect(sent.ok && sent.value).toEqual([
		{ tallyId: 'tally:sam-bike', name: 'Sam Ortiz', delivered: true },
	])
	const after = await readProfile()
	const dave = after.ok && after.value.disclosures.find(d => d.tallyId === 'tally:dave-hours')
	expect(dave && dave.sent.filter(f => f.key === 'phone').map(f => f.value)).toEqual([
		'+1-555-0142',
	])
})

test('a correction is a new statement, not an erasure', async () => {
	await setField('phone', '+1-555-0199')
	await authorizeCorrection('phone', ['tally:sam-bike'])
	const after = await readProfile()
	const sam = after.ok && after.value.disclosures.find(d => d.tallyId === 'tally:sam-bike')
	// Both stay visible to both sides (path D step 4).
	expect(sam && sam.sent.filter(f => f.key === 'phone').map(f => f.value)).toEqual([
		'+1-555-0142',
		'+1-555-0199',
	])

	const view = await renderScreen(<DisclosureView {...disclosureProps('tally:sam-bike')} />)
	await waitFor(() => expect(view.getByText('+1-555-0199')).toBeTruthy())
	expect(view.getByText('+1-555-0142')).toBeTruthy()
	expect(view.getByText(/^Corrected /)).toBeTruthy()
})

test('a correction that cannot be delivered says so rather than counting as sent', async () => {
	setVariant('error')
	await setField('phone', '+1-555-0199')
	const result = await authorizeCorrection('phone', ['tally:sam-bike', 'tally:dave-hours'])
	expect(result.ok && result.value).toEqual([
		{ tallyId: 'tally:sam-bike', name: 'Sam Ortiz', delivered: true },
		{ tallyId: 'tally:dave-hours', name: 'Dave Lin', delivered: false },
	])
	const after = await readProfile()
	const dave = after.ok && after.value.disclosures.find(d => d.tallyId === 'tally:dave-hours')
	expect(dave && dave.sent.filter(f => f.key === 'phone').map(f => f.value)).toEqual([
		'+1-555-0142',
	])
})

test('the correction is offered, and declining it sends nothing', async () => {
	const view = await renderScreen(<Profile {...profileProps()} />)
	await waitFor(() => expect(view.getByLabelText('Phone: +1-555-0142')).toBeTruthy())
	fireEvent.press(view.getByLabelText('Phone: +1-555-0142'))
	await waitFor(() => expect(view.getByLabelText('Phone')).toBeTruthy())
	fireEvent.changeText(view.getByLabelText('Phone'), '+1-555-0199')
	await waitFor(() => expect(view.getByDisplayValue('+1-555-0199')).toBeTruthy())
	fireEvent.press(view.getByText('Save'))

	await waitFor(() => expect(view.getByText('Others have the old one')).toBeTruthy())
	expect(view.getByText(/2 partners have the phone number you just changed/)).toBeTruthy()
	fireEvent.press(view.getByText('Not now'))
	await waitFor(() => expect(view.getByText(/Nobody was sent anything/)).toBeTruthy())

	const after = await readProfile()
	const sam = after.ok && after.value.disclosures.find(d => d.tallyId === 'tally:sam-bike')
	expect(sam && sam.sent.filter(f => f.key === 'phone')).toHaveLength(1)
	// The party's own record still shows the new one (path D step 3).
	expect(after.ok && after.value.held.find(f => f.key === 'phone')?.value).toBe('+1-555-0199')
})

test('more can be disclosed on a tally that already exists', async () => {
	const view = await renderScreen(<DisclosureView {...disclosureProps('tally:mara-shop')} />)
	await waitFor(() => expect(view.getByText('Tell them more')).toBeTruthy())
	// No new tally and no renegotiated terms — and they are told (step 7).
	expect(view.getByText(/No new tally and no change to the terms/)).toBeTruthy()

	fireEvent.press(view.getByLabelText('Address'))
	await waitFor(() => expect(view.getByText('Send what I picked')).toBeTruthy())
	fireEvent.press(view.getByText('Send what I picked'))
	await waitFor(() => expect(view.getByText(/Mara's Bike Shop has been told/)).toBeTruthy())

	const after = await discloseMore('tally:priya-new', ['email'])
	const priya = after.ok && after.value.disclosures.find(d => d.tallyId === 'tally:priya-new')
	expect(priya && priya.sent.map(f => f.key)).toEqual(['name', 'email'])
})

test('what a counterparty says is their claim, not a verified fact', async () => {
	const view = await renderScreen(<DisclosureView {...disclosureProps('tally:supplier-parts')} />)
	await waitFor(() => expect(view.getByText('Northwind Parts LLC')).toBeTruthy())
	// Path E step 2.
	expect(view.getByText(/Taleus has not checked any of it/)).toBeTruthy()
})

test('missing is presented as missing, without saying which kind', async () => {
	const view = await renderScreen(<DisclosureView {...disclosureProps('tally:priya-new')} />)
	await waitFor(() => expect(view.getByText('Not here')).toBeTruthy())
	// Path E step 3: withheld and never-recorded are indistinguishable from here.
	expect(view.getByText(/does not reach you from here/)).toBeTruthy()
	expect(view.queryByText(/withheld/)).toBeNull()
	// And step 4: asking is the way past it.
	expect(view.getByText('Ask them')).toBeTruthy()
})

test('asking turns an absence into an answer', async () => {
	const view = await renderScreen(<DisclosureView {...disclosureProps('tally:priya-new')} />)
	await waitFor(() => expect(view.getByText('Ask them')).toBeTruthy())
	fireEvent.press(view.getByText('Ask them'))
	await waitFor(() => expect(view.getByLabelText('Why you are asking')).toBeTruthy())
	// A field Jan does not hold either: asking is about what *they* have said,
	// not about trading like for like.
	fireEvent.press(view.getByLabelText('Tax identifier'))
	// One interaction per flush: two in a tick overlap React's act() and the
	// second update is dropped, which is a test artifact, not a screen bug.
	await waitFor(() =>
		expect(view.getByLabelText('Tax identifier').props.accessibilityState.checked).toBe(true),
	)
	fireEvent.changeText(view.getByLabelText('Why you are asking'), 'My accountant asks every year.')
	await waitFor(() => expect(view.getByDisplayValue('My accountant asks every year.')).toBeTruthy())
	fireEvent.press(view.getByText('Ask'))
	await waitFor(() => expect(view.getByText('You asked for their tax identifier')).toBeTruthy())
	expect(view.getByText(/No answer yet/)).toBeTruthy()

	const asked = await askFor('tally:mara-shop', ['phone'], 'For deliveries.')
	const mara = asked.ok && asked.value.disclosures.find(d => d.tallyId === 'tally:mara-shop')
	expect(mara && mara.requests.map(r => ({ key: r.key, from: r.from }))).toEqual([
		{ key: 'phone', from: 'me' },
	])
})

test('a refusal is an answer, from either side, and not a failure', async () => {
	const view = await renderScreen(<DisclosureView {...disclosureProps('tally:supplier-parts')} />)
	// Path A: Northwind wants a tax identifier Jan does not hold and will not give.
	await waitFor(() =>
		expect(view.getByText('Northwind Parts asked for your tax identifier')).toBeTruthy(),
	)
	expect(view.getByText(/files a 1099/)).toBeTruthy()
	expect(view.getByText(/They will see that you would rather not/)).toBeTruthy()
	expect(view.getByText(/You hold no tax identifier to send/)).toBeTruthy()

	fireEvent.press(view.getByText('I would rather not'))
	await waitFor(() => expect(view.getByText(/You said you would rather not/)).toBeTruthy())

	// And the other direction: Dave declined Jan's ask, which is an answer too.
	const dave = await renderScreen(<DisclosureView {...disclosureProps('tally:dave-hours')} />)
	await waitFor(() => expect(dave.getByText('You asked for their address')).toBeTruthy())
	expect(dave.getByText(/That is an answer/)).toBeTruthy()
})

test('supplying an answer sends the field and records that it was sent', async () => {
	await setField('taxId', '12-3456789')
	const answered = await answerRequest('req:northwind-taxid', { kind: 'supplied' })
	expect(answered.ok).toBe(true)
	if (!answered.ok) {
		return
	}
	const northwind = answered.value.disclosures.find(d => d.tallyId === 'tally:supplier-parts')
	expect(northwind && northwind.sent.some(f => f.key === 'taxId')).toBe(true)
	expect(northwind && northwind.requests[0].answer?.kind).toBe('supplied')
})

test('a party who has disclosed only a name, to one person', async () => {
	setVariant('empty')
	const view = await renderScreen(<Profile {...profileProps()} />)
	await waitFor(() => expect(view.getByText('Sam Ortiz')).toBeTruthy())
	expect(view.getByText('They have name')).toBeTruthy()
	// Everything else is offered to fill in, not implied to be missing from them.
	expect(view.getByText('Add something')).toBeTruthy()
	expect(view.getByLabelText('Address')).toBeTruthy()
})

test('disclosure chosen at formation is marked as not yet agreed', async () => {
	const view = await renderScreen(<DisclosureView {...disclosureProps('tally:rae-offer')} />)
	await waitFor(() => expect(view.getAllByText('Goes with the offer, if they sign it').length).toBe(2))
})
