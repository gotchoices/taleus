#!/usr/bin/env node
/**
 * taleus -- Taleus on the command line, for testing, evaluating and debugging.
 *
 *   taleus [options]                      interactive (stdin is a terminal)
 *   taleus [options] < script             one command per line
 *   taleus [options] <command> [\; ...]   run, then exit
 *   taleus [options] -c 'cmd; cmd'
 *
 * Spec: design/specs/cli/commands.md. Each run starts the party's node; there is no background
 * process, so a one-shot command pays for the start. Shaped after sereus chat's CLI.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { format } from 'node:util'
import { heldStrandIds, lockParty, loopbackListenAddress, openParty, partyDirs } from 'taleus-sereus/node'

import { commandNames, runCommands } from './commands/index.ts'
import { splitArgv, splitLine } from './lex.ts'
import { createOutput } from './output.ts'
import { runningParty } from './party.ts'
import { createSession, EXIT, type Session } from './session.ts'

const VERSION = '0.1.0'
const HISTORY_LINES = 1000
/** `--listen` with no address: loopback, on the party's own kept port. */
const LOOPBACK = 'loopback'

interface Globals {
	party: string
	home?: string
	json: boolean
	header: boolean
	relays: string[]
	listen: string[]
	waitSeconds: number
	verbose: boolean
	reactivity: boolean
	/** The store's backstop poll, in seconds; 0 turns it off (diagnostic). Unset: the store's default. */
	pollSeconds?: number
	script?: string
	help: boolean
	version: boolean
	/** The words after the options: commands, if any. */
	rest: string[]
}

const USAGE = `usage: taleus [options] [command [args] [\\; command ...]]

  -p, --party <name>     party (default "default")
      --home <dir>       where parties live (default $TALEUS_HOME or ~/.taleus)
      --json             JSON lines instead of tab-separated lines
      --header           a column header line before tab-separated rows
      --relay <addr>     also use this relay for this run (repeatable)
      --listen [<addr>]  also listen (default: loopback, on this party's own port)
      --wait <seconds>   one-shot: how long to let the node settle first (default 30)
  -c <commands>          run these ";"-separated commands
  -v, --verbose          the stack's log lines on stderr
      --no-reactivity    diagnostic: no push wakes for the partner's commits (poll only)
      --poll <seconds>   diagnostic: the backstop poll's interval (0: none; default 10)
  -h, --help · --version

With no command: an interactive prompt, or commands from stdin. "help" lists commands.`

export function parseGlobals(argv: readonly string[]): Globals {
	const g: Globals = { party: 'default', json: false, header: false, relays: [], listen: [], waitSeconds: 30, verbose: false, reactivity: true, help: false, version: false, rest: [] }
	let i = 0
	const value = (flag: string) => {
		const next = argv[++i]
		if (next === undefined) throw new Error(`${flag} needs a value`)
		return next
	}
	for (; i < argv.length; i++) {
		const a = argv[i]
		if (a === '-p' || a === '--party') g.party = value(a)
		else if (a === '--home') g.home = value(a)
		else if (a === '--json') g.json = true
		else if (a === '--header') g.header = true
		else if (a === '--relay') g.relays.push(value(a))
		else if (a === '--listen') g.listen.push(argv[i + 1]?.startsWith('/') ? argv[++i] : LOOPBACK)
		else if (a === '--wait') g.waitSeconds = Number(value(a))
		else if (a === '-c') g.script = value(a)
		else if (a === '-v' || a === '--verbose') g.verbose = true
		else if (a === '--no-reactivity') g.reactivity = false
		else if (a === '--poll') g.pollSeconds = Number(value(a))
		else if (a === '-h' || a === '--help') g.help = true
		else if (a === '--version') g.version = true
		else if (a === '--') {
			i++
			break
		} else if (a.startsWith('-') && a !== '-') throw new Error(`unknown option ${a}`)
		else break
	}
	g.rest = argv.slice(i)
	if (!Number.isFinite(g.waitSeconds) || g.waitSeconds < 0) throw new Error('--wait takes seconds')
	return g
}

