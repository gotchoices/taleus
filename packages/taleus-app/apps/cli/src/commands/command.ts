/**
 * What a command is: a name, its usage line, its switches (`node:util` `parseArgs`), and what it does
 * with the session. Each command is a few `TaleusModel` calls and some rows.
 */
import { parseArgs, type ParseArgsConfig } from 'node:util'

import { UsageError, type Session } from '../session.ts'

export type Options = NonNullable<ParseArgsConfig['options']>
export type Values = Record<string, string | boolean | string[] | boolean[] | undefined>

export interface Command {
	name: string
	aliases?: string[]
	/** One line, for `help`. */
	summary: string
	/** Arguments after the name, for `help` and usage errors. */
	usage: string
	options?: Options
	/** Takes no arguments: extra words are a usage error, not silently ignored. */
	noArgs?: boolean
	/** Needs no running party (`help`): runs before the session is ready. */
	offline?: boolean
	run(session: Session, args: string[], values: Values): Promise<void>
}

export function parseCommand(command: Command, words: string[]): { args: string[]; values: Values } {
	try {
		const { positionals, values } = parseArgs({ args: words, options: command.options ?? {}, allowPositionals: true, strict: true })
		if (command.noArgs && positionals.length) throw new Error(`unexpected ${JSON.stringify(positionals[0])}`)
		return { args: positionals, values: values as Values }
	} catch (error) {
		throw new UsageError(`${(error as Error).message}\nusage: ${command.name} ${command.usage}`)
	}
}

/** The argument at `index`, or a usage error naming it. */
export function need(command: Pick<Command, 'name' | 'usage'>, args: string[], index: number, what: string): string {
	const value = args[index]
	if (value === undefined || value === '') throw new UsageError(`${command.name}: missing ${what}\nusage: ${command.name} ${command.usage}`)
	return value
}

/** A string switch's value, or undefined. */
export function text(values: Values, name: string): string | undefined {
	const value = values[name]
	return typeof value === 'string' ? value : undefined
}

/** Run `parse`, turning what it throws into a usage error for `command`. */
export function usage<T>(command: Pick<Command, 'name'>, parse: () => T): T {
	try {
		return parse()
	} catch (error) {
		throw new UsageError(`${command.name}: ${(error as Error).message}`)
	}
}
