/**
 * The **commit half** of the lift agent (see docs/architecture.md § Referee model and
 * the commit seam, § State mapping). It consumes the selected `LiftPlan` from discovery
 * (src/lift/agent.ts) and runs ChipNet's promise → commit → consensus flow, writing the
 * pledge / finalize / void rows the tally schema (schema/draft1.qsql) enforces:
 *
 *   - **Pledge** — for each edge THIS party owns, an issuer-signed `PendingLift` row.
 *     It RESERVES capacity (schema `WithinReservedCredit`) but does not move the settled
 *     balance; it settles only on referee commit, or is released on void.
 *   - **Settle (commit)** — on ChipNet consensus, copy the referee's per-edge signature
 *     into a finalize `Ledger` row (`Kind='lift'`); the schema's `LiftFinalize` verifies
 *     it locally against the pledge, moving the reserved delta into the settled balance.
 *   - **Settle (void)** — on abort/timeout, write the referee's `LiftVoid`, releasing the
 *     reservation with no settled row.
 *
 * ── Per-edge LiftId (a decision this ticket owns) ─────────────────────────────
 * NOTE: each route edge carries its OWN `LiftId` (the strand's `PendingLift.LiftId` PK).
 * It MUST be per-edge, not one id shared across the route: every edge's finalize digest
 * binds its own tally `Cid` (schema `Ledger.LiftFinalize`), so the referee emits a
 * DISTINCT per-edge signature, and the record `payload` `{ LiftId → refereeEdgeSignature }`
 * map can only key those signatures apart if `LiftId` is per-edge. The whole lift is
 * correlated by the ChipNet `transactionCode` and the originator's `LiftJournal` row
 * (keyed by the discovery `liftId`); the per-edge pledge ids live only on the strands and
 * in the record. See docs/architecture.md § Referee model.
 *
 * ── Ports (ChipNet + Quereus are both injected) ──────────────────────────────
 * NOTE: ChipNet is unbound (tickets/blocked/chipnet-npm-publish-needed.md) and there is no
 * live Quereus runner yet, so — as discovery/transport did — the ChipNet consensus and the
 * per-edge strand are injected ports (`ConsensusEngine`, `EdgeStrand`). Production backs
 * `EdgeStrand` with Quereus writes against a tally strand and `ConsensusEngine` with
 * ChipNet's cluster consensus over the `/taleus/chipnet/1.0.0` transport; tests back them
 * with the in-memory, schema-emulating doubles in src/lift/test-harness.ts.
 */

import { bytesToHex, liftTermsDigest, verifyLiftTerms, verifyLiftVoid, type LiftEdgeTerms } from './digest.js'
import type { OriginatorState } from './agent.js'
import type { JournalEdge } from './agent.js'
import type { LiftPlan } from './terms.js'

/* ── Per-edge strand port (Quereus PendingLift / Ledger / LiftVoid) ──────────── */

/** An issuer-signed pledge row, as `PendingLift` (schema/draft1.qsql) stores it. */
export interface PledgeRow {
	liftId: string
	refereeKey: string
	issuer: 'S' | 'F'
	units: bigint
	date: string
	expiry: string
	/** The issuing party's authorized `PartyKey` text. */
	signerKey: string
	/** Issuer signature (hex) over `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)`. */
	signature: string
}

/** Whether a lift's pledge/resolution rows exist on this strand — the idempotency + rebuild signal. */
export interface EdgeStatus {
	pledged: boolean
	finalized: boolean
	voided: boolean
}

/**
 * One tally strand as the commit half writes it. Backed in production by Quereus
 * inserts/reads against the strand's `PendingLift` / `Ledger` / `LiftVoid` tables; the
 * strand's own schema constraints are the authoritative gate (reserved credit, single
 * finalize, finalize/void exclusion, balance chaining) — this port never re-implements
 * them, it surfaces the insert and reports what committed.
 */
