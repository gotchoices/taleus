import type { SAppConfig } from '@serfab/cadre-core'
import tallySchema from 'taleus-core/schema-text/draft1'

/**
 * The Taleus tally sApp, as every Taleus host publishes and joins it: the same id, version and
 * schema on both sides of every tally.
 *
 * Unsigned for now, so a node must run with `requireSignedSchemas: false`. A signed config needs
 * `id` to be the author's public key and a `signature` from `signSchema`, made once at release with
 * a Taleus author key and shipped beside the schema.
 */
export function taleusSApp(): SAppConfig {
	return { id: 'taleus-tally', version: '1', schema: tallySchema, schemaVersion: TALLY_SCHEMA_VERSION, latencyHint: 'interactive' }
}

/**
 * The tally schema's version, which Sereus records on each strand (`Strand.AppSchemaVersion`):
 * a strand refuses an app whose number is lower than the highest any member has applied
 * (`AppSchemaOutdatedError`), so an older app cannot undo a newer schema's changes. Raise it with
 * every change to `taleus-core/schema/draft1.qsql`.
 */
export const TALLY_SCHEMA_VERSION = 1
