/**
 * Profile a tally's whole formation between two CLI parties: invite, accept, the inviter's terms,
 * accepting them, open, one payment. Each party is its own `taleus` process, so each has its own
 * event loop, as two phones do. The stack's debug output is captured per party with timestamps,
 * and every step the CLI reports is marked, so `analyze-profile.ts` can say where the time went.
 *
 *   node scripts/profile-formation.ts [--relay <addr>] [--out <dir>] [--debug <namespaces>] [--cpu-prof]
 *
 * `--debug ''` turns the stack's debug output off, for timings the logging does not inflate.
 * `--cpu-prof` writes each party's V8 CPU profile to `cpu-<party>/` (`summarize-cpu.ts` reads it).
 * `--count-fsync` logs every fsync (`count-fsync.mjs`), as `fsync:file` / `fsync:dir` lines.
 * `--busy <fraction>` keeps each party's event loop that busy (`busy-loop.mjs`): a phone-shaped CPU.
 * `--latency <ms>[:serial]` holds each outbound WebSocket frame that long (`ws-latency.mjs`).
 * `--no-reactivity` runs both parties without push wakes (the CLI's diagnostic switch).
 * `--memory` logs each party's memory every 5 s (`sample-memory.mjs`), as `mem` lines.
 * `--poll <seconds>` passes the CLI's backstop-poll switch to both parties (0: none).
 * `--idle <seconds>` how long both parties stay up after the payment (default 30): the idle tally's cost.
 * `--count-requests` logs every remote Optimystic request to `requests-<party>.jsonl` (`count-requests.mjs`;
 *   `analyze-requests.ts` reads them).
 * `--local-relay [<delayMs>]` runs both parties through a loopback relay of its own, every byte held
 *   `delayMs` each way on each party's link (`taleus-sereus/node` `startLocalRelay`).
 * `--pays <n>` makes n payments rather than one (each one Sam's chit to Jan).
 * `--preload <file>` loads one more module into each party first (`node --import`), e.g. a diagnostic patch.
 * `--count-peerstore` prints each party's libp2p peer-store operations by caller at exit (`count-peerstore.mjs`).
 *
 * Default: loopback (`--listen`), one run per party, no relay -- so nothing but the stack is
 * measured. With `--relay`, both parties use that relay, as phones do.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startLocalRelay, type LocalRelay } from 'taleus-sereus/node'

const { values } = parseArgs({
	options: {
		relay: { type: 'string' },
		'local-relay': { type: 'string' },
		'count-requests': { type: 'boolean' },
		preload: { type: 'string' },
		pays: { type: 'string' },
		out: { type: 'string' },
		debug: { type: 'string' },
		timeout: { type: 'string' },
		'cpu-prof': { type: 'boolean' },
		'count-fsync': { type: 'boolean' },
		busy: { type: 'string' },
		latency: { type: 'string' },
		'no-reactivity': { type: 'boolean' },
		memory: { type: 'boolean' },
		'count-peerstore': { type: 'boolean' },
		idle: { type: 'string' },
		poll: { type: 'string' },
	},
})
const out = resolve(values.out ?? `profile-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const debug = values.debug ?? 'sereus:*,optimystic:*'
const timeout = Number(values.timeout ?? 600)
const idle = Number(values.idle ?? 30)
const MAIN = resolve(import.meta.dirname, '../src/main.ts')
const home = join(out, 'home')
const link = join(out, 'link')
const marksFile = join(out, 'marks.jsonl')
const t0 = Date.now()
/** The relay both parties use: `--relay`, or the local one `--local-relay` starts. */
let relay: string | undefined = values.relay
let localRelay: LocalRelay | undefined

interface Mark {
	t: number
	at: string
	party: string
	text: string
}

async function mark(party: string, text: string): Promise<void> {
	const entry: Mark = { t: Date.now() - t0, at: new Date().toISOString(), party, text }
	process.stdout.write(`${(entry.t / 1000).toFixed(1).padStart(7)} s  ${party.padEnd(4)} ${text}\n`)
	await appendFile(marksFile, `${JSON.stringify(entry)}\n`)
}

/** Global options every run of a party gets: its home, and how it is reached. */
function reach(): string[] {
	return [
		...(relay ? [] : ['--listen']),
		...(values['no-reactivity'] ? ['--no-reactivity'] : []),
		...(values.poll === undefined ? [] : ['--poll', values.poll]),
	]
}

/** Run one party's commands to completion, quietly (setup). */
function setup(party: string, commands: string): Promise<void> {
	return new Promise((done, fail) => {
		const child = spawn(process.execPath, [MAIN, '--home', home, '-p', party, ...reach(), '-c', commands], { stdio: ['ignore', 'ignore', 'inherit'] })
		child.on('exit', code => (code === 0 ? done() : fail(new Error(`${party} setup exited ${code}`))))
	})
}

/**
 * Start one party's scripted run with the stack's debug output on. Its stderr -- the CLI's notes and
 * the stack's timestamped debug lines -- goes to `<party>.log`; every CLI line (stdout data, and
 * stderr notes that are not debug lines) is also marked.
 */
