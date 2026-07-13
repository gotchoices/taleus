/**
 * The negotiate half of denomination-aware lift discovery (see
 * docs/architecture.md § Denomination-aware discovery, § Cross-denomination
 * conversion). ChipNet owns the unidirectional route search; Taleus fills the
 * `L`/`C` intent terms (src/lift/terms.ts) and the negotiate callbacks that
 * accumulate, backward from the payee, the **conversion product** (per-edge ceiled
 * units + the exact source-denomination cost) and the composed **trading-variable
 * fee**, pruning any route it cannot cost.
 *
 * ── The ChipNet discovery port ───────────────────────────────────────────────
 * NOTE: `chipnet` is not installable yet (tickets/blocked/chipnet-npm-publish-
 * needed.md), so — mirroring src/transport/chipnet-protocol.ts — the discovery
 * types below (`Intent`, `NegotiateIntentFunc`, `NegotiatePlanFunc`, `LiftQuery`)
 * are a LOCAL PORT capturing only what these callbacks read/produce. When the
 * package lands, replace them with imports from `chipnet` and keep the callback
 * bodies. The negotiate logic itself needs ZERO ChipNet change — the conversion
 * product accumulates entirely in Taleus code; ChipNet never sees a rate.
 *
 * The accumulator (`accumulateRoute`) is a PURE function of a candidate route — no
 * network, no ChipNet, no strand — so the whole cost/prune surface is unit-testable
 * in isolation. The negotiate callbacks are thin wrappers ChipNet's search drives.
 */

import { convertBoundary } from './convert.js'
import type { LiftTerms, RateQuote } from './terms.js'

/* ── ChipNet discovery port (opaque terms) ───────────────────────────────────── */

/** A ChipNet intent tag on an edge: `L` = lift-capable, `C` = comms/relay only. */
export type IntentCode = 'L' | 'C'

/**
 * A ChipNet discovery query. The transport reads `sessionCode`; the rest steers the
 * Taleus negotiate callbacks. `amount` is in the payee's own denomination smallest
 * units — the payer's intent is "the payee receives `amount` on their end" — and
 * conversion accumulates upstream from there.
 */
export interface LiftQuery {
	liftId: string
	sessionCode: string
	/** Payment = search toward the payee; circular = clearing lift back to self. */
	kind: 'payment' | 'circular'
	/** Target amount in the payee edge's denomination smallest units. */
	amount: bigint
	/** Payee edge denomination + scale (the downstream-most edge of every candidate). */
	payeeDenom: string
	payeeScale: number
	/** Decision date: quote-validity cutoff and the pledge date the reserved-credit gate keys off. */
	date: string
	/** ChipNet depth/cost cut-off (advisory here; the real engine enforces query economics). */
	maxDepth?: number
}

/**
 * One edge of a candidate route as the accumulator consumes it — the pure-math
 * projection of an `L`-intent hop (src/lift/terms.ts `LiftTerms`) plus the quote
 * for the boundary this edge straddles toward the next-downstream edge. Ordered
 * originator → payee across a route, so `convertQuote` converts the downstream
 * edge's requirement into *this* edge's requirement: `From = this.denom` (D_in,
 * upstream), `To = next.denom` (D_out, downstream).
 */
export interface RouteMathEdge {
	denom: string
	scale: number
	/** Movable capacity in this edge's own denomination (LiftLading.FreeUnits). */
	freeUnits: bigint
	/** Further movable capacity charged at `reward` (LiftLading.RewardedUnits). */
	rewardedUnits: bigint
	reward: number
	clutch: number
	/**
	 * Quote for the conversion boundary to the next-downstream edge, resolved
	 * `From = this.denom, To = next.denom`. Semantics:
	 *   - `undefined`  — no downstream neighbor (payee edge) OR same denomination
	 *                    both sides (no conversion; the accumulator uses a 1:1 rate).
	 *   - `null`       — a real denomination change with NO usable quote → prune.
	 *   - `RateQuote`  — a resolved, valid, direction-checked quote.
	 */
	convertQuote?: RateQuote | null
}

