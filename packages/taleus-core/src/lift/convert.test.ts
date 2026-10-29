import { convertBoundary } from './convert.js'

describe('convertBoundary', () => {
	it('is a no-op for the degenerate single-denomination case (RateNum=RateDen=1, d_in=d_out)', () => {
		expect(convertBoundary({ reqOut: 12345n, rateNum: 1n, rateDen: 1n, divisorIn: 1000, divisorOut: 1000 })).toBe(12345n)
		expect(convertBoundary({ reqOut: 0n, rateNum: 1n, rateDen: 1n, divisorIn: 1, divisorOut: 1 })).toBe(0n)
	})

	it('converts a two-denomination payment (1.5 CHIP at divisor 1000, quoted 2 USD per CHIP, USD at divisor 100)', () => {
		// D_out = CHIP (divisor 1000, milliCHIP), D_in = USD (divisor 100, cents); quote From=USD,To=CHIP, RateNum/RateDen = 2/1.
		expect(convertBoundary({ reqOut: 1500n, rateNum: 2n, rateDen: 1n, divisorIn: 100, divisorOut: 1000 })).toBe(300n)
	})

	it('converts across a unit that does not divide by ten (hours counted in minutes)', () => {
		// D_out = an hour at divisor 60 (minutes), D_in = USD at divisor 100; quoted 30 USD per hour.
		// 90 minutes is 1.5 hours, so 45 USD: 4500 cents.
		expect(convertBoundary({ reqOut: 90n, rateNum: 30n, rateDen: 1n, divisorIn: 100, divisorOut: 60 })).toBe(4500n)
		// One minute at 30 USD/hour is exactly 50 cents.
		expect(convertBoundary({ reqOut: 1n, rateNum: 30n, rateDen: 1n, divisorIn: 100, divisorOut: 60 })).toBe(50n)
	})

	it('rounds up on remainder, and does not round up on an exact division', () => {
		expect(convertBoundary({ reqOut: 8n, rateNum: 3n, rateDen: 2n, divisorIn: 1, divisorOut: 1 })).toBe(12n) // 24 / 2, exact
		expect(convertBoundary({ reqOut: 7n, rateNum: 3n, rateDen: 2n, divisorIn: 1, divisorOut: 1 })).toBe(11n) // 21 / 2 = 10.5 -> 11
	})

	it('composes across a three-denomination chain, walked A->B->C', () => {
		// A (divisor 100) -> B (divisor 1000) -> C (divisor 1); reqC = 7, discovery walks backward from C.
		const reqB = convertBoundary({ reqOut: 7n, rateNum: 5n, rateDen: 2n, divisorIn: 1000, divisorOut: 1 }) // D_in=B, D_out=C
		expect(reqB).toBe(17500n)
		const reqA = convertBoundary({ reqOut: reqB, rateNum: 3n, rateDen: 4n, divisorIn: 100, divisorOut: 1000 }) // D_in=A, D_out=B
		expect(reqA).toBe(1313n)
	})

	it('composes across a three-denomination chain, walked in the other direction C->B->A', () => {
		// A (divisor 100) -> B (divisor 1000) -> C (divisor 1); reqA = 9, discovery walks backward from A.
		const reqB = convertBoundary({ reqOut: 9n, rateNum: 7n, rateDen: 3n, divisorIn: 1000, divisorOut: 100 }) // D_in=B, D_out=A
		expect(reqB).toBe(210n)
		const reqC = convertBoundary({ reqOut: reqB, rateNum: 11n, rateDen: 13n, divisorIn: 1, divisorOut: 1000 }) // D_in=C, D_out=B
		expect(reqC).toBe(1n)
	})

	it('is a no-op across every boundary in a circular clearing lift (all rates 1)', () => {
		const reqB = convertBoundary({ reqOut: 42n, rateNum: 1n, rateDen: 1n, divisorIn: 100, divisorOut: 100 })
		const reqA = convertBoundary({ reqOut: reqB, rateNum: 1n, rateDen: 1n, divisorIn: 100, divisorOut: 100 })
		expect(reqA).toBe(42n)
	})

	it('stays exact past the point where a native 64-bit multiply would overflow', () => {
		// reqOut * rateNum * divisorIn = 1e15 * 1e5 * 1e10 = 1e30, far past Number.MAX_SAFE_INTEGER (~9e15)
		// and past a native 64-bit multiply (~1.8e19). Exact division (rateDen=1), so the ceiling is a no-op --
		// this isolates the BigInt product/reduction path from the rounding path.
		const reqOut = 10n ** 15n
		const rateNum = 10n ** 5n
		expect(convertBoundary({ reqOut, rateNum, rateDen: 1n, divisorIn: 10000000000, divisorOut: 1 })).toBe(10n ** 30n)
	})

	it('reduces RateNum/RateDen to lowest terms before multiplying', () => {
		// 500/200 reduces to 5/2; same result as passing the reduced form directly.
		const reduced = convertBoundary({ reqOut: 9n, rateNum: 5n, rateDen: 2n, divisorIn: 1, divisorOut: 1 })
		const unreduced = convertBoundary({ reqOut: 9n, rateNum: 500n, rateDen: 200n, divisorIn: 1, divisorOut: 1 })
		expect(unreduced).toBe(reduced)
	})

	it('asserts its preconditions: reqOut >= 0, RateNum/RateDen > 0, positive integer divisors', () => {
		expect(() => convertBoundary({ reqOut: -1n, rateNum: 1n, rateDen: 1n, divisorIn: 1, divisorOut: 1 })).toThrow()
		expect(() => convertBoundary({ reqOut: 1n, rateNum: 0n, rateDen: 1n, divisorIn: 1, divisorOut: 1 })).toThrow()
		expect(() => convertBoundary({ reqOut: 1n, rateNum: 1n, rateDen: 0n, divisorIn: 1, divisorOut: 1 })).toThrow()
		expect(() => convertBoundary({ reqOut: 1n, rateNum: 1n, rateDen: 1n, divisorIn: 0, divisorOut: 1 })).toThrow()
		expect(() => convertBoundary({ reqOut: 1n, rateNum: 1n, rateDen: 1n, divisorIn: 1, divisorOut: 1.5 })).toThrow()
	})

	// A missing or expired ExchangeRateQuote is the caller's (lift agent's) job to detect and prune
	// the route for -- this function is only ever invoked with an already-resolved, valid quote, so
	// there is no "missing quote" input shape to test here (see docs/architecture.md § Cross-denomination
	// conversion, "A missing or expired quote...").
})
