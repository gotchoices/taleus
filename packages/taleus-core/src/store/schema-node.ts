import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Database } from '@quereus/quereus'

import { openStrandFrom, type SchemaName } from './strand.js'

/**
 * Reading the schema off a filesystem -- **the only file in this package that may import
 * `node:` anything**.
 *
 * The core runs in React Native and the browser as well as Node. Keeping the one
 * platform-bound capability in a file named for its platform means a bundler that pulls in
 * `taleus-core` never reaches `node:fs`, and a reviewer can tell at a glance whether that
 * is still true: `grep "node:" src/ | grep -v schema-node` should stay empty.
 *
 * A React Native host bundles the `.qsql` text instead; a browser fetches it. Both call
 * `openStrandFrom` directly.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

export function schemaPath(name: SchemaName): string {
	return join(HERE, '..', '..', 'schema', `${name}.qsql`)
}

export function readSchema(name: SchemaName): string {
	return readFileSync(schemaPath(name), 'utf8')
}

/** Open an in-memory strand from a schema file on disk. Node only. */
export function openStrand(name: SchemaName = 'draft1'): Promise<Database> {
	return openStrandFrom(readSchema(name))
}