export interface EdgeStrand {
	/** The tally CID (`TallyCore.Cid`) — the per-strand value every digest on this edge binds. */
	readonly cid: string
	/** Insert the `PendingLift` pledge (schema gates it against reserved credit). */
	pledge(row: PledgeRow): Promise<void>
	/** Insert the finalize `Ledger` row (`Kind='lift'`) carrying the referee commit signature. */
	finalize(liftId: string, refereeSignature: string): Promise<void>
	/** Insert the `LiftVoid` row carrying the referee void signature. */
	void(liftId: string, refereeSignature: string): Promise<void>
	/** Read pledge/finalize/void existence for a lift (idempotent ingest + crash-restart rebuild). */
	status(liftId: string): Promise<EdgeStatus>
}

/** The issuer's signing seam: its authorized key text + a signer over a digest (keychain-backed in prod). */
export interface EdgeSigner {
	signerKey: string
	sign(digest: Uint8Array): Uint8Array
}

/* ── The ChipNet transaction record (Taleus payload; opaque to ChipNet) ───────── */

/** One edge in the transaction record. Carries NO `cid` — that stays private to each strand. */
export interface RecordEdge {
	/** Per-edge pledge id (this edge's `PendingLift.LiftId`). */
	liftId: string
	/** Anonymized tally id (graph privacy). */
	nonce: string
	issuer: 'S' | 'F'
	/** Decimal-encoded units (JSON has no bigint). */
	units: string
	date: string
	expiry: string
}

/**
 * The Taleus payload that rides inside a ChipNet `TrxRecord` (`record.body`, opaque to
 * ChipNet). Extends the transport's correlation fields; the resolution fields are absent
 * until the referee commits/voids.
 */
export interface LiftRecord {
	sessionCode: string
	transactionCode: string
	/** The agreed referee's public key text — every edge signature verifies against THIS. */
	refereeKey: string
	edges: RecordEdge[]
	/** Referee resolution — absent until resolved. */
	decision?: 'commit' | 'void'
	/** ChipNet whole-record commit/void signature (liveness; not the settlement proof). */
	recordSignature?: string
	/** `{ LiftId → per-edge referee signature (hex) }` — the schema settlement proof. */
	edgeSignatures?: Record<string, string>
}

/* ── An edge this party owns (pledges + settles) ─────────────────────────────── */

/** A route edge this party holds: the strand to write, plus this edge's pledge terms. */
export interface OwnedEdge {
	liftId: string
	strand: EdgeStrand
	issuer: 'S' | 'F'
	units: bigint
	date: string
	expiry: string
}

/** Build the schema `LiftEdgeTerms` for an owned edge from its strand cid + pledge fields. */
function ownedTerms(edge: OwnedEdge, refereeKey: string): LiftEdgeTerms {
	return {
		cid: edge.strand.cid,
		liftId: edge.liftId,
		refereeKey,
		issuer: edge.issuer,
		units: edge.units,
		date: edge.date,
		expiry: edge.expiry,
	}
}

/* ── Pledge ──────────────────────────────────────────────────────────────────── */

/**
 * Write the issuer-signed `PendingLift` pledge for one owned edge. The issuer signs the
 * lift-terms digest with its own authorized key; the schema's `WithinReservedCredit` gate
 * reserves capacity (or rejects if it would over-commit — the pledge insert throws, which
 * the caller treats as a failed promise, never a stranded pledge).
 */
export async function pledgeEdge(edge: OwnedEdge, refereeKey: string, signer: EdgeSigner): Promise<void> {
	const terms = ownedTerms(edge, refereeKey)
	const signature = bytesToHex(signer.sign(liftTermsDigest(terms)))
	await edge.strand.pledge({
		liftId: edge.liftId,
		refereeKey,
		issuer: edge.issuer,
		units: edge.units,
		date: edge.date,
		expiry: edge.expiry,
		signerKey: signer.signerKey,
		signature,
	})
}