/** Project an `L`-intent term record onto the accumulator's math edge, attaching the boundary quote. */
export function mathEdge(terms: LiftTerms, convertQuote?: RateQuote | null): RouteMathEdge {
	return {
		denom: terms.denom,
		scale: terms.scale,
		freeUnits: terms.freeUnits,
		rewardedUnits: terms.rewardedUnits,
		reward: terms.reward,
		clutch: terms.clutch,
		convertQuote,
	}
}

/* ── Accumulation (pure) ─────────────────────────────────────────────────────── */

/** Why a route was pruned. Each independently prunes; none is a thrown error. */
export type PruneReason =
	| 'missing-quote' // a real denomination change with no usable quote at this boundary
	| 'zero-capacity' // an edge advertises no movable units (incl. no CreditTerms → 0 limit)
	| 'insufficient-capacity' // the route's required units exceed this edge's movable capacity

/** A route that survived: per-edge ceiled units, the source cost, and the composed fee. */
export interface AccumulatedRoute {
	pruned: false
	/** Ceiled units per edge, index-aligned to the input (originator … payee), each in its own denomination. */
	perEdgeUnits: bigint[]
	/** The exact source-denomination cost = `perEdgeUnits[0]` (accumulated `req_in` at the originator's edge). */
	sourceUnits: bigint
	/** Composed trading-variable fee across the route, parts-per-million. */
	feeRatioPpm: number
}

/** A pruned route: the reason and the edge index it failed at. Never thrown. */
export interface PrunedRoute {
	pruned: true
	reason: PruneReason
	atEdge: number
}

export type AccumulationResult = AccumulatedRoute | PrunedRoute

/**
 * Accumulate a candidate route backward from the payee (see § Cross-denomination
 * conversion). `edges` is ordered originator (index 0, the source edge) → payee
 * (last, where `amount` is denominated). Returns per-edge ceiled units + the exact
 * source cost + the composed fee, or a prune (no throw for a pruned route).
 *
 * Two independent accumulations run alongside each other, exactly as the doc
 * splits them:
 *   1. the **conversion product** — one `convertBoundary` ceiling per boundary,
 *      giving the integer units on each edge and the source cost. The single
 *      ceiling per boundary means the originator absorbs the sub-unit dust.
 *   2. the **fee ratio** — `NewRate = PriorRate + MyRate·(1 − PriorRate)` composed
 *      over every edge. That reduces to `1 − Π(1 − MyRate_k)` (commutative), so
 *      order does not matter; computed as an exact bigint rational, surfaced as ppm.
 *
 * The two are deliberately separate: the source *cost* the originator sees is the
 * conversion product (per the test contract), and the fee is a parallel cost metric
 * for route comparison and disclosure — not folded into the settled per-edge units.
 */
export function accumulateRoute(edges: RouteMathEdge[], amount: bigint): AccumulationResult {
	if (edges.length === 0) {
		throw new Error('accumulateRoute: empty route')
	}
	if (amount <= 0n) {
		throw new Error(`accumulateRoute: amount must be > 0, got ${amount}`)
	}

	const n = edges.length
	const perEdgeUnits = new Array<bigint>(n)
	perEdgeUnits[n - 1] = amount // payee edge: the requested amount in its own denomination

	// Walk backward: derive each upstream edge's requirement from its downstream neighbour.
	for (let j = n - 2; j >= 0; j--) {
		const upstream = edges[j]
		const downstream = edges[j + 1]
		const converted = convertUpstream(upstream, downstream, perEdgeUnits[j + 1], j)
		if (converted.pruned) {
			return converted
		}
		perEdgeUnits[j] = converted.value
	}

	// Capacity check every edge against its own required units (reserved-balance based).
	for (let j = 0; j < n; j++) {
		const capacity = edges[j].freeUnits + edges[j].rewardedUnits
		if (capacity <= 0n) {
			return { pruned: true, reason: 'zero-capacity', atEdge: j }
		}
		if (perEdgeUnits[j] > capacity) {
			return { pruned: true, reason: 'insufficient-capacity', atEdge: j }
		}
	}

	return {
		pruned: false,
		perEdgeUnits,
		sourceUnits: perEdgeUnits[0],
		feeRatioPpm: composeFeePpm(edges, perEdgeUnits),
	}
}

