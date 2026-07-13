/**
 * In-memory test doubles for the lift module. Discovery half: a scripted
 * `DiscoveryEngine`, an in-memory `LiftJournalStore`, a stub `TermSource`, and candidate
 * builders. Commit half: a schema-EMULATING `InMemoryTally` (`EdgeStrand`), a scripted
 * `ConsensusEngine`, and key/identity builders. No ChipNet, no strand, no portfolio —
 * enough to exercise the accumulator, term population, route selection, journal
 * correlation, the sleeping-edge / concurrency paths, and the whole pledge → commit → void
 * settlement contract in-process.
 *
 * Excluded from the production build (see tsconfig.build.json `src/**\/test-harness.ts`).
 */

import { generateKeyPair, sign } from '../crypto/index.js'
import type {
	DiscoveryEngine,
	LiftJournalRow,
	LiftJournalStore,
} from './agent.js'
import type { CandidateEdge, CandidateRoute, LiftQuery, NegotiateCallbacks, RouteMathEdge } from './discovery.js'
import { digest, publicKeyText, verifyLiftTerms, verifyLiftVoid, type LiftEdgeTerms } from './digest.js'
import { SingleReferee, type RefereeEdge } from './referee.js'
import type { ConsensusEngine, EdgeSigner, EdgeStatus, EdgeStrand, LiftRecord, PledgeRow } from './commit.js'
import type { EdgeDenomination, EdgeLading, RateQuote, TermSource } from './terms.js'

/** A candidate route the scripted engine will offer; `sleeping` models a non-responding hop. */
export interface RouteSpec {
	edges: CandidateEdge[]
	/** When true, ChipNet's time budget would skip this route — the engine omits it (not an error). */
	sleeping?: boolean
}

/**
 * A `DiscoveryEngine` that returns a fixed set of candidate routes, running each
 * through the real negotiate callbacks so accumulation/pruning is exercised end to
 * end. Sleeping routes are dropped (skipped that round), never failing the round.
 */
export class ScriptedDiscoveryEngine implements DiscoveryEngine {
	constructor(private readonly specs: RouteSpec[]) {}

	discover(query: LiftQuery, callbacks: NegotiateCallbacks): Promise<CandidateRoute[]> {
		const live = this.specs.filter((s) => !s.sleeping)
		return Promise.resolve(live.map((s) => callbacks.negotiatePlan(s.edges, query)))
	}
}

/** An append-only in-memory `LiftJournal`, latest-revision-wins `current`. */
export class InMemoryLiftJournalStore implements LiftJournalStore {
	readonly rows: LiftJournalRow[] = []

	append(row: LiftJournalRow): Promise<void> {
		this.rows.push(row)
		return Promise.resolve()
	}

	current(liftId: string): Promise<LiftJournalRow | null> {
		const rows = this.rows.filter((r) => r.liftId === liftId)
		if (rows.length === 0) {
			return Promise.resolve(null)
		}
		return Promise.resolve(rows.reduce((a, b) => (b.revision > a.revision ? b : a)))
	}
}

/** A `TermSource` backed by plain maps. Quote keys are `From|To`; the date is ignored (validity pre-baked). */
export class StubTermSource implements TermSource {
	constructor(
		private readonly denoms: Record<string, EdgeDenomination>,
		private readonly ladings: Record<string, EdgeLading>,
		private readonly quotes: Record<string, RateQuote | null>,
	) {}

	denomination(linkId: string): EdgeDenomination {
		const d = this.denoms[linkId]
		if (!d) {
			throw new Error(`StubTermSource: no denomination for ${linkId}`)
		}
		return d
	}

	lading(linkId: string, receiverSid: string): EdgeLading {
		const l = this.ladings[`${linkId}|${receiverSid}`]
		if (!l) {
			throw new Error(`StubTermSource: no lading for ${linkId}|${receiverSid}`)
		}
		return l
	}

	quote(fromDenom: string, toDenom: string, _date: string): RateQuote | null {
		return this.quotes[`${fromDenom}|${toDenom}`] ?? null
	}
}

/** Build a `RouteMathEdge` for a lift-capable hop. */
export function liftMathEdge(
	denom: string,
	scale: number,
	capacity: { free: bigint; rewarded?: bigint; reward?: number; clutch?: number },
	convertQuote?: RateQuote | null,
): RouteMathEdge {
	return {
		denom,
		scale,
		freeUnits: capacity.free,
		rewardedUnits: capacity.rewarded ?? 0n,
		reward: capacity.reward ?? 0,
		clutch: capacity.clutch ?? 0,
		convertQuote,
	}
}

