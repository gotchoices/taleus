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
	return { id: 'taleus-tally', version: '1', schema: tallySchema, latencyHint: 'interactive' }
}
