import { digest as stackDigest } from '@optimystic/quereus-plugin-crypto'

import type { DigestField } from '../lift/digest.js'

/**
 * The tally schema calls only what every Sereus node already has: Quereus's built-ins and
 * the stack's crypto scalars (`digest`, `verify`, from `@optimystic/quereus-plugin-crypto`,
 * which Sereus composes into every strand database). It registers nothing of its own, so a
 * node that holds a replica -- an always-on cadre machine as much as either party's phone --
 * validates every write without any Taleus code. A function the schema needed and Sereus did
 * not provide would leave such a node unable to accept the strand's rows.
 *
 * Dates are `YYYY-MM-DD` text, checked with `IsISODate`, and compared as text: that order is
 * calendar order. Quereus rejects non-deterministic expressions in CHECK constraints and
 * defaults, because every replica re-validates every write; `date('now')` appears only in
 * views. See `docs/timestamps.md`.
 *
 * What is left here is the TypeScript side of `digest`.
 */

/**
 * The digest a signature covers, in the schema's text form -- byte-for-byte what the schema's
 * `digest(...)` computes, because it is the same function: the plugin's, asked for base64url,
 * its default and so what a strand database registers.
 *
 * The only work done here is refusing what the schema never digests. A non-integer number
 * would encode as a REAL, which the plugin documents as colliding with an integer of equal
 * value; nothing Taleus signs is fractional, so a fraction here is a caller's mistake.
 */
export function digest(...args: unknown[]): string {
	const fields: DigestField[] = args.map(arg => {
		if (arg === null || arg === undefined) return null
		if (typeof arg === 'string' || typeof arg === 'bigint') return arg
		if (typeof arg === 'number') {
			if (!Number.isInteger(arg)) {
				throw new Error(`digest received a non-integer number: ${arg}`)
			}
			return arg
		}
		throw new Error(`digest received an unsupported value: ${typeof arg}`)
	})
	return stackDigest(fields, 'sha256', 'base64url') as string
}
