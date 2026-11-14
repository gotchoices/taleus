import { jest } from '@jest/globals'

import { DeliveryWatch } from './delivery-watch.js'
import type { Delivery, DeliveryStatus, FollowedWrite, Reach, TallyStore, WriteReceipt } from './types.js'

/** A networked store whose acts, reach and delivery events the test sets. */
class FollowingStore implements TallyStore {
	readonly states = new Map<string, Delivery>()
	reachNow: Reach | undefined = 'connected'
	private readonly listeners = new Set<() => void>()

	async query<T>(): Promise<T[]> {
		return []
	}

	async apply(): Promise<WriteReceipt> {
		return {}
	}

	reach(): Reach | undefined {
		return this.reachNow
	}

	writeStatus(key: string): DeliveryStatus | undefined {
		const state = this.states.get(key)
		return state ? { state } : undefined
	}

	followedWrites(): FollowedWrite[] {
		return [...this.states].map(([key, state]) => ({
			write: { table: 'Ledger', row: { Id: key } },
			status: { state },
		}))
	}

	onDelivery(listener: () => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	/** An act moved, as the stack would report it. */
	moved(key: string, state: Delivery): void {
		this.states.set(key, state)
		for (const listener of this.listeners) listener()
	}

	subscribe(): () => void {
		return () => {}
	}

	async close(): Promise<void> {}
}

const STALL = 180_000
const SAMPLE = 15_000

function setup() {
	let now = 0
	const store = new FollowingStore()
	const watch = new DeliveryWatch(store, { stallMs: STALL, sampleMs: SAMPLE, now: () => now })
	const heard = jest.fn()
	return {
		store,
		watch,
		heard,
		listen: () => watch.onDelivery(heard),
		/** Let `ms` pass, with the watchdog's own sampling running. */
		pass: (ms: number) => {
			now += ms
			jest.advanceTimersByTime(ms)
		},
	}
}

describe('the delivery watchdog', () => {
	beforeEach(() => jest.useFakeTimers())
	afterEach(() => jest.useRealTimers())

	it('marks an act stalled after enough connected time, and says so once', () => {
		const { store, watch, heard, listen, pass } = setup()
		store.states.set('chit-1', 'sending')
		listen()
		pass(STALL - SAMPLE)
		expect(watch.writeStatus('chit-1')).toEqual({ state: 'sending' })
		expect(heard).not.toHaveBeenCalled()
		pass(SAMPLE)
		expect(watch.writeStatus('chit-1')).toEqual({ state: 'sending', stalled: true })
		expect(watch.followedWrites()[0].status.stalled).toBe(true)
		expect(heard).toHaveBeenCalledTimes(1)
		pass(SAMPLE * 4)
		expect(heard).toHaveBeenCalledTimes(1)
	})

	it('does not count time while the counterparty is away or the device is offline', () => {
		const { store, watch, listen, pass } = setup()
		store.states.set('chit-1', 'waiting')
		store.reachNow = 'partner-away'
		listen()
		pass(STALL * 3)
		store.reachNow = 'no-network'
		pass(STALL * 3)
		expect(watch.writeStatus('chit-1')?.stalled).toBeUndefined()
		store.reachNow = 'connected'
		pass(STALL - SAMPLE)
		expect(watch.writeStatus('chit-1')?.stalled).toBeUndefined()
		pass(SAMPLE)
		expect(watch.writeStatus('chit-1')?.stalled).toBe(true)
	})

	it('tells listeners when the reach moves while an act travels', () => {
		const { store, heard, listen, pass } = setup()
		store.states.set('chit-1', 'here-only')
		listen()
		store.reachNow = 'partner-away'
		pass(SAMPLE)
		expect(heard).toHaveBeenCalledTimes(1)
	})

	it('forgets an act once it is delivered, and stops sampling', () => {
		const { store, watch, listen, pass } = setup()
		store.states.set('chit-1', 'sending')
		listen()
		pass(STALL)
		expect(watch.writeStatus('chit-1')?.stalled).toBe(true)
		store.moved('chit-1', 'delivered')
		expect(watch.writeStatus('chit-1')).toEqual({ state: 'delivered' })
		expect(jest.getTimerCount()).toBe(0)
	})

	it('never stalls an act nothing will report on, or a refusal', () => {
		const { store, watch, listen, pass } = setup()
		store.states.set('chit-1', 'unconfirmed')
		store.states.set('chit-2', 'not-recorded')
		listen()
		pass(STALL * 2)
		expect(watch.writeStatus('chit-1')?.stalled).toBeUndefined()
		expect(watch.writeStatus('chit-2')?.stalled).toBeUndefined()
		expect(jest.getTimerCount()).toBe(0)
	})

	it('runs no clock while nobody listens', () => {
		const { store, watch, listen, pass } = setup()
		store.states.set('chit-1', 'sending')
		const stop = listen()
		stop()
		pass(STALL * 2)
		expect(jest.getTimerCount()).toBe(0)
		expect(watch.writeStatus('chit-1')?.stalled).toBeUndefined()
	})

	it('passes through a store that cannot say which tables a read uses', () => {
		const { watch } = setup()
		expect(watch.tablesRead).toBeUndefined()
	})
})
