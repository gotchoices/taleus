import type { TraceEvent } from 'tallynet'
import { FORMAT_VERSION, type Network, serialize } from '../model.js'
import type { SimScenario } from '../scenario.js'
import {
	TRACE_FORMAT_VERSION,
	type TraceLiftEntry,
	type TraceLine,
	buildTraceHeader,
	makeNetworkSnapshot,
	parseTrace,
	serializeTraceLine,
} from './trace-format.js'

function networkWith(tallies: Network['tallies'], entityCount: number): Network {
	return {
		entityCount,
		tallies,
		meta: { generator: 'test', params: { entityCount }, seed: 7, formatVersion: FORMAT_VERSION },
	}
}

const scenario: SimScenario = {
	network: { generator: 'uniform', params: { entityCount: 3, meanDegree: 2 }, capacity: { kind: 'constant', value: 100 }, seed: 1 },
	workload: { kind: 'payment', queries: 2, amount: { dist: 'constant', params: { value: 100 } }, depth: 7, seed: 1 },
}

function event(sessionCode: string, time: number): TraceEvent {
	return { type: 'query-sent', time, nodeId: '0', sessionCode, nonce: 'n1', depth: 0, round: 1 }
}

/** Serialise a header + network + events into NDJSON lines, as a file on disk would hold them. */
function linesFor(network: Network, events: TraceEvent[], lifts?: TraceLiftEntry[]): string[] {
	const header = buildTraceHeader({
		tallysimVersion: '0.1.0',
		tallynetVersion: '0.1.0',
		scenario,
		runSeed: 0,
		queries: [{ sessionCode: 'S1', from: 0, to: 2, amount: 100, depth: 7 }],
		lifts,
	})
	const lines: TraceLine[] = [header, makeNetworkSnapshot(network), ...events.map((e) => ({ kind: 'event' as const, event: e }))]
	return lines.map(serializeTraceLine)
}

/** One lift-header fixture joining to the `S1` query above. */
const lift: TraceLiftEntry = {
	sessionCode: 'S1',
	transactionCode: 'TX1',
	route: [0, 1, 2],
	tallyPath: [0, 1],
	memberKeys: { 'key-0': 0, 'key-1': 1, 'key-2': 2 },
	amount: 100,
}

describe('trace-format round-trip', () => {
	it('round-trips header, network and events in order', () => {
		const network = networkWith(
			[
				{ stock: 0, foil: 1, balance: 3, stockCreditLimit: 10, foilCreditLimit: 5 },
				{ stock: 1, foil: 2, balance: -4, stockCreditLimit: 20, foilCreditLimit: 8 },
			],
			3,
		)
		const events = [event('S1', 100), event('S2', 200), event('S1', 300)]
		const parsed = parseTrace(linesFor(network, events))

		expect(parsed.header.traceFormatVersion).toBe(TRACE_FORMAT_VERSION)
		expect(parsed.header.scenario).toEqual(scenario)
		expect(parsed.header.queries).toEqual([{ sessionCode: 'S1', from: 0, to: 2, amount: 100, depth: 7 }])
		// The rebuilt network serialises byte-identically to the original (and so deserialises identically).
		expect(serialize(parsed.network)).toBe(serialize(network))
		expect(parsed.network).toEqual(network)
		expect([...parsed.events()]).toEqual(events)
	})

	it('rebuilds an unlimited-capacity network byte-identically (Infinity ↔ null)', () => {
		const network = networkWith(
			[{ stock: 0, foil: 1, balance: 0, stockCreditLimit: Infinity, foilCreditLimit: Infinity }],
			2,
		)
		const parsed = parseTrace(linesFor(network, []))
		expect(parsed.network.tallies[0].stockCreditLimit).toBe(Infinity)
		expect(parsed.network).toEqual(network)
		expect(serialize(parsed.network)).toBe(serialize(network))
	})

	it('tolerates a trailing blank line (NDJSON files end with a newline)', () => {
		const network = networkWith([{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 5, foilCreditLimit: 5 }], 2)
		const lines = [...linesFor(network, [event('S1', 1)]), '']
		const parsed = parseTrace(lines)
		expect([...parsed.events()]).toEqual([event('S1', 1)])
	})

	it('round-trips a consensus-shaped event unchanged (no format bump needed)', () => {
		const network = networkWith([{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 5, foilCreditLimit: 5 }], 2)
		const consensusEvent: TraceEvent = {
			type: 'settled',
			time: 42,
			nodeId: '1',
			sessionCode: 'S9',
			transactionCode: 'TX9',
			decision: 'commit',
		}
		const parsed = parseTrace(linesFor(network, [consensusEvent]))
		expect([...parsed.events()]).toEqual([consensusEvent])
	})
})

describe('trace-format header lifts (v2)', () => {
	const network = networkWith([{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 5, foilCreditLimit: 5 }], 2)

	it('a v2 header with lifts round-trips (deep-equal)', () => {
		const parsed = parseTrace(linesFor(network, [], [lift]))
		expect(parsed.header.traceFormatVersion).toBe(2)
		expect(parsed.header.lifts).toEqual([lift])
	})

	it('a v2 discovery-only header has no lifts (the field is omitted, not empty)', () => {
		const lines = linesFor(network, [])
		// The header JSON must not carry a `lifts` key when none was supplied (byte-identical to a v1 header
		// but for the version field).
		expect(JSON.parse(lines[0])).not.toHaveProperty('lifts')
		expect(parseTrace(lines).header.lifts).toBeUndefined()
	})

	it('a v1 file (older build, no lifts) still parses, with lifts absent', () => {
		const lines = linesFor(network, [event('S1', 1)])
		const header = JSON.parse(lines[0]) as { traceFormatVersion: number }
		header.traceFormatVersion = 1 // pretend an older, v1 writer produced this file
		lines[0] = JSON.stringify(header)
		const parsed = parseTrace(lines)
		expect(parsed.header.traceFormatVersion).toBe(1)
		expect(parsed.header.lifts).toBeUndefined()
		expect([...parsed.events()]).toEqual([event('S1', 1)])
	})
})

describe('trace-format version + shape checks', () => {
	const network = networkWith([{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 5, foilCreditLimit: 5 }], 2)

	it('rejects an unsupported traceFormatVersion, naming found vs the supported set', () => {
		const lines = linesFor(network, [])
		const bumped = JSON.parse(lines[0]) as { traceFormatVersion: number }
		bumped.traceFormatVersion = 3 // past the supported {1, 2}
		lines[0] = JSON.stringify(bumped)
		expect(() => parseTrace(lines)).toThrow(/unsupported traceFormatVersion 3 \(this build reads 1, 2\)/)
	})

	it('rejects a garbage traceFormatVersion', () => {
		const lines = linesFor(network, [])
		lines[0] = JSON.stringify({ ...(JSON.parse(lines[0]) as object), traceFormatVersion: 'x' })
		expect(() => parseTrace(lines)).toThrow(/unsupported traceFormatVersion/)
	})

	it('throws when the first line is not a header', () => {
		expect(() => parseTrace(['{"kind":"network"}'])).toThrow(/first line is not a header/)
	})

	it('throws on empty input', () => {
		expect(() => parseTrace([])).toThrow(/empty input/)
	})

	it('throws when the network line is missing', () => {
		const lines = linesFor(network, [])
		expect(() => parseTrace([lines[0]])).toThrow(/missing network-snapshot line/)
	})

	it('throws a clear error on a malformed header line', () => {
		expect(() => parseTrace(['{not json'])).toThrow(/malformed header line/)
	})
})
