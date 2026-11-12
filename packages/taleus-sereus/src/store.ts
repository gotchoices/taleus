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

import { describeThrown, generateStrandMemberKey, StrandAwaitingFirstSyncError } from '@serfab/cadre-core'
import { decodeStrandAddress, encodeStrandAddress } from './address.js'
import { WriteLog } from './write-log.js'
import type {
	CadreNode,
	PendingJoinStatus,
	SAppConfig,
	DurableSlot,
	StrandDatabase,
	StrandFormationDisclosure,
	StrandInstance,
	StrandRow,
} from '@serfab/cadre-core'
import type { Database } from '@quereus/quereus'
import type { DeliveryStatus, FollowedWrite, InvitationTicket, StoreProvider, TallyRef, TallyStore, Unsubscribe, WriteReceipt } from 'taleus-core'
import { actKey, insertReturningTransaction, tablesIn, tablesReadBy, transactionBatch, watchTables, type RowWrite } from 'taleus-core/host'

/**
 * What the store asks of the app's running node: these methods of `CadreNode`, and nothing else.
 * Named rather than the whole class, so a host on a neighbouring cadre-core release -- a class
 * type never matches across two copies of a package -- can still hand its node in.
 */
export type StrandNode = Pick<
	CadreNode,
	| 'addStrand'
	| 'createOpenInvitation'
	| 'foundStrand'
	| 'getDiscoveredStrands'
	| 'getStrands'
	| 'off'
	| 'on'
	| 'publishFormationInvite'
	| 'requestJoin'
	| 'wakeStrand'
	| 'whenStrandWritable'
>

export interface CadreStoreOptions {
	/** The app's running node. */
	node: StrandNode
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
	 * no watch. Each report re-reads everything, and every read of a strand may consult the
	 * partner (optimystic#56), so it is rare: the watch carries the counterparty's commits, and
	 * the scenarios pass with it off, online and offline. Default 10 min; 0 turns it off.
	 */
	pollMs?: number
	/**
	 * Where this device keeps its log of its own writes to one tally (`write-log.ts`), so a write's
	 * mark survives a restart: a device-local slot per strand id. Absent, the log lives in memory.
	 */
	writeLog?: (strandId: string) => DurableSlot
	/** Diagnostics: told of every statement this provider's stores run, once it finishes. */
	onStatement?: (statement: StatementTiming) => void
}

/** One statement a store ran, and how long it took. */
export interface StatementTiming {
	strandId: string
	sql: string
	kind: 'read' | 'write'
	ranMs: number
	rows: number
	failed?: true
}

const DAY_MS = 24 * 60 * 60 * 1000

export function cadreStoreProvider(options: CadreStoreOptions): StoreProvider {
	return new CadreStoreProvider(options)
}

class CadreStoreProvider implements StoreProvider {
	private readonly tables: readonly string[]
	/** Each strand's attach, started once and shared by everyone who waits for it. */
	private readonly attaching = new Map<string, Promise<StrandInstance>>()
	/** One write log per strand, shared by every store opened on it, so no store saves over another's. */
	private readonly logs = new Map<string, Promise<WriteLog>>()
	/** Callers waiting for a strand that has not been offered yet. */
	private readonly awaited = new Map<string, ((instance: Promise<StrandInstance>) => void)[]>()

	constructor(private readonly options: CadreStoreOptions) {
		this.tables = tablesIn(options.sApp.schema)
		// Subscribe, then drain what was offered before this store existed: a strand offered
		// between the two is attached once either way.
		options.node.on('strand:discovered', ({ strand }) => {
			void this.attach(strand).catch(err => console.warn(`taleus-sereus: attaching ${strand.Id} failed:`, err))
		})
		for (const strand of options.node.getDiscoveredStrands().values()) {
			void this.attach(strand).catch(err => console.warn(`taleus-sereus: attaching ${strand.Id} failed:`, err))
		}
	}

	list(): Promise<TallyRef[]> {
		const strands = [...this.options.node.getStrands().values()]
		return Promise.resolve(strands.filter(readable).map(strand => ({ id: strand.strandId })))
	}

