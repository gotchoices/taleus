import { listAttention } from '../src/data/attention'
import { listEntries } from '../src/data/entries'
import { listRequests } from '../src/data/requests'
import { readTally } from '../src/data/tally'
import { readPosition } from '../src/data/position'

test('a tally reads back with terms in both directions, each with its own date', async () => {
	const result = await readTally('tally:sam-bike')
	expect(result.ok).toBe(true)
	if (result.ok) {
		expect(result.value.terms.mine.creditLimit.units).toBe(50000)
		expect(result.value.terms.theirs.creditLimit.units).toBe(0)
		expect(result.value.terms.mine.effective).not.toBe(result.value.terms.theirs.effective)
	}
})

test('a tally is read by the id asked for, not whichever one the fixture held', async () => {
	const mara = await readTally('tally:mara-shop')
	expect(mara.ok).toBe(true)
	if (mara.ok) {
		expect(mara.value.counterparty.name).toBe("Mara's Bike Shop")
		expect(mara.value.balance.perspective).toBe('owed-by-me')
	}
})

test('an unknown tally is a stated failure, not somebody else s tally', async () => {
	const missing = await readTally('tally:nobody')
	expect(missing.ok).toBe(false)
	if (!missing.ok) {
		expect(missing.error.kind).toBe('not-found')
	}
})

test('entries come back with the balance that resulted, stated from a side', async () => {
	const result = await listEntries('tally:sam-bike')
	expect(result.ok).toBe(true)
	if (result.ok) {
		expect(result.value.length).toBeGreaterThan(0)
		expect(result.value[0].balanceAfter.perspective).toBe('owed-to-me')
	}
})

test('entries are keyed by tally, so two tallies do not share a history', async () => {
	const sam = await listEntries('tally:sam-bike')
	const mara = await listEntries('tally:mara-shop')
	expect(sam.ok && mara.ok).toBe(true)
	if (sam.ok && mara.ok) {
		expect(sam.value.map(e => e.id)).not.toEqual(mara.value.map(e => e.id))
	}
})

test('an entry only ever answers a request on its own tally', async () => {
	const entries = await listEntries('tally:sam-bike')
	const requests = await listRequests('tally:sam-bike')
	expect(entries.ok && requests.ok).toBe(true)
	if (entries.ok && requests.ok) {
		const here = new Set(requests.value.map(r => r.id))
		for (const entry of entries.value) {
			for (const answered of entry.answers ?? []) {
				expect(here.has(answered)).toBe(true)
			}
		}
	}
})

test('requests filter to the tally asked for and say which way they run', async () => {
	const result = await listRequests('tally:sam-bike')
	expect(result.ok).toBe(true)
	if (result.ok) {
		expect(result.value.every(r => r.tallyId === 'tally:sam-bike')).toBe(true)
		expect(result.value.length).toBe(2)
		for (const request of result.value) {
			expect(['asked-of-me', 'asked-by-me']).toContain(request.direction)
		}
	}
})

test('ageing is derived from when it was asked, not stored', async () => {
	const result = await listRequests()
	expect(result.ok).toBe(true)
	if (result.ok) {
		for (const request of result.value) {
			expect(request.outstandingDays).toBe(
				Math.max(0, Math.floor((Date.now() - new Date(request.asked).getTime()) / 86_400_000)),
			)
		}
	}
})

test('attention items carry no prose and every amount carries its unit', async () => {
	const result = await listAttention()
	expect(result.ok).toBe(true)
	if (result.ok) {
		for (const item of result.value) {
			expect(item).not.toHaveProperty('summary')
			expect(item.waitingDays).toBeGreaterThanOrEqual(0)
			if (item.amount) {
				expect(typeof item.amount.denom).toBe('string')
				expect(typeof item.amount.scale).toBe('number')
			}
		}
	}
})

test('spending power carries its unit rather than leaving a screen to guess', async () => {
	const result = await readPosition()
	expect(result.ok).toBe(true)
	if (result.ok && result.value.spendingPower) {
		expect(result.value.spendingPower.heldByOthers.denom).toBeTruthy()
		expect(result.value.spendingPower.creditExtendedToMe.scale).toBeDefined()
	}
})
