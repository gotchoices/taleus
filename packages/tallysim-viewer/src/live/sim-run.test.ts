import { TRACE_FORMAT_VERSION, type QueryOutcome, type QuerySpec, type SimScenario } from 'tallysim'
import { VIEWER_VERSIONS, buildRunHeader, plansToRoutes } from './sim-run.js'

/** A minimal but valid scenario (the provenance a header embeds); its exact contents don't matter here. */
function scenario(): SimScenario {
	return {
		network: { generator: 'scale-free', params: { entityCount: 10, edgesPerNode: 3 }, capacity: { kind: 'unlimited' }, seed: 7 },
		workload: { kind: 'payment', queries: 1, amount: { dist: 'constant', params: { value: 100 } }, depth: 6, seed: 0 },
	}
}

/** A plan with the given ordered (nonce, intents) hops, shaped like `QueryOutcome.plans[i]`. */
function plan(hops: { nonce: string; intents: Record<string, unknown> }[]): QueryOutcome['plans'][number] {
	return { path: hops as QueryOutcome['plans'][number]['path'], members: [] }
}

describe('buildRunHeader', () => {
	const query: QuerySpec = { from: 1, to: 4, amount: 100, depth: 6 }

	it('stamps the format version, the viewer provenance, scenario, run seed and the one query entry', () => {
		const header = buildRunHeader(scenario(), 0, 'sess-ABC', query)
		expect(header).toEqual({
			kind: 'header',
			traceFormatVersion: TRACE_FORMAT_VERSION,
			tallysimVersion: VIEWER_VERSIONS.tallysimVersion,
			tallynetVersion: VIEWER_VERSIONS.tallynetVersion,
			scenario: scenario(),
			runSeed: 0,
			queries: [{ sessionCode: 'sess-ABC', from: 1, to: 4, amount: 100, depth: 6 }],
		})
	})

	it('joins the minted session code to the query (the field the reader joins events on)', () => {
		const header = buildRunHeader(scenario(), 0, 'sess-XYZ', query)
		expect(header.queries).toHaveLength(1)
		expect(header.queries[0].sessionCode).toBe('sess-XYZ')
	})

	it('carries a non-zero run seed through unchanged', () => {
		expect(buildRunHeader(scenario(), 5, 'sess', query).runSeed).toBe(5)
	})
})

describe('plansToRoutes', () => {
	it('maps each plan to its ordered link nonces and index-aligned opaque terms', () => {
		const plans = [
			plan([
				{ nonce: 'n0', intents: { L: { capFwd: 100, capBack: 0, amount: 0 } } },
				{ nonce: 'n1', intents: { L: { capFwd: 50, capBack: 10, amount: 0 } } },
			]),
		]
		expect(plansToRoutes(plans, 1, 4)).toEqual([
			{
				from: 1,
				to: 4,
				linkNonces: ['n0', 'n1'],
				terms: [{ L: { capFwd: 100, capBack: 0, amount: 0 } }, { L: { capFwd: 50, capBack: 10, amount: 0 } }],
			},
		])
	})

	it('keeps the nonces and terms index-aligned (same path order)', () => {
		const route = plansToRoutes([plan([{ nonce: 'a', intents: { L: 1 } }, { nonce: 'b', intents: { L: 2 } }])], 0, 9)[0]
		expect(route.linkNonces).toEqual(['a', 'b'])
		route.linkNonces.forEach((_nonce, i) => {
			expect((route.terms?.[i] as Record<string, number>).L).toBe(i + 1)
		})
	})

	it('maps every plan when the search finds more than one route', () => {
		const plans = [plan([{ nonce: 'x', intents: {} }]), plan([{ nonce: 'y', intents: {} }, { nonce: 'z', intents: {} }])]
		expect(plansToRoutes(plans, 2, 3).map((r) => r.linkNonces)).toEqual([['x'], ['y', 'z']])
	})

	it('carries a self-payment loop through (from === to, its path nonces draw the closed loop)', () => {
		const route = plansToRoutes([plan([{ nonce: 'p', intents: {} }, { nonce: 'q', intents: {} }])], 3, 3)[0]
		expect(route).toMatchObject({ from: 3, to: 3, linkNonces: ['p', 'q'] })
	})

	it('returns an empty list for no plans (a not-found or degenerate run)', () => {
		expect(plansToRoutes([], 1, 2)).toEqual([])
	})

	it('maps an empty-path plan to empty nonces (never throws)', () => {
		expect(plansToRoutes([plan([])], 1, 2)).toEqual([{ from: 1, to: 2, linkNonces: [], terms: [] }])
	})
})
