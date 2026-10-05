/**
 * A taleus-core `StoreProvider` over a running Sereus `CadreNode`: each tally is a closed
 * two-party strand carrying the Taleus sApp, persisted and replicated by Optimystic.
 *
 * Platform-neutral. The host builds and starts the node -- on a phone, `@serfab/cadre-rn`'s
 * `createPhoneNode`; in a Node test, a node over memory storage -- and hands it here. The node
 * is the app's own: every strand it holds is taken to be a tally.
 *
 * Joining is two layers. The inviter's store founds the strand and mints a Sereus invitation to
 * it, which travels as the ticket's `ref.address`; the invitee's store asks to join with it
 * (`requestJoin`, which the party keeps retrying, from any of its owner machines, until the
 * inviter's side answers) and attaches the strand. Taking a *seat* in the tally is the engine's
 * business, with the credential the ticket also carries.
 *
 * Every strand reaches this store the same way: cadre-core offers it as `strand:discovered` --
 * a strand this party joined, and after a restart every strand the node holds -- and the store
 * attaches it, once.
 */

import { generateStrandMemberKey, StrandAwaitingFirstSyncError } from '@serfab/cadre-core'
import type {
	CadreNode,
	PendingJoinStatus,
	SAppConfig,
	StrandFormationDisclosure,
	StrandInstance,
	StrandRow,
} from '@serfab/cadre-core'
import type { Database } from '@quereus/quereus'
import type { InvitationTicket, StoreProvider, TallyRef, TallyStore, Unsubscribe } from 'taleus-core'
import { tablesIn, transactionBatch, watchTables, type RowWrite } from 'taleus-core/host'

export interface CadreStoreOptions {
	/** The app's running node. */
	node: CadreNode
	/** The Taleus sApp: the tally schema, and the id and version it is published under. */
	sApp: SAppConfig
	/** What this party discloses to an inviter when it redeems an invitation. */
	disclosure?: StrandFormationDisclosure
	/** How long an invitation to a new tally's strand stays redeemable. Default 30 days. */
	invitationLifetimeMs?: number
	/**
	 * How long a joiner waits for its first sync before giving up. Default 240 s: a first sync
	 * that outlasts cadre-core's own budget is progress, not failure.
	 */
	firstSyncPatienceMs?: number
	/**
	 * How long `join` waits for the inviter's side to answer before failing. The party keeps
	 * asking after that, and the strand is attached when it arrives. Default 120 s.
	 */
	joinPatienceMs?: number
	/**
	 * A backstop: report every table as changed this often, in case a replicated commit raises
	 * no watch. Default 10 s; 0 turns it off.
	 */
	pollMs?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function cadreStoreProvider(options: CadreStoreOptions): StoreProvider {
	return new CadreStoreProvider(options)
}

class CadreStoreProvider implements StoreProvider {
	private readonly tables: readonly string[]
	/** Each strand's attach, started once and shared by everyone who waits for it. */
	private readonly attaching = new Map<string, Promise<StrandInstance>>()
	/** Callers waiting for a strand that has not been offered yet. */
	private readonly awaited = new Map<string, ((instance: Promise<StrandInstance>) => void)[]>()

	constructor(private readonly options: CadreStoreOptions) {
		this.tables = tablesIn(options.sApp.schema)
		// Subscribe, then drain what was offered before this store existed: a strand offered
		// between the two is attached once either way.
		options.node.on('strand:discovered', ({ strand }) => {
			void this.attach(strand).catch(err => console.warn(`taleus-model/cadre: attaching ${strand.Id} failed:`, err))
		})
		for (const strand of options.node.getDiscoveredStrands().values()) {
			void this.attach(strand).catch(err => console.warn(`taleus-model/cadre: attaching ${strand.Id} failed:`, err))
		}
	}

	async list(): Promise<TallyRef[]> {
		return [...this.options.node.getStrands().keys()].map(id => ({ id }))
	}

	async open(ref: TallyRef): Promise<TallyStore> {
		return this.storeFor(await this.whenAttached(ref.id))
	}

	/**
	 * Found the tally's strand with this party as its founder, then publish a single-use
	 * invitation to it. The node must be dialable (a relay reservation on a phone) for the
	 * invitation to be redeemable.
	 */
	async create(_request: { denomination: string }): Promise<{ ref: TallyRef; store: TallyStore }> {
		const { node, sApp } = this.options
		const strandId = `tally-${randomHex(16)}`
		const { instance } = await node.foundStrand({
			strandId,
			type: 'c',
			memberPrivateKey: await generateStrandMemberKey(),
			sAppConfig: sApp,
		})
		this.attaching.set(strandId, Promise.resolve(instance))
		console.warn('TMPDBG founded; creating invitation')
		const lifetimeMs = this.options.invitationLifetimeMs ?? 30 * DAY_MS
		const invitation = await node.createOpenInvitation(sApp.id, lifetimeMs)
		console.warn('TMPDBG invitation minted; publishing')
		await node.publishFormationInvite(invitation.token, sApp.id, {
			strandId,
			expiresAtMs: Date.now() + lifetimeMs,
			totalUses: 1,
		})
		console.warn('TMPDBG invitation published')
		return { ref: { id: strandId, address: node.encodeInvitation(invitation) }, store: this.storeFor(instance) }
	}

