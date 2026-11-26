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
 * ── Why we drain between fires ───────────────────────────────────────────────────────────────────
 *
 * The whole discovery/consensus run is async: firing a delivery timer runs a neighbour's `query` (or
 * a pushed record's `update`), which itself schedules more timers (its sub-deliveries, its round
 * budget, its onward pushes) **via promise continuations** -- microtasks, not synchronously. Between
 * firing timer T and picking the next one, all of T's consequent timers must already be queued, or
 * virtual time advances out of order (the next timer would fire at the wrong `now`).
 *
 * ── How: drain a macrotask at a time, not a microtask at a time (the crux) ───────────────────────
 *
 * So between fires we let the event loop turn, and we wait until timer **mutations quiesce**. A
 * `mutations` counter bumps on every `setTimer`, every `clearTimer` of a live timer, and every fire;
 * {@link drain} turns the loop one **macrotask** at a time until that counter is unchanged for
 * {@link DRAIN_QUIET} consecutive macrotask hops.
 *
 * Macrotask granularity is the whole point. The JS event loop guarantees the microtask queue is
 * drained **completely** before any macrotask runs -- including microtasks enqueued while draining.
 * So **one** macrotask hop flushes an entire microtask continuation cascade of *any* length. Counting
 * quiescence in macrotask hops is therefore immune to how long that cascade is: there is no threshold
 * to guess. (The previous design counted *microtask* hops and had to guess a `DRAIN_QUIET` that
 * exceeded the longest promise-continuation chain between a fire and its consequent timer mutations.
 * That guess was unknowable and load-bearing: any chain longer than the guess made the drain quiesce
 * mid-cascade, the outer loop saw an empty-looking heap, declared the run idle, and the timer the
 * still-running chain was about to schedule was silently dropped -- a wrong result with no error. The
 * macrotask drain removes the guess and the failure mode with it.)
 *
 * This subsumes the async-timer-callback case (consensus). A pushed record's `update` runs a long
 * await chain (validate -> merge -> verify every signature -> advance state -> sign) and schedules
 * its onward pushes only at the very end. That chain arms no timer mid-flight, so it is pure
 * microtasks: one macrotask flush drains the whole `update`, including the onward pushes it queues at
 * its end, before the drain quiesces. No promise-tracking of the callback is needed; a timer callback
 * may still be async (and the heap is driven exactly the same whether it is or not).
 *
 * Counting *clears* (not just new timers) matters too: when a subtree completes, a cascade of promise
 * resolutions **clears** budget timers early (`budgetedStep` clears its timer when its requests finish
 * before the budget). That cascade schedules no new timer but must fully unwind before the next fire,
 * or a to-be-cleared timer fires prematurely and advances `now` wrongly -- and because `clearTimer`
 * bumps `mutations`, the drain waits for it. One macrotask flush unwinds the whole cascade regardless
 * of its depth.
 *
 * ── Scheduling a macrotask without setTimeout ────────────────────────────────────────────────────
 *
 * `setTimeout` is forbidden in this file (only the real-time clock at `src/clock.ts` is allowlisted --
 * see `no-node-globals.test.ts`). A `MessageChannel` `postMessage` schedules a macrotask instead; it
 * is cross-platform (Node >= 15, browsers, Hermes/React Native) and the neutrality guard does not
 * forbid it. The channel is created lazily and **closed when the clock goes idle** ({@link
 * closeChannel}) so it never keeps the host process (or a jest worker) alive after a run. We do *not*
 * `unref` the ports: while a macrotask is the only pending work, an unref'd port lets the event loop
 * go empty and exit before the macrotask runs, leaving the drain's awaited promise forever unsettled.
 */

import type { Clock, TimerHandle } from '../clock.js'

/**
 * The slice of a `MessageChannel` port this file uses, narrowed to three members so the
 * platform-neutral build (`tsconfig.build.json`, `types: []`) needs neither the DOM nor the Node lib.
 * Declared module-locally -- like the timer globals in `clock.ts` -- because this is the one file in
 * `src/` that reaches for the macrotask primitive, and keeping it out of `globals.d.ts` stops the
 * rest of `src/` from assuming it exists.
 */
interface MacrotaskPort {
	postMessage(value: unknown): void
	onmessage: ((event: unknown) => void) | null
	close(): void
}
declare const MessageChannel: { new (): { readonly port1: MacrotaskPort; readonly port2: MacrotaskPort } }

/** Consecutive quiet **macrotask** hops (no timer created / cleared / fired) that end one drain. */
// Two, not one: a single confirming hop after the cascade-flushing hop is cheap insurance. Because one
// macrotask flushes an entire microtask continuation cascade regardless of length, this is a true
// constant -- no cascade can outrun it the way a chain could outrun the old microtask-hop threshold.
const DRAIN_QUIET = 2
/** Safety valve: the most macrotask hops a single drain will ever take before giving up. */
const MAX_DRAIN = 100_000
/** Safety valve: the most timers `advance` / {@link VirtualClock.runUntilIdle} fire before throwing. */
const DEFAULT_MAX_STEPS = 10_000_000

