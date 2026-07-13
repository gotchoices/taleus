/**
 * Intent-term shapes and their population for denomination-aware lift discovery
 * (see docs/architecture.md § Denomination-aware discovery). ChipNet tags each
 * edge (link) with **intents** — `C` (communications, on every link) and `L`
 * (lift) — whose **terms** are an opaque `Record<string, unknown>` ChipNet never
 * interprets. This module builds those term records from the three Taleus data
 * sources a hop draws on:
 *
 *   - the edge's `TallyContract`      → denomination + scale;
 *   - the strand's `LiftLading` view  → movable capacity + fee, off the *reserved*
 *                                       balance (an open pledge already shrinks it);
 *   - the party's private portfolio    → the intermediary's `ExchangeRateQuote` for
 *     `ExchangeRateQuote`               the conversion boundary it straddles.
 *
 * It also defines the handoff structures (`LiftPlan`/`RouteEdge`/`SourceCost`) the
 * commit ticket (`feat-lift-referee-commit`) consumes, so the selected route is not
 * re-derived downstream.
 *
 * ── Scope & the ChipNet binding ──────────────────────────────────────────────
 * NOTE: `chipnet`/`chipcryptbase` are not installable yet (unpublished; see
 * tickets/blocked/chipnet-npm-publish-needed.md), so — exactly as
 * src/transport/chipnet-protocol.ts did for the wire types — the ChipNet
 * discovery types this half fills are a LOCAL PORT (src/lift/discovery.ts). This
 * module produces the *content* that rides inside an `L`/`C` intent's opaque
 * terms; the data sources below are injected ports so term population is testable
 * without a live Quereus strand or cadre.
 *
 * NOTE: WIRE SERIALIZATION. Capacities and units are `bigint` here (exact,
 * arbitrarily large — a route can cross large scales). ChipNet frames the terms
 * as JSON (src/transport/comms.ts), and `JSON.stringify` throws on a `bigint`, so
 * when the real ChipNet engine lands these fields must be string-encoded at the
 * transport body boundary and parsed back here. No live engine sends these terms
 * today, so the encode/decode shim is deferred rather than built now.
 */

/**
 * A directional exchange-rate quote resolved from the party's private
 * `ExchangeRateQuote` (schema/portfolio.qsql). Effective rate — the party's spread
 * is already folded into `rateNum/rateDen` (the multi-denomination generalization
 * of a trading variable's reward). `from`/`to` are display-unit denominations, so
 * the quote is independent of any tally's per-contract scale; scales enter only at
 * conversion time (src/lift/convert.ts).
 */
export interface RateQuote {
	/** Convert-FROM denomination = `D_in`, the upstream edge (nearer the payer) the quoting party receives on. */
	fromDenom: string
	/** Convert-TO denomination = `D_out`, the downstream edge (nearer the payee) the quoting party releases on. */
	toDenom: string
	rateNum: bigint
	rateDen: bigint
}

/**
 * The `L`-intent terms for one lift-capable edge (a single tally). Built by
 * `buildLiftTerms`. Movable capacity is `free + rewarded`, computed off the
 * *reserved* balance, so an edge already carrying an open pending lift advertises
 * less — the agent must not re-add open-pledge effects (that would double-count).
 */
export interface LiftTerms {
	readonly intent: 'L'
	/** Denomination identifier from the edge's `TallyContract` (e.g. `CHIP`, `iso4217:USD`). */
	readonly denom: string
	/** Decimal scale from the edge's `TallyContract`: one smallest unit = 10^(-scale) display units. */
	readonly scale: number
	/** Units movable free up to the receiver's target, this edge's own denomination (LiftLading.FreeUnits). */
	readonly freeUnits: bigint
	/** Further units up to the receiver's bound, charged at `reward` (LiftLading.RewardedUnits). */
	readonly rewardedUnits: bigint
	/** Receiver's fee ratio on the rewarded portion, parts-per-million (LiftLading.Reward). */
	readonly reward: number
	/** Releasing counterparty's fee ratio on the whole moved amount, ppm (LiftLading.Clutch). */
	readonly clutch: number
}

/** `C`-only (pure comms/relay) intent terms — no lift capacity, no denomination. */
export interface CommsTerms {
	readonly intent: 'C'
}

/* ── Data-source ports (backed in production by tally + portfolio strands) ───── */

/** The edge's `TallyContract` denomination + scale. Resolved from the tally strand. */
export interface EdgeDenomination {
	denom: string
	scale: number
}

/**
 * The `LiftLading` row for one direction of an edge — movable capacity and fees
 * off the *reserved* balance. A direction is named by its receiver (the party
 * whose perspective balance rises). Absent credit terms / zero room yields all
 * zeros, which the accumulator treats as zero capacity (a prune, never a throw).
 */
export interface EdgeLading {
	freeUnits: bigint
	rewardedUnits: bigint
	reward: number
	clutch: number
}

