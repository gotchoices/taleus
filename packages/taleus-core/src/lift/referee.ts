/**
 * The lift **referee**: the single agreed arbiter whose one decision finalizes every
 * pledge on a route or cancels them all (see docs/architecture.md § Referee model and
 * the commit seam). ChipNet's commit phase is referee-voted; the Taleus schema names
 * ONE `RefereeKey` per `PendingLift` and settles each edge on ONE `RefereeSignature`.
 * v1 reconciles these as a referee set of size 1 (a "majority" of one).
 *
 * At commit the referee emits BOTH signatures the docs require — they are complementary
 * layers, not redundant:
 *   1. the ChipNet whole-record commit signature — drives ChipNet **liveness/coordination**
 *      (ring/star propagation, void-on-timeout, network-split handling). ChipNet's
 *      `getCommitDigest` signs the whole record; that primitive is unbound here (see the
 *      port NOTE below), so this module signs an injected record digest.
 *   2. one **per-edge Taleus signature** for each edge, over that edge's lift-terms digest
 *      `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)` — the schema's
 *      **safety/settlement** proof (`Ledger.LiftFinalize`). These ride in the record
 *      `payload` as a `{ LiftId → refereeEdgeSignature }` map; each strand's agent copies
 *      its edge's signature into that strand's finalize `Ledger` row.
 *
 * Void is symmetric: one per-edge signature over the DISTINCT void digest
 * `Digest(Cid, LiftId, 'void')` (`LiftVoid.RefereeVoidValid`), plus the record signature
 * that propagates the void through ChipNet.
 *
 * NOTE (single-referee equivocation — documented v1 risk): a referee set of one is a
 * single point of both liveness and trust. A malicious referee could `commit` some edges
 * and `void` others, breaking atomicity (ChipNet's "lying referee"), with no majority to
 * outvote it. v1 accepts this — the reference default is the originator's own agent, which
 * has no incentive to equivocate against its own lift. Multi-referee majority is deferred
 * to backlog/feat-multi-referee-consensus (a schema change: `RefereeKey` → set + threshold,
 * `RefereeSignature` → majority bundle). This module signs every edge with the SAME
 * decision by construction (one `commit`/`void` call over all edges), so an honest referee
 * cannot split a route; contradiction detection for a dishonest one lives on the ingest
 * side (src/lift/commit.ts, `LiftParticipant`).
 */

import { sign } from '../crypto/index.js'
import { bytesToHex, liftTermsDigest, liftVoidDigest, type LiftEdgeTerms } from './digest.js'

/**
 * One edge the referee resolves. The referee — the route's arbiter — legitimately knows
 * every edge's terms (including its `cid`), unlike a plain participant which sees only its
 * own edge; that is why the per-edge digest is per-edge (a strand settles from its own row
 * without the topology).
 */
export type RefereeEdge = LiftEdgeTerms

/**
 * ChipNet's whole-record commit digest, injected. ChipNet's `getCommitDigest` derives it
 * from `transactionCode + sessionCode + payload + topology + promises`; that engine is
 * unbound today (tickets/blocked/chipnet-npm-publish-needed.md), so the caller passes the
 * digest bytes and this module signs them. The exact `getCommitDigest` preimage is
 * reconciled when ChipNet lands — it does not affect the per-edge Taleus digests, which are
 * the schema's settlement proof and are fully pinned here.
 */
export type RecordDigest = Uint8Array

/** The referee's commit: the record (liveness) signature + one Taleus edge signature per LiftId. */
export interface RefereeCommit {
	decision: 'commit'
	/** ChipNet whole-record commit signature (hex) — propagation/liveness. */
	recordSignature: string
	/** `{ LiftId → per-edge Taleus commit signature (hex) }` — the schema settlement proof. */
	edgeSignatures: Record<string, string>
}

/** The referee's void: the record signature + one void signature per LiftId. */
export interface RefereeVoidResult {
	decision: 'void'
	/** ChipNet whole-record void signature (hex) — propagation/liveness. */
	recordSignature: string
	/** `{ LiftId → per-edge void signature (hex) }` over the DISTINCT void digest. */
	edgeSignatures: Record<string, string>
}

export type RefereeResolution = RefereeCommit | RefereeVoidResult

/**
 * A single referee (set size 1). Holds the referee secret key and its public key text (the
 * value every edge's `PendingLift.RefereeKey` names). Construct once per referee identity;
 * call `commit`/`void` once per lift over ALL of its edges — never per edge — so the whole
 * route carries one atomic decision.
 */
export class SingleReferee {
	constructor(
		private readonly secretKey: Uint8Array,
		/** The referee's public key text; must equal every resolved edge's `refereeKey`. */
		readonly publicKeyText: string,
	) {}

	/**
	 * Commit the whole route: sign the ChipNet record digest, and sign each edge's
	 * lift-terms digest. Returns the record signature plus a `{ LiftId → edgeSignature }`
	 * map the agent distributes to each strand's finalize.
	 */
	commit(recordDigest: RecordDigest, edges: RefereeEdge[]): RefereeCommit {
		const edgeSignatures = this.signEdges(edges, (e) => liftTermsDigest(e))
		return {
			decision: 'commit',
			recordSignature: bytesToHex(sign(this.secretKey, recordDigest)),
			edgeSignatures,
		}
	}

	/**
	 * Void the whole route (explicit abort or post-timeout — the same mechanism): sign the
	 * record digest, and sign each edge's DISTINCT void digest. The void signature can never
	 * satisfy `Ledger.LiftFinalize` (different digest), so it cannot be replayed as a commit.
	 */
	void(recordDigest: RecordDigest, edges: RefereeEdge[]): RefereeVoidResult {
		const edgeSignatures = this.signEdges(edges, (e) => liftVoidDigest(e.cid, e.liftId))
		return {
			decision: 'void',
			recordSignature: bytesToHex(sign(this.secretKey, recordDigest)),
			edgeSignatures,
		}
	}

	/** Sign one digest per edge, keyed by the edge's `LiftId`; rejects an edge naming another referee. */
	private signEdges(edges: RefereeEdge[], digestOf: (edge: RefereeEdge) => Uint8Array): Record<string, string> {
		const out: Record<string, string> = {}
		for (const edge of edges) {
			if (edge.refereeKey !== this.publicKeyText) {
				// The referee only signs edges that named it — a signature over an edge whose
				// RefereeKey is some other key would never verify at that strand anyway.
				throw new Error(`referee ${this.publicKeyText} asked to resolve edge ${edge.liftId} naming referee ${edge.refereeKey}`)
			}
			if (out[edge.liftId] !== undefined) {
				// Per-edge LiftId is the settlement key; a duplicate would mean two edges could not
				// be told apart in the { LiftId → signature } map. Fail loudly rather than clobber.
				throw new Error(`referee saw duplicate LiftId ${edge.liftId} in one resolution`)
			}
			out[edge.liftId] = bytesToHex(sign(this.secretKey, digestOf(edge)))
		}
		return out
	}
}
