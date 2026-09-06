import { listEntries } from '../src/data/entries'
import { listRequests } from '../src/data/requests'
import { readTally } from '../src/data/tally'

test('a tally reads back with terms in both directions', async () => {
	const result = await readTally('tally:sam-bike')
	expect(result.ok).toBe(true)
	if (result.ok) {
		expect(result.value.terms.mine.creditLimit.units).toBe(50000)
		expect(result.value.terms.theirs.creditLimit.units).toBe(0)
	}
})

test('entries come back with the balance that resulted', async () => {
	const result = await listEntries('tally:sam-bike')
	expect(result.ok).toBe(true)
	if (result.ok) {
		expect(result.value.length).toBeGreaterThan(0)
		expect(result.value[0].balanceAfter.perspective).toBe('owed-to-me')
	}
})

test('requests filter to the tally asked for', async () => {
	const result = await listRequests('tally:sam-bike')
	expect(result.ok).toBe(true)
	if (result.ok) {
		expect(result.value.every(r => r.tallyId === 'tally:sam-bike')).toBe(true)
		expect(result.value.length).toBe(1)
	}
})
