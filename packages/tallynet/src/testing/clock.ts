/**
 * The virtual clock: the simulator's / test harness's implementation of the {@link Clock} port
 * (`clock.ts` ships only the interface and the real-time default). Simulated time advances **only**
 * when a timer fires, so a whole discovery run of thousands of nodes replays deterministically on
 * compressed time and a viewer can animate it. Ties (timers scheduled for the same instant) break by
 * insertion order.
 *
 * It ships behind the `tallynet/testing` subpath export because `tallysim` and the viewer build on
 * it; it is a shipped module, not a test file, so it obeys the same platform-neutral rules as `src/`
 * (no `setTimeout`, no `Date.now`, no `Math.random`, no Node import -- enforced by
 * `no-node-globals.test.ts`, which scans `src/` recursively).
 *
 * ── The microtask-drain problem (the crux) ──────────────────────────────────────────────────────
 *
 * The whole discovery run is async: firing a delivery timer runs a neighbour's `query`, which itself
 * schedules more timers (its sub-deliveries, its round budget) **via promise continuations**, i.e.
 * microtasks, not synchronously. Between firing timer T and picking the next one, all of T's
 * consequent timers must already be queued, or virtual time advances out of order.
 *
 * So between fires we drain the microtask queue until timer **mutations quiesce**. A `mutations`
 * counter bumps on every `setTimer`, every `clearTimer` of a live timer, and every fire; the drain
 * loop yields to microtasks until that counter is unchanged for {@link DRAIN_QUIET} consecutive
 * hops. Counting *clears* (not just new timers) matters because when a subtree completes a cascade
 * of promise resolutions **clears** budget timers early (`budgetedStep` clears its timer when its
 * requests finish before the budget) -- that cascade schedules no new timer but must fully unwind
 * before the next fire, or a to-be-cleared timer fires prematurely and advances `now` wrongly.
 *
 * The gap between a fire and its consequent mutations is ~2-5 microtask hops in this system
 * (`findAddress` is a resolved promise -> `issueBatch` schedules delivery timers synchronously ->
 * `await budgetedStep` schedules the budget timer synchronously), so {@link DRAIN_QUIET} = 16 is a
 * wide margin. {@link MAX_DRAIN} is a large safety valve so a pathological chain cannot spin forever.
 * If a future, deeper promise chain ever under-drains, raise `DRAIN_QUIET` (or switch to an explicit
 * quiescence signal). The run always terminates because discovery schedules a bounded number of
 * timers (deliveries fire once; budget timers fire or are cleared; rounds are bounded by `maxDepth`),
 * so the heap strictly drains.
 */

import type { Clock, TimerHandle } from '../clock.js'

/** Consecutive quiet microtask hops (no timer created / cleared / fired) that end one drain. */
const DRAIN_QUIET = 16
/** Safety valve: the most microtask hops a single drain will ever take before giving up. */
const MAX_DRAIN = 100_000
/** Safety valve: the most timers `advance` / {@link VirtualClock.runUntilIdle} fire before throwing. */
const DEFAULT_MAX_STEPS = 10_000_000

/** One scheduled timer. `cancelled` is lazy deletion: the heap skips it on pop rather than removing it eagerly. */
interface VirtualTimer {
	time: number
	/** Monotonic insertion counter; the tie-break when two timers share a `time`. */
	seq: number
	fn: () => void
	cancelled: boolean
}

/**
 * A deterministic clock whose `now()` only moves when a timer fires. Back it with a binary min-heap
 * keyed by `(time asc, seq asc)` so queuing and draining thousands of timers stays O(log n) per op --
 * a linear scan would make the 1,000-node scale test O(n²) and blow the budget.
 */
export class VirtualClock implements Clock {
	private virtualNow = 0
	private seq = 0
	/** Bumped on every setTimer, every clearTimer of a live timer, and every fire; drives the drain. */
	private mutations = 0
	private readonly heap: VirtualTimer[] = []
	/** The timers this clock owns, so `clearTimer` safely no-ops a foreign or `undefined` handle. */
	private readonly own = new WeakSet<object>()

	now(): number {
		return this.virtualNow
	}

	setTimer(fn: () => void, ms: number): TimerHandle {
		const timer: VirtualTimer = { time: this.virtualNow + Math.max(0, ms), seq: this.seq++, fn, cancelled: false }
		this.own.add(timer)
		this.heapPush(timer)
		this.mutations++
		return timer
	}

	clearTimer(handle: TimerHandle): void {
		if (typeof handle !== 'object' || handle === null || !this.own.has(handle)) {
			return // foreign or undefined handle: a safe no-op, exactly as realClock's clearTimer is
		}
		const timer = handle as VirtualTimer
		if (timer.cancelled) {
			return
		}
		timer.cancelled = true // lazy deletion; the heap drops it when it reaches the top
		this.mutations++
	}