/** Convert the downstream requirement into the upstream edge's requirement across one boundary. */
function convertUpstream(
	upstream: RouteMathEdge,
	downstream: RouteMathEdge,
	reqOut: bigint,
	atEdge: number,
): { pruned: false; value: bigint } | PrunedRoute {
	if (upstream.denom === downstream.denom) {
		// Same denomination — no conversion, no quote lookup even if scales differ.
		const value = convertBoundary({
			reqOut,
			rateNum: 1n,
			rateDen: 1n,
			scaleIn: upstream.scale,
			scaleOut: downstream.scale,
		})
		return { pruned: false, value }
	}

	// Real denomination change: a valid, direction-checked quote is required, else prune.
	const quote = upstream.convertQuote
	if (quote === undefined || quote === null) {
		return { pruned: true, reason: 'missing-quote', atEdge }
	}
	assertQuoteDirection(quote, upstream.denom, downstream.denom)
	const value = convertBoundary({
		reqOut,
		rateNum: quote.rateNum,
		rateDen: quote.rateDen,
		scaleIn: upstream.scale,
		scaleOut: downstream.scale,
	})
	return { pruned: false, value }
}

/**
 * Guard the backward-direction invariant: at each boundary `From = D_in` (upstream,
 * received) and `To = D_out` (downstream, released). Inverting this inverts every
 * spread (the exchange-rate-quotes review bug), so a mis-directed quote is a
 * programming error, not a prune — it throws.
 */
function assertQuoteDirection(quote: RateQuote, upstreamDenom: string, downstreamDenom: string): void {
	if (quote.fromDenom !== upstreamDenom || quote.toDenom !== downstreamDenom) {
		throw new Error(
			`quote direction mismatch: expected From=${upstreamDenom} (D_in) To=${downstreamDenom} (D_out), ` +
				`got From=${quote.fromDenom} To=${quote.toDenom}`,
		)
	}
}

const PPM = 1_000_000n

/**
 * Compose the per-edge trading-variable fees as `1 − Π(1 − MyRate_k)`, exact in
 * bigint rationals, returned as ppm. Each edge's `MyRate_k` is the releasing
 * counterparty's `clutch` on the whole moved amount plus the receiver's `reward` on
 * the rewarded portion (units above `freeUnits`):
 *
 *   MyRate_k = [clutch_k·units_k + reward_k·rewardedPortion_k] / (1e6·units_k)
 *
 * so `(1 − MyRate_k)` has denominator `1e6·units_k`. A negative reward/clutch
 * (subsidy) is permitted, mirroring MyCHIPs' signed reward semantics, and can make
 * the composed fee negative.
 *
 * NOTE: this per-edge MyRate is a reasonable reading of the LiftLading free/rewarded
 * split, but the precise MyCHIPs fee-to-units mechanics are the commit ticket's to
 * finalize — the fee here is a comparison/disclosure metric, not a settlement input
 * (the settled per-edge units come from the conversion product above). If commit
 * needs a different fee model, this is the one site to change.
 */
function composeFeePpm(edges: RouteMathEdge[], perEdgeUnits: bigint[]): number {
	let complementNum = 1n
	let complementDen = 1n
	for (let k = 0; k < edges.length; k++) {
		const units = perEdgeUnits[k]
		if (units <= 0n) {
			continue // no movement on this edge → no fee contribution
		}
		const rewardedPortion = units > edges[k].freeUnits ? units - edges[k].freeUnits : 0n
		const clutch = BigInt(edges[k].clutch)
		const reward = BigInt(edges[k].reward)
		// (1 − MyRate_k) = (1e6·units − clutch·units − reward·rewardedPortion) / (1e6·units)
		const edgeNum = PPM * units - clutch * units - reward * rewardedPortion
		const edgeDen = PPM * units
		complementNum *= edgeNum
		complementDen *= edgeDen
	}
	// feeRatio = 1 − complement = (complementDen − complementNum) / complementDen; to ppm, rounded.
	const feeNum = complementDen - complementNum
	return roundRatioToPpm(feeNum, complementDen)
}

