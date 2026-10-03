/**
 * A taleus-core `StoreProvider` over a running Sereus `CadreNode`: each tally is a closed
 * two-party strand carrying the Taleus sApp, persisted and replicated by Optimystic.
 *
 * Platform-neutral. The host builds and starts the node -- on a phone, `@serfab/cadre-rn`'s
 * `createPhoneNode`; in a Node test, a node over memory storage -- and hands it here. The node
 * is the app's own: every strand it holds is taken to be a tally.
 *
 * Joining is two layers. The inviter's store founds the strand and mints a Sereus invitation to
 * it, which travels as the ticket's `ref.address`; the invitee's store redeems that invitation
 * (`formStrand`) and attaches the strand. Taking a *seat* in the tally is the engine's business,
 * with the credential the ticket also carries.
 */

import { generateStrandMemberKey, StrandAwaitingFirstSyncError } from '@serfab/cadre-core'
import type { CadreNode, SAppConfig, StrandFormationDisclosure, StrandInstance } from '@serfab/cadre-core'
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

	constructor(private readonly options: CadreStoreOptions) {
		this.tables = tablesIn(options.sApp.schema)
	}

	async list(): Promise<TallyRef[]> {
		return [...this.options.node.getStrands().keys()].map(id => ({ id }))
	}

	async open(ref: TallyRef): Promise<TallyStore> {
		return this.storeFor(this.instance(ref.id))
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
		const lifetimeMs = this.options.invitationLifetimeMs ?? 30 * DAY_MS
		const invitation = await node.createOpenInvitation(sApp.id, lifetimeMs)
		await node.publishFormationInvite(invitation.token, sApp.id, {
			strandId,
			expiresAtMs: Date.now() + lifetimeMs,
			totalUses: 1,
		})
		return { ref: { id: strandId, address: node.encodeInvitation(invitation) }, store: this.storeFor(instance) }
	}

	/** Redeem the strand invitation the ticket carries, then attach the strand once it has synced. */
	async join(ticket: InvitationTicket): Promise<{ ref: TallyRef; store: TallyStore }> {
		const { node, sApp } = this.options
		const address = ticket.ref.address
		if (!address) throw new Error(`the invitation to ${ticket.ref.id} carries no strand address to join it by`)
		const formed = await node.formStrand(node.decodeInvitation(address), this.options.disclosure)
		if (formed.strandId !== ticket.ref.id) {
			throw new Error(`the strand invitation admits to ${formed.strandId}, not the tally ${ticket.ref.id}`)
		}
		const instance = await this.attachWhenWritable({
			strandRow: { Id: formed.strandId, MemberPrivateKey: formed.memberPrivateKey ?? null, Type: 'c', FounderOwnerKey: null },
			sAppConfig: sApp,
		})
		return { ref: { id: formed.strandId }, store: this.storeFor(instance) }
	}

	/**
	 * `addStrand`, then keep waiting when the first sync outlasts its budget:
	 * `StrandAwaitingFirstSyncError` leaves the strand launched and syncing.
	 */
	private async attachWhenWritable(config: Parameters<CadreNode['addStrand']>[0]): Promise<StrandInstance> {
		try {
			return await this.options.node.addStrand(config)
		} catch (err) {
			if (!(err instanceof StrandAwaitingFirstSyncError)) throw err
			return await this.options.node.whenStrandWritable(config.strandRow.Id, {
				timeoutMs: this.options.firstSyncPatienceMs ?? 240_000,
			})
		}
	}

	private instance(id: string): StrandInstance {
		const instance = this.options.node.getStrands().get(id)
		if (!instance) throw new Error(`this node holds no strand ${id}`)
		return instance
	}

	private storeFor(instance: StrandInstance): TallyStore {
		const database = instance.database
		if (!database) throw new Error(`strand ${instance.strandId} is not writable yet`)
		return new CadreTallyStore(database.getDatabase(), this.tables, this.options.pollMs ?? 10_000)
	}
}

class CadreTallyStore implements TallyStore {
	constructor(
		private readonly db: Database,
		private readonly tables: readonly string[],
		private readonly pollMs: number,
	) {}

	async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
		const collected: T[] = []
		for await (const row of this.db.eval(sql, params as never)) collected.push(row as T)
		return collected
	}

	/**
	 * One act, as one strand transaction. NOTE: each table is its own Optimystic collection, so
	 * a transaction across tables can commit some and not others
	 * (`CoordinatorPartialCommitError`). The engine mints its keys once and reads before it
	 * re-writes, so a retry after one does not double a row; the half that stood is visible.
	 */
	async apply(writes: RowWrite[]): Promise<void> {
		const { sql, params } = transactionBatch(writes)
		await this.db.exec(sql, params as never, { transaction: true })
	}

	/**
	 * Post-commit watchers -- for this party's commits and, through Optimystic's change
	 * notifier, for the counterparty's once they reach this node -- plus the backstop poll.
	 */
	subscribe(listener: (tables: readonly string[]) => void): Unsubscribe {
		const unwatch = watchTables(this.db, this.tables, listener)
		const timer = this.pollMs > 0 ? setInterval(() => listener(this.tables), this.pollMs) : undefined
		return () => {
			unwatch()
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
