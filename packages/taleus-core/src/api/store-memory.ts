import type { Database } from '@quereus/quereus'

import {
	insertStatement,
	openStrandFrom,
	row,
	rows,
	statementsOf,
	stripComments,
	type RowWrite,
} from '../store/strand.js'
import type { InvitationTicket, StoreProvider, TallyRef, TallyStore, Unsubscribe } from './types.js'

/**
 * An in-memory strand fabric: several parties, each holding their own replica, with every act
 * proposed to all of them.
 *
 * This is the **test host** `SPEC.md` names as a first-class consumer, and it is the thing that
 * lets the API be exercised end to end before the Sereus adapter exists. It models the property
 * that matters -- every replica re-validates every write, and an act stands only if all of them
 * accept -- and deliberately does not model Optimystic's ordering under concurrency: replicas
 * here are applied in sequence, never raced.
 *
 * Platform-neutral: the schema arrives as text, because a phone bundles it, a browser fetches
 * it, and only a Node host reads it off a disk (`SPEC.md` § 3).
 */

/** A member's replica of one strand. */
interface Replica {
	member: string
	db: Database
}

class Strand {
	readonly replicas: Replica[] = []
	/**
	 * Every act that stood, in order. A replica that joins late replays it -- which is not an
	 * optimisation but a requirement: the invitee's own seating validates against the inviter's
	 * `InvitationKey`, so a fresh database would refuse the very act that admits it.
	 */
	readonly log: RowWrite[][] = []
	constructor(readonly id: string) {}
}

/** One replica refused an act the others accepted. The two copies now hold different facts. */
export class DisagreementError extends Error {
	constructor(
		readonly accepted: string[],
		readonly rejected: { member: string; message: string }[],
	) {
		super(
			`replicas disagreed: ${accepted.join(', ') || 'none'} accepted, ` +
				rejected.map(r => `${r.member} refused (${r.message})`).join('; '),
		)
		this.name = 'DisagreementError'
	}
}

export class MemoryFabric {
	private readonly strands = new Map<string, Strand>()
	private nextId = 1

	/** Every base table in the schema -- the scope a replica's watcher registers over. */
	private readonly tables: string[]

	constructor(private readonly schema: string) {
		this.tables = tablesIn(schema)
	}

	tableNames(): readonly string[] {
		return this.tables
	}

	/** A store provider acting as one member. Each gets its own replica of any strand it joins. */
	provider(member: string): StoreProvider {
		return new MemoryStoreProvider(this, member)
	}

	/* ── internals, used by the provider and store below ─────────────────── */

	async createStrand(member: string): Promise<{ strand: Strand; replica: Replica }> {
		const strand = new Strand(`strand-${this.nextId++}`)
		this.strands.set(strand.id, strand)
		return { strand, replica: await this.addReplica(strand, member) }
	}

	async addReplica(strand: Strand, member: string): Promise<Replica> {
		const existing = strand.replicas.find(r => r.member === member)
		if (existing) return existing
		const replica: Replica = { member, db: await openStrandFrom(this.schema) }
		// Catch up on everything written before this member arrived, act by act, each in its own
		// transaction -- the same shape they were committed in. A real strand syncs a joining
		// member the same way; here it is a replay of the log.
		for (const act of strand.log) {
			await applyTo(replica.db, act)
		}
		strand.replicas.push(replica)
		return replica
	}

	/**
	 * Write to ONE member's replica, bypassing the others.
	 *
	 * A test affordance, and an honest one: it manufactures the state a party's own node has
	 * admitted while the counterparty's has not. Nothing an engine does can reach it -- `apply`
	 * always proposes to everyone -- which is exactly why a `disagreement` needs it to be
	 * reachable at all.
	 */
	async divergeOn(member: string, ref: TallyRef, writes: RowWrite[]): Promise<void> {
		const strand = this.strandOf(ref)
		const replica = strand.replicas.find(r => r.member === member)
		if (!replica) throw new Error(`${member} holds no replica of ${ref.id}`)
		await applyTo(replica.db, writes)
	}

	strandOf(ref: TallyRef): Strand {
		const strand = this.strands.get(ref.id)
		if (!strand) throw new Error(`no strand ${ref.id}`)
		return strand
	}

	strandsHolding(member: string): TallyRef[] {
		return [...this.strands.values()]
			.filter(s => s.replicas.some(r => r.member === member))
			.map(s => ({ id: s.id }))
	}

}

