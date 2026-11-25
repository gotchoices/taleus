import { advanceClock, clampToBounds, progressFraction, timeAtFraction, type TimeBounds } from './clock.js'

const bounds: TimeBounds = { min: 10, max: 110 }

describe('clampToBounds', () => {
	it('clamps below, above, and passes through inside', () => {
		expect(clampToBounds(5, bounds)).toBe(10)
		expect(clampToBounds(200, bounds)).toBe(110)
		expect(clampToBounds(50, bounds)).toBe(50)
	})
})

describe('advanceClock', () => {
	it('advances by speed · realDelta and does not report end mid-range', () => {
		expect(advanceClock(10, 1, 20, bounds)).toEqual({ time: 30, atEnd: false })
		expect(advanceClock(10, 2, 20, bounds)).toEqual({ time: 50, atEnd: false })
		expect(advanceClock(10, 0.25, 20, bounds)).toEqual({ time: 15, atEnd: false })
	})

	it('clamps to max and reports atEnd when it reaches the end', () => {
		expect(advanceClock(100, 1, 50, bounds)).toEqual({ time: 110, atEnd: true })
		expect(advanceClock(110, 1, 50, bounds)).toEqual({ time: 110, atEnd: true })
	})

	it('holds position (never rewinds) on a non-positive frame delta', () => {
		expect(advanceClock(50, 1, 0, bounds)).toEqual({ time: 50, atEnd: false })
		expect(advanceClock(50, 1, -16, bounds)).toEqual({ time: 50, atEnd: false })
	})

	it('a zero-length trace is immediately at the end', () => {
		const point: TimeBounds = { min: 42, max: 42 }
		expect(advanceClock(42, 1, 16, point)).toEqual({ time: 42, atEnd: true })
	})
})

describe('progressFraction / timeAtFraction', () => {
	it('maps time to a 0..1 fraction and back', () => {
		expect(progressFraction(10, bounds)).toBe(0)
		expect(progressFraction(60, bounds)).toBe(0.5)
		expect(progressFraction(110, bounds)).toBe(1)
		expect(timeAtFraction(0, bounds)).toBe(10)
		expect(timeAtFraction(0.5, bounds)).toBe(60)
		expect(timeAtFraction(1, bounds)).toBe(110)
	})

	it('guards a zero-length range (no NaN)', () => {
		const point: TimeBounds = { min: 7, max: 7 }
		expect(progressFraction(7, point)).toBe(0)
		expect(timeAtFraction(0.5, point)).toBe(7)
	})

	it('clamps out-of-range inputs', () => {
		expect(progressFraction(-100, bounds)).toBe(0)
		expect(progressFraction(9999, bounds)).toBe(1)
		expect(timeAtFraction(-1, bounds)).toBe(10)
		expect(timeAtFraction(2, bounds)).toBe(110)
	})
})
