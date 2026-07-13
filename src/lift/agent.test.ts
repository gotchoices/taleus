import {
	LiftAgent,
	LiftJournalOriginatorState,
	type JournalEdge,
	type LiftQuery,
} from './index.js'
import {
	candidateEdge,
	InMemoryLiftJournalStore,
	liftMathEdge,
	rate,
	ScriptedDiscoveryEngine,
	type RouteSpec,
} from './test-harness.js'

const REFEREE = { key: 'referee-pub-key' }

/** A monotonic string clock so journal `Updated` timestamps are deterministic per test. */
function clock(): () => string {
	let t = 0
	return () => `t${t++}`
}

function makeAgent(specs: RouteSpec[]): { agent: LiftAgent; store: InMemoryLiftJournalStore } {
	const store = new InMemoryLiftJournalStore()
	const state = new LiftJournalOriginatorState(store, clock())
	const agent = new LiftAgent({ engine: new ScriptedDiscoveryEngine(specs), state, referee: REFEREE })
	return { agent, store }
}

/** originator USD(2) → payee CHIP(3), quote From=USD To=CHIP 2/1; 1500 milliCHIP costs 300 cents. */
function twoDenomRoute(): RouteSpec {
	return {
		edges: [
			candidateEdge('n-usd', liftMathEdge('USD', 2, { free: 10_000n }, rate('USD', 'CHIP', 2n, 1n)), { linkId: 'tally-usd', issuer: 'F' }),
			candidateEdge('n-chip', liftMathEdge('CHIP', 3, { free: 10_000n })),
		],
	}
}

function paymentQuery(overrides: Partial<LiftQuery> = {}): LiftQuery {
	return {
		liftId: 'L1',
		sessionCode: 's1',
		kind: 'payment',
		amount: 1500n,
		payeeDenom: 'CHIP',
		payeeScale: 3,
		date: '2026-07-13',
		...overrides,
	}
}