	async open(ref: TallyRef): Promise<TallyStore> {
		return await this.storeFor(await this.whenAttached(ref.id))
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
		const lifetimeMs = this.options.invitationLifetimeMs ?? 30 * DAY_MS
		const invitation = await node.createOpenInvitation(sApp.id, lifetimeMs)
		await node.publishFormationInvite(invitation.token, sApp.id, {
			strandId,
			expiresAtMs: Date.now() + lifetimeMs,
			totalUses: 1,
		})
		return { ref: { id: strandId, address: encodeStrandAddress(invitation) }, store: await this.storeFor(instance) }
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
			return { ref: { id: ticket.ref.id }, store: await this.storeFor(await this.whenAttached(ticket.ref.id)) }
		}
		const address = ticket.ref.address
		if (!address) throw new Error(`the invitation to ${ticket.ref.id} carries no strand address to join it by`)
		const status = await this.joined(await node.requestJoin(decodeStrandAddress(address, this.options.sApp.id), this.options.disclosure))
		if (status.strandId !== ticket.ref.id) {
			throw new Error(`the strand invitation admitted to ${status.strandId ?? 'nothing'}, not the tally ${ticket.ref.id}`)
		}
		return { ref: { id: ticket.ref.id }, store: await this.storeFor(await this.whenAttached(ticket.ref.id)) }
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
		if (running) return awake(this.options.node, id, this.options.firstSyncPatienceMs ?? 240_000)
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
	private async attachWhenWritable(config: Parameters<StrandNode['addStrand']>[0]): Promise<StrandInstance> {
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

	private async storeFor(instance: StrandInstance): Promise<TallyStore> {
		return new CadreTallyStore(
			this.options.node,
			instance.strandId,
			this.tables,
			this.options.pollMs ?? 600_000,
			this.options.firstSyncPatienceMs ?? 240_000,
			await this.logFor(instance.strandId),
			this.options.onStatement,
		)
	}

	private logFor(strandId: string): Promise<WriteLog> {
		let log = this.logs.get(strandId)
		if (!log) {
			log = WriteLog.open(this.options.writeLog?.(strandId))
			// A slot that could not be read is tried again by the next store, not remembered.
			log.catch(() => this.logs.delete(strandId))
			this.logs.set(strandId, log)
		}
		return log
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
	return /Failed to get super-majority/i.test(describeThrown(error))
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
		private readonly node: StrandNode,
		private readonly strandId: string,
		private readonly tables: readonly string[],
		private readonly pollMs: number,
		private readonly patienceMs: number,
		private readonly log: WriteLog,
		private readonly onStatement?: (statement: StatementTiming) => void,
	) {}

	/** Run one statement, timing it for `onStatement` when there is one. */
	private async timed<T>(sql: string, kind: StatementTiming['kind'], run: () => Promise<{ value: T; rows: number }>): Promise<T> {
		const report = this.onStatement
		if (!report) return (await run()).value
		const started = Date.now()
		try {
			const { value, rows } = await run()
			report({ strandId: this.strandId, sql, kind, ranMs: Date.now() - started, rows })
			return value
		} catch (error) {
			report({ strandId: this.strandId, sql, kind, ranMs: Date.now() - started, rows: 0, failed: true })
			throw error
		}
	}

	/** The strand's current database, waiting for one while the strand is syncing. */
	private async db(): Promise<Database> {
		const current = this.node.getStrands().get(this.strandId)?.database
		if (current) return current.getDatabase()
		const instance = await awake(this.node, this.strandId, this.patienceMs)
		if (!instance.database) throw new Error(`strand ${this.strandId} is not writable`)
		return instance.database.getDatabase()
	}

	/** What `sql` reads, as Quereus plans it -- planning only. */
	async tablesRead(sql: string): Promise<readonly string[]> {
		return await tablesReadBy(await this.db(), sql)
	}

	async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
		const db = await this.db()
		return await this.timed(sql, 'read', async () => {
			const collected: T[] = []
			for await (const row of db.eval(sql, params as never)) collected.push(row as T)
			return { value: collected, rows: collected.length }
		})
	}

