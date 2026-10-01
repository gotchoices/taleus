import { digest as stackDigest } from '@optimystic/quereus-plugin-crypto'

import type { DigestField } from '../lift/digest.js'

/**
 * The host-registered scalars the schema calls -- Taleus's own, that is. The crypto scalars
 * (`digest`, `verify`) are `@optimystic/quereus-plugin-crypto`'s, which Sereus composes into
 * every strand database; see `registerFunctions` for why none of ours may share their names.
 *
 * Quereus rejects non-deterministic expressions inside CHECK constraints and column
 * defaults, and it is right to: every replica re-validates every write, so a gate that
 * read a clock or a random source would have replicas disagree about the same row and
 * the strand would diverge. Every function here is therefore a pure function of its
 * arguments -- `DayNumber` cannot read a clock the way `julianday('now')` can, and there
 * is deliberately no `RandomUUID`: a row's `Id` is inside the digest its signer signs,
 * so the caller must choose it before the insert.
 *
 * See `docs/timestamps.md`.
 */

/** `YYYY-MM-DD`, the calendar-date form the schema stores. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A calendar date's day number -- days since the Unix epoch, UTC.
 *
 * Read in UTC deliberately: `2026-03-02` is the second of March to both parties wherever
 * they are, and putting a civil date through a local zone renders it as the first for
 * half the world.
 */
export function dayNumber(date: unknown): number | null {
	if (typeof date !== 'string' || !ISO_DATE.test(date)) {
		return null
	}
	const ms = Date.parse(`${date}T00:00:00Z`)
	return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000)
}

/**
 * Today, as a day number. **Volatile by design** -- it is the one function here that reads a
 * clock, and it is therefore usable only where Quereus permits volatility: a plain view.
 * A CHECK constraint or a materialized view must never call it, because every replica would
 * answer differently and the strand would diverge.
 *
 * `DayNumber` is deliberately separate and pure, so the split is visible in the schema: a
 * gate calls `DayNumber(SomeColumn)`, a report calls `Today()`. There is no spelling that
 * lets a constraint read the clock by accident.
 */
export function today(now: number = Date.now()): number {
	return Math.floor(now / 86_400_000)
}

/** Whether a value is a calendar date the schema will accept. */
export function validDate(date: unknown): number {
	return dayNumber(date) === null ? 0 : 1
}

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

/**
 * Whether a string names a unit of account a tally may be denominated in.
 *
 * Prefix dispatch over three namespaces and nothing else -- no parser, no currency table:
 *
 * - `CHIP` -- the network reference unit. The one bare token, no prefix.
 * - `iso4217:AAA` -- a national currency, where `AAA` is exactly three uppercase ASCII
 *   letters. **Shape only**: it is deliberately not checked against a currency table, so a
 *   private or future code passes while `iso4217:US`, `iso4217:usd` and `iso4217:USDX` do not.
 * - `cid:<address>` -- anything else, named by the content address of a descriptor document.
 *   The address must be non-empty. Content addressing makes it globally unique by
 *   construction; what the unit *means* is settled by both parties at negotiation, not here.
 *   Nothing in this function fetches anything.
 */
export function validDenomination(id: unknown): number {
	if (typeof id !== 'string') {
		return 0
	}
	if (id === 'CHIP') {
		return 1
	}
	if (id.startsWith('iso4217:')) {
		return /^[A-Z]{3}$/.test(id.slice('iso4217:'.length)) ? 1 : 0
	}
	if (id.startsWith('cid:')) {
		return id.length > 'cid:'.length ? 1 : 0
	}
	return 0
}

/**
 * Two-argument min and max. SQL has no scalar `min`/`max` -- SQLite's are an extension, and
 * Quereus treats both as aggregates -- so the schema's economics (`LiftLading`) would
 * otherwise be spelled as nested `case when` and become unreadable. The names are
 * PostgreSQL's for the same operation.
 */
export function greatest(a: unknown, b: unknown): unknown {
	if (typeof a !== 'number') return b
	if (typeof b !== 'number') return a
	return a > b ? a : b
}

export function least(a: unknown, b: unknown): unknown {
	if (typeof a !== 'number') return b
	if (typeof b !== 'number') return a
	return a < b ? a : b
}
