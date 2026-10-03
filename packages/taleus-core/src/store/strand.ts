import cryptoPlugin from '@optimystic/quereus-plugin-crypto/plugin'
import { Database, registerPlugin } from '@quereus/quereus'


/**
 * A Taleus strand, open in Quereus.
 *
 * This is the whole substrate the core needs in order to be exercised: the real schema,
 * with its real constraints, executed by the real engine, in memory. No Optimystic, no
 * cadre, no peers. What it does not model is replication -- a single store cannot show
 * two parties disagreeing -- so anything about concurrent writers belongs in a test that
 * opens two of these and moves rows between them by hand.
 *
 * The schema arrives as **text**. Nothing here reads a file: this package runs in React
 * Native and the browser as well as Node, and a core that imports `node:fs` is a core that
 * runs in one of the three. Where the text comes from -- a bundled string, a fetch, the
 * filesystem -- is the host's business; `src/store/schema-node.ts` is the Node answer and
 * is the only file in the package that knows what a path is.
 */

export type SchemaName = 'draft1' | 'portfolio'

/**
 * Strip SQL comments, whole-line and trailing alike.
 *
 * Trailing ones matter as much as whole lines: a `;` in prose after code would end a
 * statement early, and a capitalised word in prose reads as a function call to anything
 * scanning for them. Both happen in `draft1.qsql`, which explains most of its constraints
 * in the margin.
 *
 * This assumes `--` never appears inside a string literal. True throughout the schema,
 * whose literals are tokens like `'S'` and `'direct'`, and worth re-checking if that
 * changes.
 */
export function stripComments(sql: string): string {
	return sql
		.split('\n')
		.map(line => {
			const comment = line.indexOf('--')
			return comment === -1 ? line : line.slice(0, comment)
		})
		.join('\n')
}

/** Split a schema file into executable statements. */
export function statementsOf(sql: string): string[] {
	return stripComments(sql)
		.split(/;\s*\n/)
		.map(statement => statement.trim())
		.filter(Boolean)
}

/**
 * Register the crypto scalars exactly as Sereus does when it composes a strand: the plugin,
 * with no configuration, so `digest` is sha256 and emits base64url.
 */
export async function registerCrypto(db: Database): Promise<void> {
	await registerPlugin(db, cryptoPlugin)
}

/**
 * The schema Taleus's tables live in, on every strand database.
 *
 * Sereus wraps an sApp schema as `declare schema App { … }` and applies it, so the tables
 * are `App.Ledger`, `App.TallyCore` and so on, and app code qualifies them -- as the Sereus
 * reference apps do. The in-memory store does exactly the same, so SQL written against it is
 * SQL that runs on a real strand.
 */
export const APP_SCHEMA = 'App'

/** A table or view name, qualified into the app's schema. */
export function appTable(name: string): string {
	return `${APP_SCHEMA}.${name}`
}

/**
 * Apply an sApp schema body the way Sereus applies it (`applyAppSchema` in
 * `@serfab/quereus-plugin-sereus`): declare it as `App`, refuse it if Quereus skipped any
 * item, then apply.
 *
 * The refusal matters more than it looks. Quereus keeps an item it does not model -- a
 * `create table …` prefix, a misspelled `tabel` -- as an opaque placeholder that apply
 * ignores, so without the check a schema can load *missing a table* and nothing says so.
 * Sereus 1.8 made this an error; doing the same here means a schema that passes these tests
 * is one Sereus will accept.
 */
export async function applyAppSchema(db: Database, schema: string): Promise<void> {
	await db.exec(`declare schema ${APP_SCHEMA} {\n${schema}\n}`)
	const items = db.declaredSchemaManager.getDeclaredSchema(APP_SCHEMA)?.items ?? []
	const ignored = items.filter(item => item.type === 'declareIgnored').length
	if (ignored > 0) {
		throw new Error(
			`sApp schema has ${ignored} item(s) Quereus does not recognize -- a \`create …\` prefix or a ` +
				'misspelled keyword; items are `table`, `index`, `unique index`, `view`, ' +
				'`materialized view`, `seed` and `assertion`',
		)
	}
	await db.exec(`apply schema ${APP_SCHEMA}`)
}

/**
 * Open an in-memory database with a schema applied -- composed the way a Sereus strand
 * database is, minus the storage: the crypto plugin, then the sApp schema declared and
 * applied as `App`. Nothing of Taleus's is registered: the schema needs nothing a Sereus node
 * lacks (see `functions.ts`).
 */
export async function openStrandFrom(sql: string): Promise<Database> {
	const db = new Database()
	await registerCrypto(db)
	await applyAppSchema(db, sql)
	return db
}

/** Run a query and collect its rows. */
export async function rows<T = Record<string, unknown>>(
	db: Database,
	sql: string,
	params?: unknown[],
): Promise<T[]> {
	const collected: T[] = []
	for await (const row of db.eval(sql, params as never)) {
		collected.push(row as T)
	}
	return collected
}

/** Run a query expecting one row, or none. */
export async function row<T = Record<string, unknown>>(
	db: Database,
	sql: string,
	params?: unknown[],
): Promise<T | undefined> {
	return (await rows<T>(db, sql, params))[0]
}

/**
 * Every scalar the schema calls, found by reading the schema rather than by memory.
 *
 * A function used only inside a column CHECK is not resolved when the table is created --
 * Quereus plans those lazily -- so a missing one stays invisible until the first insert
 * into that table; a missing function once hid that way while the schema-loads test passed.
 * This is what finds the next one.
 */
export function functionsCalledBy(sql: string): string[] {
	const code = stripComments(sql)

	// Relation names are not function calls even when a '(' follows them. Matched in the
	// declarative item form an sApp schema uses (`table X (…)`), not `create table`.
	const relations = new Set(
		[...code.matchAll(/^\s*(?:materialized\s+)?(?:table|view)\s+(\w+)/gim)].map(m => m[1].toLowerCase()),
	)
	// SQL's own vocabulary, which the same pattern matches.
	const keywords = new Set(
		[
			'select', 'from', 'where', 'exists', 'count', 'sum', 'min', 'max', 'avg', 'case',
			'when', 'then', 'else', 'end', 'coalesce', 'cast', 'in', 'not', 'and', 'or',
			'values', 'order', 'by', 'limit', 'desc', 'asc', 'distinct', 'union', 'join',
			'on', 'as', 'null', 'integer', 'text', 'real', 'blob', 'check', 'constraint',
			'primary', 'key', 'insert', 'update', 'delete', 'default', 'committed', 'new',
			'is', 'if', 'left', 'inner', 'outer', 'group', 'having', 'with',
		].map(k => k.toLowerCase()),
	)

	const called = new Set<string>()
	for (const match of code.matchAll(/(\w+)\s*\(/g)) {
		const name = match[1]
		const lower = name.toLowerCase()
		if (relations.has(lower) || keywords.has(lower)) continue
		// A one-letter match is a column alias or a literal, never a host scalar.
		if (name.length < 2) continue
		called.add(name)
	}
	return [...called].sort()
}

/** A row to insert, named by its table. Values are bound, never interpolated. */
export interface RowWrite {
	table: string
	row: Record<string, unknown>
}

export function insertStatement({ table, row }: RowWrite): { sql: string; params: unknown[] } {
	const columns = Object.keys(row)
	return {
		sql: `insert into ${appTable(table)} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')})`,
		params: columns.map(c => row[c]),
	}
}
