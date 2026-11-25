import type { TraceEvent } from 'tallynet'
import { FORMAT_VERSION, type Network } from '../model.js'
import type { SimScenario } from '../scenario.js'
import { buildSimNetwork, runQuery } from './harness.js'
import { type TraceHeader, buildTraceHeader, makeNetworkSnapshot, parseTrace } from './trace-format.js'
import { makeTraceWriter } from './trace-writer.js'

/** A 3-entity line 0—1—2, every direction amply capitalised, so 0 → 2 for 100 is always found. */
function lineNetwork(): Network {
	return {
		entityCount: 3,
		tallies: [
			{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
			{ stock: 1, foil: 2, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
		],
		meta: { generator: 'test', params: { entityCount: 3 }, seed: 1, formatVersion: FORMAT_VERSION },
	}
}

const scenario: SimScenario = {
	network: { materialized: lineNetwork() },
	workload: { kind: 'payment', queries: 1, amount: { dist: 'constant', params: { value: 100 } }, depth: 7, seed: 1 },
}

function header(): TraceHeader {
	return buildTraceHeader({ tallysimVersion: 't', tallynetVersion: 'n', scenario, runSeed: 0, queries: [] })
}

function event(sessionCode: string, time: number): TraceEvent {
	return { type: 'query-sent', time, nodeId: '0', sessionCode, nonce: 'n', depth: 0, round: 1 }
}

describe('makeTraceWriter — up-front emission and streaming', () => {
	it('emits header + network immediately, then one line per event', () => {
		const network = lineNetwork()
		const lines: string[] = []
		const writer = makeTraceWriter(header(), makeNetworkSnapshot(network), (l) => lines.push(l))

		// Before any event: exactly the header and network lines are out.
		expect(lines).toHaveLength(2)
		expect(writer.stats().lines).toBe(2)

		writer.sink(event('S1', 1))
		expect(lines).toHaveLength(3) // streamed immediately, not buffered
		writer.sink(event('S1', 2))
		expect(lines).toHaveLength(4)
		expect(writer.stats().lines).toBe(4)

		// The whole thing parses back: header, network, the two events in order.
		const parsed = parseTrace(lines)
		expect(parsed.network).toEqual(network)
		expect([...parsed.events()]).toEqual([event('S1', 1), event('S1', 2)])
	})

	it('reports byte counts matching the on-disk NDJSON size (each line plus its newline)', () => {
		const lines: string[] = []
		const writer = makeTraceWriter(header(), makeNetworkSnapshot(lineNetwork()), (l) => lines.push(l))
		writer.sink(event('S1', 1))
		const encoder = new TextEncoder()
		const expectedBytes = lines.reduce((sum, l) => sum + encoder.encode(l).length + 1, 0)
		expect(writer.stats()).toEqual({ lines: lines.length, bytes: expectedBytes })
	})

	it('records only the selected sessions when options.sessions is set', () => {
		const lines: string[] = []
		const writer = makeTraceWriter(header(), makeNetworkSnapshot(lineNetwork()), (l) => lines.push(l), {
			sessions: new Set(['S1']),
		})
		writer.sink(event('S1', 1))
		writer.sink(event('S2', 2)) // filtered out
		writer.sink(event('S1', 3))

		const recorded = parseTrace(lines)
		expect([...recorded.events()]).toEqual([event('S1', 1), event('S1', 3)])
		expect(writer.stats().lines).toBe(4) // header + network + two S1 events
	})
})

describe('makeTraceWriter — over the real harness', () => {
	/** Record one 0 → 2 payment through the harness into an in-memory line sink. */
	async function record(): Promise<string[]> {
		const network = lineNetwork()
		const lines: string[] = []
		const writer = makeTraceWriter(header(), makeNetworkSnapshot(network), (l) => lines.push(l))
		const sim = buildSimNetwork(network, {}, 0, writer.sink)
		const outcome = await runQuery(sim, { from: 0, to: 2, amount: 100, depth: 7 })
		expect(outcome.found).toBe(true) // sanity: the route exists, so events were emitted
		return lines
	}

	it('streams real discovery events and the trace parses back', async () => {
		const lines = await record()
		expect(lines.length).toBeGreaterThan(2) // header + network + at least one event
		const parsed = parseTrace(lines)
		expect([...parsed.events()].length).toBeGreaterThan(0)
	})

	it('is byte-identical across two runs of the same scenario + seed', async () => {
		const first = await record()
		const second = await record()
		expect(second).toEqual(first)
	})
})