/* ── Settlement (the reusable core of ingest + the driver) ───────────────────── */

/** How one owned edge resolved when a record was applied. */
export type EdgeApplied =
	| 'finalized'
	| 'voided'
	| 'skipped-idempotent' // already finalized/voided the same way — a re-delivered record no-ops
	| 'skipped-unverified' // the referee signature did not verify against RefereeKey — never acted on
	| 'skipped-no-signature' // the record carried no signature for this edge's LiftId
	| 'skipped-contradiction' // a commit+void contradiction was already seen for this LiftId

export interface EdgeOutcome {
	liftId: string
	applied: EdgeApplied
	error?: string
}

export interface SettleResult {
	decision: 'commit' | 'void'
	edges: EdgeOutcome[]
}

/** Structured logger; caught errors and referee contradictions are reported here, never swallowed. */
export type Logger = (message: string, ...args: unknown[]) => void

/**
 * Apply a referee-resolved record to the owned edges it names. The heart of both the
 * originator driver and the inbound participant. For each owned edge:
 *   1. verify the referee signature (over the reconstructed per-edge digest, against the
 *      record's `RefereeKey`) BEFORE acting — a record from the transport gate is NOT
 *      trusted on its own (docs § edge cases: the per-edge referee-signature check is the
 *      real safety boundary; a `C`-relayed record arrives ungated);
 *   2. no-op if the strand already resolved this lift the same way (idempotent ingest);
 *   3. finalize (commit) or void the strand.
 * A contradictory decision (commit after void seen, or vice versa, for one LiftId) is
 * detected-and-logged — the single-referee "lying referee" case; recovery is out of scope
 * (backlog/feat-multi-referee-consensus).
 */
export async function applyResolution(
	record: LiftRecord,
	owned: OwnedEdge[],
	seenDecisions: Map<string, 'commit' | 'void'>,
	log: Logger,
): Promise<SettleResult> {
	if (record.decision === undefined || record.edgeSignatures === undefined) {
		throw new Error(`applyResolution: record ${record.transactionCode} is not resolved (no decision)`)
	}
	const decision = record.decision
	const edges: EdgeOutcome[] = []
	for (const edge of owned) {
		edges.push(await applyToEdge(record, decision, edge, seenDecisions, log))
	}
	return { decision, edges }
}

/** Apply one edge of a resolved record: contradiction check → signature check → idempotency → write. */
async function applyToEdge(
	record: LiftRecord,
	decision: 'commit' | 'void',
	edge: OwnedEdge,
	seenDecisions: Map<string, 'commit' | 'void'>,
	log: Logger,
): Promise<EdgeOutcome> {
	const signature = record.edgeSignatures?.[edge.liftId]
	if (signature === undefined) {
		return { liftId: edge.liftId, applied: 'skipped-no-signature' }
	}

	// Referee equivocation guard: a single referee could sign commit for some edges and void
	// for others (docs § edge cases). Detect + log a contradiction; never act on the second face.
	const prior = seenDecisions.get(edge.liftId)
	if (prior !== undefined && prior !== decision) {
		log('CONTRADICTION: referee signed both %s and %s for LiftId %s (single-referee equivocation; see backlog/feat-multi-referee-consensus)', prior, decision, edge.liftId)
		return { liftId: edge.liftId, applied: 'skipped-contradiction' }
	}

	// Verify the referee signature against RefereeKey over THIS edge's reconstructed digest,
	// using the strand's own cid. A record is never trusted from the transport gate alone.
	const verified =
		decision === 'commit'
			? verifyLiftTerms(record.refereeKey, ownedTerms(edge, record.refereeKey), signature)
			: verifyLiftVoid(record.refereeKey, edge.strand.cid, edge.liftId, signature)
	if (!verified) {
		log('rejected unverifiable referee %s signature for LiftId %s on tally %s', decision, edge.liftId, edge.strand.cid)
		return { liftId: edge.liftId, applied: 'skipped-unverified' }
	}
	seenDecisions.set(edge.liftId, decision)

	// Idempotent ingest: the transport's push-wake retry can re-deliver a record, so a strand
	// already resolved the same way is a no-op (never a double-apply). status() is the
	// authoritative check (schema also rejects a second finalize / a finalize-after-void).
	const status = await edge.strand.status(edge.liftId)
	if ((decision === 'commit' && status.finalized) || (decision === 'void' && status.voided)) {
		return { liftId: edge.liftId, applied: 'skipped-idempotent' }
	}

	try {
		if (decision === 'commit') {
			await edge.strand.finalize(edge.liftId, signature)
			return { liftId: edge.liftId, applied: 'finalized' }
		}
		await edge.strand.void(edge.liftId, signature)
		return { liftId: edge.liftId, applied: 'voided' }
	} catch (err) {
		// The schema rejected the write (e.g. a racing void already committed). Surface, don't eat.
		const message = err instanceof Error ? err.message : String(err)
		log('strand rejected %s for LiftId %s on tally %s: %s', decision, edge.liftId, edge.strand.cid, message)
		return { liftId: edge.liftId, applied: decision === 'commit' ? 'skipped-unverified' : 'skipped-contradiction', error: message }
	}
}

