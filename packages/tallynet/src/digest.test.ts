import { canonicalEncode, digest, type DigestValue } from './digest.js'

function toHex(bytes: Uint8Array): string {
	let out = ''
	for (const b of bytes) {
		out += b.toString(16).padStart(2, '0')
	}
	return out
}

/**
 * No cross-check with `taleus-core`'s `digest.ts`: that digest is the storage stack's framed
 * tuple encoding (`@optimystic/quereus-plugin-crypto`) over a fixed-shape settlement tuple, a
 * different byte format for a different input. The two never share a preimage, so there is nothing
 * to cross-check. The pinned vectors below instead lock TallyNet's own DAG-CBOR bytes so a
 * dependency bump that changes the encoding is caught.
 */
describe('canonicalEncode (DAG-CBOR) — pinned vectors', () => {
	it('encodes integers, maps, arrays and bytes to their canonical DAG-CBOR bytes', () => {
		expect(toHex(canonicalEncode(1))).toBe('01')
		expect(toHex(canonicalEncode({ a: 1 }))).toBe('a1616101')
		expect(toHex(canonicalEncode([1, 2]))).toBe('820102')
		expect(toHex(canonicalEncode(new Uint8Array([1, 2, 3])))).toBe('43010203')
	})
})

describe('digest', () => {
	it('returns a 32-byte sha256 and is deterministic', () => {
		const d = digest({ hello: 'world' })
		expect(d.length).toBe(32)
		expect(toHex(d)).toBe(toHex(digest({ hello: 'world' })))
	})

	it('ignores object key order', () => {
		expect(toHex(digest({ a: 1, b: 2 }))).toBe(toHex(digest({ b: 2, a: 1 })))
	})

	it('distinguishes {a:"bc"} from {ab:"c"}', () => {
		expect(toHex(digest({ a: 'bc' }))).not.toBe(toHex(digest({ ab: 'c' })))
	})

	it('distinguishes an array from an object with index keys', () => {
		expect(toHex(digest([1, 2]))).not.toBe(toHex(digest({ 0: 1, 1: 2 })))
	})

	it('treats a bigint and the number of equal value as equal (documented DAG-CBOR behaviour)', () => {
		expect(toHex(digest(1n))).toBe(toHex(digest(1)))
	})

	it('handles bigints beyond 2^53 deterministically', () => {
		const big = 9_007_199_254_740_993n
		expect(digest(big).length).toBe(32)
		expect(toHex(digest(big))).toBe(toHex(digest(big)))
	})

	it('accepts finite floats', () => {
		expect(digest(1.5).length).toBe(32)
	})
})

describe('digest rejects values DAG-CBOR cannot represent', () => {
	it('rejects undefined, top-level and nested, with a path', () => {
		expect(() => digest(undefined as unknown as DigestValue)).toThrow(/undefined/)
		expect(() => digest({ a: { b: undefined } } as unknown as DigestValue)).toThrow(/\$\.a\.b/)
	})

	it('rejects functions and symbols', () => {
		expect(() => digest({ f: (): number => 1 } as unknown as DigestValue)).toThrow(/function/)
		expect(() => digest({ s: Symbol('x') } as unknown as DigestValue)).toThrow(/symbol/)
	})

	it('rejects a hole in a sparse array with its path, like an explicit undefined', () => {
		// A hole reads as `undefined`; the pre-check must catch it with a path rather than letting
		// it fall through to the encoder (which `Array.prototype.forEach` skipping holes would allow).
		const holey = [1]
		holey[2] = 3 // leaves index 1 a hole
		expect(() => digest(holey as unknown as DigestValue)).toThrow(/undefined is not encodable at \$\[1\]/)
		expect(() => digest([1, undefined, 3] as unknown as DigestValue)).toThrow(/\$\[1\]/)
	})

	it('rejects non-finite numbers', () => {
		expect(() => digest(NaN)).toThrow(/non-finite/)
		expect(() => digest(Infinity)).toThrow(/non-finite/)
		expect(() => digest(-Infinity)).toThrow(/non-finite/)
	})

	it('rejects objects with a non-plain prototype (Date, Map)', () => {
		expect(() => digest(new Date() as unknown as DigestValue)).toThrow(/non-plain prototype/)
		expect(() => digest(new Map() as unknown as DigestValue)).toThrow(/non-plain prototype/)
	})

	it('accepts a null-prototype object and null', () => {
		expect(digest(Object.create(null) as DigestValue).length).toBe(32)
		expect(digest(null).length).toBe(32)
	})
})
