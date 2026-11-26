/**
 * `consensus` — a Node driver for the consensus sweep (sibling of `cli/simulate.ts`). Reads a
 * {@link SimSweepSpec} JSON file whose base scenario carries a `consensus` block, drives the real
 * sign-and-settle lift for every found route, and streams JSON-lines {@link ConsensusRunRecord}s to
 * stdout/`--jsonl`, building the CSV on the same pass to `--csv`. Sequential only (no `--concurrent`: the
 * runner mutates the one kept network in order — see `sim/consensus-runner.ts`). No `--trace` here (the
 * consensus trace lives in `tallysim-consensus-trace-v2`). Excluded from the neutral build + no-node-globals
 * guard; compiled by `tsconfig.cli.json`.
 *
 * Usage:
 *   node dist/cli/consensus.js <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>]
 *   yarn workspace tallysim consensus <spec.json> ...
 */

import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
	createConsensusCsvAccumulator,
	consensusRecordToJsonLine,
	runConsensusSweep,
	type SimSweepSpec,
} from '../index.js'

export interface CliArgs {
	specPath: string
	jsonlPath?: string
	csvPath?: string
}

const USAGE = 'usage: consensus <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>]'

export function parseArgs(argv: string[]): CliArgs {
	let specPath: string | undefined
	let jsonlPath: string | undefined
	let csvPath: string | undefined
	const takeValue = (flag: string, value: string | undefined): string => {
		if (value === undefined) {
			throw new Error(`${flag} needs a value`)
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

/** Injectable sinks so the run-to-outputs path is unit-testable without the filesystem (like simulate.ts). */
export interface ConsensusSinks {
	record(chunk: string): void
	csv?: (text: string) => void
}

/** Stream JSON-lines to `sinks.record` and (when given) build a CSV to `sinks.csv` on the same pass. */
export async function runToOutputs(spec: SimSweepSpec, sinks: ConsensusSinks): Promise<void> {
	const csv = sinks.csv !== undefined ? createConsensusCsvAccumulator() : undefined
	for await (const record of runConsensusSweep(spec)) {
		sinks.record(`${consensusRecordToJsonLine(record)}\n`)
		csv?.add(record)
	}
	if (csv !== undefined && sinks.csv !== undefined) {
		sinks.csv(`${csv.toCsv()}\n`)
	}
}

function fileSinks(args: CliArgs): { sinks: ConsensusSinks; close: () => void } {
	const jsonlFd = args.jsonlPath !== undefined ? openSync(args.jsonlPath, 'w') : undefined
	const sinks: ConsensusSinks = {
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
		process.stderr.write(`consensus: ${(error as Error).message}\n${USAGE}\n`)
		process.exit(1)
	}
	const spec = JSON.parse(readFileSync(args.specPath, 'utf8')) as SimSweepSpec
	const { sinks, close } = fileSinks(args)
	try {
		await runToOutputs(spec, sinks)
	} finally {
		close()
	}
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
	void main().catch((error: unknown) => {
		process.stderr.write(`consensus: ${(error as Error).message}\n`)
		process.exit(1)
	})
}
