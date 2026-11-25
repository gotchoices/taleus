/**
 * Smoke test for the Node-only discovery CLI (`simulate.ts`). It imports `parseArgs` and `runToOutputs`
 * directly — safe, because `main()` is guarded to direct invocation (`import.meta.url`), so importing the
 * module runs nothing. `runToOutputs` takes injectable {@link SimSinks} (in-memory, like `cli/trace.ts`'s
 * `open`), so the whole run-to-outputs path is exercised without touching the filesystem. This file lives
 * under `src/cli/` so its reliance on the CLI module is exempt from the `no-node-globals` guard.
 */

import type { LineSink, SimSweepSpec } from '../index.js'
import { parseSimJsonLine, parseTrace } from '../index.js'
import { parseArgs, runToOutputs, type SimSinks } from './simulate.js'

/** A tiny two-cell, one-seed discovery sweep over a small uniform network — two records, cheap to run. */
const spec: SimSweepSpec = {
	base: {
		network: { generator: 'uniform', params: { entityCount: 8, meanDegree: 2 }, capacity: { kind: 'unlimited' }, seed: 100 },
		workload: { kind: 'payment', queries: 3, amount: { dist: 'constant', params: { value: 1 } }, depth: 4, seed: 200 },
	},
	vary: [{ path: 'network.params.meanDegree', values: [2, 3] }],
	seeds: [1],
}

const versions = { tallysimVersion: 't', tallynetVersion: 'n' }

/** Collect JSON-line chunks into `lines` (stripping the trailing newline each chunk carries). */
function recordInto(lines: string[]): (chunk: string) => void {
	return (chunk) => lines.push(chunk.replace(/\n$/, ''))
}

/** An in-memory trace opener: collect every emitted line into `lines`; `close` is a no-op. */
function traceInto(lines: string[]): () => { out: LineSink; close: () => void } {
	return () => ({ out: (line) => lines.push(line), close: () => {} })
}

describe('parseArgs', () => {
	it('parses the spec path, all output flags, --concurrent and the trace flags', () => {
		expect(
			parseArgs(['spec.json', '--jsonl', 'o.jsonl', '--csv', 'o.csv', '--concurrent', '--trace', 't.ndjson', '--seed', '3', '--query', '0', '--query', '2']),
		).toEqual({
			specPath: 'spec.json',
			jsonlPath: 'o.jsonl',
			csvPath: 'o.csv',
			concurrent: true,
			tracePath: 't.ndjson',
			traceSeed: 3,
			traceQueries: [0, 2],
		})
	})

	it('defaults the output/trace flags (JSON-lines to stdout, no CSV, no trace, sequential, seed 0)', () => {
		expect(parseArgs(['spec.json'])).toEqual({
			specPath: 'spec.json',
			jsonlPath: undefined,
			csvPath: undefined,
			concurrent: false,
			tracePath: undefined,
			traceSeed: 0,
			traceQueries: [],
		})
	})

	it('throws when the spec path is missing', () => {
		expect(() => parseArgs(['--jsonl', 'o.jsonl'])).toThrow(/missing <spec.json>/)
	})

	it('throws on an unknown flag, a flag missing its value, a bad seed and a negative query', () => {
		expect(() => parseArgs(['spec.json', '--bogus'])).toThrow(/unknown flag/)
		expect(() => parseArgs(['spec.json', '--jsonl'])).toThrow(/needs a value/)
		expect(() => parseArgs(['spec.json', '--seed', 'x'])).toThrow(/needs an integer/)
		expect(() => parseArgs(['spec.json', '--query', '-1'])).toThrow(/non-negative/)
	})
})

