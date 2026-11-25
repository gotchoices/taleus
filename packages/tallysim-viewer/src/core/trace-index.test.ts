import { FORMAT_VERSION, TRACE_FORMAT_VERSION, makeNetworkSnapshot, type Network, type TraceQueryEntry } from 'tallysim'
import type { TraceEvent } from 'tallynet'
import { createTraceIndex, indexTrace } from './trace-index.js'

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

function headerLine(formatVersion: number, q: TraceQueryEntry[]): string {
	return JSON.stringify({
		kind: 'header',
		traceFormatVersion: formatVersion,
		tallysimVersion: '0.0.0-test',
		tallynetVersion: '0.0.0-test',
		scenario: {},
		runSeed: 1,
		queries: q,
	})
}

function traceLines(formatVersion: number, q: TraceQueryEntry[], evs: TraceEvent[]): string[] {
	return [
		headerLine(formatVersion, q),
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