/* ── Inbound participant (registered with the ChipNet transport) ─────────────── */

/**
 * The `RecordParticipant` the `/taleus/chipnet/1.0.0` transport dispatches inbound records
 * to (src/transport/chipnet-protocol.ts). Owns the party's in-flight owned edges (indexed
 * by LiftId), verifies + idempotently settles each inbound resolved record, and detects
 * referee contradictions across deliveries. Registered once via
 * `transport.registerParticipant(participant.ingest)`.
 */
export class LiftParticipant {
	private readonly owned = new Map<string, OwnedEdge>()
	private readonly seenDecisions = new Map<string, 'commit' | 'void'>()
	private readonly log: Logger

	constructor(log: Logger = () => {}) {
		this.log = log
	}

	/** Register an owned edge (this party's pledge on one strand) so inbound records can settle it. */
	register(edge: OwnedEdge): void {
		this.owned.set(edge.liftId, edge)
	}

	/** Drop an owned edge once its lift has fully resolved, so the index does not grow unbounded. */
	forget(liftId: string): void {
		this.owned.delete(liftId)
	}

	/**
	 * Ingest one inbound resolved record: settle every owned edge it names. Idempotent and
	 * signature-verified per `applyResolution`. Records naming no owned edge (relayed past us)
	 * are a no-op. Bound as an arrow so it can be passed directly as the transport's
	 * `RecordParticipant`.
	 */
	ingest = async (record: LiftRecord): Promise<SettleResult> => {
		const touched = record.edges.map((e) => this.owned.get(e.liftId)).filter((e): e is OwnedEdge => e !== undefined)
		return applyResolution(record, touched, this.seenDecisions, this.log)
	}
}

/* ── Originator driver ───────────────────────────────────────────────────────── */

/**
 * ChipNet's cluster consensus over one record, injected. Production wraps ChipNet's
 * promise → commit → consensus state machine (driven by the referee, propagated over the
 * `/taleus/chipnet/1.0.0` transport); it returns the referee-RESOLVED record (a `commit`
 * with per-edge signatures, or a `void` — including a **pre-promise void** when not every
 * participant promised in time, so the originator never pledges-then-strands a partly
 * promised route). A referee that never resolves surfaces as a `void` with `timedout`
 * (coordinated with the transport's push-wake failure path; the bounded party-driven
 * release is backlog/feat-lift-timeout-release).
 */
export interface ConsensusEngine {
	resolve(record: LiftRecord): Promise<LiftRecord>
}

export type CommitOutcome =
	| { committed: true; result: SettleResult }
	| { committed: false; reason: 'voided' | 'timedout'; result: SettleResult }

