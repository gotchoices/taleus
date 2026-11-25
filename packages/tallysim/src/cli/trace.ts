/**
 * `trace` — a Node-specific driver that records one discovery-simulation run to a versioned NDJSON trace
 * file. It reads a {@link SimScenario} JSON file, materialises the network, draws the workload's payment
 * queries, runs them on the `tallynet` protocol over compressed time, and **streams** the trace (header,
 * network snapshot, then one line per event) to stdout or a file — never buffering the event list, so
 * memory stays flat regardless of run size. It prints the final trace-size stats to stderr.
 *
 * The platform-neutral core (`sim/trace-format.ts`, `sim/trace-writer.ts`, `sim/harness.ts`) does the
 * work; this file only wires `node:fs`/process args and reads the two package versions for the header.
 * Like `cli/sweep.ts`, it is excluded from the neutral build (`tsconfig.build.json`) and the
 * `no-node-globals` guard, and compiled with node types by `tsconfig.cli.json`.
 *
 * ── Two passes, by necessity ──────────────────────────────────────────────────────────────────────
 * The trace header lists each query's session code, and the header is line 1 — it must be written before
 * any event. But a session code is minted *inside* `discover()` and is not knowable until the query has
 * run. So the driver runs the queries twice: pass 1 learns the session codes (collecting only codes, not
 * events — memory stays flat), then pass 2 rebuilds an identical `SimNetwork` from the same seeds and
 * reruns the same queries, streaming their events to the file. The rerun reproduces the same codes and
 * events exactly — this is the format's byte-identical determinism guarantee at work.
 *
 * Usage:
 *   node dist/cli/trace.js <scenario.json> [--out <trace.ndjson>] [--seed <n>] [--query <i> ...]
 *   yarn workspace tallysim trace <scenario.json> [--out <trace.ndjson>] [--seed <n>] [--query <i> ...]
 *
 * With no `--out`, the trace streams to stdout. `--seed` sets the run seed (default 0). `--query <i>`
 * (repeatable) records only those 0-based query indices (the selected-query option); the header then
 * lists only the recorded queries, so the file stays self-consistent with its events.
 */

import { createRequire } from 'node:module'
import { closeSync, existsSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SeededRandom } from 'tallynet/testing'
import {
	buildSimNetwork,
	buildTraceHeader,
	drawAmount,
	drawPaymentPair,
	makeNetworkSnapshot,
	makeTraceWriter,
	materializeNetwork,
	runQuery,
	type LineSink,
	type QuerySpec,
	type SimScenario,
	type TraceQueryEntry,
} from '../index.js'

export interface CliArgs {
	specPath: string
	outPath?: string
	seed: number
	/** The 0-based query indices to record; empty ⇒ record every query. */
	queries: number[]
}

const USAGE = 'usage: trace <scenario.json> [--out <trace.ndjson>] [--seed <n>] [--query <i> ...]'

/** Parse `argv` (without the leading `node script` entries). Throws with a usage message on bad input. */
export function parseArgs(argv: string[]): CliArgs {
	let specPath: string | undefined
	let outPath: string | undefined
	let seed = 0
	const queries: number[] = []
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
		if (arg === '--out') {
			outPath = takeValue(arg, argv[++i])
		} else if (arg === '--seed') {
			seed = takeInt(arg, argv[++i])
		} else if (arg === '--query') {
			const index = takeInt(arg, argv[++i])
			if (index < 0) {
				throw new Error(`--query needs a non-negative index, got ${index}`)
			}
			queries.push(index)
		} else if (arg.startsWith('--')) {
			throw new Error(`unknown flag "${arg}"`)
		} else if (specPath === undefined) {
			specPath = arg
		} else {
			throw new Error(`unexpected argument "${arg}"`)
		}
	}
	if (specPath === undefined) {
		throw new Error('missing <scenario.json>')
	}
	return { specPath, outPath, seed, queries }
}

/** Climb from `startDir` to the nearest `package.json` and read its `version`. */
function readVersionAbove(startDir: string, label: string): string {
	let dir = startDir
	for (;;) {
		const candidate = join(dir, 'package.json')
		if (existsSync(candidate)) {
			return (JSON.parse(readFileSync(candidate, 'utf8')) as { version: string }).version
		}
		const parent = dirname(dir)
		if (parent === dir) {
			throw new Error(`trace: no package.json found above ${startDir} (for ${label})`)
		}
		dir = parent
	}
}

/** The tallysim + tallynet package versions, for the trace header. Read lazily so importing this is pure. */
function packageVersions(): { tallysimVersion: string; tallynetVersion: string } {
	const require = createRequire(import.meta.url)
	return {
		tallysimVersion: readVersionAbove(dirname(fileURLToPath(import.meta.url)), 'tallysim'),
		tallynetVersion: readVersionAbove(dirname(require.resolve('tallynet')), 'tallynet'),
	}
}