/** Wrap a math edge as a candidate edge with identity. */
export function candidateEdge(nonce: string, math: RouteMathEdge, owned?: { linkId: string; issuer: 'S' | 'F' }): CandidateEdge {
	return { nonce, math, linkId: owned?.linkId, issuer: owned?.issuer }
}

/** A directional quote helper. */
export function rate(fromDenom: string, toDenom: string, rateNum: bigint, rateDen: bigint): RateQuote {
	return { fromDenom, toDenom, rateNum, rateDen }
}

/* ── Commit half: keys / signers ─────────────────────────────────────────────── */

/** A generated identity: the raw secret key, its schema text public key, and an `EdgeSigner`. */
export interface Identity {
	publicKeyText: string
	signer: EdgeSigner
	secretKey: Uint8Array
}

/** Generate an ed25519 identity whose `EdgeSigner` signs a digest with its secret key. */
export function identity(): Identity {
	const kp = generateKeyPair()
	const text = publicKeyText(kp.publicKey)
	return {
		publicKeyText: text,
		secretKey: kp.secretKey,
		signer: { signerKey: text, sign: (d) => sign(kp.secretKey, d) },
	}
}

/** Generate a single-referee identity plus its `SingleReferee`. */
export function referee(): { ref: SingleReferee; key: string; secretKey: Uint8Array } {
	const id = identity()
	return { ref: new SingleReferee(id.secretKey, id.publicKeyText), key: id.publicKeyText, secretKey: id.secretKey }
}

/* ── Commit half: a schema-emulating in-memory tally strand ──────────────────── */

/** A rejected-insert promise (a schema constraint rejecting the write). */
function fail(message: string): Promise<never> {
	return Promise.reject(new Error(message))
}

/** Stored pledge + resolution state for one lift on one tally. */
interface StoredPledge {
	row: PledgeRow
	finalized: boolean
	voided: boolean
}

/**
 * One tally strand's lift state, reproducing the schema's lift gates in-memory
 * (schema/draft1.qsql): the reserved-credit gate (`PendingLift.WithinReservedCredit`),
 * single-finalize + finalize-after-void exclusion (`Ledger.LiftFinalize`), void-after-
 * finalize exclusion (`LiftVoid.NotFinalized`), the referee-signature checks
 * (`LiftFinalize` / `RefereeVoidValid`), and the settled-balance chain (`BalanceCorrect`).
 * The AUTHORITATIVE gate is Quereus; this is agent-layer behavioral parity while no runner
 * exists (the feat-schema-lift-chits review's caveat). Re-run these flows against a runner
 * when one lands.
 */
export class InMemoryTally implements EdgeStrand {
	private readonly pledges = new Map<string, StoredPledge>()
	/** Settled, stock-perspective balance (BalanceCorrect: Issuer='F' → +Units, 'S' → −Units). */
	private settled: bigint
	/** Append-only settled finalize deltas, for inspection (mirrors `Ledger` `Kind='lift'` rows). */
	readonly finalizedLedger: Array<{ liftId: string; delta: bigint; balance: bigint }> = []

	constructor(
		readonly cid: string,
		/** Stock-granted limit: how far the reserved stock-perspective balance may RISE. */
		private readonly stockLimit: bigint,
		/** Foil-granted limit: how far it may FALL (−foilLimit). */
		private readonly foilLimit: bigint,
		initialSettled = 0n,
	) {
		this.settled = initialSettled
	}

	/** Signed delta a pledge contributes, stock-perspective. */
	private static delta(row: Pick<PledgeRow, 'issuer' | 'units'>): bigint {
		return row.issuer === 'F' ? row.units : -row.units
	}

	/** Reserved balance = settled + every OPEN pledge's delta (finalized deltas are already in settled). */
	reservedBalance(): bigint {
		let reserved = this.settled
		for (const p of this.pledges.values()) {
			if (!p.finalized && !p.voided) {
				reserved += InMemoryTally.delta(p.row)
			}
		}
		return reserved
	}

	/** Settled (authoritative signed) balance, stock-perspective. */
	settledBalance(): bigint {
		return this.settled
	}

