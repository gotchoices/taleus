/**
 * `simulate` — a Node-specific driver for the **discovery** sweep, the sibling of `cli/sweep.ts` (which
 * drives the oracle sweep). It reads a {@link SimSweepSpec} JSON file, runs the real `tallynet`
 * route-discovery protocol over a simulated network for every `(cell × seed)`, and **streams** the
 * JSON-lines {@link SimRunRecord}s to stdout or a file as each is produced (never buffering the whole sweep),
 * building the CSV summary from lightweight per-row scalars on the same pass. Because `runSimSweep` is an
 * **async** generator, the run loop is `for await`.
 *
 * The platform-neutral core (`sim/sim-runner.ts`, `serialize-sim-records.ts`) does the work; this file only
 * wires `node:fs` and process args to it. Like `cli/sweep.ts` and `cli/trace.ts`, it is excluded from the
 * neutral build (`tsconfig.build.json`) and the `no-node-globals` guard, and compiled with node types by
 * `tsconfig.cli.json`.
 *
 * ── `--trace` traces the UNVARIED base scenario ──────────────────────────────────────────────────────────
 * `--trace <path>` optionally dumps one full, replayable discovery trace. It traces `spec.base` **with the
 * sweep's `vary` NOT applied** — i.e. the base scenario exactly as written, at the `--seed` run seed
 * (default 0), for the `--query` indices (default all). It reuses `recordTrace` from `cli/trace.ts`, so the
 * trace is byte-identical to what `cli/trace.js` would produce for that scenario + seed. It is **not** a trace
 * of any swept cell — use `cli/trace.js` on a materialised cell scenario if you need that.
 *
 * Usage:
 *   node dist/cli/simulate.js <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>] [--concurrent] \
 *       [--trace <trace.ndjson> [--query <i> ...] [--seed <n>]]
 *   yarn workspace tallysim simulate <spec.json> ...
 *
 * With no `--jsonl`, JSON-lines stream to stdout. `--csv` writes the summary after the run. `--concurrent`
 * issues every cell's queries before one `runUntilIdle()` (see {@link SimRunnerDeps} — outcome metrics agree
 * with sequential mode, but round/timing metrics do not).
 */

import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
	createSimCsvAccumulator,
	runSimSweep,
	simRecordToJsonLine,
	type LineSink,
	type SimSweepSpec,
} from '../index.js'
import { packageVersions, recordTrace } from './trace.js'

export interface CliArgs {
	specPath: string
	jsonlPath?: string
	csvPath?: string
	/** Issue every cell's queries before one `runUntilIdle()` (sets {@link SimRunnerDeps.concurrent}). */
	concurrent: boolean
	/** Where to write the base-scenario trace; omitted ⇒ no trace. */
	tracePath?: string
	/** Run seed for the `--trace` dump (default 0). */
	traceSeed: number
	/** The 0-based query indices to trace; empty ⇒ trace every query. */
	traceQueries: number[]
}

const USAGE =
	'usage: simulate <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>] [--concurrent]' +
	' [--trace <trace.ndjson> [--query <i> ...] [--seed <n>]]'

/** Parse `argv` (without the leading `node script` entries). Throws with a usage message on bad input. */
export function parseArgs(argv: string[]): CliArgs {
	let specPath: string | undefined
	let jsonlPath: string | undefined
	let csvPath: string | undefined
	let concurrent = false
	let tracePath: string | undefined
	let traceSeed = 0
	const traceQueries: number[] = []
	const takeValue = (flag: string, value: string | undefined): string => {
		if (value === undefined) {
			throw new Error(`${flag} needs a value`)
		}
		return value
	}
	const takeInt = (flag: string, value: string | undefined): number => {
		const parsed = Number(takeValue(flag, value))
		if (!Number.isInteger(parsed)) {
			throw new Error(`${flag} needs an integer, got "${String(value)}"`)
		}
		return parsed
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--jsonl') {
			jsonlPath = takeValue(arg, argv[++i])
		} else if (arg === '--csv') {
			csvPath = takeValue(arg, argv[++i])
		} else if (arg === '--concurrent') {
			concurrent = true
		} else if (arg === '--trace') {
			tracePath = takeValue(arg, argv[++i])
		} else if (arg === '--seed') {
			traceSeed = takeInt(arg, argv[++i])
		} else if (arg === '--query') {
			const index = takeInt(arg, argv[++i])
			if (index < 0) {
				throw new Error(`--query needs a non-negative index, got ${index}`)
			}
			traceQueries.push(index)
		} else if (arg.startsWith('--')) {
			throw new Error(`unknown flag "${arg}"`)
		} else if (specPath === undefined) {
			specPath = arg
		} else {
			throw new Error(`unexpected argument "${arg}"`)
		}
	}
	if (specPath === undefined) {
		throw new Error('missing <spec.json>')
	}
	return { specPath, jsonlPath, csvPath, concurrent, tracePath, traceSeed, traceQueries }
}

