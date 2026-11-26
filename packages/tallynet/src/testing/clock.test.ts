import { jest } from '@jest/globals'
import { VirtualClock } from './clock.js'
import { Pending, budgetedStep } from '../sequencing.js'

describe('VirtualClock ordering', () => {
	it('fires timers in (time, seq) order', async () => {
		const clock = new VirtualClock()
		const fired: string[] = []
		clock.setTimer(() => fired.push('c@20'), 20)
		clock.setTimer(() => fired.push('a@10'), 10)
		clock.setTimer(() => fired.push('b@10'), 10)
		await clock.runUntilIdle()
		expect(fired).toEqual(['a@10', 'b@10', 'c@20'])
		expect(clock.now()).toBe(20)
	})

	it('breaks ties by insertion order, deterministically across runs', async () => {
		const run = async (): Promise<number[]> => {
			const clock = new VirtualClock()
			const out: number[] = []
			for (let i = 0; i < 6; i++) {
				const id = i
				clock.setTimer(() => out.push(id), 0)
			}
			await clock.runUntilIdle()
			return out
		}
		expect(await run()).toEqual([0, 1, 2, 3, 4, 5])
		expect(await run()).toEqual([0, 1, 2, 3, 4, 5])
	})

	it('fires a timer scheduled by a firing timer, at the later time', async () => {
		const clock = new VirtualClock()
		const fired: number[] = []
		clock.setTimer(() => {
			fired.push(clock.now())
			clock.setTimer(() => fired.push(clock.now()), 5)
		}, 10)
		await clock.runUntilIdle()
		expect(fired).toEqual([10, 15])
		expect(clock.now()).toBe(15)
	})
})

describe('VirtualClock timers', () => {
	it('a cleared timer never fires', async () => {
		const clock = new VirtualClock()
		const fn = jest.fn()
		const handle = clock.setTimer(fn, 10)
		clock.clearTimer(handle)
		await clock.runUntilIdle()
		expect(fn).not.toHaveBeenCalled()
	})

	it('clearTimer on a foreign or undefined handle is a safe no-op', () => {
		const clock = new VirtualClock()
		expect(() => clock.clearTimer(undefined)).not.toThrow()
		expect(() => clock.clearTimer({})).not.toThrow()
		expect(() => clock.clearTimer(42)).not.toThrow()
	})

	it('advance moves now even when no timer sits in the window', async () => {
		const clock = new VirtualClock()
		await clock.advance(1_000)
		expect(clock.now()).toBe(1_000)
		expect(clock.pendingTimers).toBe(0)
	})
})

describe('VirtualClock drives budgetedStep', () => {
	it('advance fires the budget when nothing completes', async () => {
		const clock = new VirtualClock()
		const requests = { a: new Pending(new Promise<number>(() => {}), clock) }
		const step = budgetedStep(clock, 5_000, requests)
		await clock.advance(5_000)
		await step
		expect(requests.a.isComplete).toBe(false)
		expect(clock.pendingTimers).toBe(0) // the budget timer did not leak
	})

	it('runUntilIdle drives a step to completion and clears the budget timer, leaving an empty queue', async () => {
		const clock = new VirtualClock()
		let resolveReq: (v: number) => void = () => {}
		const reqPromise = new Promise<number>((r) => { resolveReq = r })
		clock.setTimer(() => resolveReq(42), 1_000) // request answers well under the budget
		const requests = { a: new Pending(reqPromise, clock) }
		const step = budgetedStep(clock, 5_000, requests)
		await clock.runUntilIdle()
		await step
		expect(requests.a.isComplete).toBe(true)
		expect(requests.a.response).toBe(42)
		expect(clock.pendingTimers).toBe(0) // budget timer cleared early; nothing left queued
	})
})

describe('VirtualClock guards', () => {
	it('runUntilIdle throws when a timer reschedules itself forever', async () => {
		const clock = new VirtualClock()
		const reschedule = (): void => { clock.setTimer(reschedule, 1) }
		clock.setTimer(reschedule, 1)
		await expect(clock.runUntilIdle(100)).rejects.toThrow(/exceeded/)
	})
})

describe('VirtualClock long-continuation-chain drain', () => {
	// A timer whose callback schedules the NEXT timer only after a detached chain of N microtask hops.
	// A microtask-hop drain heuristic (the old design) silently dropped the second timer once N outran
	// its threshold; the macrotask drain flushes the whole chain in one hop, so chain length can't fool it.
	const hops = async (n: number): Promise<void> => { for (let i = 0; i < n; i++) { await Promise.resolve() } }
	it.each([8, 64, 200, 2000])('fires a timer scheduled after %i continuation hops', async (n) => {
		const clock = new VirtualClock()
		const fired: string[] = []
		clock.setTimer(() => {
			fired.push('first')
			void hops(n).then(() => { clock.setTimer(() => fired.push('second'), 5) })
		}, 10)
		await clock.runUntilIdle()
		expect(fired).toEqual(['first', 'second'])
		expect(clock.pendingTimers).toBe(0)
	})
})
