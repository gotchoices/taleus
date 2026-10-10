import type { RowWrite } from '../store/strand.js'
import type { TallyStore, Unsubscribe } from './types.js'

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
 * counterparty's replicated commit counts too. A change that raises no notification -- the case the
 * cadre store's backstop poll exists for -- is bounded by `maxAgeMs`, after which a result is read
 * afresh. A failed read is not kept, so the next caller tries again.
 */
export class SharedReadStore implements TallyStore {
	private readonly results = new Map<string, { at: number; rows: Promise<unknown[]> }>()
	private listening: Unsubscribe | undefined

	constructor(
		private readonly store: TallyStore,
		private readonly maxAgeMs: number,
		private readonly now: () => number = Date.now,
	) {}

	query<T>(sql: string, params?: unknown[]): Promise<T[]> {
		this.listening ??= this.store.subscribe(() => this.forget())
		const key = params?.length ? `${sql}\u0000${JSON.stringify(params)}` : sql
		const held = this.results.get(key)
		if (held && this.now() - held.at < this.maxAgeMs) return held.rows as Promise<T[]>
		const rows = this.store.query<T>(sql, params)
		const entry = { at: this.now(), rows: rows as Promise<unknown[]> }
		this.results.set(key, entry)
		rows.catch(() => {
			if (this.results.get(key) === entry) this.results.delete(key)
		})
		return rows
	}

	async apply(writes: RowWrite[]): Promise<void> {
		try {
			await this.store.apply(writes)
		} finally {
			// Even a failed act may have committed part of itself, so nothing read before it stands.
			this.forget()
		}
	}

	subscribe(listener: (tables: readonly string[]) => void): Unsubscribe {
		return this.store.subscribe(tables => {
			// Before the listener, which is likely to read straight away.
			this.forget()
			listener(tables)
		})
	}

	close(): Promise<void> {
		this.listening?.()
		this.listening = undefined
		this.forget()
		return this.store.close()
	}

	/** Drop every held result: the next read of anything goes to the store. */
	forget(): void {
		this.results.clear()
	}
}