/** Round `num/den · 1e6` to the nearest integer ppm (den > 0), sign-correct. */
function roundRatioToPpm(num: bigint, den: bigint): number {
	if (den <= 0n) {
		throw new Error(`roundRatioToPpm: non-positive denominator ${den}`)
	}
	const scaled = num * PPM
	const half = den / 2n
	const rounded = scaled >= 0n ? (scaled + half) / den : (scaled - half) / den
	return Number(rounded)
}

/* ── Candidate routes + negotiate callbacks ──────────────────────────────────── */

/**
 * A candidate route as ChipNet's search assembles it: the identity of each edge
 * (anonymized `nonce`, plus `linkId`/`issuer` only for edges the originator owns)
 * alongside its accumulator math edge. Ordered originator → payee.
 */
export interface CandidateEdge {
	nonce: string
	linkId?: string
	issuer?: 'S' | 'F'
	math: RouteMathEdge
}

/** A candidate route with its accumulation outcome attached. */
export interface CandidateRoute {
	edges: CandidateEdge[]
	result: AccumulationResult
}

/**
 * The Taleus negotiate callbacks ChipNet's search drives. Ported minimally (no live
 * ChipNet), these are the accept/reject-plus-accumulate seam:
 *   - `negotiateIntent` accepts an `L` hop iff it has resolvable capacity to
 *     participate at all (a zero-capacity or unpriced-but-priceable hop is a
 *     candidate the plan step may still prune); a `C` hop is always acceptable.
 *   - `negotiatePlan` runs the full backward accumulation and accepts iff the route
 *     is costable end-to-end.
 */
export interface NegotiateCallbacks {
	negotiateIntent(intent: IntentCode, edge: RouteMathEdge): boolean
	negotiatePlan(route: CandidateEdge[], query: LiftQuery): CandidateRoute
}

/** Build the negotiate callbacks for one discovery session. Pure; correlate by `query.liftId` upstream. */
export function makeNegotiateCallbacks(): NegotiateCallbacks {
	return {
		negotiateIntent(intent, edge): boolean {
			if (intent === 'C') {
				return true // comms/relay hop carries no capacity
			}
			// Accept any lift hop that advertises non-zero movable capacity. A hop with zero
			// movable units is not a candidate (§ edge cases); real amount-vs-capacity and
			// quote pruning happen once the whole route is known, in negotiatePlan.
			return edge.freeUnits + edge.rewardedUnits > 0n
		},
		negotiatePlan(route, query): CandidateRoute {
			const result = accumulateRoute(
				route.map((e) => e.math),
				query.amount,
			)
			return { edges: route, result }
		},
	}
}

/* ── Route selection ─────────────────────────────────────────────────────────── */

/** Whether a candidate survived accumulation (was not pruned). */
export function isViable(candidate: CandidateRoute): candidate is CandidateRoute & { result: AccumulatedRoute } {
	return !candidate.result.pruned
}

/**
 * Select one route from the viable candidates: cheapest source cost first, then
 * lowest composed fee, then shortest (fewest edges) as a stable tiebreak. Returns
 * `null` when no candidate is viable. Deliberately does not over-search once a
 * satisfactory route is in hand (§ query economics) — selection is over what the
 * bounded search already returned, never a driver for more rounds.
 *
 * NOTE: `sourceUnits` is compared as a raw integer, which assumes every candidate
 * shares one source denomination — true today (a payment originates on the payer's
 * single chosen tally). If discovery ever returns candidates that originate on tallies
 * of DIFFERENT denominations (payer holds heterogeneous outbound tallies), comparing
 * their `sourceUnits` by `<` is meaningless (300 USD-cents vs 30 gold-units) and picks
 * the wrong route; selection would then need a common valuation across source denoms.
 */
export function selectRoute(candidates: CandidateRoute[]): (CandidateRoute & { result: AccumulatedRoute }) | null {
	const viable = candidates.filter(isViable)
	if (viable.length === 0) {
		return null
	}
	return viable.reduce((best, c) => {
		if (c.result.sourceUnits !== best.result.sourceUnits) {
			return c.result.sourceUnits < best.result.sourceUnits ? c : best
		}
		if (c.result.feeRatioPpm !== best.result.feeRatioPpm) {
			return c.result.feeRatioPpm < best.result.feeRatioPpm ? c : best
		}
		return c.edges.length < best.edges.length ? c : best
	})
}
