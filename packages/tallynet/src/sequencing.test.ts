import { jest } from '@jest/globals'
import { Pending, budgetedStep } from './sequencing.js'
import { realClock, type Clock } from './clock.js'

afterEach(() => {
	jest.useRealTimers()
})

describe('Pending', () => {
	it('tracks a resolved value', async () => {
		const p = new Pending(Promise.resolve(7), realClock)
		await p.result()
		expect(p.isComplete).toBe(true)
		expect(p.isResponse).toBe(true)
		expect(p.isError).toBe(false)
		expect(p.response).toBe(7)
		expect(p.duration).toBeGreaterThanOrEqual(0)
	})

	it('tracks a rejection and re-throws from result()', async () => {
		const boom = new Error('boom')
		const p = new Pending(Promise.reject(boom), realClock)
		await expect(p.result()).rejects.toBe(boom)
		expect(p.isComplete).toBe(true)
		expect(p.isError).toBe(true)
		expect(p.isResponse).toBe(false)
		expect(p.error).toBe(boom)
	})

	it('reports pending before settling', () => {
		const p = new Pending(new Promise<number>(() => {}), realClock)
		expect(p.isComplete).toBe(false)
		expect(p.isResponse).toBe(false)
		expect(p.isError).toBe(false)
	})

	it('treats an undefined resolution as complete', async () => {
		const p = new Pending<void>(Promise.resolve(), realClock)
		await p.result()
		expect(p.isComplete).toBe(true)
		expect(p.isResponse).toBe(true)
	})

	it('measures duration from a clock origin other than the epoch', async () => {
		// A virtual clock may count from 0; duration must stay correct regardless of origin.
		let t = 1000
		const virtualClock = { now: () => t, setTimer: () => 0, clearTimer: () => {} }
		const p = new Pending(Promise.resolve(1), virtualClock)
		t = 1250
		await p.result()
		expect(p.t1).toBe(1000)
		expect(p.duration).toBe(250)
	})
})

describe('budgetedStep', () => {
	it('resolves immediately for an empty request set, arming no timer', async () => {
		jest.useFakeTimers()
		await budgetedStep(realClock, 10_000, {})
		expect(jest.getTimerCount()).toBe(0)
	})

	it('returns early with no leaked timer when all requests are already complete', async () => {
		const requests = { a: new Pending(Promise.resolve(1), realClock), b: new Pending(Promise.resolve(2), realClock) }
		await Promise.all([requests.a.result(), requests.b.result()])
		jest.useFakeTimers()
		await budgetedStep(realClock, 10_000, requests)
		expect(jest.getTimerCount()).toBe(0)
	})

	it('clears the budget timer when requests complete during the step', async () => {
		let resolveA: (v: number) => void = () => {}
		const requests = { a: new Pending(new Promise<number>((r) => { resolveA = r }), realClock) }
		jest.useFakeTimers()
		const step = budgetedStep(realClock, 10_000, requests)
		expect(jest.getTimerCount()).toBe(1)
		resolveA(1)
		await step
		expect(jest.getTimerCount()).toBe(0)
	})

	it('resolves at the budget when nothing completes', async () => {
		const requests = { a: new Pending(new Promise<number>(() => {}), realClock) }
		jest.useFakeTimers()
		const step = budgetedStep(realClock, 5_000, requests)
		expect(jest.getTimerCount()).toBe(1)
		jest.advanceTimersByTime(5_000)
		await step
		expect(jest.getTimerCount()).toBe(0)
	})

	it('counts a rejected request as complete', async () => {
		const p = new Pending(Promise.reject(new Error('x')), realClock)
		await p.result().catch(() => undefined)
		await budgetedStep(realClock, 10_000, { a: p })
		expect(p.isError).toBe(true)
	})

	it('ends early when the abort signal fires, clearing the timer', async () => {
		const controller = new AbortController()
		const requests = { a: new Pending(new Promise<number>(() => {}), realClock) }
		jest.useFakeTimers()
		const step = budgetedStep(realClock, 100_000, requests, { signal: controller.signal })
		expect(jest.getTimerCount()).toBe(1)
		controller.abort()
		await step
		expect(jest.getTimerCount()).toBe(0)
	})

	it('resolves immediately when the signal is already aborted', async () => {
		const controller = new AbortController()
		controller.abort()
		jest.useFakeTimers()
		await budgetedStep(realClock, 100_000, { a: new Pending(new Promise<number>(() => {}), realClock) }, { signal: controller.signal })
		expect(jest.getTimerCount()).toBe(0)
	})

	it('arms and fires its budget through an injected virtual clock, with no real time', async () => {
		// A hand-driven virtual clock: setTimer stashes the callback; the test fires it. No real
		// timers, no jest fake timers -- proves the budget path runs entirely on injected time.
		let fire: (() => void | Promise<void>) | undefined
		const virtualClock: Clock = {
			now: () => 0,
			setTimer: (fn) => { fire = fn; return 1 },
			clearTimer: () => { fire = undefined },
		}
		const requests = { a: new Pending(new Promise<number>(() => {}), virtualClock) }
		const step = budgetedStep(virtualClock, 5_000, requests)
		expect(fire).toBeDefined()
		void fire?.() // the budget "elapses" on virtual time
		await step // resolves, never rejects, even though the request never settled
		expect(requests.a.isComplete).toBe(false)
	})
})
