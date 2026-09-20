import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Database } from '@quereus/quereus'

import {
	dayNumber,
	digest,
	greatest,
	least,
	signatureValid,
	today,
	validDate,
	validDenomination,
} from './functions.js'

/**
 * A Taleus strand, open in Quereus.
 *
 * This is the whole substrate the core needs in order to be exercised: the real schema,
 * with its real constraints, executed by the real engine, in memory. No Optimystic, no
 * cadre, no peers. What it does not model is replication -- a single store cannot show
 * two parties disagreeing -- so anything about concurrent writers belongs in a test that
 * opens two of these and moves rows between them by hand.
 *
 * The schema is loaded as text and split on statement boundaries because a `.qsql` file
 * is the deployable artifact; parsing it here is what keeps the file the source of truth
 * rather than a copy of one.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

export type SchemaName = 'draft1' | 'portfolio'

export function schemaPath(name: SchemaName): string {
	return join(HERE, '..', '..', 'schema', `${name}.qsql`)
}

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

/** Register the scalars the schema calls. Every one is deterministic; see `functions.ts`. */
export function registerFunctions(db: Database): void {
	db.createScalarFunction('DayNumber', { numArgs: 1, deterministic: true }, date => dayNumber(date))
	db.createScalarFunction('ValidDate', { numArgs: 1, deterministic: true }, date => validDate(date))
	db.createScalarFunction('ValidDenomination', { numArgs: 1, deterministic: true }, id =>
		validDenomination(id),
	)
	// The one volatile scalar: plain views only, never a constraint. See functions.ts.
	db.createScalarFunction('Today', { numArgs: 0, deterministic: false }, () => today())
	db.createScalarFunction('SignatureValid', { numArgs: 3, deterministic: true }, (d, s, k) =>
		signatureValid(d, s, k),
	)
	db.createScalarFunction('Greatest', { numArgs: 2, deterministic: true }, (a, b) => greatest(a, b) as never)
	db.createScalarFunction('Least', { numArgs: 2, deterministic: true }, (a, b) => least(a, b) as never)
	// Variadic: the schema calls Digest with as many columns as the row signs.
	db.createScalarFunction('Digest', { numArgs: -1, deterministic: true }, (...args) => digest(...args))
}

/** Open an in-memory database with the named schema loaded and its scalars registered. */
export async function openStrand(name: SchemaName = 'draft1'): Promise<Database> {
	const db = new Database()
	registerFunctions(db)
	for (const statement of statementsOf(readFileSync(schemaPath(name), 'utf8'))) {
		await db.exec(statement)
	}
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
 * into that table. `ValidDenomination` was missing for exactly that reason, and the
 * schema-loads test passed anyway. This is what finds the next one.
 */
export function functionsCalledBy(sql: string): string[] {
	const code = stripComments(sql)

	// Relation names are not function calls even when a '(' follows them.
	const relations = new Set(
		[...code.matchAll(/create\s+(?:table|view)\s+(\w+)/gi)].map(m => m[1].toLowerCase()),
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
		sql: `insert into ${table} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')})`,
		params: columns.map(c => row[c]),
	}
}