/** The stack logs freely to the console. stdout is for data, so that goes to stderr with -v, and nowhere without. */
function routeConsole(verbose: boolean): void {
	const toStderr = (...args: unknown[]) => void process.stderr.write(`${format(...args)}\n`)
	const quiet = () => undefined
	for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) console[level] = verbose ? toStderr : quiet
	process.on('unhandledRejection', error => {
		if (verbose) toStderr('[unhandled]', error)
	})
}

async function main(argv: readonly string[]): Promise<number> {
	let g: Globals
	try {
		g = parseGlobals(argv)
	} catch (error) {
		process.stderr.write(`taleus: ${(error as Error).message}\n${USAGE}\n`)
		return EXIT.usage
	}
	if (g.help) {
		process.stderr.write(`${USAGE}\n`)
		return EXIT.ok
	}
	if (g.version) {
		process.stdout.write(`${VERSION}\n`)
		return EXIT.ok
	}

	const commands = g.script !== undefined ? splitLine(g.script) : splitArgv(g.rest)
	const interactive = commands.length === 0 && !!process.stdin.isTTY
	routeConsole(g.verbose)

	const dirs = partyDirs(g.party, g.home)
	const { config, created } = await openParty(dirs)
	await lockParty(dirs)
	const out = createOutput({ json: g.json, header: g.header })
	const listen = await Promise.all(g.listen.map(async addr => (addr === LOOPBACK ? loopbackListenAddress(dirs, config) : addr)))
	const party = runningParty({ dirs, config, extraRelays: g.relays, listen, reactivity: g.reactivity, pollSeconds: g.pollSeconds })
	out.note(`taleus ${VERSION} · party ${dirs.name}${created ? ' (new)' : ''} · starting…`)

	let abort = new AbortController()
	let asker: ((question: string) => Promise<string>) | undefined
	const ready = party.start()
	// Reported by the first command that waits on it.
	ready.catch(() => undefined)

	const session = createSession({
		party,
		out,
		verbose: g.verbose,
		interactive,
		ready,
		signal: () => abort.signal,
		// At the prompt, the prompt asks (one reader on the terminal); otherwise a one-off reader.
		confirm: question => (asker ?? askOnce)(`${question} [y/N] `).then(answer => /^y(es)?$/i.test(answer.trim())),
	})

	let code: number = EXIT.ok
	let rl: Interface | undefined
	try {
		if (interactive) {
			ready.then(
				() => out.note('ready. "help" or "?" lists the commands.'),
				(error: unknown) => out.note(`taleus: the party did not start: ${(error as Error).message}`),
			)
			rl = await prompt(session, join(dirs.root, 'history'), () => abort, next => void (abort = next), next => void (asker = next))
		} else {
			process.on('SIGINT', () => {
				if (!abort.signal.aborted) abort.abort()
				else void shutdown(session, EXIT.interrupted)
			})
			await ready.catch(() => undefined)
			await settle(session, g.waitSeconds * 1000)
			const script = commands.length ? commands : splitLine(await readAll())
			code = await runCommands(session, script)
		}
	} finally {
		rl?.close()
	}
	return shutdown(session, code)
}

/**
 * One-shot: give the node a bounded time to get going before the commands run -- its relay
 * reservation (when it has relays), and every strand the party holds launched and past starting,
 * so `tallies` finds them: a restarted node offers its strands from a poll that runs a moment after
 * it starts (`heldStrandIds`).
 */
async function settle(session: Session, ms: number): Promise<void> {
	const deadline = Date.now() + ms
	const held = await heldStrandIds(session.party.node)
	const busy = () => {
		const node = session.party.node
		if (session.party.config.relays.length && node.getRelayReservationState()?.status !== 'reserved') return true
		const launched = node.getStrands()
		return held.some(id => !launched.has(id) || launched.get(id)?.status === 'starting')
	}
	while (Date.now() < deadline && busy()) await new Promise(resolve => setTimeout(resolve, 500))
}

