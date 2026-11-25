import { jest } from '@jest/globals'
import { realClock } from './clock.js'

afterEach(() => {
	jest.useRealTimers()
})

describe('realClock.now', () => {
	it('is monotonic non-decreasing across successive reads', () => {
		let last = realClock.now()
		for (let i = 0; i < 100; i++) {
			const next = realClock.now()
			expect(next).toBeGreaterThanOrEqual(last)
			last = next
		}
	})

	it('returns a finite millisecond count', () => {
		const t = realClock.now()
		expect(Number.isFinite(t)).toBe(true)
		expect(t).toBeGreaterThan(0)
	})
})

describe('realClock timers', () => {
	it('fires a timer scheduled with setTimer', () => {
		jest.useFakeTimers()
		const fn = jest.fn()
		realClock.setTimer(fn, 1_000)
		expect(fn).not.toHaveBeenCalled()
		jest.advanceTimersByTime(1_000)
		expect(fn).toHaveBeenCalledTimes(1)
	})

	it('a cleared timer never fires', () => {
		jest.useFakeTimers()
		const fn = jest.fn()
		const handle = realClock.setTimer(fn, 1_000)
		realClock.clearTimer(handle)
		jest.advanceTimersByTime(10_000)
		expect(fn).not.toHaveBeenCalled()
	})

	it('clearTimer on an already-fired handle is a safe no-op', () => {
		jest.useFakeTimers()
		const fn = jest.fn()
		const handle = realClock.setTimer(fn, 1_000)
		jest.advanceTimersByTime(1_000)
		expect(fn).toHaveBeenCalledTimes(1)
		expect(() => realClock.clearTimer(handle)).not.toThrow()
	})

	it('clearTimer on an undefined / unknown handle is a safe no-op', () => {
		expect(() => realClock.clearTimer(undefined)).not.toThrow()
		expect(() => realClock.clearTimer(12345)).not.toThrow()
	})
})