function scripted(party: string, commands: string): { child: ChildProcess; done: Promise<number> } {
	const profiling = [
		...(values['cpu-prof'] ? ['--cpu-prof', `--cpu-prof-dir=${join(out, `cpu-${party}`)}`] : []),
		...(values['count-fsync'] ? ['--import', resolve(import.meta.dirname, 'count-fsync.mjs')] : []),
		...(values.busy ? ['--import', resolve(import.meta.dirname, 'busy-loop.mjs')] : []),
		...(values.latency ? ['--import', resolve(import.meta.dirname, 'ws-latency.mjs')] : []),
		...(values.memory ? ['--import', resolve(import.meta.dirname, 'sample-memory.mjs')] : []),
		...(values['count-peerstore'] ? ['--import', resolve(import.meta.dirname, 'count-peerstore.mjs')] : []),
		...(values['count-requests'] ? ['--import', resolve(import.meta.dirname, 'count-requests.mjs')] : []),
		...(values.preload ? ['--import', resolve(values.preload)] : []),
	]
	const [latencyMs, latencyMode] = (values.latency ?? '').split(':')
	const child = spawn(process.execPath, [...profiling, MAIN, '--home', home, '-p', party, ...reach(), '-v', '-c', commands], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, DEBUG: debug, DEBUG_COLORS: '0', ...(values['count-requests'] ? { TALEUS_REQUEST_LOG: join(out, `requests-${party}.jsonl`) } : {}), ...(values.busy ? { TALEUS_BUSY: values.busy } : {}), ...(latencyMs ? { TALEUS_WS_DELAY_MS: latencyMs, TALEUS_WS_MODE: latencyMode ?? 'pipelined' } : {}) },
	})
	const log = join(out, `${party}.log`)
	const lines = (stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		let rest = ''
		stream.on('data', (chunk: Buffer) => {
			const text = rest + chunk.toString('utf8')
			const parts = text.split('\n')
			rest = parts.pop() ?? ''
			for (const line of parts) onLine(line)
		})
	}
	lines(child.stdout!, line => void mark(party, `out: ${line.slice(0, 140)}`))
	lines(child.stderr!, line => {
		void appendFile(log, `${line}\n`)
		// Debug lines start with an ISO timestamp; the CLI's own notes do not.
		if (!/^\d{4}-\d\d-\d\dT/.test(line) && !line.startsWith(' ')) void mark(party, `note: ${line.slice(0, 140)}`)
	})
	const done = new Promise<number>(resolveDone => child.on('exit', code => resolveDone(code ?? -1)))
	return { child, done }
}

async function main(): Promise<void> {
	await rm(out, { recursive: true, force: true })
	await mkdir(out, { recursive: true })
	if (values['local-relay'] !== undefined) {
		localRelay = await startLocalRelay({ delayMs: Number(values['local-relay'] || 0) })
		relay = localRelay.address
	}
	await mark('run', `out ${out}; ${relay ? `relay ${relay}` : 'loopback'}${values['local-relay'] ? ` (local, ${values['local-relay']} ms each way)` : ''}; DEBUG=${debug}`)

	await setup('jan', `party name Jan${relay ? `; relay add ${relay}` : ''}`)
	await setup('sam', `party name Sam${relay ? `; relay add ${relay}` : ''}`)
	await mark('run', 'parties ready')

	// The inviter stays up until the tally is open and the payment has had time to arrive.
	const jan = scripted('jan', `invite --limit 500 --note profile -o ${link}; wait Open --timeout ${timeout}; idle ${idle}; history 1`)
	let janExited = false
	void jan.done.then(() => (janExited = true))
	while (!existsSync(link) || !readFileSync(link, 'utf8').trim()) {
		if (janExited) throw new Error(`jan exited before writing the invitation link; see ${join(out, 'jan.log')}`)
		await new Promise(resolveWait => setTimeout(resolveWait, 250))
	}
	await mark('run', 'link written')
	const sam = scripted('sam', [
		`accept ${readFileSync(link, 'utf8').trim()} --yes`,
		`wait Offered --timeout ${timeout}`,
		'offer 1 accept',
		`wait Open --timeout ${timeout}`,
		'pay 1 1.00 probe',
		...(values.pays ? Array.from({ length: Number(values.pays) - 1 }, (_, i) => `pay 1 1.00 probe-${i + 2}`) : []),
		`idle ${idle}`,
	].join('; '))
	const [samCode, janCode] = await Promise.all([sam.done, jan.done])
	await mark('run', `done: jan exit ${janCode}, sam exit ${samCode}`)
	await writeFile(join(out, 'summary.json'), JSON.stringify({ relay: relay ?? null, localRelayDelayMs: values['local-relay'] ?? null, debug, janCode, samCode, ms: Date.now() - t0 }, null, 2))
	await localRelay?.stop()
}

main().catch(error => {
	process.stderr.write(`profile: ${error instanceof Error ? error.stack : String(error)}\n`)
	process.exit(1)
})
