/**
 * Smoke test for the Node-only trace CLI (`trace.ts`). It imports `parseArgs` and `recordTrace` directly —
 * safe, because `main()` is guarded to direct invocation (`import.meta.url`), so importing the module runs
 * nothing. `recordTrace` takes an injectable `open()` yielding an in-memory {@link LineSink}, so the whole
 * record-and-stream path is exercised without touching the filesystem. This file lives under `src/cli/` so
 * its reliance on the CLI module is exempt from the `no-node-globals` guard (which scans the core only).
 */

import { FORMAT_VERSION, type Network } from '../model.js'
import type { LineSink, SimScenario } from '../index.js'
import { parseTrace } from '../index.js'
import { parseArgs, recordTrace } from './trace.js'

/** A 3-entity line 0—1—2, every direction amply capitalised, so any drawn pair routes. */
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

/** A two-query payment scenario over the line network. */
const scenario: SimScenario = {
	network: { materialized: lineNetwork() },
	workload: { kind: 'payment', queries: 2, amount: { dist: 'constant', params: { value: 100 } }, depth: 7, seed: 1 },
}

const versions = { tallysimVersion: 't', tallynetVersion: 'n' }

/** An in-memory `open()`: collect every emitted line into `lines`; `close` is a no-op. */
function intoArray(lines: string[]): () => { out: LineSink; close: () => void } {
	return () => ({ out: (line) => lines.push(line), close: () => {} })
}

describe('parseArgs', () => {
	it('parses the spec path, --out, --seed and repeated --query', () => {
		expect(parseArgs(['s.json', '--out', 't.ndjson', '--seed', '3', '--query', '0', '--query', '2'])).toEqual({
			specPath: 's.json',
			outPath: 't.ndjson',
			seed: 3,
			queries: [0, 2],
		})
	})

	it('defaults --out to undefined, --seed to 0 and --query to empty', () => {
		expect(parseArgs(['s.json'])).toEqual({ specPath: 's.json', outPath: undefined, seed: 0, queries: [] })
	})

	it('throws when the spec path is missing', () => {
		expect(() => parseArgs(['--out', 't.ndjson'])).toThrow(/missing <scenario.json>/)
	})

	it('throws on an unknown flag and on a flag missing its value', () => {
		expect(() => parseArgs(['s.json', '--bogus'])).toThrow(/unknown flag/)
		expect(() => parseArgs(['s.json', '--out'])).toThrow(/needs a value/)
	})

	it('throws on a non-integer seed and a negative query index', () => {
		expect(() => parseArgs(['s.json', '--seed', 'x'])).toThrow(/needs an integer/)
		expect(() => parseArgs(['s.json', '--query', '-1'])).toThrow(/non-negative/)
	})

	it('throws on a second positional argument', () => {
		expect(() => parseArgs(['a.json', 'b.json'])).toThrow(/unexpected argument/)
	})
})

describe('recordTrace', () => {
	it('streams header + network + events; the trace parses back self-consistently', async () => {
		const lines: string[] = []
		const stats = await recordTrace(scenario, { seed: 0, queries: [] }, versions, intoArray(lines))

		// Stats agree with what was emitted (one line per emitted string).
		expect(stats.lines).toBe(lines.length)
		expect(lines.length).toBeGreaterThan(2) // header + network + at least one event

		const parsed = parseTrace(lines)
		expect(parsed.header.scenario).toEqual(scenario)
		expect(parsed.header.queries).toHaveLength(2) // both queries recorded
		// Every recorded event joins back to a query listed in the header.
		const headerCodes = new Set(parsed.header.queries.map((q) => q.sessionCode))
		for (const event of parsed.events()) {
			expect(headerCodes.has(event.sessionCode)).toBe(true)
		}
	})

	it('records only the selected query when --query is given', async () => {
		const all: string[] = []
		await recordTrace(scenario, { seed: 0, queries: [] }, versions, intoArray(all))
		const allCodes = parseTrace(all).header.queries.map((q) => q.sessionCode)
		expect(new Set(allCodes).size).toBe(2) // the two queries mint distinct codes

		const sel: string[] = []
		await recordTrace(scenario, { seed: 0, queries: [0] }, versions, intoArray(sel))
		const parsed = parseTrace(sel)
		// Header lists only the selected query, and every event belongs to it.
		expect(parsed.header.queries).toHaveLength(1)
		expect(parsed.header.queries[0].sessionCode).toBe(allCodes[0])
		for (const event of parsed.events()) {
			expect(event.sessionCode).toBe(allCodes[0])
		}
	})

	it('throws on an out-of-range --query index rather than writing an empty trace', async () => {
		const lines: string[] = []
		await expect(recordTrace(scenario, { seed: 0, queries: [5] }, versions, intoArray(lines))).rejects.toThrow(
			/--query 5 is out of range/,
		)
		expect(lines).toHaveLength(0) // fails before the sink is opened — no partial file
	})

	it('is byte-identical across two runs of the same scenario + seed', async () => {
		const first: string[] = []
		const second: string[] = []
		await recordTrace(scenario, { seed: 0, queries: [] }, versions, intoArray(first))
		await recordTrace(scenario, { seed: 0, queries: [] }, versions, intoArray(second))
		expect(second).toEqual(first)
	})

	it('writes a header+network file with no query events for a sub-two-entity network', async () => {
		const tiny: SimScenario = {
			network: {
				materialized: {
					entityCount: 1,
					tallies: [],
					meta: { generator: 'test', params: { entityCount: 1 }, seed: 1, formatVersion: FORMAT_VERSION },
				},
			},
			workload: { kind: 'payment', queries: 2, amount: { dist: 'constant', params: { value: 1 } }, depth: 3, seed: 1 },
		}
		const lines: string[] = []
		await recordTrace(tiny, { seed: 0, queries: [] }, versions, intoArray(lines))
		const parsed = parseTrace(lines)
		expect(parsed.header.queries).toEqual([])
		expect([...parsed.events()]).toEqual([])
	})
})

