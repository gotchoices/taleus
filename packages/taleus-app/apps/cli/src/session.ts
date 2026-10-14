/**
 * A session: one party running, its output, and what commands share -- naming tallies, the rows of
 * the last listing, how failures leave.
 */
import type { DataError, Result, TallySummary } from 'taleus-model'
import { readText, writeTextAtomic } from 'taleus-sereus/node'
import { join } from 'node:path'

import type { Output } from './output.ts'
import type { RunningParty } from './party.ts'
import { RefError, resolveRef } from './refs.ts'

/** Exit codes (`design/specs/cli/commands.md` → Exit codes). */
export const EXIT = { ok: 0, usage: 1, failed: 2, retryable: 3, notFound: 4, interrupted: 130 } as const

/** A failure that ends a command with a message and an exit code. */
export class CliFailure extends Error {
	override name = 'CliFailure'
	readonly code: number
	constructor(message: string, code: number) {
		super(message)
		this.code = code
	}
}

export class UsageError extends CliFailure {
	constructor(message: string) {
		super(message, EXIT.usage)
	}
}

export interface Session {
	party: RunningParty
	out: Output
	verbose: boolean
	/** A person is at a terminal to answer questions. */
	interactive: boolean
	/** Resolves once the node and engine are up. */
	ready: Promise<void>
	/** Ask a yes/no question on the terminal; false when nobody can answer. */
	confirm(question: string): Promise<boolean>
	/** Aborted by Ctrl-C while a long command (`watch`, `idle`) runs. */
	readonly signal: AbortSignal
	/** The value, or a `CliFailure` with the model's words and the right exit code. */
	unwrap<T>(result: Result<T>): T
	tallies(): Promise<TallySummary[]>
	tally(ref: string): Promise<TallySummary>
	rememberTallies(ids: readonly string[]): Promise<void>
}

export interface SessionParts {
	party: RunningParty
	out: Output
	verbose: boolean
	interactive: boolean
	ready: Promise<void>
	confirm(question: string): Promise<boolean>
	signal: () => AbortSignal
}

/** What the party's name for a tally is on the command line: its counterparty, or an invitation's note. */
export function titleOf(tally: TallySummary): string {
	return tally.invitation ? (tally.invitation.note ?? '') : tally.counterparty.name
}

export function createSession(parts: SessionParts): Session {
	const lastFile = join(parts.party.dirs.root, 'last.json')
	let last: string[] | undefined
	const loadLast = async () => (last ??= JSON.parse((await readText(lastFile)) ?? '[]') as string[])

	const session: Session = {
		...parts,
		get signal() {
			return parts.signal()
		},
		unwrap(result) {
			if (result.ok) return result.value
			throw failure(result.error)
		},
		async tallies() {
			return session.unwrap(await parts.party.model.tallies.listTallies())
		},
		async tally(ref) {
			const rows = await loadLast()
			const candidates = (await session.tallies()).map(tally => ({ ...tally, title: titleOf(tally) }))
			try {
				return resolveRef(ref, candidates, rows)
			} catch (error) {
				if (error instanceof RefError) throw new CliFailure(error.message, EXIT.notFound)
				throw error
			}
		},
		async rememberTallies(ids) {
			last = [...ids]
			await writeTextAtomic(lastFile, `${JSON.stringify(last)}\n`)
		},
	}
	return session
}

function failure(error: DataError): CliFailure {
	return new CliFailure(`${error.message} (${error.kind})`, error.retryable ? EXIT.retryable : EXIT.failed)
}