	/**
	 * Ask to join with the strand invitation the ticket carries, wait for the inviter's side to
	 * answer, then for the strand -- offered as `strand:discovered` -- to be attached.
	 */
	async join(ticket: InvitationTicket): Promise<{ ref: TallyRef; store: TallyStore }> {
		const { node } = this.options
		// Already joined -- an acceptance that failed after the strand arrived, now retried: the
		// strand invitation is spent, so asking again could only be refused.
		if (this.attaching.has(ticket.ref.id) || node.getStrands().has(ticket.ref.id)) {
			return { ref: { id: ticket.ref.id }, store: this.storeFor(await this.whenAttached(ticket.ref.id)) }
		}
		const address = ticket.ref.address
		if (!address) throw new Error(`the invitation to ${ticket.ref.id} carries no strand address to join it by`)
		const status = await this.joined(await node.requestJoin(node.decodeInvitation(address), this.options.disclosure))
		if (status.strandId !== ticket.ref.id) {
			throw new Error(`the strand invitation admitted to ${status.strandId ?? 'nothing'}, not the tally ${ticket.ref.id}`)
		}
		return { ref: { id: ticket.ref.id }, store: this.storeFor(await this.whenAttached(ticket.ref.id)) }
	}

	/** Follow a join request until it has joined, failing on a refusal or when patience runs out. */
	private joined(first: PendingJoinStatus): Promise<PendingJoinStatus> {
		const settled = (status: PendingJoinStatus) => status.state === 'joined' || status.state === 'failed'
		const refusal = (status: PendingJoinStatus) =>
			new Error(`the inviter refused the join: ${status.lastError?.reason ?? status.lastError?.code ?? 'no reason given'}`)
		if (first.state === 'joined') return Promise.resolve(first)
		if (first.state === 'failed') return Promise.reject(refusal(first))
		const patienceMs = this.options.joinPatienceMs ?? 120_000
		return new Promise<PendingJoinStatus>((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe()
				reject(new Error(`the inviter's side has not answered after ${patienceMs / 1000} s; this party keeps asking`))
			}, patienceMs)
			const unsubscribe = this.onPendingJoin(first.id, status => {
				if (!settled(status)) return
				clearTimeout(timer)
				unsubscribe()
				if (status.state === 'joined') resolve(status)
				else reject(refusal(status))
			})
		})
	}

	private onPendingJoin(id: string, listener: (status: PendingJoinStatus) => void): () => void {
		const handler = (status: PendingJoinStatus) => {
			if (status.id === id) listener(status)
		}
		this.options.node.on('pendingJoin:changed', handler)
		return () => this.options.node.off('pendingJoin:changed', handler)
	}

	/** Attach an offered strand, once; a strand the node already runs is taken as it is. */
	private attach(strand: StrandRow): Promise<StrandInstance> {
		let attaching = this.attaching.get(strand.Id)
		if (!attaching) {
			const running = this.options.node.getStrands().get(strand.Id)
			attaching = running?.database
				? Promise.resolve(running)
				: this.attachWhenWritable({ strandRow: strand, sAppConfig: this.options.sApp })
			this.attaching.set(strand.Id, attaching)
			// A failed attach may be offered again; let it start afresh.
			attaching.catch(() => this.attaching.delete(strand.Id))
		}
		for (const waiter of this.awaited.get(strand.Id) ?? []) waiter(attaching)
		this.awaited.delete(strand.Id)
		return attaching
	}

	/** The strand once attached: now, or when it is offered. */
	private whenAttached(id: string): Promise<StrandInstance> {
		const attaching = this.attaching.get(id)
		if (attaching) return attaching
		const running = this.options.node.getStrands().get(id)
		if (running?.database) return Promise.resolve(running)
		if (running) return this.options.node.whenStrandWritable(id, { timeoutMs: this.options.firstSyncPatienceMs ?? 240_000 })
		return new Promise<StrandInstance>(resolve => {
			const waiters = this.awaited.get(id) ?? []
			waiters.push(instance => resolve(instance))
			this.awaited.set(id, waiters)
		})
	}

	/**
	 * `addStrand`, then keep waiting when the first sync outlasts its budget:
	 * `StrandAwaitingFirstSyncError` leaves the strand launched and syncing.
	 */
	private async attachWhenWritable(config: Parameters<CadreNode['addStrand']>[0]): Promise<StrandInstance> {
		const patience = { timeoutMs: this.options.firstSyncPatienceMs ?? 240_000 }
		try {
			const instance = await this.options.node.addStrand(config)
			// A strand the node already runs comes back as it is -- still syncing, after a restart.
			return instance.database ? instance : await this.options.node.whenStrandWritable(config.strandRow.Id, patience)
		} catch (err) {
			if (!(err instanceof StrandAwaitingFirstSyncError)) throw err
			return await this.options.node.whenStrandWritable(config.strandRow.Id, patience)
		}
	}

	private storeFor(instance: StrandInstance): TallyStore {
		return new CadreTallyStore(
			this.options.node,
			instance.strandId,
			this.tables,
			this.options.pollMs ?? 10_000,
			this.options.firstSyncPatienceMs ?? 240_000,
		)
	}
}

