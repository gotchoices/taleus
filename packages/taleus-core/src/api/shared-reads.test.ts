import { SharedReadStore } from './shared-reads.js'
import type { TallyStore } from './types.js'

/** A store that counts its reads and lets the test raise a change or fail the next read. */
class CountingStore implements TallyStore {
	reads = 0
	failNext = false
	private readonly listeners = new Set<(tables: readonly string[]) => void>()

	async query<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
		this.reads++
		if (this.failNext) {
			this.failNext = false
			throw new Error('cohort unreachable')
		}
		return [{ read: this.reads }] as T[]
	}

	async apply(): Promise<void> {}

	subscribe(listener: (tables: readonly string[]) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	change(): void {
		for (const listener of this.listeners) listener(['App.Ledger'])
	}

	get listening(): number {
		return this.listeners.size
	}

	async close(): Promise<void> {}
}

function setup(maxAgeMs = 5_000) {
	let now = 0
	const store = new CountingStore()
	const shared = new SharedReadStore(store, maxAgeMs, () => now)
	return { store, shared, advance: (ms: number) => (now += ms) }
}

describe('sharing reads', () => {
	it('runs identical concurrent reads once', async () => {
		const { store, shared } = setup()
		await Promise.all([shared.query('select 1'), shared.query('select 1'), shared.query('select 1')])
		expect(store.reads).toBe(1)
	})

	it('tells different parameters apart', async () => {
		const { store, shared } = setup()
		await shared.query('select ? as x', ['a'])
		await shared.query('select ? as x', ['b'])
		expect(store.reads).toBe(2)
	})

	it('reads afresh after a write through it', async () => {
		const { store, shared } = setup()
		await shared.query('select 1')
		await shared.apply([])
		await shared.query('select 1')
		expect(store.reads).toBe(2)
	})

	it('reads afresh after a change it did not make', async () => {
		const { store, shared } = setup()
		await shared.query('select 1')
		store.change()
		await shared.query('select 1')
		expect(store.reads).toBe(2)
	})

	it('forgets before telling a subscriber, so the subscriber reads the change', async () => {
		const { store, shared } = setup()
		await shared.query('select 1')
		let seen: unknown
		shared.subscribe(() => void shared.query<{ read: number }>('select 1').then(rows => (seen = rows[0].read)))
		store.change()
		await new Promise(resolve => setImmediate(resolve))
		expect(seen).toBe(2)
	})

	it('reads afresh once a result is older than its limit, whether or not anything was heard', async () => {
		const { store, shared, advance } = setup(1_000)
		await shared.query('select 1')
		advance(999)
		await shared.query('select 1')
		advance(1)
		await shared.query('select 1')
		expect(store.reads).toBe(2)
	})

	it('does not keep a failed read', async () => {
		const { store, shared } = setup()
		store.failNext = true
		await expect(shared.query('select 1')).rejects.toThrow('cohort unreachable')
		await shared.query('select 1')
		expect(store.reads).toBe(2)
	})

	it('stops listening when closed', async () => {
		const { store, shared } = setup()
		await shared.query('select 1')
		expect(store.listening).toBe(1)
		await shared.close()
		expect(store.listening).toBe(0)
	})
})
