import { buildCommsTerms, buildLiftTerms, resolveBoundaryQuote } from './terms.js'
import { rate, StubTermSource } from './test-harness.js'

describe('term population', () => {
	it('builds L-intent terms from the edge contract (denom/scale) and its reserved-balance lading', () => {
		const source = new StubTermSource(
			{ 'tally-0': { denom: 'iso4217:USD', scale: 2 } },
			{ 'tally-0|stockSid': { freeUnits: 500n, rewardedUnits: 200n, reward: 30_000, clutch: 10_000 } },
			{},
		)
		expect(buildLiftTerms(source, 'tally-0', 'stockSid')).toEqual({
			intent: 'L',
			denom: 'iso4217:USD',
			scale: 2,
			freeUnits: 500n,
			rewardedUnits: 200n,
			reward: 30_000,
			clutch: 10_000,
		})
	})

	it('builds C-only comms terms', () => {
		expect(buildCommsTerms()).toEqual({ intent: 'C' })
	})
})

describe('resolveBoundaryQuote', () => {
	const source = new StubTermSource(
		{},
		{},
		{ 'USD|CHIP': rate('USD', 'CHIP', 2n, 1n) },
	)

	it('resolves the quote in the walk direction From=D_in (upstream) To=D_out (downstream)', () => {
		expect(resolveBoundaryQuote(source, 'USD', 'CHIP', '2026-07-13')).toEqual(rate('USD', 'CHIP', 2n, 1n))
	})

	it('returns null (prune) when there is no usable quote for the boundary', () => {
		expect(resolveBoundaryQuote(source, 'CHIP', 'USD', '2026-07-13')).toBeNull()
	})

	it('throws if the source returns a quote whose direction does not match the boundary', () => {
		const misdirected = new StubTermSource({}, {}, { 'USD|CHIP': rate('CHIP', 'USD', 2n, 1n) })
		expect(() => resolveBoundaryQuote(misdirected, 'USD', 'CHIP', '2026-07-13')).toThrow(/direction mismatch/)
	})
})