/**
 * A commit the strand's cohort did not approve in time: transient, and it committed nothing.
 * The first writes after a node restarts alone hit it (sereus 1.9 notes), and so does a joiner's
 * first write while its membership is still reaching the founder's machine.
 *
 * NOTE: matched on the message, because Optimystic throws a plain `Error` here. If it gains a
 * typed error, match on that instead -- a reworded message would silently stop the retries.
 */
function lackedSuperMajority(error: unknown): boolean {
	return /Failed to get super-majority/i.test(error instanceof Error ? error.message : String(error))
}

const WRITE_ATTEMPTS = 5
const WRITE_RETRY_MS = 3_000

/**
 * One tally's strand, read and written through whatever database the node holds for it now.
 * cadre-core replaces a strand's database when it restarts the strand (a first sync finishing,
 * a wake from hibernation) and closes the old one, so a handle that kept the first would read a
 * closed database ever after.
 */
class CadreTallyStore implements TallyStore {
	constructor(
		private readonly node: CadreNode,
		private readonly strandId: string,
		private readonly tables: readonly string[],
		private readonly pollMs: number,
		private readonly patienceMs: number,
	) {}

	/** The strand's current database, waiting for one while the strand is syncing. */
	private async db(): Promise<Database> {
		const current = this.node.getStrands().get(this.strandId)?.database
		if (current) return current.getDatabase()
		const instance = await this.node.whenStrandWritable(this.strandId, { timeoutMs: this.patienceMs })
		if (!instance.database) throw new Error(`strand ${this.strandId} is not writable`)
		return instance.database.getDatabase()
	}

	async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
		const db = await this.db()
		const collected: T[] = []
		const t = Date.now()
		for await (const row of db.eval(sql, params as never)) collected.push(row as T)
		const ms = Date.now() - t; if (ms > 500) console.warn(`TMPDBG slow query ${ms}ms: ${sql.slice(0, 80)}`)
		return collected
	}

	/**
	 * One act, as one strand transaction. NOTE: each table is its own Optimystic collection, so
	 * a transaction across tables can commit some and not others
	 * (`CoordinatorPartialCommitError`). The engine mints its keys once and reads before it
	 * re-writes, so a retry after one does not double a row; the half that stood is visible.
	 */
	async apply(writes: RowWrite[]): Promise<void> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.applyOnce(writes)
			} catch (error) {
				if (!lackedSuperMajority(error) || attempt >= WRITE_ATTEMPTS) throw error
				console.warn(`taleus-model/cadre: write attempt ${attempt} lacked a super-majority; retrying`)
				await new Promise<void>(resolve => setTimeout(() => resolve(), WRITE_RETRY_MS))
			}
		}
	}

	private async applyOnce(writes: RowWrite[]): Promise<void> {
		const db = await this.db()
		const { sql, params } = transactionBatch(writes)
		const t = Date.now(); console.warn(`TMPDBG apply ${writes.map(w => w.table).join(',')}`)
		await db.exec(sql, params as never, { transaction: true })
		console.warn(`TMPDBG apply done ${Date.now() - t}ms`)
	}

	/**
	 * Post-commit watchers -- for this party's commits and, through Optimystic's change
	 * notifier, for the counterparty's once they reach this node -- plus the backstop poll.
	 */
	subscribe(listener: (tables: readonly string[]) => void): Unsubscribe {
		// Watch the strand's database now, and again on each database the node opens for it later.
		let unwatch: (() => void) | undefined
		const watchCurrent = () => {
			unwatch?.()
			const database = this.node.getStrands().get(this.strandId)?.database
			unwatch = database ? watchTables(database.getDatabase(), this.tables, listener) : undefined
		}
		const onWritable = ({ strandId }: { strandId: string }) => {
			if (strandId !== this.strandId) return
			watchCurrent()
			listener(this.tables)
		}
		watchCurrent()
		this.node.on('strand:writable', onWritable)
		const timer = this.pollMs > 0 ? setInterval(() => listener(this.tables), this.pollMs) : undefined
		return () => {
			unwatch?.()
			this.node.off('strand:writable', onWritable)
			if (timer) clearInterval(timer)
		}
	}

	async close(): Promise<void> {
		// The strand belongs to the node, which keeps running it; a handle holds nothing of its own.
	}
}

function randomHex(bytes: number): string {
	const buffer = new Uint8Array(bytes)
	crypto.getRandomValues(buffer)
	return [...buffer].map(b => b.toString(16).padStart(2, '0')).join('')
}