/**
 * Everything term population reads, injected so it is testable without a live
 * strand/portfolio. Each method is backed in production by a Quereus read against
 * the tally strand (contract, lading) or the private portfolio (quote):
 *
 *   - `denomination(linkId)`             → the edge's `TallyContract`.
 *   - `lading(linkId, receiverSid)`      → the edge's `LiftLading` for the receiving direction.
 *   - `quote(fromDenom, toDenom, date)`  → the party's `CurrentExchangeRateQuote`, validity-filtered
 *                                          at `date`; `null` = no usable quote (missing OR expired).
 */
export interface TermSource {
	denomination(linkId: string): EdgeDenomination
	lading(linkId: string, receiverSid: string): EdgeLading
	quote(fromDenom: string, toDenom: string, date: string): RateQuote | null
}

/** Build the opaque `L`-intent terms for one edge from its contract + reserved-balance lading. */
export function buildLiftTerms(
	source: TermSource,
	linkId: string,
	receiverSid: string,
): LiftTerms {
	const { denom, scale } = source.denomination(linkId)
	const lading = source.lading(linkId, receiverSid)
	return {
		intent: 'L',
		denom,
		scale,
		freeUnits: lading.freeUnits,
		rewardedUnits: lading.rewardedUnits,
		reward: lading.reward,
		clutch: lading.clutch,
	}
}

/** Build the `C`-only intent terms for a pure comms/relay hop. */
export function buildCommsTerms(): CommsTerms {
	return { intent: 'C' }
}

/**
 * Resolve the exchange-rate quote for the conversion boundary an intermediary
 * straddles, in the direction discovery walks: `From = D_in` (the upstream edge it
 * receives on), `To = D_out` (the downstream edge it releases on). Getting this
 * direction wrong inverts every spread — the exact bug the exchange-rate-quotes
 * review caught — so callers pass upstream-then-downstream and this returns a quote
 * whose `fromDenom/toDenom` match, or `null` (missing/expired) to prune the route.
 * Same-denomination boundaries need no quote and never reach here.
 */
export function resolveBoundaryQuote(
	source: TermSource,
	upstreamDenom: string,
	downstreamDenom: string,
	date: string,
): RateQuote | null {
	const quote = source.quote(upstreamDenom, downstreamDenom, date)
	if (quote === null) {
		return null
	}
	if (quote.fromDenom !== upstreamDenom || quote.toDenom !== downstreamDenom) {
		throw new Error(
			`boundary quote direction mismatch: expected From=${upstreamDenom} To=${downstreamDenom}, ` +
				`got From=${quote.fromDenom} To=${quote.toDenom}`,
		)
	}
	return quote
}

/* ── Handoff to feat-lift-referee-commit ─────────────────────────────────────── */

/**
 * One edge of a selected route, as the commit half consumes it. The originator
 * resolves `linkId`/`issuer` only for edges it owns — for every other edge it sees
 * only the anonymized `nonce` (graph privacy: intermediaries are hashes, never
 * tally identities). Each participant fills its own `issuer` (its seat, S/F) from
 * its local strand at pledge time; the commit record carries `units` (this edge's
 * own denomination, the ceiled route value) keyed by `nonce`.
 */
export interface RouteEdge {
	/** Anonymized tally id on the wire: the only edge reference a non-owner ever sees. */
	nonce: string
	/** Real tally edge id — present only for edges the originator owns. */
	linkId?: string
	denom: string
	scale: number
	/** Ceiled pledge amount in this edge's own denomination (smallest units). */
	units: bigint
	/** Pledging side (S/F) — present only for owned edges; each participant fills its own at commit. */
	issuer?: 'S' | 'F'
}

/**
 * The exact source-denomination cost of delivering the target amount, surfaced
 * before commit. `units` is the accumulated `req_in` at the originator's own edge —
 * the originator absorbs the per-edge rounding dust. `feeRatioPpm` is the composed
 * trading-variable fee across the route (parts-per-million).
 */
export interface SourceCost {
	denom: string
	scale: number
	units: bigint
	feeRatioPpm: number
}

/**
 * A fully selected route: the topology (edges, originator → payee), the per-edge
 * ceiled units in each edge's own denomination, the chosen referee slot, and the
 * exact source cost. This is the input `feat-lift-referee-commit` consumes; it is
 * defined here so it is not re-derived there.
 */
export interface LiftPlan {
	liftId: string
	sessionCode: string
	kind: 'payment' | 'circular'
	/** Ordered originator → payee (circular: originator → … → originator). */
	edges: RouteEdge[]
	/** Chosen referee: the agreed cadre node whose key every `PendingLift.RefereeKey` will name. */
	referee: RefereeSlot
	source: SourceCost
}

/**
 * The referee agreed during discovery — a ChipNet member address every participant
 * must accept in the promise phase. Reference default (§ Referee model and the
 * commit seam): the originator's own always-on agent. Ported minimally here (the
 * full `Address` lives in src/transport) to keep the handoff self-contained.
 */
export interface RefereeSlot {
	/** The referee's signing key — what a `PendingLift.RefereeKey` names. */
	key: string
	cuid?: string
}