describe('runToOutputs', () => {
	it('streams one JSON-line per run and builds a CSV header + one row per run', async () => {
		const jsonl: string[] = []
		let csv = ''
		const sinks: SimSinks = { record: recordInto(jsonl), csv: (text) => (csv = text) }
		await runToOutputs(spec, sinks, { concurrent: false, traceSeed: 0, traceQueries: [], versions })

		// JSON-lines: 2 values × 1 seed = 2 records, one per line, each a parseable SimRunRecord.
		expect(jsonl).toHaveLength(2)
		const first = parseSimJsonLine(jsonl[0])
		expect(first.generator).toBe('uniform')
		expect(first.metrics.queryCount).toBe(3)
		expect(first.metrics.falseFoundCount).toBe(0) // the found ⊆ oracle guardrail

		// CSV: a header plus one row per run, trailing newline, every row as wide as the header.
		expect(csv.endsWith('\n')).toBe(true)
		const csvLines = csv.trimEnd().split('\n')
		expect(csvLines).toHaveLength(3) // header + 2 rows
		const header = csvLines[0].split(',')
		expect(header.slice(0, 2)).toEqual(['generator', 'capacity'])
		expect(header).toContain('network.params.meanDegree')
		expect(header).toContain('pFoundGivenExists')
		expect(header).toContain('pruneReasons.cycle')
		for (const row of csvLines.slice(1)) {
			expect(row.split(',')).toHaveLength(header.length)
		}
	})

	it('omits the CSV when no csv sink is given (JSON-lines only)', async () => {
		const jsonl: string[] = []
		await runToOutputs(spec, { record: recordInto(jsonl) }, { concurrent: false, traceSeed: 0, traceQueries: [], versions })
		expect(jsonl).toHaveLength(2)
	})

	it('runs in --concurrent mode and agrees with sequential on the outcome metrics', async () => {
		const seq: string[] = []
		const con: string[] = []
		await runToOutputs(spec, { record: recordInto(seq) }, { concurrent: false, traceSeed: 0, traceQueries: [], versions })
		await runToOutputs(spec, { record: recordInto(con) }, { concurrent: true, traceSeed: 0, traceQueries: [], versions })
		expect(con).toHaveLength(2)
		// Concurrent and sequential agree on outcome metrics (found / oracle), though not on round/timing.
		for (let i = 0; i < seq.length; i++) {
			const s = parseSimJsonLine(seq[i]).metrics
			const c = parseSimJsonLine(con[i]).metrics
			expect(c.routeExistsCount).toBe(s.routeExistsCount)
			expect(c.foundAndExistsCount).toBe(s.foundAndExistsCount)
			expect(c.falseFoundCount).toBe(0)
		}
	})

	it('dumps a parseable trace of the unvaried base scenario when a trace sink is given', async () => {
		const jsonl: string[] = []
		const trace: string[] = []
		await runToOutputs(
			spec,
			{ record: recordInto(jsonl), trace: traceInto(trace) },
			{ concurrent: false, traceSeed: 0, traceQueries: [], versions },
		)
		expect(jsonl).toHaveLength(2) // the sweep still ran
		expect(trace.length).toBeGreaterThan(2) // header + network + at least one event

		const parsed = parseTrace(trace)
		// The trace is of the base scenario exactly (vary NOT applied): meanDegree stays the base's 2, not 3.
		expect(parsed.header.scenario).toEqual(spec.base)
		expect(parsed.header.queries).toHaveLength(3) // workload.queries drawn from the base
		const headerCodes = new Set(parsed.header.queries.map((q) => q.sessionCode))
		for (const event of parsed.events()) {
			expect(headerCodes.has(event.sessionCode)).toBe(true)
		}
	})

	it('traces only the selected query indices when traceQueries is non-empty', async () => {
		const trace: string[] = []
		await runToOutputs(
			spec,
			{ record: recordInto([]), trace: traceInto(trace) },
			{ concurrent: false, traceSeed: 0, traceQueries: [1], versions },
		)
		const parsed = parseTrace(trace)
		expect(parsed.header.queries).toHaveLength(1)
		const only = parsed.header.queries[0].sessionCode
		for (const event of parsed.events()) {
			expect(event.sessionCode).toBe(only)
		}
	})
})
