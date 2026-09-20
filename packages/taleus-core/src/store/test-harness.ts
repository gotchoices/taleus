import type { Database } from '@quereus/quereus'

import { newKey, sidFor, type KeyPairText } from './identity.js'
import { openStrand } from './schema-node.js'
import { insertStatement, row, rows, type RowWrite, type SchemaName } from './strand.js'

/**
 * Two parties, each holding their own replica of the same strand. **Test machinery** --
 * `test-harness.ts` is excluded from the build (`tsconfig.build.json`), which is what keeps
 * `node:fs` out of the shipped core, since this is the only thing that reads a schema file.
 *
 * Two parties, each holding their own replica of the same strand.
 *
 * This is the shape the real system has and the shape the tests need. A tally is not one
 * database somebody owns: it is a strand replicated to both parties' cadres, and **every
 * replica re-validates every write**. That is the entire safety model -- the counterparty's
 * engine is what stops a forged chit, not politeness.
 *
 * So a test here does not "insert a row". One party *proposes* a row; both engines evaluate
 * it against their own copy of the schema; and the write stands only if both accept. When
 * they disagree, that disagreement is the finding.
 *
 * What this does NOT model is Optimystic's ordering under concurrency. Two replicas here
 * are applied in sequence, not raced. Anything about two writers reaching the same row at
 * once needs the real transactor and is out of scope for in-process tests -- see
 * `docs/STATUS.md` § Cross-repo.
 */

export interface Party {
	/** Party identity: in the real system a Cid over the genesis public key. */
	sid: string
	/** The party's keys, newest last. A party may hold several; the first is genesis. */
	keys: KeyPairText[]
}

export function newInvitation(): { publicKey: string; secretKey: Uint8Array } {
	return newKey()
}

/**
 * A party's own view of the strand. `db` is theirs alone -- writing to it directly is how a
 * test models a party whose own node accepted something the counterparty's did not.
 */
export interface Replica {
	party: Party
	db: Database
}

export interface Rejection {
	/** Which replica refused it. */
	sid: string
	message: string
}

export class DisagreementError extends Error {
	constructor(
		readonly accepted: string[],
		readonly rejected: Rejection[],
	) {
		super(
			`replicas disagreed: ${accepted.join(', ') || 'none'} accepted, ` +
				`${rejected.map(r => `${r.sid} refused (${r.message})`).join('; ')}`,
		)
		this.name = 'DisagreementError'
	}
}

/** One strand, replicated to two parties. */
export class Tally {
	private constructor(readonly replicas: Replica[]) {}

	static async open(parties: Party[], schema: SchemaName = 'draft1'): Promise<Tally> {
		const replicas: Replica[] = []
		for (const party of parties) {
			replicas.push({ party, db: await openStrand(schema) })
		}
		return new Tally(replicas)
	}

	replicaOf(party: Party): Replica {
		const found = this.replicas.find(r => r.party.sid === party.sid)
		if (!found) throw new Error(`no replica for ${party.sid}`)
		return found
	}

	/**
	 * Propose one act -- one or more rows, applied atomically -- to every replica. It stands
	 * only if all of them accept.
	 *
	 * Several rows per act is not a convenience: formation is circular by construction
	 * (`Stock.SignerAuthorized` needs the inviter's `PartyKey`, and the genesis `PartyKey`
	 * signature validates against `Stock.InvitationKey`), and only a transaction whose
	 * subquery CHECKs defer to COMMIT can seat a party at all.
	 *
	 * A partial acceptance is a `DisagreementError` rather than a silent divergence: in the
	 * real system that is the case where one party's node has admitted something the other's
	 * will not, and a test that let it pass would be testing the wrong system.
	 */
	async propose(writes: RowWrite[]): Promise<void> {
		const accepted: string[] = []
		const rejected: Rejection[] = []
		for (const replica of this.replicas) {
			try {
				await apply(replica, writes)
				accepted.push(replica.party.sid)
			} catch (error) {
				rejected.push({ sid: replica.party.sid, message: messageOf(error) })
			}
		}
		if (rejected.length > 0 && accepted.length > 0) {
			throw new DisagreementError(accepted, rejected)
		}
		if (rejected.length > 0) {
			throw new Error(rejected[0].message)
		}
	}

	/** Propose an act expected to be refused; returns why the first replica refused it. */
	async refuses(writes: RowWrite[]): Promise<string> {
		try {
			await this.propose(writes)
		} catch (error) {
			return messageOf(error)
		}
		throw new Error('expected the act to be refused, but every replica accepted it')
	}

	/** Read from one party's replica -- what that party can see. */
	async sees<T = Record<string, unknown>>(
		party: Party,
		sql: string,
		params?: unknown[],
	): Promise<T[]> {
		return rows<T>(this.replicaOf(party).db, sql, params)
	}

	async seesOne<T = Record<string, unknown>>(
		party: Party,
		sql: string,
		params?: unknown[],
	): Promise<T | undefined> {
		return row<T>(this.replicaOf(party).db, sql, params)
	}

	/**
	 * Write to ONE party's replica only -- a party whose own node accepted something.
	 * Use this to set up the state a byzantine party would hold, then check what the
	 * counterparty's replica does with it.
	 */
	async onlyOn(party: Party, writes: RowWrite[]): Promise<void> {
		await apply(this.replicaOf(party), writes)
	}
}

/** Apply one act to one replica, atomically. */
async function apply(replica: Replica, writes: RowWrite[]): Promise<void> {
	await replica.db.exec('begin')
	try {
		for (const write of writes) {
			const { sql, params } = insertStatement(write)
			await replica.db.exec(sql, params as never)
		}
		await replica.db.exec('commit')
	} catch (error) {
		try {
			await replica.db.exec('rollback')
		} catch {
			// A failed commit may have already unwound; the original error is the useful one.
		}
		throw error
	}
}

export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * A party with one genesis key.
 *
 * The `sid` **is** the digest of that key, which is what `docs/architecture.md` says a Sid
 * is: "the hash of the genesis (Revision 1) public key". The tests do not fake identity
 * where the real rule is this cheap -- and building it correctly here is what lets a test
 * ask whether the schema actually holds anyone to it.
 *
 * `label` is for reading test output; it is not part of the identity.
 */
export function newParty(label: string): Party & { label: string } {
	const genesis = newKey()
	return { sid: sidFor(genesis.publicKey), keys: [genesis], label }
}