	/** Count of live (not-yet-fired, not-cancelled) queued timers. Diagnostic; tests assert the queue drains to 0. */
	get pendingTimers(): number {
		let live = 0
		for (const timer of this.heap) {
			if (!timer.cancelled) {
				live++
			}
		}
		return live
	}

	/**
	 * Fire every live timer with `time <= now + ms`, in `(time, seq)` order, advancing `now` to each
	 * as it fires and draining microtasks between fires; then set `now = now + ms` even if no timer
	 * sat at the end of the window.
	 */
	async advance(ms: number): Promise<void> {
		const target = this.virtualNow + Math.max(0, ms)
		await this.drainMicrotasks()
		let steps = 0
		for (;;) {
			const next = this.earliest()
			if (!next || next.time > target) {
				break
			}
			if (steps++ >= DEFAULT_MAX_STEPS) {
				throw new Error(`VirtualClock.advance exceeded ${DEFAULT_MAX_STEPS} fires; a timer is likely rescheduling itself within the window`)
			}
			this.heapPop() // remove the live top `earliest()` just returned
			this.virtualNow = next.time
			this.fire(next)
			await this.drainMicrotasks()
		}
		this.virtualNow = target
	}

	/**
	 * Drain microtasks, then repeatedly fire the earliest live timer (advancing `now`) until no live
	 * timer remains, draining microtasks between each fire. `maxSteps` throws rather than looping
	 * forever on a timer that reschedules itself.
	 */
	async runUntilIdle(maxSteps: number = DEFAULT_MAX_STEPS): Promise<void> {
		await this.drainMicrotasks()
		let steps = 0
		for (;;) {
			const next = this.earliest()
			if (!next) {
				break
			}
			if (steps++ >= maxSteps) {
				throw new Error(`VirtualClock.runUntilIdle exceeded ${maxSteps} fires; a timer is likely rescheduling itself`)
			}
			this.heapPop()
			this.virtualNow = next.time
			this.fire(next)
			await this.drainMicrotasks()
		}
	}

	/** Fire one timer: count it (so the drain keeps running through the fallout), then run it. */
	private fire(timer: VirtualTimer): void {
		this.mutations++
		timer.fn()
	}

	/** Yield to microtasks until no timer mutation for {@link DRAIN_QUIET} consecutive hops. See the class doc. */
	private async drainMicrotasks(): Promise<void> {
		let quiet = 0
		for (let pass = 0; pass < MAX_DRAIN && quiet < DRAIN_QUIET; pass++) {
			const mark = this.mutations
			await Promise.resolve() // one microtask hop -- no global timer, no Node import
			quiet = this.mutations === mark ? quiet + 1 : 0
		}
	}

	/** The earliest live timer (cancelled ones sitting at the top are dropped first), or undefined. */
	private earliest(): VirtualTimer | undefined {
		while (this.heap.length > 0 && this.heap[0].cancelled) {
			this.heapPop()
		}
		return this.heap.length > 0 ? this.heap[0] : undefined
	}

	/** True iff `a` should fire before `b`: earlier time, or equal time and earlier insertion order. */
	private before(a: VirtualTimer, b: VirtualTimer): boolean {
		return a.time < b.time || (a.time === b.time && a.seq < b.seq)
	}

	private swap(i: number, j: number): void {
		const tmp = this.heap[i]
		this.heap[i] = this.heap[j]
		this.heap[j] = tmp
	}

	private heapPush(timer: VirtualTimer): void {
		this.heap.push(timer)
		let i = this.heap.length - 1
		while (i > 0) {
			const parent = (i - 1) >> 1
			if (!this.before(this.heap[i], this.heap[parent])) {
				break
			}
			this.swap(i, parent)
			i = parent
		}
	}

	private heapPop(): VirtualTimer | undefined {
		if (this.heap.length === 0) {
			return undefined
		}
		const top = this.heap[0]
		const last = this.heap.pop() as VirtualTimer
		if (this.heap.length > 0) {
			this.heap[0] = last
			this.siftDown()
		}
		return top
	}

	private siftDown(): void {
		let i = 0
		const n = this.heap.length
		for (;;) {
			const left = 2 * i + 1
			const right = 2 * i + 2
			let smallest = i
			if (left < n && this.before(this.heap[left], this.heap[smallest])) {
				smallest = left
			}
			if (right < n && this.before(this.heap[right], this.heap[smallest])) {
				smallest = right
			}
			if (smallest === i) {
				break
			}
			this.swap(i, smallest)
			i = smallest
		}
	}
}
