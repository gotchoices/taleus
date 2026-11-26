/**
 * `trace` — a Node-specific driver that records one discovery (and, when the scenario enables consensus,
 * consensus) simulation run to a versioned NDJSON trace file. It reads a {@link SimScenario} JSON file,
 * materialises the network, draws the workload's payment queries, runs them on the `tallynet` protocol over
 * compressed time, and **streams** the trace (header, network snapshot, then one line per event) to stdout or
 * a file — never buffering the event list, so memory stays flat regardless of run size. It prints the final
 * trace-size stats to stderr.
 *
 * ── Consensus is opt-in, keyed off `scenario.consensus` ───────────────────────────────────────────────
 * A scenario that carries a `consensus` block drives each query's **lift** to settlement as well as its
 * discovery, and records one {@link TraceLiftEntry} per found/recorded query in the header (its route +
 * member-key map, so a reader can place the consensus events, whose addresses are member keys not entity
 * ids). A scenario without the block is **discovery-only** and this path stays byte-identical to before —
 * the pinned discovery-trace tests depend on that — bar the header's `traceFormatVersion`, now 2.
 *
 * Deliberately, the consensus trace does **not** model capacity depletion: it builds ONE consensus sim per
 * pass (so session + transaction codes mint on one incrementing RNG and stay unique across the pass — the
 * viewer joins events to queries by those codes), and discards each lift's balance move against a fresh
 * {@link cloneNetwork} copy, leaving the recorded snapshot the pristine initial network. This differs on
 * purpose from the consensus **metrics** sweep (`sim/consensus-runner.ts`), which rebuilds per query and
 * mutates one kept network to model depletion; the two are each internally deterministic and need not agree,
 * exactly as the discovery trace already seeds differently from the discovery sweep.
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
	cloneNetwork,
	consensusConfigFor,
	drawPaymentQueries,
	entityName,
	makeNetworkSnapshot,
	makeTraceWriter,
	materializeNetwork,
	runLiftForOutcome,
	runQuery,
	type LineSink,
	type Network,
	type QueryOutcome,
	type QuerySpec,
	type SimNetwork,
	type SimScenario,
	type TraceLiftEntry,
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

/** The tallysim + tallynet package versions, for the trace header. Read lazily so importing this is pure.
 * Exported so the sibling `simulate` CLI reuses the same version-resolution (its `--trace` writes the same
 * header shape). */
export function packageVersions(): { tallysimVersion: string; tallynetVersion: string } {
	const require = createRequire(import.meta.url)
	return {
		tallysimVersion: readVersionAbove(dirname(fileURLToPath(import.meta.url)), 'tallysim'),
		tallynetVersion: readVersionAbove(dirname(require.resolve('tallynet')), 'tallynet'),
	}
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
	// Shared draw: pair-then-amount at `workload.seed` (NOT offset by the run seed here — preserving this
	// CLI's historical behaviour byte-identically; the sim-runner offsets by the run seed, this does not).
	const queries = drawPaymentQueries(scenario.workload, network.entityCount, new SeededRandom(scenario.workload.seed))

	// Consensus is driven iff the scenario carries a `consensus` block (its presence is the switch). When it
	// is absent, `consensus` stays `undefined` and every step below collapses to the discovery-only recorder,
	// byte-for-byte as before (one extra `liftEntries.push(undefined)` that touches no rng and no sink).
	const consensus = scenario.consensus !== undefined ? consensusConfigFor(scenario, network, runSeed) : undefined

	// Pass 1: learn each query's session code (events discarded — memory stays flat). With consensus on, also
	// drive each query's lift to settlement and collect its TraceLiftEntry (undefined when it found no route).
	const pass1 = buildSimNetwork(network, conditions, conditionsSeed, undefined, options, consensus)
	const sessionCodes: string[] = []
	const liftEntries: (TraceLiftEntry | undefined)[] = []
	for (const query of queries) {
		const outcome = await runQuery(pass1, query)
		sessionCodes.push(outcome.sessionCode)
		liftEntries.push(consensus ? await recordLift(pass1, network, outcome, query) : undefined)
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
	// The lifts for the recorded queries only (same --query narrowing); a recorded query with no found route
	// contributes none. Undefined (not []) on a discovery-only run, so the header omits `lifts` entirely.
	const headerLifts: TraceLiftEntry[] | undefined = consensus
		? recorded.map(({ index }) => liftEntries[index]).filter((entry): entry is TraceLiftEntry => entry !== undefined)
		: undefined
	const recordedSessions = selected === undefined ? undefined : new Set(recorded.map(({ index }) => sessionCodes[index]))

	const header = buildTraceHeader({ ...versions, scenario, runSeed, queries: headerQueries, lifts: headerLifts })
	const snapshot = makeNetworkSnapshot(network)

	const { out, close } = open()
	try {
		const writer = makeTraceWriter(header, snapshot, out, recordedSessions ? { sessions: recordedSessions } : undefined)
		// Pass 2: rebuild an identical sim and rerun the same queries (and lifts), streaming events to the sink.
		// Deterministic ⇒ pass-2 codes/events match pass-1's recorded `lifts`; consensus events carry the reused
		// discovery session code, so the writer's session filter records them for the selected queries too.
		const pass2 = buildSimNetwork(network, conditions, conditionsSeed, writer.sink, options, consensus)
		for (const query of queries) {
			const outcome = await runQuery(pass2, query)
			if (consensus) {
				// Discard the balance move against a fresh clone (see the module header): the recorded snapshot
				// stays pristine and lifts never accumulate into an over-limit settle across queries.
				await runLiftForOutcome(pass2, cloneNetwork(network), outcome, query)
			}
		}
		return writer.stats()
	} finally {
		close()
	}
}

/**
 * Drive one query's lift to settlement on `sim` (a consensus-enabled sim) and, if it found a route, return
 * the {@link TraceLiftEntry} for the header. The balance move is discarded against a fresh {@link cloneNetwork}
 * copy — the recorded snapshot stays the pristine initial network, and lifts never accumulate into an
 * over-limit settle across queries (the single-sim trace deliberately does not model capacity depletion).
 */
async function recordLift(
	sim: SimNetwork,
	network: Network,
	outcome: QueryOutcome,
	query: QuerySpec,
): Promise<TraceLiftEntry | undefined> {
	// NOTE: clones the whole network per lift (so the throwaway balance move never touches the snapshot);
	// fine for the planned trace sizes. If a traced scenario ever has very many queries over a huge network,
	// settle on a scratch clone reused across lifts (reset its balances per lift) instead of one clone each.
	const result = await runLiftForOutcome(sim, cloneNetwork(network), outcome, query)
	if (result === undefined) {
		return undefined
	}
	return {
		sessionCode: outcome.sessionCode,
		transactionCode: result.transactionCode,
		route: result.route,
		tallyPath: result.tallyPath,
		memberKeys: Object.fromEntries(distinctEntities(result.route).map((id) => [sim.net.memberKey(entityName(id)), id])),
		amount: result.amount,
	}
}

/** The distinct entity ids on a route, in first-appearance order (a circular route lists its repeated origin once). */
function distinctEntities(route: number[]): number[] {
	const seen = new Set<number>()
	const distinct: number[] = []
	for (const id of route) {
		if (!seen.has(id)) {
			seen.add(id)
			distinct.push(id)
		}
	}
	return distinct
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