describe('LiftAgent.discover', () => {
	it('selects a route and surfaces the exact source cost = accumulated req_in at the originator edge', async () => {
		const { agent } = makeAgent([twoDenomRoute()])
		const outcome = await agent.discover(paymentQuery())

		expect(outcome.found).toBe(true)
		if (!outcome.found) {
			return
		}
		expect(outcome.source).toEqual({ denom: 'USD', scale: 2, units: 300n, feeRatioPpm: 0 })
		// The presented cost is exactly the originator-edge requirement.
		expect(outcome.source.units).toBe(outcome.plan.edges[0].units)
		expect(outcome.plan.edges.map((e) => e.units)).toEqual([300n, 1500n])
		expect(outcome.plan.referee).toEqual(REFEREE)
		expect(outcome.plan.edges[0]).toMatchObject({ linkId: 'tally-usd', issuer: 'F', nonce: 'n-usd' })
	})

	it('journals discovering → selected, monotonic revisions, with the chosen topology', async () => {
		const { agent, store } = makeAgent([twoDenomRoute()])
		await agent.discover(paymentQuery())

		const states = store.rows.map((r) => ({ rev: r.revision, state: r.state }))
		expect(states).toEqual([
			{ rev: 1, state: 'discovering' },
			{ rev: 2, state: 'selected' },
		])
		const edges = JSON.parse(store.rows[1].edges) as JournalEdge[]
		expect(edges).toEqual([
			{ strandId: 'tally-usd', denom: 'USD', units: '300', direction: 'source' },
			{ strandId: 'n-chip', denom: 'CHIP', units: '1500', direction: 'payee' },
		])
	})

	it('returns no-viable-route (journaling aborted) when every candidate is pruned — not a throw', async () => {
		const prunedByQuote: RouteSpec = {
			edges: [
				candidateEdge('n0', liftMathEdge('USD', 2, { free: 10_000n }, null)),
				candidateEdge('n1', liftMathEdge('CHIP', 3, { free: 10_000n })),
			],
		}
		const { agent, store } = makeAgent([prunedByQuote])
		const outcome = await agent.discover(paymentQuery())

		expect(outcome).toEqual({ found: false, reason: 'no-viable-route' })
		expect(store.rows.map((r) => r.state)).toEqual(['discovering', 'aborted'])
	})

	it('prunes a zero-reserved-capacity route so it never appears as the selected candidate', async () => {
		const zeroCap: RouteSpec = {
			edges: [
				candidateEdge('z0', liftMathEdge('CHIP', 3, { free: 0n, rewarded: 0n })),
				candidateEdge('z1', liftMathEdge('CHIP', 3, { free: 10_000n })),
			],
		}
		const single: LiftQuery = paymentQuery({ payeeDenom: 'CHIP' })
		const { agent } = makeAgent([zeroCap, twoDenomRoute()])
		const outcome = await agent.discover(single)

		expect(outcome.found).toBe(true)
		if (outcome.found) {
			// The viable USD→CHIP route wins; the zero-capacity route is never chosen.
			expect(outcome.plan.edges[0].nonce).toBe('n-usd')
		}
	})

	it('skips a sleeping edge without failing the round: a live route is still selected', async () => {
		const sleeping: RouteSpec = { ...twoDenomRoute(), sleeping: true }
		const live: RouteSpec = {
			edges: [
				candidateEdge('live-usd', liftMathEdge('USD', 2, { free: 10_000n }, rate('USD', 'CHIP', 3n, 1n)), { linkId: 'live', issuer: 'F' }),
				candidateEdge('live-chip', liftMathEdge('CHIP', 3, { free: 10_000n })),
			],
		}
		const { agent } = makeAgent([sleeping, live])
		const outcome = await agent.discover(paymentQuery())

		expect(outcome.found).toBe(true)
		if (outcome.found) {
			expect(outcome.plan.edges[0].nonce).toBe('live-usd')
			expect(outcome.source.units).toBe(450n) // 1500 milliCHIP at 3/1, scale 2 vs 3
		}
	})

	it('a round where the only route is sleeping is empty, not a failure (no throw)', async () => {
		const { agent } = makeAgent([{ ...twoDenomRoute(), sleeping: true }])
		await expect(agent.discover(paymentQuery())).resolves.toEqual({ found: false, reason: 'no-viable-route' })
	})

	it('correlates concurrent discoveries strictly by liftId — no cross-contamination', async () => {
		const store = new InMemoryLiftJournalStore()
		const state = new LiftJournalOriginatorState(store, clock())

		// Two independent agents/engines sharing one journal store, distinct liftIds.
		const agentA = new LiftAgent({ engine: new ScriptedDiscoveryEngine([twoDenomRoute()]), state, referee: REFEREE })
		const chipOnly: RouteSpec = {
			edges: [
				candidateEdge('c0', liftMathEdge('CHIP', 3, { free: 10_000n }), { linkId: 'own', issuer: 'F' }),
				candidateEdge('c1', liftMathEdge('CHIP', 3, { free: 10_000n })),
			],
		}
		const agentB = new LiftAgent({ engine: new ScriptedDiscoveryEngine([chipOnly]), state, referee: REFEREE })

		const [a, b] = await Promise.all([
			agentA.discover(paymentQuery({ liftId: 'LA', amount: 1500n })),
			agentB.discover(paymentQuery({ liftId: 'LB', amount: 900n, kind: 'circular' })),
		])

		expect(a.found && a.source.units).toBe(300n) // USD cost of LA
		expect(b.found && b.source.units).toBe(900n) // single-denom LB, no conversion

		const rowsA = store.rows.filter((r) => r.liftId === 'LA').map((r) => r.state)
		const rowsB = store.rows.filter((r) => r.liftId === 'LB').map((r) => r.state)
		expect(rowsA).toEqual(['discovering', 'selected'])
		expect(rowsB).toEqual(['discovering', 'selected'])
		// LB's journal edges are CHIP-only; LA's carry the USD source edge — no bleed-through.
		const bEdges = JSON.parse(store.rows.filter((r) => r.liftId === 'LB').at(-1)!.edges) as JournalEdge[]
		expect(bEdges.every((e) => e.denom === 'CHIP')).toBe(true)
	})
})

describe('LiftJournalOriginatorState', () => {
	it('appends monotonic revisions and reads the current row', async () => {
		const store = new InMemoryLiftJournalStore()
		const state = new LiftJournalOriginatorState(store, clock())

		await state.record('L1', 'discovering', [], 'ref')
		await state.record('L1', 'selected', [{ strandId: 's', denom: 'CHIP', units: '5', direction: 'source' }], 'ref')

		const current = await state.read('L1')
		expect(current?.revision).toBe(2)
		expect(current?.state).toBe('selected')
		expect(current?.role).toBe('O')
	})
})
