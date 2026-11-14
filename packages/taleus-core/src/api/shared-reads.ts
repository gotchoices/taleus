import type { RowWrite } from '../store/strand.js'
import type { DeliveryStatus, FollowedWrite, Reach, TallyStore, Unsubscribe, WriteReceipt } from './types.js'

/**
 * A tally's store, with identical reads shared.
 *
 * A screen showing one tally asks the engine for its view, its history and its requests, and each
 * of those re-reads the tally's core, its denomination and its contract; a list of tallies does
 * that for every tally; the agent does it again when anything changes. On a strand every one of
 * those reads may cross the network to the cohort, so on a phone behind a relay the same few
 * queries were measured running thirty times within a second, each taking seconds.
 *
 * So a query that is already running, or has answered since the tally last changed, is answered
 * from that result. "Changed" is anything this store hears: a write applied through it, or any
 * change the underlying store reports -- it listens from its first read until `close`, so a
 * counterparty's replicated commit counts too. Where the store can say which tables a read
 * depends on (`tablesRead`), a change drops only the results over the tables it names: a payment
 * arriving leaves the tally's certificates, terms and contract as they were read. Every read that
 * reaches a strand can cost a round trip to the partner, so a result kept is a round trip saved. A change that raises no notification -- the case the
 * cadre store's backstop poll exists for -- is bounded by `maxAgeMs`, after which a result is read
 * afresh. A failed read is not kept, so the next caller tries again.
 *
 * Where this device's own writes stand (`writeStatus` and its siblings) is the store below's to
 * say, and is passed through unshared: it changes without any table changing.
 */
export class SharedReadStore implements TallyStore {
	private readonly results = new Map<string, { at: number; rows: Promise<unknown[]>; tables?: ReadonlySet<string> }>()
	/** Each statement's tables, resolved once; `undefined` where the store cannot say. */
	private readonly tablesOf = new Map<string, Promise<ReadonlySet<string> | undefined>>()
	private listening: Unsubscribe | undefined

	constructor(
		private readonly store: TallyStore,
		private readonly maxAgeMs: number,
		private readonly now: () => number = Date.now,
	) {}

	query<T>(sql: string, params?: unknown[]): Promise<T[]> {
		this.listening ??= this.store.subscribe(tables => this.forget(tables))
		const key = params?.length ? `${sql}\u0000${JSON.stringify(params)}` : sql
		const held = this.results.get(key)
		if (held && this.now() - held.at < this.maxAgeMs) return held.rows as Promise<T[]>
		const rows = this.store.query<T>(sql, params)
		const entry: { at: number; rows: Promise<unknown[]>; tables?: ReadonlySet<string> } = { at: this.now(), rows }
		this.results.set(key, entry)
		// Until its tables are known, any change drops it.
		void this.tablesFor(sql).then(tables => {
			entry.tables = tables
		})
		rows.catch(() => {
			if (this.results.get(key) === entry) this.results.delete(key)
		})
		return rows
	}

	async apply(writes: RowWrite[]): Promise<WriteReceipt> {
		let receipt: WriteReceipt
		try {
			receipt = await this.store.apply(writes)
		} catch (error) {
			// Even a failed act may have committed part of itself, so nothing read before it stands.
			this.forget()
			throw error
		}
		this.forget(writes.map(write => write.table))
		return receipt
	}

	writeStatus(rowId: string): DeliveryStatus | undefined {
		return this.store.writeStatus?.(rowId)
	}

	followedWrites(): FollowedWrite[] {
		return this.store.followedWrites?.() ?? []
	}

	reach(): Reach | undefined {
		return this.store.reach?.()
	}

	acknowledge(rowId: string): void {
		this.store.acknowledge?.(rowId)
	}

	onDelivery(listener: () => void): Unsubscribe {
		return this.store.onDelivery?.(() => {
			// A refused write's rows have left the view: nothing read before it stands.
			this.forget()
			listener()
		}) ?? (() => {})
	}

	subscribe(listener: (tables: readonly string[]) => void): Unsubscribe {
		return this.store.subscribe(tables => {
			// Before the listener, which is likely to read straight away.
			this.forget(tables)
			listener(tables)
		})
	}

	close(): Promise<void> {
		this.listening?.()
		this.listening = undefined
		this.forget()
		return this.store.close()
	}

	/**
	 * Drop held results: those over any of `changed`, and those whose tables are not known -- or,
	 * with no tables named, every one. The next read of what was dropped goes to the store.
	 */
	forget(changed?: readonly string[]): void {
		if (!changed) {
			this.results.clear()
			return
		}
		const touched = new Set(changed.map(tableKey))
		for (const [key, entry] of this.results) {
			if (!entry.tables || [...entry.tables].some(table => touched.has(table))) this.results.delete(key)
		}
	}

	/** The tables `sql` reads, by `tableKey`, once per statement; `undefined` where the store cannot say. */
	private tablesFor(sql: string): Promise<ReadonlySet<string> | undefined> {
		let tables = this.tablesOf.get(sql)
		if (!tables) {
			const read = this.store.tablesRead?.(sql)
			tables = read
				? read.then(
						names => new Set(names.map(tableKey)),
						(error: unknown) => {
							// The read itself reports a statement that will not plan; here it only costs caching.
							console.warn('taleus-core: could not tell which tables a read uses:', error)
							return undefined
						},
					)
				: Promise.resolve(undefined)
			this.tablesOf.set(sql, tables)
		}
		return tables
	}
}

/** A table's name for comparison: without its schema (`App.Ledger` and `Ledger` are one), any case. */
function tableKey(name: string): string {
	return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}
