import { FORMAT_VERSION, TRACE_FORMAT_VERSION, makeNetworkSnapshot, type Network, type TraceLiftEntry, type TraceQueryEntry } from 'tallysim'
import type { TraceEvent } from 'tallynet'
import { createLiftResolver, createTraceIndex, indexTrace } from './trace-index.js'

const network: Network = {
	entityCount: 3,
	tallies: [
		{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
		{ stock: 1, foil: 2, balance: 0, stockCreditLimit: 100, foilCreditLimit: 100 },
	],
	meta: { generator: 'test', params: {}, seed: 1, formatVersion: FORMAT_VERSION },
}

const queries: TraceQueryEntry[] = [
	{ sessionCode: 'S1', from: 0, to: 2, amount: 1, depth: 3 },
	{ sessionCode: 'S2', from: 2, to: 0, amount: 1, depth: 3 },
]

// Events deliberately interleaved across the two sessions and not globally time-sorted in array order,
// to prove the index buckets by session while tracking min/max by comparison.
const events: TraceEvent[] = [
	{ time: 10, nodeId: '0', sessionCode: 'S1', type: 'query-received', nonce: '', depth: 1, round: 0 },
	{ time: 20, nodeId: '0', sessionCode: 'S1', type: 'query-sent', nonce: 'x', depth: 1, round: 1 },
	{ time: 15, nodeId: '2', sessionCode: 'S2', type: 'query-received', nonce: '', depth: 1, round: 0 },
	{ time: 30, nodeId: '1', sessionCode: 'S1', type: 'plan-returned', nonce: 'x' },
	{ time: 25, nodeId: '0', sessionCode: 'S2', type: 'plan-found' },
]

function headerLine(formatVersion: number, q: TraceQueryEntry[], lifts?: TraceLiftEntry[]): string {
	return JSON.stringify({
		kind: 'header',
		traceFormatVersion: formatVersion,
		tallysimVersion: '0.0.0-test',
		tallynetVersion: '0.0.0-test',
		scenario: {},
		runSeed: 1,
		queries: q,
		// Only stamp `lifts` when present, matching a discovery-only header (which omits the key entirely).
		...(lifts !== undefined ? { lifts } : {}),
	})
}

function traceLines(formatVersion: number, q: TraceQueryEntry[], evs: TraceEvent[], lifts?: TraceLiftEntry[]): string[] {
	return [
		headerLine(formatVersion, q, lifts),
		JSON.stringify(makeNetworkSnapshot(network)),
		...evs.map((event) => JSON.stringify({ kind: 'event', event })),
	]
}

describe('indexTrace', () => {
	it('indexes a trace into per-session event lists and global time bounds', () => {
		const idx = indexTrace(traceLines(TRACE_FORMAT_VERSION, queries, events))

		expect(idx.sessions()).toEqual(queries)
		expect(idx.queryFor('S1')).toEqual(queries[0])
		expect(idx.network.entityCount).toBe(3)

		expect(idx.eventsForSession('S1').map((e) => e.time)).toEqual([10, 20, 30])
		expect(idx.eventsForSession('S2').map((e) => e.time)).toEqual([15, 25])
		expect(idx.allEvents()).toHaveLength(5)
		expect(idx.timeBounds()).toEqual({ min: 10, max: 30 })
	})

	it('returns [] for a known session with no events and undefined bounds for an empty trace', () => {
		const idx = indexTrace(traceLines(TRACE_FORMAT_VERSION, queries, []))
		expect(idx.eventsForSession('S1')).toEqual([])
		expect(idx.timeBounds()).toBeUndefined()
		expect(idx.sessions()).toHaveLength(2)
	})

	it('propagates parseTrace version rejection unchanged (names found vs supported)', () => {
		expect(() => indexTrace(traceLines(999, queries, events))).toThrow(/traceFormatVersion 999/)
	})
})

describe('createTraceIndex (incremental builder)', () => {
	it('accepts events in chunks and matches a whole-file parse', () => {
		const full = indexTrace(traceLines(TRACE_FORMAT_VERSION, queries, events))
		const builder = createTraceIndex(full.header, full.network)

		builder.addAll(events.slice(0, 2))
		builder.addAll(events.slice(2))

		expect(builder.allEvents()).toHaveLength(5)
		expect(builder.eventsForSession('S1')).toEqual(full.eventsForSession('S1'))
		expect(builder.eventsForSession('S2')).toEqual(full.eventsForSession('S2'))
		expect(builder.timeBounds()).toEqual({ min: 10, max: 30 })
	})

	it('buckets an event whose session is not in the header without listing it in sessions()', () => {
		const builder = createTraceIndex(
			{
				kind: 'header',
				traceFormatVersion: TRACE_FORMAT_VERSION,
				tallysimVersion: 't',
				tallynetVersion: 't',
				// The scenario is never read by the index; a stub keeps this fixture small.
				scenario: {} as never,
				runSeed: 1,
				queries,
			},
			network,
		)
		builder.add({ time: 5, nodeId: '0', sessionCode: 'UNKNOWN', type: 'plan-found' })
		expect(builder.eventsForSession('UNKNOWN')).toHaveLength(1)
		expect(builder.sessions()).toEqual(queries)
	})
})

describe('createLiftResolver', () => {
	// A path lift 0→1→2: hop 0 joins 0↔1 on tally 0, hop 1 joins 1↔2 on tally 1.
	const pathLift: TraceLiftEntry = {
		sessionCode: 'S1',
		transactionCode: 'TX1',
		route: [0, 1, 2],
		tallyPath: [0, 1],
		memberKeys: { m0: 0, m1: 1, m2: 2 },
		amount: 1,
	}

	it('maps a member key to its entity id (and an unknown key to undefined)', () => {
		const resolver = createLiftResolver(pathLift)
		expect(resolver.entityOfMember('m0')).toBe(0)
		expect(resolver.entityOfMember('m2')).toBe(2)
		expect(resolver.entityOfMember('not-a-member')).toBeUndefined()
	})

	it('resolves an adjacent (from, to) pair to its tally index, order-independently', () => {
		const resolver = createLiftResolver(pathLift)
		expect(resolver.tallyOfEdge(0, 1)).toBe(0)
		expect(resolver.tallyOfEdge(1, 0)).toBe(0) // same undirected pair
		expect(resolver.tallyOfEdge(1, 2)).toBe(1)
		// 0 and 2 are not adjacent on this path route — no hop, no tally.
		expect(resolver.tallyOfEdge(0, 2)).toBeUndefined()
	})

	it('resolves a circular lift originator on its two distinct hops without ambiguity', () => {
		// A ring 0→1→2→0: the originator 0 sits on hop 0 (0↔1, tally 0) and the closing hop 2 (2↔0, tally 2).
		const loopLift: TraceLiftEntry = {
			sessionCode: 'S1',
			transactionCode: 'TXL',
			route: [0, 1, 2, 0],
			tallyPath: [0, 1, 2],
			memberKeys: { m0: 0, m1: 1, m2: 2 },
			amount: 1,
		}
		const resolver = createLiftResolver(loopLift)
		expect(resolver.tallyOfEdge(0, 1)).toBe(0) // opening hop
		expect(resolver.tallyOfEdge(1, 2)).toBe(1)
		expect(resolver.tallyOfEdge(2, 0)).toBe(2) // closing hop — distinct pair {0,2}, so unambiguous
	})
})

describe('index lifts (consensus v2)', () => {
	const pathLift: TraceLiftEntry = {
		sessionCode: 'S1',
		transactionCode: 'TX1',
		route: [0, 1, 2],
		tallyPath: [0, 1],
		memberKeys: { m0: 0, m1: 1, m2: 2 },
		amount: 1,
	}

	it('indexes the header lifts by session code and transaction code', () => {
		const idx = indexTrace(traceLines(TRACE_FORMAT_VERSION, queries, events, [pathLift]))
		expect(idx.lifts()).toEqual([pathLift])
		expect(idx.liftFor('S1')).toEqual(pathLift)
		expect(idx.liftFor('S2')).toBeUndefined() // S2 drove no lift
		expect(idx.liftByTransaction('TX1')).toEqual(pathLift)
		expect(idx.liftByTransaction('absent-tx')).toBeUndefined()
	})

	it('a trace with no lifts header (v1 / discovery-only v2) has an empty lifts() and no bindings', () => {
		const idx = indexTrace(traceLines(TRACE_FORMAT_VERSION, queries, events))
		expect(idx.lifts()).toEqual([])
		expect(idx.liftFor('S1')).toBeUndefined()
		expect(idx.liftByTransaction('TX1')).toBeUndefined()
	})
})
