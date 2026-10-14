/** Every command, `help`, and running one command line's commands in order. */
import { CliFailure, EXIT, UsageError, type Session } from '../session.ts'
import { parseCommand, type Command } from './command.ts'
import { diagCommands } from './diag.ts'
import { inviteCommands } from './invites.ts'
import { moneyCommands } from './money.ts'
import { setupCommands } from './setup.ts'
import { tallyCommands } from './tallies.ts'

const help: Command = {
	name: 'help',
	aliases: ['?'],
	summary: 'List commands, or show one command\'s usage',
	usage: '[command]',
	offline: true,
	run(session, args) {
		if (args[0]) {
			const command = find(args[0])
			session.out.note(`${command.name} ${command.usage}\n  ${command.summary}${command.aliases ? `\n  also: ${command.aliases.join(', ')}` : ''}`)
			return Promise.resolve()
		}
		const width = Math.max(...COMMANDS.map(command => command.name.length))
		session.out.note(COMMANDS.map(command => `${command.name.padEnd(width)}  ${command.summary}`).join('\n')
			+ '\n\nTallies are named by row (from the last "tallies"), id or id prefix, or counterparty.'
			+ '\nAmounts are in the tally\'s unit, as written: 12.50 on a dollar tally.'
			+ '\nSeparate commands with ";". Any unique beginning of a command works.'
			+ '\nDetails: help <command>.')
		return Promise.resolve()
	},
}

export const COMMANDS: Command[] = [help, ...setupCommands, ...tallyCommands, ...inviteCommands, ...moneyCommands, ...diagCommands]

/** The command a word names: a name or alias exactly, else the one command it begins. */
export function find(word: string): Command {
	const names = (command: Command) => [command.name, ...(command.aliases ?? [])]
	const exact = COMMANDS.find(command => names(command).includes(word))
	if (exact) return exact
	const matches = COMMANDS.filter(command => names(command).some(name => name.startsWith(word)))
	if (matches.length === 1) return matches[0]
	if (matches.length > 1) throw new UsageError(`${JSON.stringify(word)} could be ${matches.map(command => command.name).join(', ')}`)
	throw new UsageError(`no command ${JSON.stringify(word)}; "help" lists them`)
}

export function commandNames(): string[] {
	return COMMANDS.flatMap(command => [command.name, ...(command.aliases ?? [])]).sort()
}

/** Run commands in order, stopping at the first failure. Returns the exit code. */
export async function runCommands(session: Session, commands: string[][]): Promise<number> {
	for (const [name, ...words] of commands) {
		const code = await runOne(session, name, words)
		if (code !== EXIT.ok) return code
	}
	return EXIT.ok
}

async function runOne(session: Session, name: string, words: string[]): Promise<number> {
	try {
		const command = find(name)
		const { args, values } = parseCommand(command, words)
		if (!command.offline) await session.ready
		await command.run(session, args, values)
		return EXIT.ok
	} catch (error) {
		if (error instanceof CliFailure) {
			session.out.note(`taleus: ${error.message}`)
			return error.code
		}
		// A thrown error is a defect, or the party failing to start.
		session.out.note(`taleus: ${error instanceof Error ? (session.verbose ? error.stack : error.message) : String(error)}`)
		return EXIT.failed
	}
}
