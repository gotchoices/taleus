/**
 * Smoke test for the Node-only consensus CLI (`consensus.ts`). Imports `parseArgs` and `runToOutputs`
 * directly — safe, because `main()` is guarded to direct invocation, so importing runs nothing. The
 * run-to-outputs path takes injectable {@link ConsensusSinks}, so it is exercised without the filesystem.
 */

import { FORMAT_VERSION, type Network, parseConsensusJsonLine, type SimSweepSpec } from '../index.js'
import { parseArgs, runToOutputs, type ConsensusSinks } from './consensus.js'

/** A tiny line network `0-1-2-3`, one tally per pair, finite credit. */
function line(n: number, limit = 1000): Network {
	const tallies = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: limit, foilCreditLimit: limit })
	}
	return { entityCount: n, tallies, meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** A one-cell, one-seed consensus sweep over a small cooperative line — cheap to run. */
const spec: SimSweepSpec = {
	base: {
		network: { materialized: line(4) },
		workload: { kind: 'payment', queries: 4, amount: { dist: 'constant', params: { value: 5 } }, depth: 4, seed: 200 },
		consensus: {},
	},
	vary: [{ path: 'workload.depth', values: [4] }],
	seeds: [1],
}

/** Collect JSON-line chunks into `lines` (stripping the trailing newline each chunk carries). */
function recordInto(lines: string[]): (chunk: string) => void {
	return (chunk) => lines.push(chunk.replace(/\n$/, ''))
}

describe('parseArgs', () => {
	it('parses the spec path and both output flags', () => {
		expect(parseArgs(['spec.json', '--jsonl', 'o.jsonl', '--csv', 'o.csv'])).toEqual({
			specPath: 'spec.json',
			jsonlPath: 'o.jsonl',
			csvPath: 'o.csv',
		})
	})

	it('defaults the output flags (JSON-lines to stdout, no CSV)', () => {
		expect(parseArgs(['spec.json'])).toEqual({ specPath: 'spec.json', jsonlPath: undefined, csvPath: undefined })
	})

	it('throws on a missing spec, an unknown flag and a flag missing its value', () => {
		expect(() => parseArgs(['--jsonl', 'o.jsonl'])).toThrow(/missing <spec.json>/)
		expect(() => parseArgs(['spec.json', '--bogus'])).toThrow(/unknown flag/)
		expect(() => parseArgs(['spec.json', '--jsonl'])).toThrow(/needs a value/)
	})
})

describe('runToOutputs', () => {
	it('streams one JSON-line per run and builds a CSV header + one row per run', async () => {
		const jsonl: string[] = []
		let csv = ''
		const sinks: ConsensusSinks = { record: recordInto(jsonl), csv: (text) => (csv = text) }
		await runToOutputs(spec, sinks)

		expect(jsonl).toHaveLength(1) // 1 cell × 1 seed
		const first = parseConsensusJsonLine(jsonl[0])
		expect(first.generator).toBe('test')
		expect(first.metrics.queryCount).toBe(4)
		expect(first.metrics.pCommitGivenFound).toBe(1) // an all-cooperative line commits every found route

		expect(csv.endsWith('\n')).toBe(true)
		const csvLines = csv.trimEnd().split('\n')
		expect(csvLines).toHaveLength(2) // header + 1 row
		const header = csvLines[0].split(',')
		expect(header.slice(0, 2)).toEqual(['generator', 'capacity'])
		expect(header).toContain('pCommitGivenFound')
		expect(header).toContain('voidReasons.stalled')
		expect(csvLines[1].split(',')).toHaveLength(header.length)
	})

	it('omits the CSV when no csv sink is given (JSON-lines only)', async () => {
		const jsonl: string[] = []
		await runToOutputs(spec, { record: recordInto(jsonl) })
		expect(jsonl).toHaveLength(1)
	})
})
