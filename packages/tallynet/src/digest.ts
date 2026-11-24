/**
 * The canonical digest TallyNet signs and compares over: sha256 of a deterministic CBOR encoding
 * of a JSON-like value (extended with `bigint` and raw bytes).
 *
 * Why not `JSON.stringify` or ChipNet's `hashDeep`: both are ambiguous preimages. `hashDeep`
 * concatenates keys and values with no type tags or delimiters, so `{a:'bc'}` and `{ab:'c'}` hash
 * alike and arrays collide with objects (see docs/chipnet-review.md § Transaction module defects).
 * A signature over an ambiguous preimage is forgeable. The encoding here is **injective and
 * self-delimiting**, and independent of property insertion order.
 *
 * Encoding choice: **deterministic DAG-CBOR** (`@ipld/dag-cbor`), from the same IPLD family as the
 * `multiformats` package `taleus-model` already uses. DAG-CBOR fixes one byte sequence per value:
 * map keys are sorted (length-first, then bytewise), integers use their shortest form, and there
 * are no indefinite-length items, floats-for-ints, `NaN`, `Infinity` or `undefined`. Recorded in
 * docs/design.md § Canonical encoding.
 *
 * Relationship to `taleus-core`'s `digest.ts`: that one is the **settlement** digest the Quereus
 * schema verifies, and it uses the storage stack's own framed tuple encoding
 * (`@optimystic/quereus-plugin-crypto`), a different byte format for a different, fixed-shape
 * input. The two do **not** produce equal bytes and are not meant to; there is no shared preimage
 * to cross-check. This digest is for TallyNet's own records, signatures and nonces.
 *
 * Caveat — `bigint` vs `number`: DAG-CBOR encodes an integer the same way whether it arrives as
 * `1` or `1n`, so `digest(1) === digest(1n)`. This is intentional and tested. It does not matter in
 * practice because amounts cross TallyNet as decimal **strings** (bigint only in memory), so a
 * record never carries a bare integer that a number/bigint confusion could forge.
 */

import { encode as dagCborEncode } from '@ipld/dag-cbor'
import { nobleHasher, type Hasher } from './crypto.js'

/** A value TallyNet can canonically encode: JSON-like, plus `bigint` and raw bytes. */
export type DigestValue =
	| null
	| boolean
	| number
	| bigint
	| string
	| Uint8Array
	| readonly DigestValue[]
	| { readonly [key: string]: DigestValue }

/**
 * Canonically encode `value` to DAG-CBOR bytes. Throws (before touching the encoder, with a path
 * to the offending node) on anything not encodable: `undefined`, a function, a symbol, a non-finite
 * number, or an object with a non-plain prototype (a `Date`, `Map`, class instance, …).
 */
export function canonicalEncode(value: DigestValue): Uint8Array {
	assertEncodable(value, '$')
	return dagCborEncode(value)
}

/** The canonical digest: sha256 of {@link canonicalEncode}. `hasher` defaults to `@noble/hashes`. */
export function digest(value: DigestValue, hasher: Hasher = nobleHasher): Uint8Array {
	return hasher.sha256(canonicalEncode(value))
}

/** Recursively reject values DAG-CBOR cannot represent, with a JSON-path to the offender. */
function assertEncodable(value: unknown, path: string): void {
	if (value === null) {
		return
	}
	switch (typeof value) {
		case 'boolean':
		case 'string':
		case 'bigint':
			return
		case 'number':
			if (!Number.isFinite(value)) {
				throw new Error(`digest: non-finite number at ${path}`)
			}
			return
		case 'object': {
			if (value instanceof Uint8Array) {
				return
			}
			if (Array.isArray(value)) {
				(value as readonly unknown[]).forEach((element, index) => assertEncodable(element, `${path}[${index}]`))
				return
			}
			const proto: unknown = Object.getPrototypeOf(value)
			if (proto !== Object.prototype && proto !== null) {
				throw new Error(`digest: unsupported object with a non-plain prototype at ${path}`)
			}
			const record = value as Record<string, unknown>
			for (const key of Object.keys(record)) {
				assertEncodable(record[key], `${path}.${key}`)
			}
			return
		}
		case 'undefined':
			throw new Error(`digest: undefined is not encodable at ${path}`)
		case 'function':
			throw new Error(`digest: a function is not encodable at ${path}`)
		case 'symbol':
			throw new Error(`digest: a symbol is not encodable at ${path}`)
		default:
			throw new Error(`digest: value of type ${typeof value} is not encodable at ${path}`)
	}
}