/**
 * Where the run writes, injected so the whole path is unit-testable without the filesystem (like
 * `cli/trace.ts`'s `open`). `record` receives each already-newline-terminated JSON-line chunk; `csv` (when
 * present) the final CSV text; `trace` (when present) opens the trace sink the way {@link recordTrace} wants.
 */
export interface SimSinks {
	record(chunk: string): void
	csv?: (text: string) => void
	trace?: () => { out: LineSink; close: () => void }
}

/** Knobs the run needs beyond the sinks: concurrency and the `--trace` run seed / query selection + versions. */
export interface SimRunConfig {
	concurrent: boolean
	traceSeed: number
	traceQueries: number[]
	versions: { tallysimVersion: string; tallynetVersion: string }
}

/**
 * Run the discovery sweep described by `spec`: stream JSON-lines to `sinks.record`, build a CSV when
 * `sinks.csv` is given (same streaming pass), then — when `sinks.trace` is given — dump a trace of the
 * **unvaried base scenario** via {@link recordTrace}. Filesystem-free: the caller owns every sink.
 */
export async function runToOutputs(spec: SimSweepSpec, sinks: SimSinks, config: SimRunConfig): Promise<void> {
	const csv = sinks.csv !== undefined ? createSimCsvAccumulator() : undefined
	for await (const record of runSimSweep(spec, { concurrent: config.concurrent })) {
		sinks.record(`${simRecordToJsonLine(record)}\n`)
		csv?.add(record)
	}
	if (csv !== undefined && sinks.csv !== undefined) {
		sinks.csv(`${csv.toCsv()}\n`)
	}
	if (sinks.trace !== undefined) {
		await recordTrace(
			spec.base,
			{ seed: config.traceSeed, queries: config.traceQueries },
			config.versions,
			sinks.trace,
		)
	}
}

/** Build the filesystem sinks for `args`; returns them plus a `close` thunk for any file descriptor opened. */
function fileSinks(args: CliArgs): { sinks: SimSinks; close: () => void } {
	const jsonlFd = args.jsonlPath !== undefined ? openSync(args.jsonlPath, 'w') : undefined
	const sinks: SimSinks = {
		record:
			jsonlFd !== undefined
				? (chunk): void => {
						writeSync(jsonlFd, chunk)
					}
				: (chunk): void => {
						process.stdout.write(chunk)
					},
	}
	if (args.csvPath !== undefined) {
		const csvPath = args.csvPath
		sinks.csv = (text): void => writeFileSync(csvPath, text)
	}
	if (args.tracePath !== undefined) {
		const tracePath = args.tracePath
		sinks.trace = (): { out: LineSink; close: () => void } => {
			const fd = openSync(tracePath, 'w')
			return { out: (line) => writeSync(fd, `${line}\n`), close: () => closeSync(fd) }
		}
	}
	const close = (): void => {
		if (jsonlFd !== undefined) {
			closeSync(jsonlFd)
		}
	}
	return { sinks, close }
}

async function main(): Promise<void> {
	let args: CliArgs
	try {
		args = parseArgs(process.argv.slice(2))
	} catch (error) {
		process.stderr.write(`simulate: ${(error as Error).message}\n${USAGE}\n`)
		process.exit(1)
	}
	const spec = JSON.parse(readFileSync(args.specPath, 'utf8')) as SimSweepSpec
	const { sinks, close } = fileSinks(args)
	try {
		await runToOutputs(spec, sinks, {
			concurrent: args.concurrent,
			traceSeed: args.traceSeed,
			traceQueries: args.traceQueries,
			versions: packageVersions(),
		})
	} finally {
		close()
	}
}

/** Run `main` only when executed as the entry script (not when imported by a test). */
const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
	void main().catch((error: unknown) => {
		process.stderr.write(`simulate: ${(error as Error).message}\n`)
		process.exit(1)
	})
}
