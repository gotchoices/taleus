/**
 * Scenario harness: parties driven through the CLI's own commands, in one process.
 *
 * Each party is a real one -- its folder, its cadre node, its model -- and every step is a command
 * line run exactly as `taleus -c` runs it (`runCommands`): parsing, tally references, the model call,
 * the output. Only the process boundary is skipped, so a scenario reads a command's rows instead of
 * scraping a child process's stdout. The parties reach each other through a relay, a loopback one by
 * default (`startLocalRelay`), or the one in `TALEUS_SCENARIO_RELAY` -- which is how a party survives
 * a restart: through a relay it is found again, where loopback listen ports change with every run.
 * Party folders go in a fresh directory under `TALEUS_SCENARIO_HOME` (default: the system temp
 * directory), removed afterwards.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openParty, partyDirs, saveConfig, startLocalRelay, type LocalRelay } from 'taleus-sereus/node'

import { runCommands } from '../src/commands/index.ts'
import { splitLine } from '../src/lex.ts'
import { createOutput } from '../src/output.ts'
import { runningParty, settle, type RunningParty } from '../src/party.ts'
import { createSession, EXIT, type Session } from '../src/session.ts'

/** `TALEUS_SCENARIO_TRACE=1`: each command's time, and how many polls a wait took, on stderr. */
const TRACE = process.env.TALEUS_SCENARIO_TRACE === '1'

/** How long a party gets to settle after starting (relay reservation, strands launched). */
const SETTLE_MS = 60_000

/** What a command line printed: its exit code, its rows (JSON), and its notes. */
export interface Ran {
	code: number
	rows: Record<string, unknown>[]
	notes: string[]
}

export interface ScenarioParty {
	readonly name: string
	/** Run a command line; never throws for a command's own failure. */
	run(line: string): Promise<Ran>
	/** Run a command line that must succeed; its rows. */
	ok(line: string): Promise<Record<string, unknown>[]>
	/** Run `line` until `test` passes on its rows, or fail after `timeoutMs`. */
	until(line: string, test: (rows: Record<string, unknown>[]) => boolean, timeoutMs?: number): Promise<Record<string, unknown>[]>
	/** Stop the party and start it again from its folder. */
	restart(): Promise<void>
	stop(): Promise<void>
}

export interface World {
	party(name: string): Promise<ScenarioParty>
	stop(): Promise<void>
}

export async function startWorld(): Promise<World> {
	// Party folders: under TALEUS_SCENARIO_HOME when set (a RAM disk spares macOS's per-write fsync).
	const home = await mkdtemp(join(process.env.TALEUS_SCENARIO_HOME ?? tmpdir(), 'taleus-scenario-'))
	const shared = process.env.TALEUS_SCENARIO_RELAY
	// TALEUS_SCENARIO_RELAY_LIMITS=default: the local relay caps connections as a stock public relay does.
	// TALEUS_SCENARIO_DELAY_MS: each party's link to it holds every byte that long each way.
	const local: LocalRelay | undefined = shared ? undefined : await startLocalRelay({
		defaultLimits: process.env.TALEUS_SCENARIO_RELAY_LIMITS === 'default',
		delayMs: Number(process.env.TALEUS_SCENARIO_DELAY_MS ?? 0),
	})
	const relay = shared ?? local!.address
	const parties: ScenarioParty[] = []
	return {
		async party(name) {
			const party = await startParty(home, name, relay)
			parties.push(party)
			return party
		},
		async stop() {
			await Promise.allSettled(parties.map(party => party.stop()))
			await local?.stop()
			await rm(home, { recursive: true, force: true })
		},
	}
}

async function startParty(home: string, name: string, relay: string): Promise<ScenarioParty> {
	const dirs = partyDirs(name.toLowerCase(), home)
	const { config } = await openParty(dirs)
	if (!config.relays.includes(relay)) {
		config.relays = [...config.relays, relay]
		await saveConfig(dirs, config)
	}
	let running: { party: RunningParty; session: Session; captured: Captured } | undefined

	async function start(): Promise<void> {
		const party = runningParty({ dirs, config, extraRelays: [], listen: [], reactivity: true })
		const captured = capture()
		const ready = party.start()
		const session = createSession({
			party,
			out: createOutput({ json: true, header: false, write: captured.write, writeErr: captured.writeErr }),
			verbose: false,
			interactive: false,
			ready,
			signal: () => new AbortController().signal,
			confirm: () => Promise.resolve(false),
		})
		await ready
		await settle(party, SETTLE_MS)
		running = { party, session, captured }
	}

	async function run(line: string): Promise<Ran> {
		if (!running) throw new Error(`${name} is not running`)
		running.captured.reset()
		const started = Date.now()
		const code = await runCommands(running.session, splitLine(line))
		if (TRACE) process.stderr.write(`[trace] ${name} ${line.slice(0, 40)}: ${Date.now() - started} ms\n`)
		return { code, rows: running.captured.rows(), notes: running.captured.notes() }
	}

	const self: ScenarioParty = {
		name,
		run,
		async ok(line) {
			const ran = await run(line)
			if (ran.code !== EXIT.ok) throw new Error(`${name}: \`${line}\` exited ${ran.code}: ${ran.notes.join(' | ')}`)
			return ran.rows
		},
		async until(line, test, timeoutMs = 120_000) {
			const started = Date.now()
			const deadline = started + timeoutMs
			let last: Ran | undefined
			let polls = 0
			while (Date.now() < deadline) {
				last = await run(line)
				polls++
				if (last.code === EXIT.ok && test(last.rows)) {
					if (TRACE) process.stderr.write(`[trace] ${name} until ${line}: ${Date.now() - started} ms, ${polls} polls\n`)
					return last.rows
				}
				await new Promise(resolve => setTimeout(resolve, 1000))
			}
			throw new Error(`${name}: \`${line}\` did not reach the expected state in ${timeoutMs} ms; last: ${JSON.stringify(last)}`)
		},
		async restart() {
			await self.stop()
			await start()
		},
		async stop() {
			const stopping = running
			running = undefined
			await stopping?.party.stop()
		},
	}
	await start()
	return self
}

interface Captured {
	write(text: string): void
	writeErr(text: string): void
	rows(): Record<string, unknown>[]
	notes(): string[]
	reset(): void
}

function capture(): Captured {
	let out = ''
	let err = ''
	return {
		write: text => void (out += text),
		writeErr: text => void (err += text),
		rows: () => out.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>),
		notes: () => err.split('\n').filter(Boolean),
		reset() {
			out = ''
			err = ''
		},
	}
}
