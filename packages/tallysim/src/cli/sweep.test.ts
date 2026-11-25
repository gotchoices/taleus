/**
 * Smoke test for the Node-only CLI (`sweep.ts`). It imports `parseArgs` and `runToOutputs` directly — safe,
 * because `main()` is guarded to direct invocation (`import.meta.url`), so importing the module runs nothing.
 * It writes a tiny {@link SweepSpec} to a temp file, runs it to temp `--jsonl`/`--csv` outputs, reads them
 * back, and checks the line count and that the CSV header + first row are well-formed. This file lives under
 * `src/cli/` so its `node:*` imports are exempt from the `no-node-globals` guard (which scans the core only).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SweepSpec } from '../index.js'
import { parseArgs, runToOutputs } from './sweep.js'

/** A tiny two-cell, two-seed payment sweep — four records, cheap to run. */
const spec: SweepSpec = {
	base: {
		network: { generator: 'uniform', params: { entityCount: 20, meanDegree: 2 }, capacity: { kind: 'unlimited' }, seed: 100 },
		workload: { kind: 'payment', queries: 10, amount: { dist: 'constant', params: { value: 1 } }, depth: 3, seed: 200 },
	},
	vary: [{ path: 'network.params.meanDegree', values: [1, 3] }],
	seeds: [1, 2],
}

describe('parseArgs', () => {
	it('parses the spec path and both output flags', () => {
		expect(parseArgs(['spec.json', '--jsonl', 'out.jsonl', '--csv', 'out.csv'])).toEqual({
			specPath: 'spec.json',
			jsonlPath: 'out.jsonl',
			csvPath: 'out.csv',
		})
	})

	it('defaults the output flags to undefined (JSON-lines to stdout, no CSV)', () => {
		expect(parseArgs(['spec.json'])).toEqual({ specPath: 'spec.json', jsonlPath: undefined, csvPath: undefined })
	})

	it('throws when the spec path is missing', () => {
		expect(() => parseArgs(['--jsonl', 'out.jsonl'])).toThrow(/missing <spec.json>/)
	})

	it('throws on an unknown flag and on a flag missing its value', () => {
		expect(() => parseArgs(['spec.json', '--bogus'])).toThrow(/unknown flag/)
		expect(() => parseArgs(['spec.json', '--jsonl'])).toThrow(/needs a path/)
	})
})

describe('runToOutputs', () => {
	let dir: string
	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), 'tallysim-cli-'))
	})
	afterAll(() => {
		rmSync(dir, { recursive: true, force: true })
	})

	it('streams one JSON-line per run and a CSV header + one row per run', () => {
		const jsonlPath = join(dir, 'out.jsonl')
		const csvPath = join(dir, 'out.csv')
		runToOutputs(spec, { specPath: 'unused', jsonlPath, csvPath })

		// JSON-lines: 2 values × 2 seeds = 4 records, one per line, with a trailing newline.
		const jsonl = readFileSync(jsonlPath, 'utf8')
		const lines = jsonl.split('\n')
		expect(lines[lines.length - 1]).toBe('') // trailing newline
		const records = lines.filter((line) => line.length > 0)
		expect(records).toHaveLength(4)
		const first = JSON.parse(records[0]) as { generator: string; metrics: { queryCount: number } }
		expect(first.generator).toBe('uniform')
		expect(first.metrics.queryCount).toBe(10)

		// CSV: a header plus one row per run (same four).
		const csv = readFileSync(csvPath, 'utf8').trimEnd()
		const csvLines = csv.split('\n')
		expect(csvLines).toHaveLength(5) // header + 4 rows
		const header = csvLines[0].split(',')
		expect(header.slice(0, 2)).toEqual(['generator', 'capacity'])
		expect(header).toContain('network.params.meanDegree')
		expect(header).toContain('seed')
		expect(header).toContain('pRouteExists')
		// Every data row has exactly as many cells as the header.
		for (const row of csvLines.slice(1)) {
			expect(row.split(',')).toHaveLength(header.length)
		}
	})

	it('defaults to no CSV file when csvPath is omitted (JSON-lines only)', () => {
		const jsonlPath = join(dir, 'jsonl-only.jsonl')
		runToOutputs(spec, { specPath: 'unused', jsonlPath })
		const records = readFileSync(jsonlPath, 'utf8').split('\n').filter((line) => line.length > 0)
		expect(records).toHaveLength(4)
	})

	it('is deterministic — the same spec produces byte-identical JSON-lines', () => {
		const a = join(dir, 'det-a.jsonl')
		const b = join(dir, 'det-b.jsonl')
		runToOutputs(spec, { specPath: 'unused', jsonlPath: a })
		runToOutputs(spec, { specPath: 'unused', jsonlPath: b })
		expect(readFileSync(b, 'utf8')).toBe(readFileSync(a, 'utf8'))
	})
})
