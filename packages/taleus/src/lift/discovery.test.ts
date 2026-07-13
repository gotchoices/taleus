import {
	accumulateRoute,
	isViable,
	makeNegotiateCallbacks,
	selectRoute,
	type AccumulatedRoute,
	type CandidateRoute,
	type LiftQuery,
	type RouteMathEdge,
} from './discovery.js'
import { candidateEdge, liftMathEdge, rate } from './test-harness.js'

/** An accumulation that must have survived — narrows the union for assertions. */
function survived(edges: RouteMathEdge[], amount: bigint): AccumulatedRoute {
	const r = accumulateRoute(edges, amount)
	if (r.pruned) {
		throw new Error(`expected a viable route, got prune ${r.reason} at edge ${r.atEdge}`)
	}
	return r
}

describe('accumulateRoute — conversion product (backward from payee)', () => {
	it('two-denomination payment: source cost is the accumulated req_in at the originator edge, dust upstream', () => {
		// originator edge USD (scale 2), payee edge CHIP (scale 3); boundary quote From=USD To=CHIP = 2/1.
		// Payee receives 1500 milliCHIP (1.5 CHIP); source cost = 300 cents ($3.00).
		const edges = [
			liftMathEdge('USD', 2, { free: 10_000n }, rate('USD', 'CHIP', 2n, 1n)),
			liftMathEdge('CHIP', 3, { free: 10_000n }),
		]
		const r = survived(edges, 1500n)
		expect(r.perEdgeUnits).toEqual([300n, 1500n])
		expect(r.sourceUnits).toBe(300n) // === perEdgeUnits[0], the originator-edge requirement
	})

	it('rounds up per boundary so the payee is never shorted (dust borne by the originator)', () => {
		// 7 units of D_out at rate 3/2, equal scales: ceil(7*3/2) = ceil(10.5) = 11 upstream.
		const edges = [liftMathEdge('A', 0, { free: 100n }, rate('A', 'B', 3n, 2n)), liftMathEdge('B', 0, { free: 100n })]
		const r = survived(edges, 7n)
		expect(r.sourceUnits).toBe(11n)
	})

	it('composes a three-denomination chain walked A→B→C (payee at C)', () => {
		// Route originator→payee = [A(2), B(3), C(0)]; amount at C = 7.
		const edges = [
			liftMathEdge('A', 2, { free: 100_000n }, rate('A', 'B', 3n, 4n)),
			liftMathEdge('B', 3, { free: 100_000n }, rate('B', 'C', 5n, 2n)),
			liftMathEdge('C', 0, { free: 100n }),
		]
		const r = survived(edges, 7n)
		expect(r.perEdgeUnits).toEqual([1313n, 17_500n, 7n])
		expect(r.sourceUnits).toBe(1313n)
	})

	it('composes the same three denominations walked the other way C→B→A (payee at A)', () => {
		// Route originator→payee = [C(0), B(3), A(2)]; amount at A = 9. reqB=210, reqC=1.
		const edges = [
			liftMathEdge('C', 0, { free: 100n }, rate('C', 'B', 11n, 13n)),
			liftMathEdge('B', 3, { free: 100_000n }, rate('B', 'A', 7n, 3n)),
			liftMathEdge('A', 2, { free: 100n }),
		]
		const r = survived(edges, 9n)
		expect(r.perEdgeUnits).toEqual([1n, 210n, 9n])
		expect(r.sourceUnits).toBe(1n)
	})

	it('single-denomination circular clearing lift is degenerate: all rates 1, ceiling a no-op, MyCHIPs-equal', () => {
		// Every edge is CHIP → same-denom boundary → no quote lookup. The bogus quotes below would
		// throw the direction assert IF consulted; the result being unchanged (42) proves they are not.
		const edges = [
			liftMathEdge('CHIP', 2, { free: 1000n }, rate('WRONG', 'ALSO_WRONG', 999n, 1n)),
			liftMathEdge('CHIP', 2, { free: 1000n }, rate('WRONG', 'ALSO_WRONG', 999n, 1n)),
			liftMathEdge('CHIP', 2, { free: 1000n }),
		]
		const r = survived(edges, 42n)
		expect(r.perEdgeUnits).toEqual([42n, 42n, 42n])
		expect(r.sourceUnits).toBe(42n)
	})
})

describe('accumulateRoute — pruning (never a throw)', () => {
	it('prunes a real denomination change with no usable quote (missing/expired)', () => {
		const edges = [liftMathEdge('USD', 2, { free: 10_000n }, null), liftMathEdge('CHIP', 3, { free: 10_000n })]
		const r = accumulateRoute(edges, 1500n)
		expect(r).toEqual({ pruned: true, reason: 'missing-quote', atEdge: 0 })
	})

	it('prunes an edge with zero movable capacity (also the no-CreditTerms → 0-limit case)', () => {
		const edges = [liftMathEdge('CHIP', 2, { free: 0n, rewarded: 0n }), liftMathEdge('CHIP', 2, { free: 100n })]
		const r = accumulateRoute(edges, 42n)
		expect(r).toEqual({ pruned: true, reason: 'zero-capacity', atEdge: 0 })
	})

	it('prunes when required units exceed an edge’s movable capacity', () => {
		const edges = [liftMathEdge('CHIP', 2, { free: 10n }), liftMathEdge('CHIP', 2, { free: 100n })]
		const r = accumulateRoute(edges, 42n) // needs 42 on edge 0, only 10 movable
		expect(r).toEqual({ pruned: true, reason: 'insufficient-capacity', atEdge: 0 })
	})

	it('free + rewarded together satisfy capacity (rewarded units are movable, at a fee)', () => {
		const edges = [liftMathEdge('CHIP', 2, { free: 10n, rewarded: 40n }), liftMathEdge('CHIP', 2, { free: 100n })]
		const r = survived(edges, 42n) // 42 <= 10 + 40
		expect(r.sourceUnits).toBe(42n)
	})
})