class MemoryStoreProvider implements StoreProvider {
	constructor(
		private readonly fabric: MemoryFabric,
		private readonly member: string,
	) {}

	async list(): Promise<TallyRef[]> {
		return this.fabric.strandsHolding(this.member)
	}

	async open(ref: TallyRef): Promise<TallyStore> {
		const strand = this.fabric.strandOf(ref)
		const replica = strand.replicas.find(r => r.member === this.member)
		if (!replica) throw new Error(`${this.member} holds no replica of ${ref.id}`)
		return new MemoryTallyStore(strand, replica, this.fabric.tableNames())
	}

	async create(): Promise<{ ref: TallyRef; store: TallyStore }> {
		const { strand, replica } = await this.fabric.createStrand(this.member)
		return {
			ref: { id: strand.id },
			store: new MemoryTallyStore(strand, replica, this.fabric.tableNames()),
		}
	}

	async join(ticket: InvitationTicket): Promise<{ ref: TallyRef; store: TallyStore }> {
		// The ticket names its strand; what else it carries is the engine's business.
		const strand = this.fabric.strandOf(ticket.ref)
		const replica = await this.fabric.addReplica(strand, this.member)
		return {
			ref: { id: strand.id },
			store: new MemoryTallyStore(strand, replica, this.fabric.tableNames()),
		}
	}
}

class MemoryTallyStore implements TallyStore {
	constructor(
		private readonly strand: Strand,
		private readonly replica: Replica,
		private readonly tables: readonly string[],
	) {}

	async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
		return rows<T>(this.replica.db, sql, params)
	}

	/**
	 * Propose one act to every replica. It stands only if all of them accept.
	 *
	 * Several rows per act is not a convenience: seating a party is circular by construction,
	 * and only a transaction whose subquery CHECKs defer to COMMIT can do it at all.
	 */
	async apply(writes: RowWrite[]): Promise<void> {
		const accepted: string[] = []
		const rejected: { member: string; message: string }[] = []
		for (const replica of this.strand.replicas) {
			try {
				await applyTo(replica.db, writes)
				accepted.push(replica.member)
			} catch (error) {
				rejected.push({ member: replica.member, message: messageOf(error) })
			}
		}
		if (rejected.length > 0 && accepted.length > 0) {
			throw new DisagreementError(accepted, rejected)
		}
		if (rejected.length > 0) {
			throw new Error(rejected[0].message)
		}
		this.strand.log.push(writes)
	}

	/**
	 * Quereus's own post-commit watchers, on this member's replica.
	 *
	 * Deliberately not a callback the fabric fans out itself: firing through `Database.watch`
	 * is the path a Sereus-backed store will take too, so what is exercised here is what will
	 * ship. The only piece that differs is where the commit comes from -- locally today,
	 * locally *or* from a peer once the replication path calls `notifyExternalTableChange`.
	 */
	subscribe(listener: (tables: readonly string[]) => void): Unsubscribe {
		const subscription = this.replica.db.watch(
			{
				watches: this.tables.map(table => ({
					table: { schema: 'main', table },
					columns: 'all' as const,
					scope: { kind: 'full' as const },
				})),
				nonDeterministicSources: [],
				unboundParameters: [],
			},
			event => {
				listener(event.matched.map(m => m.watch.table.table))
			},
		)
		return () => subscription.unsubscribe()
	}

	async close(): Promise<void> {
		// Replicas outlive any one handle: another party is still holding this strand.
	}
}

async function applyTo(db: Database, writes: RowWrite[]): Promise<void> {
	await db.exec('begin')
	try {
		for (const write of writes) {
			const { sql, params } = insertStatement(write)
			await db.exec(sql, params as never)
		}
		await db.exec('commit')
	} catch (error) {
		await db.exec('rollback')
		throw error
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * The schema's base tables, read from the DDL rather than listed by hand -- a table added to
 * the schema and forgotten here would be a watch that silently never fires.
 */
function tablesIn(schema: string): string[] {
	const names: string[] = []
	for (const statement of statementsOf(stripComments(schema))) {
		const match = /^\s*create\s+table\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(statement)
		if (match) names.push(match[1])
	}
	return names
}

/** Read one row, or undefined. Re-exported so the engine need not reach into `src/store/`. */
export const oneRow = row
