/**
 * Output for pipes: one record per line, tab-separated fields in a fixed order, or one JSON object
 * per line (`--json`). Data goes to stdout and nothing else does. Spec: `design/specs/cli/commands.md`
 * → Output.
 */

export type Field = string | number | boolean | null | undefined
export type Row = Record<string, Field>
export type Pair = [string, Field | Array<Field | Field[]>]

/** Escape a field so a record stays on one line: tab, newline, CR and backslash. */
export function escapeField(value: Field): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'boolean') return value ? 'yes' : 'no'
	return String(value).replace(/[\\\t\n\r]/g, c => (c === '\\' ? '\\\\' : c === '\t' ? '\\t' : c === '\n' ? '\\n' : '\\r'))
}

export interface Output {
	/** Records with these columns, in this order. */
	rows(columns: readonly string[], rows: readonly Row[]): void
	/** `key<TAB>value` lines. An array value repeats the key; an array inside it is one line of several fields. */
	pairs(pairs: readonly Pair[]): void
	/** Any JSON value, one line: what `sql` prints. */
	json(value: unknown): void
	/** Progress, previews and notes: stderr, never stdout. */
	note(text: string): void
}

export function createOutput(options: {
	json: boolean
	header: boolean
	write?: (text: string) => void
	writeErr?: (text: string) => void
}): Output {
	const write = options.write ?? (text => void process.stdout.write(text))
	const writeErr = options.writeErr ?? (text => void process.stderr.write(text))
	const headed = new Set<string>()
	return {
		rows(columns, rows) {
			if (options.json) {
				for (const row of rows) write(`${JSON.stringify(Object.fromEntries(columns.map(c => [c, row[c] ?? null])))}\n`)
				return
			}
			const key = columns.join('\t')
			if (options.header && !headed.has(key)) {
				write(`${key}\n`)
				headed.add(key)
			}
			for (const row of rows) write(`${columns.map(c => escapeField(row[c])).join('\t')}\n`)
		},
		pairs(pairs) {
			if (options.json) {
				write(`${JSON.stringify(Object.fromEntries(pairs.map(([k, v]) => [k, v ?? null])))}\n`)
				return
			}
			for (const [key, value] of pairs) {
				for (const one of Array.isArray(value) ? value : [value]) {
					write(`${key}\t${Array.isArray(one) ? one.map(escapeField).join('\t') : escapeField(one)}\n`)
				}
			}
		},
		json(value) {
			write(`${JSON.stringify(value)}\n`)
		},
		note(text) {
			writeErr(`${text}\n`)
		},
	}
}