/** Draw the scenario's payment queries over an already-materialised network (pair then amount, mirroring
 * the oracle runner's draw order). Returns empty for a sub-two-entity network (no distinct pair exists). */
function drawQueries(workload: SimScenario['workload'], entityCount: number): QuerySpec[] {
	if (entityCount < 2) {
		return [] // no distinct (from, to) pair exists; a valid header+network file with no query events
	}
	const rng = new SeededRandom(workload.seed)
	const queries: QuerySpec[] = []
	for (let i = 0; i < workload.queries; i++) {
		const [from, to] = drawPaymentPair(entityCount, rng)
		const amount = drawAmount(workload.amount, rng)
		queries.push({ from, to, amount, depth: workload.depth })
	}
	return queries
}

/** The discovery options the scenario's budget maps onto (depth rides on each query's `depth`). */
function budgetOptions(scenario: SimScenario): { initialBudgetMs?: number; perHopBudgetMs?: number } | undefined {
	return scenario.budget
}

/**
 * Record `scenario` to the trace sink wired by `open`. Returns the final trace-size stats.
 *
 * `open` yields a {@link LineSink} and a `close` thunk, so the caller owns the file descriptor lifecycle
 * (the function stays filesystem-agnostic and is unit-testable with an in-memory sink).
 */
export async function recordTrace(
	scenario: SimScenario,
	args: Pick<CliArgs, 'seed' | 'queries'>,
	versions: { tallysimVersion: string; tallynetVersion: string },
	open: () => { out: LineSink; close: () => void },
): Promise<{ lines: number; bytes: number }> {
	const runSeed = args.seed
	const network = materializeNetwork(scenario.network, runSeed)
	const conditions = scenario.conditions ?? {}
	const conditionsSeed = scenario.conditionsSeed ?? 0
	const options = budgetOptions(scenario)
	const queries = drawQueries(scenario.workload, network.entityCount)

	// Pass 1: learn each query's session code (collect codes only; events are discarded — memory stays flat).
	const pass1 = buildSimNetwork(network, conditions, conditionsSeed, undefined, options)
	const sessionCodes: string[] = []
	for (const query of queries) {
		sessionCodes.push((await runQuery(pass1, query)).sessionCode)
	}

	// Which queries to record: all when no --query was given, else the selected 0-based indices.
	const selected = args.queries.length > 0 ? new Set(args.queries) : undefined
	if (selected !== undefined) {
		for (const index of selected) {
			if (index >= queries.length) {
				throw new Error(`--query ${index} is out of range (the scenario draws ${queries.length} queries, 0..${queries.length - 1})`)
			}
		}
	}
	const recorded = queries
		.map((query, index) => ({ query, index }))
		.filter(({ index }) => selected === undefined || selected.has(index))
	const headerQueries: TraceQueryEntry[] = recorded.map(({ query, index }) => ({
		sessionCode: sessionCodes[index],
		from: query.from,
		to: query.to,
		amount: query.amount,
		depth: query.depth,
	}))
	const recordedSessions = selected === undefined ? undefined : new Set(recorded.map(({ index }) => sessionCodes[index]))

	const header = buildTraceHeader({ ...versions, scenario, runSeed, queries: headerQueries })
	const snapshot = makeNetworkSnapshot(network)

	const { out, close } = open()
	try {
		const writer = makeTraceWriter(header, snapshot, out, recordedSessions ? { sessions: recordedSessions } : undefined)
		// Pass 2: rebuild an identical network and rerun the same queries, streaming events to the sink.
		const pass2 = buildSimNetwork(network, conditions, conditionsSeed, writer.sink, options)
		for (const query of queries) {
			await runQuery(pass2, query)
		}
		return writer.stats()
	} finally {
		close()
	}
}

async function main(): Promise<void> {
	let args: CliArgs
	try {
		args = parseArgs(process.argv.slice(2))
	} catch (error) {
		process.stderr.write(`trace: ${(error as Error).message}\n${USAGE}\n`)
		process.exit(1)
	}
	const scenario = JSON.parse(readFileSync(args.specPath, 'utf8')) as SimScenario
	const open = (): { out: LineSink; close: () => void } => {
		if (args.outPath !== undefined) {
			const fd = openSync(args.outPath, 'w')
			return { out: (line) => writeSync(fd, `${line}\n`), close: () => closeSync(fd) }
		}
		return { out: (line) => process.stdout.write(`${line}\n`), close: () => {} }
	}
	const stats = await recordTrace(scenario, args, packageVersions(), open)
	process.stderr.write(`trace: wrote ${stats.lines} lines, ${stats.bytes} bytes\n`)
}

/** Run `main` only when executed as the entry script (not when imported by a test). */
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
	void main().catch((error: unknown) => {
		process.stderr.write(`trace: ${(error as Error).message}\n`)
		process.exit(1)
	})
}