describe('accumulateRoute — backward-direction invariant', () => {
	it('throws (programming error, not a prune) if a boundary quote is mis-directed', () => {
		// Route [USD, CHIP] needs From=USD To=CHIP; a From=CHIP To=USD quote inverts the spread.
		const edges = [
			liftMathEdge('USD', 2, { free: 10_000n }, rate('CHIP', 'USD', 2n, 1n)),
			liftMathEdge('CHIP', 3, { free: 10_000n }),
		]
		expect(() => accumulateRoute(edges, 1500n)).toThrow(/direction mismatch/)
	})
})

describe('accumulateRoute — fee composition (1 − Π(1 − MyRate))', () => {
	it('a single clutch fee applies to the whole moved amount', () => {
		const edges = [liftMathEdge('CHIP', 2, { free: 1000n, clutch: 100_000 }), liftMathEdge('CHIP', 2, { free: 1000n })]
		expect(survived(edges, 100n).feeRatioPpm).toBe(100_000) // 10% on edge 0
	})

	it('two clutch fees compose multiplicatively, not additively', () => {
		const edges = [
			liftMathEdge('CHIP', 2, { free: 1000n, clutch: 100_000 }),
			liftMathEdge('CHIP', 2, { free: 1000n, clutch: 100_000 }),
		]
		// 1 − 0.9·0.9 = 0.19
		expect(survived(edges, 100n).feeRatioPpm).toBe(190_000)
	})

	it('reward applies only to the rewarded portion (units above free)', () => {
		// free=0 → all 100 units rewarded at 20%: MyRate = 0.2.
		const edges = [liftMathEdge('CHIP', 2, { free: 0n, rewarded: 1000n, reward: 200_000 }), liftMathEdge('CHIP', 2, { free: 1000n })]
		expect(survived(edges, 100n).feeRatioPpm).toBe(200_000)
	})

	it('a negative fee (subsidy) is permitted and composes as a net subsidy', () => {
		const edges = [liftMathEdge('CHIP', 2, { free: 1000n, clutch: -100_000 }), liftMathEdge('CHIP', 2, { free: 1000n })]
		expect(survived(edges, 100n).feeRatioPpm).toBe(-100_000)
	})
})

describe('negotiate callbacks', () => {
	const callbacks = makeNegotiateCallbacks()

	it('accepts a lift hop with capacity, rejects a zero-capacity hop, always accepts comms', () => {
		expect(callbacks.negotiateIntent('L', liftMathEdge('CHIP', 2, { free: 5n }))).toBe(true)
		expect(callbacks.negotiateIntent('L', liftMathEdge('CHIP', 2, { free: 0n, rewarded: 0n }))).toBe(false)
		expect(callbacks.negotiateIntent('C', liftMathEdge('CHIP', 2, { free: 0n }))).toBe(true)
	})

	it('negotiatePlan runs the full backward accumulation over a candidate route', () => {
		const query: LiftQuery = {
			liftId: 'L1',
			sessionCode: 's1',
			kind: 'payment',
			amount: 1500n,
			payeeDenom: 'CHIP',
			payeeScale: 3,
			date: '2026-07-13',
		}
		const route = [
			candidateEdge('n0', liftMathEdge('USD', 2, { free: 10_000n }, rate('USD', 'CHIP', 2n, 1n)), { linkId: 'tally-0', issuer: 'F' }),
			candidateEdge('n1', liftMathEdge('CHIP', 3, { free: 10_000n })),
		]
		const candidate = callbacks.negotiatePlan(route, query)
		expect(isViable(candidate)).toBe(true)
		expect((candidate.result as AccumulatedRoute).sourceUnits).toBe(300n)
	})
})

describe('selectRoute', () => {
	function viable(source: bigint, fee: number, edges = 2): CandidateRoute {
		return {
			edges: Array.from({ length: edges }, (_v, i) => candidateEdge(`n${i}`, liftMathEdge('CHIP', 2, { free: 1n }))),
			result: { pruned: false, perEdgeUnits: [source], sourceUnits: source, feeRatioPpm: fee },
		}
	}

	it('returns null when nothing is viable, and never a pruned route', () => {
		const pruned: CandidateRoute = {
			edges: [candidateEdge('n0', liftMathEdge('USD', 2, { free: 1n }, null)), candidateEdge('n1', liftMathEdge('CHIP', 3, { free: 1n }))],
			result: { pruned: true, reason: 'missing-quote', atEdge: 0 },
		}
		expect(selectRoute([pruned])).toBeNull()
	})

	it('picks the cheapest source cost, breaking ties by lower fee then fewer edges', () => {
		const cheap = viable(300n, 5000)
		const dear = viable(305n, 0)
		expect(selectRoute([dear, cheap])).toBe(cheap)

		const lowFee = viable(300n, 100)
		const highFee = viable(300n, 900)
		expect(selectRoute([highFee, lowFee])).toBe(lowFee)
	})

	it('ignores pruned candidates when a viable one exists', () => {
		const pruned: CandidateRoute = {
			edges: [candidateEdge('x', liftMathEdge('CHIP', 2, { free: 0n }))],
			result: { pruned: true, reason: 'zero-capacity', atEdge: 0 },
		}
		const good = viable(300n, 0)
		expect(selectRoute([pruned, good])).toBe(good)
	})
})
