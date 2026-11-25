/**
 * `sweep` — the one Node-specific file in tallysim. It reads a {@link SweepSpec} JSON file, runs the sweep,
 * and **streams** the JSON-lines records to stdout or a file as each is produced (never buffering the whole
 * sweep), building the CSV summary from lightweight per-row scalars on the same pass. The platform-neutral
 * core (everything under `src/` except this `cli/` folder) does the actual work; this file only wires `node:fs`
 * and process args to it. It is excluded from the neutral build (`tsconfig.build.json`) and the
 * `no-node-globals` guard, and compiled with node types by `tsconfig.cli.json`.
 *
 * Usage:
 *   node dist/cli/sweep.js <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>]
 *   yarn workspace tallysim sweep <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>]
 *
 * With no `--jsonl`, JSON-lines stream to stdout. `--csv` writes the summary after the run.
 */

import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createCsvAccumulator, recordToJsonLine, runSweep, type SweepSpec } from '../index.js'

export interface CliArgs {
	specPath: string
	jsonlPath?: string
	csvPath?: string
}

/** Parse `argv` (without the leading `node script` entries). Throws with a usage message on bad input. */
export function parseArgs(argv: string[]): CliArgs {
	let specPath: string | undefined
	let jsonlPath: string | undefined
	let csvPath: string | undefined
	const takeValue = (flag: string, value: string | undefined): string => {
		if (value === undefined) {
			throw new Error(`${flag} needs a path`)
		}
		return value
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--jsonl') {
			jsonlPath = takeValue(arg, argv[++i])
		} else if (arg === '--csv') {
			csvPath = takeValue(arg, argv[++i])
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
	return { specPath, jsonlPath, csvPath }
}

const USAGE = 'usage: sweep <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>]'

/** Run the sweep described by `spec`, streaming JSON-lines and (optionally) accumulating a CSV summary. */
export function runToOutputs(spec: SweepSpec, args: CliArgs): void {
	const csv = args.csvPath !== undefined ? createCsvAccumulator() : undefined
	const jsonlFd = args.jsonlPath !== undefined ? openSync(args.jsonlPath, 'w') : undefined
	try {
		for (const record of runSweep(spec)) {
			const line = `${recordToJsonLine(record)}\n`
			if (jsonlFd !== undefined) {
				writeSync(jsonlFd, line)
			} else {
				process.stdout.write(line)
			}
			csv?.add(record)
		}
	} finally {
		if (jsonlFd !== undefined) {
			closeSync(jsonlFd)
		}
	}
	if (csv !== undefined && args.csvPath !== undefined) {
		writeFileSync(args.csvPath, `${csv.toCsv()}\n`)
	}
}

function main(): void {
	let args: CliArgs
	try {
		args = parseArgs(process.argv.slice(2))
	} catch (error) {
		process.stderr.write(`sweep: ${(error as Error).message}\n${USAGE}\n`)
		process.exit(1)
	}
	const spec = JSON.parse(readFileSync(args.specPath, 'utf8')) as SweepSpec
	runToOutputs(spec, args)
}

/** Run `main` only when executed as the entry script (not when imported by a test). */
const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
	main()
}
