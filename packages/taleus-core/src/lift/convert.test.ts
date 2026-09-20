import { convertBoundary } from './convert.js'

describe('convertBoundary', () => {
	it('is a no-op for the degenerate single-denomination case (RateNum=RateDen=1, s_in=s_out)', () => {
		expect(convertBoundary({ reqOut: 12345n, rateNum: 1n, rateDen: 1n, scaleIn: 3, scaleOut: 3 })).toBe(12345n)
		expect(convertBoundary({ reqOut: 0n, rateNum: 1n, rateDen: 1n, scaleIn: 0, scaleOut: 0 })).toBe(0n)
	})

	it('converts a two-denomination payment (1.5 CHIP at scale 3, quoted 2 USD per CHIP, USD at scale 2)', () => {
		// D_out = CHIP (scale 3, milliCHIP), D_in = USD (scale 2, cents); quote From=USD,To=CHIP, RateNum/RateDen = 2/1.
		expect(convertBoundary({ reqOut: 1500n, rateNum: 2n, rateDen: 1n, scaleIn: 2, scaleOut: 3 })).toBe(300n)
	})

	it('rounds up on remainder, and does not round up on an exact division', () => {
		expect(convertBoundary({ reqOut: 8n, rateNum: 3n, rateDen: 2n, scaleIn: 0, scaleOut: 0 })).toBe(12n) // 24 / 2, exact
		expect(convertBoundary({ reqOut: 7n, rateNum: 3n, rateDen: 2n, scaleIn: 0, scaleOut: 0 })).toBe(11n) // 21 / 2 = 10.5 -> 11
	})

	it('composes across a three-denomination chain, walked A->B->C', () => {
		// A (scale 2) -> B (scale 3) -> C (scale 0); reqC = 7, discovery walks backward from C.
		const reqB = convertBoundary({ reqOut: 7n, rateNum: 5n, rateDen: 2n, scaleIn: 3, scaleOut: 0 }) // D_in=B, D_out=C
		expect(reqB).toBe(17500n)
		const reqA = convertBoundary({ reqOut: reqB, rateNum: 3n, rateDen: 4n, scaleIn: 2, scaleOut: 3 }) // D_in=A, D_out=B
		expect(reqA).toBe(1313n)
	})

	it('composes across a three-denomination chain, walked in the other direction C->B->A', () => {
		// A (scale 2) -> B (scale 3) -> C (scale 0); reqA = 9, discovery walks backward from A.
		const reqB = convertBoundary({ reqOut: 9n, rateNum: 7n, rateDen: 3n, scaleIn: 3, scaleOut: 2 }) // D_in=B, D_out=A
		expect(reqB).toBe(210n)
		const reqC = convertBoundary({ reqOut: reqB, rateNum: 11n, rateDen: 13n, scaleIn: 0, scaleOut: 3 }) // D_in=C, D_out=B
		expect(reqC).toBe(1n)
	})

	it('is a no-op across every boundary in a circular clearing lift (all rates 1)', () => {
		const reqB = convertBoundary({ reqOut: 42n, rateNum: 1n, rateDen: 1n, scaleIn: 2, scaleOut: 2 })
		const reqA = convertBoundary({ reqOut: reqB, rateNum: 1n, rateDen: 1n, scaleIn: 2, scaleOut: 2 })
		expect(reqA).toBe(42n)
	})

	it('stays exact past the point where a native 64-bit multiply would overflow', () => {
		// reqOut * rateNum * 10^scaleIn = 1e15 * 1e5 * 1e10 = 1e30, far past Number.MAX_SAFE_INTEGER (~9e15)
		// and past a native 64-bit multiply (~1.8e19). Exact division (rateDen=1), so the ceiling is a no-op --
		// this isolates the BigInt product/reduction path from the rounding path.
		const reqOut = 10n ** 15n
		const rateNum = 10n ** 5n
		expect(convertBoundary({ reqOut, rateNum, rateDen: 1n, scaleIn: 10, scaleOut: 0 })).toBe(10n ** 30n)
	})

	it('reduces RateNum/RateDen to lowest terms before multiplying', () => {
		// 500/200 reduces to 5/2; same result as passing the reduced form directly.
		const reduced = convertBoundary({ reqOut: 9n, rateNum: 5n, rateDen: 2n, scaleIn: 0, scaleOut: 0 })
		const unreduced = convertBoundary({ reqOut: 9n, rateNum: 500n, rateDen: 200n, scaleIn: 0, scaleOut: 0 })
		expect(unreduced).toBe(reduced)
	})

	it('asserts its preconditions: reqOut >= 0, RateNum/RateDen > 0, integer non-negative scales', () => {
		expect(() => convertBoundary({ reqOut: -1n, rateNum: 1n, rateDen: 1n, scaleIn: 0, scaleOut: 0 })).toThrow()
		expect(() => convertBoundary({ reqOut: 1n, rateNum: 0n, rateDen: 1n, scaleIn: 0, scaleOut: 0 })).toThrow()
		expect(() => convertBoundary({ reqOut: 1n, rateNum: 1n, rateDen: 0n, scaleIn: 0, scaleOut: 0 })).toThrow()
		expect(() => convertBoundary({ reqOut: 1n, rateNum: 1n, rateDen: 1n, scaleIn: -1, scaleOut: 0 })).toThrow()
		expect(() => convertBoundary({ reqOut: 1n, rateNum: 1n, rateDen: 1n, scaleIn: 0, scaleOut: 1.5 })).toThrow()
	})

	// A missing or expired ExchangeRateQuote is the caller's (lift agent's) job to detect and prune
	// the route for -- this function is only ever invoked with an already-resolved, valid quote, so
	// there is no "missing quote" input shape to test here (see docs/architecture.md § Cross-denomination
	// conversion, "A missing or expired quote...").
})