async function shutdown(session: Session, code: number): Promise<number> {
	// Stopping can hang on a peer that does not answer; the exit does not wait forever.
	await Promise.race([
		session.party.stop().catch((error: unknown) => session.out.note(`taleus: stopping: ${(error as Error).message}`)),
		new Promise(resolve => setTimeout(resolve, 5000).unref()),
	])
	process.exit(code)
}

async function readAll(): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
	return Buffer.concat(chunks).toString('utf8')
}

/** A question on the terminal outside the prompt (a one-shot run); '' when nobody can answer. */
function askOnce(question: string): Promise<string> {
	if (!process.stdin.isTTY) return Promise.resolve('')
	const once = createInterface({ input: process.stdin, output: process.stderr })
	return new Promise(resolve => once.question(question, answer => {
		once.close()
		resolve(answer)
	}))
}

/**
 * The interactive prompt. Resolves with its readline interface once the user leaves.
 *
 * ONE READER. Lines arrive as events and run in order. While a command asks a question, the next
 * line answers it and is not run as a command. A second readline on the terminal would see every
 * line too, and closing it pauses the shared input.
 */
async function prompt(
	session: Session,
	historyFile: string,
	currentAbort: () => AbortController,
	setAbort: (next: AbortController) => void,
	setAsker: (ask: (question: string) => Promise<string>) => void,
): Promise<Interface> {
	const saved = (await readFile(historyFile, 'utf8').catch(() => '')).split('\n').filter(Boolean)
	return new Promise<Interface>(resolve => {
		const PROMPT = 'taleus> '
		const names = commandNames()
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: PROMPT,
			history: saved.slice(-HISTORY_LINES).reverse(),
			historySize: HISTORY_LINES,
			completer: (line: string) => {
				if (/\s/.test(line)) return [[], line]
				const hits = names.filter(name => name.startsWith(line))
				return [hits.length ? hits : names, line]
			},
		})
		let answer: ((line: string) => void) | null = null
		setAsker(question => new Promise(reply => {
			answer = reply
			rl.setPrompt(question)
			rl.prompt()
		}))

		const queue: string[] = []
		let running = false
		let closed = false
		const drain = async () => {
			if (running) return
			running = true
			while (queue.length) {
				const trimmed = queue.shift()!.trim()
				if (trimmed === 'quit' || trimmed === 'exit') {
					rl.close()
					break
				}
				if (!trimmed) continue
				let commands: string[][]
				try {
					commands = splitLine(trimmed)
				} catch (error) {
					session.out.note(`taleus: ${(error as Error).message}`)
					continue
				}
				setAbort(new AbortController())
				await runCommands(session, commands)
			}
			running = false
			if (closed) finish()
			else {
				rl.setPrompt(PROMPT)
				rl.prompt()
			}
		}

		rl.on('line', line => {
			if (answer) {
				const reply = answer
				answer = null
				rl.setPrompt(PROMPT)
				reply(line)
				return
			}
			queue.push(line)
			void drain()
		})
		rl.on('SIGINT', () => {
			if (running) {
				currentAbort().abort()
				return
			}
			process.stderr.write('\n(quit or Ctrl-D to leave)\n')
			rl.prompt()
		})
		let finished = false
		const finish = () => {
			if (finished) return
			finished = true
			const history = (rl as unknown as { history: string[] }).history.slice(0, HISTORY_LINES).reverse()
			writeFile(historyFile, `${history.join('\n')}\n`, { mode: 0o600 }).then(
				() => resolve(rl),
				(error: unknown) => {
					session.out.note(`taleus: saving history: ${(error as Error).message}`)
					resolve(rl)
				},
			)
		}
		rl.on('close', () => {
			closed = true
			if (answer) {
				const reply = answer
				answer = null
				reply('')
			}
			if (!running) finish()
		})
		rl.prompt()
	})
}

main(process.argv.slice(2)).then(
	code => process.exit(code),
	(error: unknown) => {
		process.stderr.write(`taleus: ${error instanceof Error ? error.message : String(error)}\n`)
		process.exit(EXIT.failed)
	},
)