/** One scheduled timer. `cancelled` is lazy deletion: the heap skips it on pop rather than removing it eagerly. */
interface VirtualTimer {
	time: number
	/** Monotonic insertion counter; the tie-break when two timers share a `time`. */
	seq: number
	fn: () => void | Promise<void>
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
	/** The lazily-created macrotask channel; `undefined` while the clock is idle. See {@link macrotask}. */
	private channel: { port1: MacrotaskPort; port2: MacrotaskPort } | undefined
	/** Resolver for the macrotask hop currently in flight, fired by the channel's `onmessage`. */
	private resolveMacrotask: (() => void) | undefined

	now(): number {
		return this.virtualNow
	}

	setTimer(fn: () => void | Promise<void>, ms: number): TimerHandle {
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
	 * as it fires and draining between fires; then set `now = now + ms` even if no timer sat at the end
	 * of the window. The macrotask channel is closed on exit (even on a throw) so the clock leaves no
	 * handle holding the event loop open.
	 */
	async advance(ms: number): Promise<void> {
		const target = this.virtualNow + Math.max(0, ms)
		try {
			await this.drain()
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
				await this.drain()
			}
			this.virtualNow = target
			await this.assertDrained()
		} finally {
			this.closeChannel()
		}
	}

	/**
	 * Drain, then repeatedly fire the earliest live timer (advancing `now`) until no live timer
	 * remains, draining between each fire. `maxSteps` throws rather than looping forever on a timer
	 * that reschedules itself. The macrotask channel is closed on exit (even on a throw).
	 */
	async runUntilIdle(maxSteps: number = DEFAULT_MAX_STEPS): Promise<void> {
		try {
			await this.drain()
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
				await this.drain()
			}
			await this.assertDrained()
		} finally {
			this.closeChannel()
		}
	}

	/**
	 * Fire one timer: count it (so the drain keeps running through the fallout), then run it. A callback
	 * may be async; the drain flushes its whole await chain (one macrotask flush drains any
	 * microtask cascade), so the promise it returns needs no tracking. The network's push callback
	 * already catches its own receiver-side errors, so the returned promise never rejects here.
	 */
	private fire(timer: VirtualTimer): void {
		this.mutations++
		// NOTE: matches realClock (`void fn()`) — a rejecting async callback surfaces as an unhandled
		// rejection, not swallowed. No callback rejects uncaught today (the network push catches its own
		// errors into deliveryErrors); if a future async timer callback can reject, add a `.catch` here.
		void timer.fn()
	}

	/**
	 * Turn the event loop one **macrotask** at a time until no timer mutated for {@link DRAIN_QUIET}
	 * consecutive hops. One macrotask flushes the entire microtask continuation cascade a fire set off,
	 * so quiescence cannot be faked by a long promise chain -- the failure mode the old microtask-hop
	 * heuristic had. {@link MAX_DRAIN} is a runaway valve.
	 */
	private async drain(): Promise<void> {
		let quiet = 0
		for (let pass = 0; pass < MAX_DRAIN && quiet < DRAIN_QUIET; pass++) {
			const mark = this.mutations
			await this.macrotask()
			quiet = this.mutations === mark ? quiet + 1 : 0
		}
	}

	/**
	 * Loud overrun guard: once the fire loop has gone idle, one more macrotask hop must schedule
	 * nothing. If a late continuation still arms a timer here, the drain quiesced too early -- the exact
	 * silent-drop this clock's macrotask drain is designed to prevent -- so fail loudly instead of
	 * returning a wrong result. With the macrotask drain this never trips; it is belt-and-suspenders.
	 */
	private async assertDrained(): Promise<void> {
		const mark = this.mutations
		await this.macrotask()
		if (this.mutations !== mark) {
			throw new Error('VirtualClock went idle but a timer continuation then scheduled more work; the drain quiesced too early (please report)')
		}
	}

	/**
	 * Resolve on the next **macrotask**, scheduled via a `MessageChannel` `postMessage` (a macrotask on
	 * every target, and allowed here where `setTimeout` is not). The channel is created on first use and
	 * reused for the rest of the run; {@link closeChannel} releases it when the clock goes idle. Calls
	 * are strictly sequential (each drain awaits its hop before the next), so one resolver is live at a time.
	 */
	private macrotask(): Promise<void> {
		if (!this.channel) {
			const channel = new MessageChannel()
			channel.port1.onmessage = (): void => {
				const resolve = this.resolveMacrotask
				this.resolveMacrotask = undefined
				resolve?.()
			}
			this.channel = channel
		}
		return new Promise<void>((resolve) => {
			this.resolveMacrotask = resolve
			this.channel!.port2.postMessage(null)
		})
	}

	/** Close and drop the macrotask channel so nothing keeps the event loop (or a jest worker) alive after a run. */
	private closeChannel(): void {
		if (this.channel) {
			this.channel.port1.close()
			this.channel.port2.close()
			this.channel = undefined
			this.resolveMacrotask = undefined
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
