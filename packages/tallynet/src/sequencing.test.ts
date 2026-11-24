import { jest } from '@jest/globals'
import { Pending, budgetedStep } from './sequencing.js'

afterEach(() => {
	jest.useRealTimers()
})

describe('Pending', () => {
	it('tracks a resolved value', async () => {
		const p = new Pending(Promise.resolve(7))
		await p.result()
		expect(p.isComplete).toBe(true)
		expect(p.isResponse).toBe(true)
		expect(p.isError).toBe(false)
		expect(p.response).toBe(7)
		expect(p.duration).toBeGreaterThanOrEqual(0)
	})

	it('tracks a rejection and re-throws from result()', async () => {
		const boom = new Error('boom')
		const p = new Pending(Promise.reject(boom))
		await expect(p.result()).rejects.toBe(boom)
		expect(p.isComplete).toBe(true)
		expect(p.isError).toBe(true)
		expect(p.isResponse).toBe(false)
		expect(p.error).toBe(boom)
	})

	it('reports pending before settling', () => {
		const p = new Pending(new Promise<number>(() => {}))
		expect(p.isComplete).toBe(false)
		expect(p.isResponse).toBe(false)
		expect(p.isError).toBe(false)
	})

	it('treats an undefined resolution as complete', async () => {
		const p = new Pending<void>(Promise.resolve())
		await p.result()
		expect(p.isComplete).toBe(true)
		expect(p.isResponse).toBe(true)
	})
})

describe('budgetedStep', () => {
	it('resolves immediately for an empty request set, arming no timer', async () => {
		jest.useFakeTimers()
		await budgetedStep(10_000, {})
		expect(jest.getTimerCount()).toBe(0)
	})

	it('returns early with no leaked timer when all requests are already complete', async () => {
		const requests = { a: new Pending(Promise.resolve(1)), b: new Pending(Promise.resolve(2)) }
		await Promise.all([requests.a.result(), requests.b.result()])
		jest.useFakeTimers()
		await budgetedStep(10_000, requests)
		expect(jest.getTimerCount()).toBe(0)
	})

	it('clears the budget timer when requests complete during the step', async () => {
		let resolveA: (v: number) => void = () => {}
		const requests = { a: new Pending(new Promise<number>((r) => { resolveA = r })) }
		jest.useFakeTimers()
		const step = budgetedStep(10_000, requests)
		expect(jest.getTimerCount()).toBe(1)
		resolveA(1)
		await step
		expect(jest.getTimerCount()).toBe(0)
	})

	it('resolves at the budget when nothing completes', async () => {
		const requests = { a: new Pending(new Promise<number>(() => {})) }
		jest.useFakeTimers()
		const step = budgetedStep(5_000, requests)
		expect(jest.getTimerCount()).toBe(1)
		jest.advanceTimersByTime(5_000)
		await step
		expect(jest.getTimerCount()).toBe(0)
	})

	it('counts a rejected request as complete', async () => {
		const p = new Pending(Promise.reject(new Error('x')))
		await p.result().catch(() => undefined)
		await budgetedStep(10_000, { a: p })
		expect(p.isError).toBe(true)
	})

	it('ends early when the abort signal fires, clearing the timer', async () => {
		const controller = new AbortController()
		const requests = { a: new Pending(new Promise<number>(() => {})) }
		jest.useFakeTimers()
		const step = budgetedStep(100_000, requests, { signal: controller.signal })
		expect(jest.getTimerCount()).toBe(1)
		controller.abort()
		await step
		expect(jest.getTimerCount()).toBe(0)
	})

	it('resolves immediately when the signal is already aborted', async () => {
		const controller = new AbortController()
		controller.abort()
		jest.useFakeTimers()
		await budgetedStep(100_000, { a: new Pending(new Promise<number>(() => {})) }, { signal: controller.signal })
		expect(jest.getTimerCount()).toBe(0)
	})
})
