/**
 * The single-row writes this device made on one tally's strand, by their act key (`actKey`), with
 * the transaction each committed or queued in -- so a store can say where one of this party's own
 * entries stands (`writeStatus`) after a restart as well as before it. The stack reports where a
 * transaction stands by its id (sereus `docs/strands.md`, "A commit's durability" and "Offline
 * mode"); only this device knows which of its rows that transaction wrote.
 *
 * Kept in a device-local slot the host supplies (a file in the CLI's party folder, a key in the
 * phone's session store), never in the strand: it is this device's own bookkeeping. A write is
 * dropped once it is delivered (remembered as delivered until the process ends, so the mark does
 * not vanish the moment it is reached), once its refusal is acknowledged, or once nothing can say
 * where it stands any more (a write committed in an earlier run, online). Without a slot it lives
 * in memory.
 */
import type { DurableSlot } from '@serfab/cadre-core'
import type { RowWrite } from 'taleus-core/host'

export interface LoggedWrite {
	transactionId: string
	write: RowWrite
}

export class WriteLog {
	/** Saves run one after another, so a later snapshot can never be overwritten by an earlier one. */
	private saving: Promise<void> = Promise.resolve()
	/** Rows delivered while this process ran: no longer kept, still reported. */
	private readonly settled = new Set<string>()

	private constructor(
		private readonly writes: Map<string, LoggedWrite>,
		private readonly slot: DurableSlot | undefined,
	) {}

	/** The log a slot holds, or an empty one. A slot that exists but cannot be read throws. */
	static async open(slot: DurableSlot | undefined): Promise<WriteLog> {
		const text = slot ? await slot.load() : undefined
		const entries = text ? (JSON.parse(text) as [string, LoggedWrite][]) : []
		return new WriteLog(new Map(entries), slot)
	}

	get(rowId: string): LoggedWrite | undefined {
		return this.writes.get(rowId)
	}

	entries(): [string, LoggedWrite][] {
		return [...this.writes]
	}

	/** Whether a transaction is one of this log's: what a store filters the stack's events by. */
	has(transactionId: string): boolean {
		for (const logged of this.writes.values()) if (logged.transactionId === transactionId) return true
		return false
	}

	record(rowId: string, logged: LoggedWrite): void {
		this.writes.set(rowId, logged)
		this.save()
	}

	delivered(rowId: string): boolean {
		return this.settled.has(rowId)
	}

	/** The row reached the counterparty: stop keeping it, but go on saying so this run. */
	settle(rowId: string): void {
		this.settled.add(rowId)
		this.forget(rowId)
	}

	forget(rowId: string): void {
		if (this.writes.delete(rowId)) this.save()
	}

	/**
	 * Durably replace the slot's text. Not awaited by the store: a lost save costs only a mark the
	 * next restart cannot show, never a write; it is logged so a failing slot is seen.
	 */
	private save(): void {
		const slot = this.slot
		if (!slot) return
		const text = JSON.stringify([...this.writes])
		this.saving = this.saving
			.then(() => slot.save(text))
			.catch((error: unknown) => {
				console.warn('taleus-sereus: could not save the write log', error)
			})
	}
}
