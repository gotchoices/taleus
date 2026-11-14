import { actKey, type RowWrite } from '../store/strand.js'
import type { Delivery, DeliveryStatus, FollowedWrite, Reach, TallyStore, Unsubscribe, WriteReceipt } from './types.js'

/** Connected time an act may stay unresolved before it is `stalled`. */
export const STALL_MS = 180_000
/** How often the clock reads `reach()` while an act travels and someone listens. */
export const SAMPLE_MS = 15_000

/** The states an act passes through on its way: the ones a stall can be judged in. */
const TRAVELLING: readonly Delivery[] = ['waiting', 'sending', 'here-only']

export interface DeliveryWatchOptions {
	stallMs?: number
	sampleMs?: number
	now?: () => number
}

/**
 * A tally's store, with a watchdog over this party's acts on their way to the counterparty
 * (story 15).
 *
 * An act waiting while this side cannot reach the counterparty's -- the phone has no network, or
 * the partner's phone is off -- is the ordinary life of a phone-to-phone tally, and says nothing
 * is wrong. An act that stays unresolved through `stallMs` of time this side *was* connected to
 * the counterparty's is a fault on the way (a stuck queue, a refusal not reported, a defect), and
 * its status says `stalled`. So the clock counts connected time only: an act that waited three
 * hours offline and then sticks for three minutes connected is stalled after the three minutes.
 *
 * The clock is the store's `reach()`, read every `sampleMs` -- and on every delivery event and
 * write -- while an act travels and someone listens (`onDelivery`); it costs nothing otherwise.
 * Time between two readings counts as connected when the later reading is. A store with no
 * `reach()` (no network) never stalls. Kept in memory: a restart starts every act's count again.
 */
export class DeliveryWatch implements TallyStore {
	private readonly stallMs: number
	private readonly sampleMs: number
	private readonly now: () => number
	/** Connected time each travelling act has spent unresolved, by act key. */
	private readonly connectedMs = new Map<string, number>()
	private readonly listeners = new Set<() => void>()
	private unlisten: Unsubscribe | undefined
	private timer: ReturnType<typeof setTimeout> | undefined
	private sampledAt: number | undefined
	private lastReach: Reach | undefined
	/** Only where the store below can say: absent, a cache above counts every change. */
	readonly tablesRead?: (sql: string) => Promise<readonly string[]>

	constructor(
		private readonly store: TallyStore,
		options: DeliveryWatchOptions = {},
	) {
		this.stallMs = options.stallMs ?? STALL_MS
		this.sampleMs = options.sampleMs ?? SAMPLE_MS
		this.now = options.now ?? Date.now
		if (store.tablesRead) this.tablesRead = store.tablesRead.bind(store)
	}

	query<T>(sql: string, params?: unknown[]): Promise<T[]> {
		return this.store.query<T>(sql, params)
	}

	async apply(writes: RowWrite[]): Promise<WriteReceipt> {
		try {
			return await this.store.apply(writes)
		} finally {
			this.check()
		}
	}

	reach(): Reach | undefined {
		return this.store.reach?.()
	}

	writeStatus(key: string): DeliveryStatus | undefined {
		const status = this.store.writeStatus?.(key)
		return status && this.marked(key, status)
	}

	followedWrites(): FollowedWrite[] {
		return this.store.followedWrites?.().map(followed => this.markedWrite(followed)) ?? []
	}

	acknowledge(key: string): void {
		this.connectedMs.delete(key)
		this.store.acknowledge?.(key)
	}

	onDelivery(listener: () => void): Unsubscribe {
		this.listeners.add(listener)
		this.unlisten ??= this.store.onDelivery?.(() => this.delivered())
		this.check()
		return () => {
			this.listeners.delete(listener)
			if (this.listeners.size === 0) this.idle()
		}
	}

	subscribe(listener: (tables: readonly string[]) => void): Unsubscribe {
		return this.store.subscribe(listener)
	}

	close(): Promise<void> {
		this.listeners.clear()
		this.idle()
		return this.store.close()
	}

	/** Where an act stands, with `stalled` when the clock says so. */
	private marked(key: string, status: DeliveryStatus): DeliveryStatus {
		const stalled = TRAVELLING.includes(status.state) && (this.connectedMs.get(key) ?? 0) >= this.stallMs
		return stalled ? { ...status, stalled: true } : status
	}

	private markedWrite(followed: FollowedWrite): FollowedWrite {
		const key = actKey(followed.write)
		return key ? { ...followed, status: this.marked(key, followed.status) } : followed
	}

	/** An act moved: tell the listeners, then bring the clock up to date. */
	private delivered(): void {
		this.emit()
		this.check()
	}

	private emit(): void {
		for (const listener of [...this.listeners]) listener()
	}

	/** Advance the clock to now, and sample again later while anything travels. */
	private check(): void {
		if (this.listeners.size === 0) return
		if (this.advance()) this.emit()
		this.schedule()
	}

	/**
	 * Count the time since the last reading toward each travelling act, when connected now. True
	 * when something a reader shows changed: an act crossed into `stalled`, or the reach moved.
	 */
	private advance(): boolean {
		const now = this.now()
		const elapsed = this.sampledAt === undefined ? 0 : now - this.sampledAt
		this.sampledAt = now
		const reach = this.store.reach?.()
		const reachMoved = this.lastReach !== undefined && reach !== this.lastReach
		this.lastReach = reach
		const travelling = this.travellingKeys()
		for (const key of this.connectedMs.keys()) if (!travelling.has(key)) this.connectedMs.delete(key)
		let crossed = false
		for (const key of travelling) {
			const before = this.connectedMs.get(key) ?? 0
			const after = reach === 'connected' ? before + elapsed : before
			this.connectedMs.set(key, after)
			if (before < this.stallMs && after >= this.stallMs) crossed = true
		}
		return crossed || reachMoved
	}

	/** The acts still on their way, as the store below reports them. */
	private travellingKeys(): Set<string> {
		const keys = new Set<string>()
		for (const { write, status } of this.store.followedWrites?.() ?? []) {
			const key = actKey(write)
			if (key && TRAVELLING.includes(status.state)) keys.add(key)
		}
		return keys
	}

	private schedule(): void {
		if (this.connectedMs.size === 0 || !this.store.reach) {
			this.stopTimer()
			return
		}
		if (this.timer !== undefined) return
		this.timer = setTimeout(() => {
			this.timer = undefined
			this.check()
		}, this.sampleMs)
		unref(this.timer)
	}

	private idle(): void {
		this.unlisten?.()
		this.unlisten = undefined
		this.stopTimer()
		this.sampledAt = undefined
	}

	private stopTimer(): void {
		if (this.timer !== undefined) clearTimeout(this.timer)
		this.timer = undefined
	}
}

/** A watchdog never keeps a process alive on its own (Node's timers; elsewhere a number, no `unref`). */
function unref(timer: ReturnType<typeof setTimeout>): void {
	if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
}