	/**
	 * One act, as one strand transaction. NOTE: each table is its own Optimystic collection, so
	 * a transaction across tables can commit some and not others
	 * (`CoordinatorPartialCommitError`). The engine mints its keys once and reads before it
	 * re-writes, so a retry after one does not double a row; the half that stood is visible.
	 */
	async apply(writes: RowWrite[]): Promise<WriteReceipt> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.applyOnce(writes)
			} catch (error) {
				if (!lackedSuperMajority(error) || attempt >= WRITE_ATTEMPTS) throw error
				console.warn(`taleus-sereus: write attempt ${attempt} lacked a super-majority; retrying: ${describeThrown(error)}`)
				await new Promise<void>(resolve => setTimeout(() => resolve(), WRITE_RETRY_MS))
			}
		}
	}

	/**
	 * A single-row write runs as one statement returning its transaction's id, which is what the
	 * stack reports its durability under (`delivery`). A write of several rows runs as one
	 * transaction and names none: no act that needs a delivery mark writes more than one row.
	 */
	private async applyOnce(writes: RowWrite[]): Promise<WriteReceipt> {
		const db = await this.db()
		const label = writes.map(write => `insert ${write.table}`).join('; ')
		return await this.timed(label, 'write', async () => ({ value: await this.write(db, writes), rows: writes.length }))
	}

	private async write(db: Database, writes: RowWrite[]): Promise<WriteReceipt> {
		if (writes.length === 1) {
			const { sql, params } = insertReturningTransaction(writes[0])
			let transactionId: string | undefined
			for await (const row of db.eval(sql, params as never)) transactionId ??= typeof row.Tx === 'string' ? row.Tx : undefined
			// Followed by its act key -- a chit, a request, a decline, a close request alike.
			const key = actKey(writes[0])
			if (transactionId && key) this.log.record(key, { transactionId, write: writes[0] })
			return transactionId ? { transactionId } : {}
		}
		const { sql, params } = transactionBatch(writes)
		await db.exec(sql, params as never, { transaction: true })
		return {}
	}

	/**
	 * Where a single-row write this device made stands, while it is followed. In offline mode the
	 * queue says first -- waiting, sending, refused -- and once committed, the commit's durability
	 * (sereus `docs/strands.md`, "Offline mode" and "A commit's durability"): held by another
	 * member, held here and followed until it is, or held here with nothing to report its arrival.
	 * A write delivered, or one nothing can account for any more (committed in an earlier run, online),
	 * stops being followed; a refusal stays until it is acknowledged.
	 */
	writeStatus(key: string): DeliveryStatus | undefined {
		if (this.log.delivered(key)) return { state: 'delivered' }
		const logged = this.log.get(key)
		if (!logged) return undefined
		const database = this.node.getStrands().get(this.strandId)?.database
		// Not running yet (a restart, before its first sync): nothing to judge by, so keep it.
		if (!database) return undefined
		const status = statusOf(database, logged.transactionId)
		if (status?.state === 'delivered') this.log.settle(key)
		else if (!status) this.log.forget(key)
		return status
	}

	followedWrites(): FollowedWrite[] {
		const followed: FollowedWrite[] = []
		for (const [key, logged] of this.log.entries()) {
			const status = this.writeStatus(key)
			if (status) followed.push({ write: logged.write, status })
		}
		return followed
	}

	/** The party has seen a refusal: forget it here, and in the queue's retained outcomes. */
	acknowledge(key: string): void {
		const logged = this.log.get(key)
		if (!logged) return
		const queue = this.node.getStrands().get(this.strandId)?.database?.offline
		if (queue?.status(logged.transactionId)?.kind === 'failed') queue.acknowledge(logged.transactionId)
		this.log.forget(key)
	}

	/** The queue's statuses, and `strand:commit-held` once every member holds a followed commit. */
	onDelivery(listener: () => void): Unsubscribe {
		const mine = ({ strandId, transactionId }: { strandId: string; transactionId: string }) =>
			strandId === this.strandId && this.log.has(transactionId)
		const held = (event: { strandId: string; transactionId: string }) => {
			if (mine(event)) listener()
		}
		const queued = ({ strandId, status }: { strandId: string; status: { transactionId: string } }) => {
			if (mine({ strandId, transactionId: status.transactionId })) listener()
		}
		this.node.on('strand:commit-held', held)
		this.node.on('strand:offline-status', queued)
		return () => {
			this.node.off('strand:commit-held', held)
			this.node.off('strand:offline-status', queued)
		}
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

/**
 * A strand this party can read now: running with its database, or hibernating -- the node
 * quiesces strands while the app is in the background, and one woken holds everything it held.
 * A strand still on its first sync is left out (`StoreProvider.list`).
 */
function readable(strand: StrandInstance): boolean {
	return Boolean(strand.database) || strand.status === 'hibernating'
}

/**
 * The strand, writable: woken first if it is hibernating, since waiting does not wake one
 * (`CadreNode.whenStrandWritable`), and a hibernated tally would otherwise wait out its patience.
 */
async function awake(node: StrandNode, strandId: string, timeoutMs: number): Promise<StrandInstance> {
	if (node.getStrands().get(strandId)?.status === 'hibernating') await node.wakeStrand(strandId)
	return node.whenStrandWritable(strandId, { timeoutMs })
}

function randomHex(bytes: number): string {
	const buffer = new Uint8Array(bytes)
	crypto.getRandomValues(buffer)
	return [...buffer].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Where one transaction stands, from the strand database's queue and its commit reports. */
function statusOf(database: StrandDatabase, transactionId: string): DeliveryStatus | undefined {
	const queued = database.offline?.status(transactionId)
	switch (queued?.kind) {
		case 'queued':
			return { state: 'waiting', ...(queued.outlook?.kind === 'exposed' ? { mayFail: true as const } : {}) }
		case 'outlook-changed':
			return { state: 'waiting', ...(queued.outlook.kind === 'exposed' ? { mayFail: true as const } : {}) }
		case 'submitting':
		case 'partially-committed':
			return { state: 'sending' }
		case 'failed':
			return { state: 'not-recorded', reason: queued.reason }
		default:
			break
	}
	const durability = database.commitDurability(transactionId)
	if (durability) {
		if (durability.heldElsewhere) return { state: 'delivered' }
		return { state: durability.followed ? 'here-only' : 'unconfirmed' }
	}
	// Sent and committed, but no longer in the database's last 256 reports.
	return queued?.kind === 'committed' ? { state: 'unconfirmed' } : undefined
}