describe('recordTrace — consensus', () => {
	/** The same line scenario with consensus turned on (cooperative — every found route commits). */
	const consensusScenario: SimScenario = { ...scenario, consensus: {} }

	/** The `transactionCode` carried by `events` (consensus events only — discovery events have none). */
	function eventTxCodes(parsed: ReturnType<typeof parseTrace>): Set<string> {
		const codes = new Set<string>()
		for (const ev of parsed.events()) {
			const tx = (ev as { transactionCode?: string }).transactionCode
			if (tx !== undefined) {
				codes.add(tx)
			}
		}
		return codes
	}

	it('records one header.lifts entry per found recorded query, route/tallyPath/memberKeys populated', async () => {
		const lines: string[] = []
		await recordTrace(consensusScenario, { seed: 0, queries: [] }, versions, intoArray(lines))
		const parsed = parseTrace(lines)

		const queryCodes = new Set(parsed.header.queries.map((q) => q.sessionCode))
		const lifts = parsed.header.lifts
		expect(lifts).toBeDefined()
		expect(lifts!.length).toBeGreaterThanOrEqual(1)
		for (const lift of lifts!) {
			expect(queryCodes.has(lift.sessionCode)).toBe(true) // joins back to a recorded discovery query
			expect(lift.route.length).toBeGreaterThanOrEqual(2) // [from, …, to]
			expect(lift.tallyPath).toHaveLength(lift.route.length - 1) // one edge per hop (acyclic payment)
			const distinct = new Set(lift.route)
			expect(Object.keys(lift.memberKeys)).toHaveLength(distinct.size) // one key per distinct route entity
			for (const id of Object.values(lift.memberKeys)) {
				expect(distinct.has(id)).toBe(true) // every mapped id is on the route
			}
			expect(lift.amount).toBe(100)
		}

		// The consensus events made it into the trace and join to a recorded lift by transactionCode.
		const liftTxCodes = new Set(lifts!.map((l) => l.transactionCode))
		const txCodes = eventTxCodes(parsed)
		expect(txCodes.size).toBeGreaterThanOrEqual(1)
		for (const tx of txCodes) {
			expect(liftTxCodes.has(tx)).toBe(true)
		}
	})

	it('is byte-identical across two runs of the same consensus scenario + seed', async () => {
		const first: string[] = []
		const second: string[] = []
		await recordTrace(consensusScenario, { seed: 0, queries: [] }, versions, intoArray(first))
		await recordTrace(consensusScenario, { seed: 0, queries: [] }, versions, intoArray(second))
		expect(second).toEqual(first)
	})

	it('records consensus events only for the selected query when --query is given', async () => {
		const sel: string[] = []
		await recordTrace(consensusScenario, { seed: 0, queries: [0] }, versions, intoArray(sel))
		const parsed = parseTrace(sel)
		expect(parsed.header.queries).toHaveLength(1)
		const selectedCode = parsed.header.queries[0].sessionCode
		// Every recorded lift and every recorded event belongs to the one selected session.
		expect(parsed.header.lifts!.every((l) => l.sessionCode === selectedCode)).toBe(true)
		for (const ev of parsed.events()) {
			expect(ev.sessionCode).toBe(selectedCode)
		}
	})

	it('a discovery-only scenario records no lifts (the header omits the field)', async () => {
		const lines: string[] = []
		await recordTrace(scenario, { seed: 0, queries: [] }, versions, intoArray(lines))
		expect(parseTrace(lines).header.lifts).toBeUndefined()
		expect(JSON.parse(lines[0])).not.toHaveProperty('lifts')
	})
})
