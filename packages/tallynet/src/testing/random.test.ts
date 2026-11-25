import { SeededRandom } from './random.js'

describe('SeededRandom', () => {
	it('produces the same byte stream for the same seed', () => {
		const a = new SeededRandom(123)
		const b = new SeededRandom(123)
		expect(Array.from(a.randomBytes(32))).toEqual(Array.from(b.randomBytes(32)))
	})

	it('diverges for different seeds', () => {
		const a = new SeededRandom(1)
		const b = new SeededRandom(2)
		expect(Array.from(a.randomBytes(32))).not.toEqual(Array.from(b.randomBytes(32)))
	})

	it('is reproducible across two instances over a long float stream', () => {
		const a = new SeededRandom(2026)
		const b = new SeededRandom(2026)
		const sa: number[] = []
		const sb: number[] = []
		for (let i = 0; i < 50; i++) {
			sa.push(a.nextFloat())
			sb.push(b.nextFloat())
		}
		expect(sa).toEqual(sb)
	})

	it('returns an empty array for length 0', () => {
		expect(new SeededRandom(1).randomBytes(0)).toEqual(new Uint8Array(0))
	})

	it('rejects a negative or non-integer length', () => {
		const r = new SeededRandom(1)
		expect(() => r.randomBytes(-1)).toThrow()
		expect(() => r.randomBytes(1.5)).toThrow()
	})

	it('does not degenerate for seed 0', () => {
		const bytes = new SeededRandom(0).randomBytes(16)
		expect(bytes.some((b) => b !== 0)).toBe(true)
	})

	it('keeps nextInt within [0, maxExclusive)', () => {
		const r = new SeededRandom(99)
		for (let i = 0; i < 1_000; i++) {
			const n = r.nextInt(10)
			expect(Number.isInteger(n)).toBe(true)
			expect(n).toBeGreaterThanOrEqual(0)
			expect(n).toBeLessThan(10)
		}
	})

	it('rejects a non-positive nextInt bound', () => {
		const r = new SeededRandom(1)
		expect(() => r.nextInt(0)).toThrow()
		expect(() => r.nextInt(-3)).toThrow()
	})

	it('keeps nextFloat in [0, 1)', () => {
		const r = new SeededRandom(5)
		for (let i = 0; i < 1_000; i++) {
			const f = r.nextFloat()
			expect(f).toBeGreaterThanOrEqual(0)
			expect(f).toBeLessThan(1)
		}
	})
})
