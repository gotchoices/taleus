import { fireEvent, waitFor } from '@testing-library/react-native'

import { bringBack, listAttention, listPast, resetAttention, setAside } from '../src/data/attention'
import { setVariant } from '../src/mock/variant'
import { Attention } from '../src/screens/Attention'
import { AttentionHistory } from '../src/screens/AttentionHistory'
import { renderScreen, screenProps } from '../testUtils'

const attentionProps = (navigate = jest.fn()) => screenProps('Attention', undefined, navigate)
const historyProps = (navigate = jest.fn()) => screenProps('AttentionHistory', undefined, navigate)

beforeEach(() => {
	resetAttention()
	setVariant('happy')
})

test('urgent is tellable from merely open, without date arithmetic', async () => {
	const view = await renderScreen(<Attention {...attentionProps()} />)
	// Path B: Mara's request runs out this week; Rae's offer next month.
	await waitFor(() => expect(view.getAllByText(/Runs out in \d+ days/)).toHaveLength(2))
	const items = await listAttention()
	const mara = items.ok && items.value.find(item => item.id === 'att:request-mara')
	const rae = items.ok && items.value.find(item => item.id === 'att:offer-rae')
	expect(mara && mara.daysLeft).toBeLessThanOrEqual(7)
	expect(rae && rae.daysLeft).toBeGreaterThan(7)
	// And the one with no deadline says so rather than leaving it blank.
	expect(view.getByText('No deadline')).toBeTruthy()
})

test('a request item lands on the request, not on the tally beneath it', async () => {
	const navigate = jest.fn()
	const view = await renderScreen(<Attention {...attentionProps(navigate)} />)
	await waitFor(() => expect(view.getByLabelText(/Mara's Bike Shop is asking/)).toBeTruthy())
	fireEvent.press(view.getByLabelText(/Mara's Bike Shop is asking/))
	expect(navigate).toHaveBeenCalledWith('Tallies', {
		screen: 'RequestView',
		params: { requestId: 'request:mara-95' },
	})
})

test('setting aside stops it asking and answers nothing', async () => {
	const before = await listAttention()
	expect(before.ok && before.value.map(item => item.id)).toContain('att:request-mara')

	const after = await setAside('att:request-mara')
	// Path F: it leaves the list.
	expect(after.ok && after.value.map(item => item.id)).not.toContain('att:request-mara')

	// And is recorded as set aside, which is not an answer.
	const past = await listPast()
	const entry = past.ok && past.value.find(item => item.id === 'att:request-mara')
	expect(entry && entry.outcome).toBe('set-aside')
})

test('set aside is never presented as a refusal', async () => {
	const view = await renderScreen(<Attention {...attentionProps()} />)
	await waitFor(() => expect(view.getAllByText('Not now').length).toBeGreaterThan(0))
	// Path F step 3: the two must not be confusable.
	expect(view.queryByText(/refuse/i)).toBeNull()
	expect(view.queryByText(/decline/i)).toBeNull()

	const history = await renderScreen(<AttentionHistory {...historyProps()} />)
	await waitFor(() => expect(history.getByText(/Nothing quietly disappears/)).toBeTruthy())
})

test('a party can bring back what they set aside', async () => {
	await setAside('att:offer-rae')
	const view = await renderScreen(<AttentionHistory {...historyProps()} />)
	await waitFor(() => expect(view.getByText('You set it aside')).toBeTruthy())
	// Still unanswered, and nothing reached the other side.
	expect(view.getByText(/Nothing about it ever reached Rae Whitfield/)).toBeTruthy()

	fireEvent.press(view.getByText('Bring it back'))
	await waitFor(async () => {
		const items = await listAttention()
		expect(items.ok && items.value.map(item => item.id)).toContain('att:offer-rae')
	})

	const back = await bringBack('att:offer-rae')
	expect(back.ok && back.value.map(item => item.id)).toContain('att:offer-rae')
})

test('working through a backlog shows what has been dealt with this session', async () => {
	// Path C: eleven things after a week away.
	setVariant('error')
	const items = await listAttention()
	expect(items.ok && items.value).toHaveLength(11)

	const view = await renderScreen(<Attention {...attentionProps()} />)
	await waitFor(() => expect(view.getAllByText('Not now').length).toBeGreaterThan(1))
	fireEvent.press(view.getAllByText('Not now')[0])
	await waitFor(() => expect(view.getByText('1 dealt with just now')).toBeTruthy())
})

test('something whose next move is not this party’s is shown, never demanded of them', async () => {
	setVariant('error')
	const view = await renderScreen(<Attention {...attentionProps()} />)
	// Path D.
	await waitFor(() => expect(view.getByText('Waiting on somebody else')).toBeTruthy())
	expect(view.getByText('Waiting on them')).toBeTruthy()
	// And it carries no "not now" — there is nothing of theirs to set aside.
	expect(view.getAllByText('Not now')).toHaveLength(10)
})

test('everything that left the list says what became of it', async () => {
	const view = await renderScreen(<AttentionHistory {...historyProps()} />)
	await waitFor(() => expect(view.getByText(/Nothing quietly disappears/)).toBeTruthy())
	// Path E: answered, refused, withdrawn by them, and lapsed.
	expect(view.getAllByText('You answered it')).toHaveLength(2)
	expect(view.getByText('You said no')).toBeTruthy()
	expect(view.getByText("Mara's Bike Shop took it back")).toBeTruthy()
	expect(view.getByText('Ran out unanswered')).toBeTruthy()
})

test('lapsing is distinguishable from being dealt with', async () => {
	const view = await renderScreen(<AttentionHistory {...historyProps()} />)
	await waitFor(() => expect(view.getByText('Ran out unanswered')).toBeTruthy())
	expect(view.getByText(/stopped being answerable, which is not the same as being handled/)).toBeTruthy()
})

test('a past item opens the thing it was about', async () => {
	const navigate = jest.fn()
	const view = await renderScreen(<AttentionHistory {...historyProps(navigate)} />)
	await waitFor(() => expect(view.getByLabelText(/Sam Ortiz is asking/)).toBeTruthy())
	fireEvent.press(view.getByLabelText(/Sam Ortiz is asking/))
	expect(navigate).toHaveBeenCalledWith('Tallies', {
		screen: 'RequestView',
		params: { requestId: 'request:jan-sam-40' },
	})
})

test('a figure in a unit that divides by sixty keeps its divisor through the list', async () => {
	const past = await listPast()
	const dave = past.ok && past.value.find(item => item.id === 'att:offer-dave')
	// Ten hours, not six hundred: an amount carrying its own unit has to carry
	// the whole of it.
	expect(dave && dave.amount?.divisor).toBe(60)
	const view = await renderScreen(<AttentionHistory {...historyProps()} />)
	await waitFor(() => expect(view.getByLabelText(/10 Dave-hours/)).toBeTruthy())
})

test('nothing waiting is a good state, and the way back is offered', async () => {
	setVariant('empty')
	const navigate = jest.fn()
	const view = await renderScreen(<Attention {...attentionProps(navigate)} />)
	// Path A.
	await waitFor(() => expect(view.getByText('Nothing needs you')).toBeTruthy())
	expect(view.getByText('And you can look back at what has.')).toBeTruthy()
	fireEvent.press(view.getByText('What has already been through here'))
	expect(navigate).toHaveBeenCalledWith('AttentionHistory')
})

test('a party with no history is told that plainly too', async () => {
	setVariant('empty')
	const view = await renderScreen(<AttentionHistory {...historyProps()} />)
	await waitFor(() => expect(view.getByText('Nothing has been through yet')).toBeTruthy())
})
