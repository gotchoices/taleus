import { generateKeyPair, type KeyPair } from '../crypto/index.js'
import { publicKeyText } from '../lift/digest.js'
import { signText } from './tally.js'
import { bytesToHex, digest as canonicalDigest } from '../lift/digest.js'
import { dayNumber, digest, greatest, least, signatureValid, validDate } from './functions.js'

/** A generated pair in the text form the schema stores. */
const asText = (pair: KeyPair) => ({ publicKey: publicKeyText(pair.publicKey), secretKey: pair.secretKey })

/**
 * The host scalars are the seam between the schema and the host, and a schema constraint
 * is only as sound as the function it calls. These are the floor under every other test.
 */

describe('DayNumber', () => {
	it('orders calendar dates', () => {
		expect(dayNumber('2026-03-02')).toBeGreaterThan(dayNumber('2026-03-01')!)
		expect(dayNumber('2027-01-01')).toBeGreaterThan(dayNumber('2026-12-31')!)
	})

	it('counts days, so the schema can add a notice period', () => {
		expect(dayNumber('2026-03-02')! - dayNumber('2026-02-28')!).toBe(2)
		// Across a month boundary and a leap year.
		expect(dayNumber('2028-03-01')! - dayNumber('2028-02-28')!).toBe(2)
	})

	it('reads in UTC, so a civil date is the same day to both parties', () => {
		// The bug this prevents: rendering or comparing 2026-03-02 through a local zone
		// puts it on the first of March for half the world.
		expect(dayNumber('2026-03-02')).toBe(Math.floor(Date.UTC(2026, 2, 2) / 86_400_000))
	})

	it('refuses anything that is not a calendar date', () => {
		for (const bad of ['2026-03-02T00:00:00Z', '2026-3-2', 'today', '', null, 20260302]) {
			expect(dayNumber(bad)).toBeNull()
			expect(validDate(bad)).toBe(0)
		}
		expect(validDate('2026-03-02')).toBe(1)
	})
})

describe('Digest', () => {
	it('separates its arguments, so two splittings of the same text differ', () => {
		// Without a separator Digest('a','bc') and Digest('ab','c') would collide, and a
		// signature over one would verify against the other.
		expect(digest('a', 'bc')).not.toBe(digest('ab', 'c'))
	})

	it('distinguishes a null field from an empty one', () => {
		expect(digest('x', null, 'y')).not.toBe(digest('x', '', 'y'))
	})

	it('is stable across calls', () => {
		expect(digest('x', 1, null)).toBe(digest('x', 1, null))
	})

	it('is the lift module’s encoding, not a second one', () => {
		// A divergence here means every signature silently fails to verify, and the failure
		// looks like a permissions problem rather than an encoding one. So this asserts the
		// scalar delegates rather than reimplements.
		expect(digest('a', 'b', 'c')).toBe(bytesToHex(canonicalDigest(['a', 'b', 'c'])))
	})

	it('distinguishes text from the integer that prints the same', () => {
		// The tagged encoding is what makes this true; a naive join would collide.
		expect(digest('18000')).not.toBe(digest(18000))
	})

	it('refuses a value the encoding cannot represent, rather than truncating', () => {
		expect(() => digest(1.5)).toThrow(/non-integer/)
	})
})

describe('SignatureValid', () => {
	it('accepts a real signature over the digest it covers', () => {
		const keys = generateKeyPair()
		const d = digest('tally:1', 'F', 18000, '2026-03-02')
		expect(signatureValid(d, signText(asText(keys), d), publicKeyText(keys.publicKey))).toBe(1)
	})

	it('refuses a signature over different content', () => {
		const keys = generateKeyPair()
		const signed = digest('tally:1', 'F', 18000, '2026-03-02')
		const other = digest('tally:1', 'F', 99999, '2026-03-02')
		expect(
			signatureValid(other, signText(asText(keys), signed), publicKeyText(keys.publicKey)),
		).toBe(0)
	})

	it('refuses another party’s key', () => {
		const mine = generateKeyPair()
		const theirs = generateKeyPair()
		const d = digest('tally:1')
		expect(signatureValid(d, signText(asText(mine), d), publicKeyText(theirs.publicKey))).toBe(0)
	})

	it('returns 0 rather than throwing on rubbish', () => {
		expect(signatureValid(null, 'x', 'y')).toBe(0)
		expect(signatureValid('d', 'not-hex!!', 'also-not')).toBe(0)
	})
})

describe('Greatest and Least', () => {
	it('pick the larger and the smaller', () => {
		expect(greatest(3, 7)).toBe(7)
		expect(least(3, 7)).toBe(3)
		expect(greatest(0, -5)).toBe(0)
	})

	it('fall through nulls, so a missing term does not zero the economics', () => {
		expect(greatest(null, 4)).toBe(4)
		expect(least(4, null)).toBe(4)
	})
})