	// Mutators return a REJECTED promise on a rejected insert (never a synchronous throw — a
	// Promise-returning method must not throw before it returns), faithful to a real async
	// Quereus insert failing. `fail()` keeps the guard bodies terse.
	pledge(row: PledgeRow): Promise<void> {
		if (this.pledges.has(row.liftId)) {
			return fail(`PendingLift PK collision: duplicate LiftId ${row.liftId}`)
		}
		// WithinReservedCredit: the prospective reserved balance (this pledge included) must sit
		// within both grantors' limits, else the pledge would over-commit reserved capacity.
		const prospective = this.reservedBalance() + InMemoryTally.delta(row)
		if (prospective > this.stockLimit || prospective < -this.foilLimit) {
			return fail(`WithinReservedCredit: reserved ${prospective} outside [${-this.foilLimit}, ${this.stockLimit}] for LiftId ${row.liftId}`)
		}
		this.pledges.set(row.liftId, { row, finalized: false, voided: false })
		return Promise.resolve()
	}

	finalize(liftId: string, refereeSignature: string): Promise<void> {
		const p = this.pledges.get(liftId)
		if (!p) {
			return fail(`LiftFinalize: no PendingLift for LiftId ${liftId}`)
		}
		if (p.voided) {
			return fail(`LiftFinalize.NotVoided: LiftId ${liftId} already voided`)
		}
		if (p.finalized) {
			return fail(`LiftFinalize single-finalize: LiftId ${liftId} already finalized`)
		}
		if (!verifyLiftTerms(p.row.refereeKey, this.termsOf(p.row), refereeSignature)) {
			return fail(`LiftFinalize: referee commit signature does not verify for LiftId ${liftId}`)
		}
		p.finalized = true
		this.settled += InMemoryTally.delta(p.row)
		this.finalizedLedger.push({ liftId, delta: InMemoryTally.delta(p.row), balance: this.settled })
		return Promise.resolve()
	}

	void(liftId: string, refereeSignature: string): Promise<void> {
		const p = this.pledges.get(liftId)
		if (!p) {
			return fail(`LiftVoid.PendingExists: no PendingLift for LiftId ${liftId}`)
		}
		if (p.finalized) {
			return fail(`LiftVoid.NotFinalized: LiftId ${liftId} already finalized`)
		}
		if (p.voided) {
			return fail(`LiftVoid PK collision: LiftId ${liftId} already voided`)
		}
		if (!verifyLiftVoid(p.row.refereeKey, this.cid, liftId, refereeSignature)) {
			return fail(`LiftVoid.RefereeVoidValid: referee void signature does not verify for LiftId ${liftId}`)
		}
		p.voided = true
		return Promise.resolve()
	}

	status(liftId: string): Promise<EdgeStatus> {
		const p = this.pledges.get(liftId)
		return Promise.resolve({ pledged: p !== undefined, finalized: p?.finalized ?? false, voided: p?.voided ?? false })
	}

	/** Reconstruct the lift-terms this strand's pledge signed — the `LiftFinalize` digest form. */
	private termsOf(row: PledgeRow): LiftEdgeTerms {
		return { cid: this.cid, liftId: row.liftId, refereeKey: row.refereeKey, issuer: row.issuer, units: row.units, date: row.date, expiry: row.expiry }
	}
}

/* ── Commit half: scripted consensus ─────────────────────────────────────────── */

/**
 * A `ConsensusEngine` that resolves a record deterministically to a fixed decision using a
 * real `SingleReferee`, so the referee's actual signatures flow through settlement. The
 * referee legitimately knows each edge's `cid` (it is the route arbiter) — supplied here as
 * a `liftId → cid` map. A `void` models both an explicit abort and a pre-promise void.
 */
export class ScriptedConsensusEngine implements ConsensusEngine {
	constructor(
		private readonly ref: SingleReferee,
		private readonly cids: Map<string, string>,
		private readonly decision: 'commit' | 'void',
	) {}

	resolve(record: LiftRecord): Promise<LiftRecord> {
		const edges = record.edges.map((e): RefereeEdge => {
			const cid = this.cids.get(e.liftId)
			if (cid === undefined) {
				throw new Error(`ScriptedConsensusEngine: no cid known for LiftId ${e.liftId}`)
			}
			return { cid, liftId: e.liftId, refereeKey: record.refereeKey, issuer: e.issuer, units: BigInt(e.units), date: e.date, expiry: e.expiry }
		})
		// The ChipNet whole-record commit-digest preimage is unbound; any deterministic digest
		// serves the liveness signature here (the settlement proof is the per-edge digests).
		const recordDigest = digest([record.transactionCode, record.sessionCode])
		const resolution = this.decision === 'commit' ? this.ref.commit(recordDigest, edges) : this.ref.void(recordDigest, edges)
		return Promise.resolve({
			...record,
			decision: resolution.decision,
			recordSignature: resolution.recordSignature,
			edgeSignatures: resolution.edgeSignatures,
		})
	}
}