/** Everything the originator driver needs, injected. */
export interface LiftCommitDeps {
	engine: ConsensusEngine
	state: OriginatorState
	signer: EdgeSigner
	log?: Logger
	/** Whether the consensus returned a plain void vs a timeout void (for the journal state). */
	timedOut?: (record: LiftRecord) => boolean
}

/**
 * The originator's commit driver: pledge the owned edges of a selected `LiftPlan`, run
 * consensus, and settle. Ends at "route committed" or "route voided" — the mirror of the
 * discovery half's `LiftAgent`.
 */
export class LiftCommit {
	private readonly engine: ConsensusEngine
	private readonly state: OriginatorState
	private readonly signer: EdgeSigner
	private readonly log: Logger
	private readonly timedOut: (record: LiftRecord) => boolean
	private readonly seenDecisions = new Map<string, 'commit' | 'void'>()

	constructor(deps: LiftCommitDeps) {
		this.engine = deps.engine
		this.state = deps.state
		this.signer = deps.signer
		this.log = deps.log ?? ((): void => {})
		this.timedOut = deps.timedOut ?? ((): boolean => false)
	}

	/**
	 * Pledge → consensus → settle for one plan. `owned` are the edges this party holds
	 * (each with its strand + per-edge LiftId, index-aligned to `record.edges` by LiftId).
	 * `record` is the ChipNet transaction record for the whole route (built by the caller so
	 * every participant agrees on the per-edge LiftIds). Journals `pending`, then `committed`
	 * or `aborted`/`timedout`.
	 */
	async commit(plan: LiftPlan, record: LiftRecord, owned: OwnedEdge[]): Promise<CommitOutcome> {
		// Pledge every owned edge. A pledge that the reserved-credit gate rejects throws here,
		// BEFORE consensus — so a route that cannot be fully pledged is abandoned, never left
		// with a stranded reservation (the pre-promise-void invariant on the local side).
		for (const edge of owned) {
			await pledgeEdge(edge, record.refereeKey, this.signer)
		}
		await this.state.record(plan.liftId, 'pending', journalEdgesOf(plan), record.refereeKey)

		const resolved = await this.engine.resolve(record)
		const result = await applyResolution(resolved, owned, this.seenDecisions, this.log)

		if (result.decision === 'commit') {
			await this.state.record(plan.liftId, 'committed', journalEdgesOf(plan), record.refereeKey)
			return { committed: true, result }
		}
		const reason = this.timedOut(resolved) ? 'timedout' : 'voided'
		await this.state.record(plan.liftId, reason === 'timedout' ? 'timedout' : 'aborted', journalEdgesOf(plan), record.refereeKey)
		return { committed: false, reason, result }
	}
}

/** Project a plan's edges onto the journal `Edges` JSON (units → decimal; direction by position). */
function journalEdgesOf(plan: LiftPlan): JournalEdge[] {
	const last = plan.edges.length - 1
	return plan.edges.map((e, i) => ({
		strandId: e.linkId ?? e.nonce,
		denom: e.denom,
		units: e.units.toString(),
		direction: i === 0 ? 'source' : i === last ? 'payee' : 'relay',
	}))
}

/* ── Crash / restart rebuild ─────────────────────────────────────────────────── */

/**
 * Rebuild an owned edge's in-flight phase from the STRAND, not the journal. The
 * authoritative per-edge state is `PendingLift`/`Ledger`/`LiftVoid` (the journal is
 * reconstructible bookkeeping), so on restart the agent reads `status()` to decide whether
 * an edge still needs settling. Returns the phase the strand is actually in.
 */
export async function rebuildEdgePhase(edge: OwnedEdge): Promise<'unpledged' | 'pending' | 'finalized' | 'voided'> {
	const status = await edge.strand.status(edge.liftId)
	if (status.finalized) {
		return 'finalized'
	}
	if (status.voided) {
		return 'voided'
	}
	if (status.pledged) {
		return 'pending'
	}
	return 'unpledged'
}
