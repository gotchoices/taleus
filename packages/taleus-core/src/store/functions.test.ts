import { Database } from '@quereus/quereus'

import { generateKeyPair, type KeyPair } from '../crypto/index.js'
import { digest as canonicalDigest, publicKeyText, toText } from '../lift/digest.js'
import { digest } from './functions.js'
import { signText } from './identity.js'
import { registerCrypto, row } from './strand.js'

/** A generated pair in the text form the schema stores. */
const asText = (pair: KeyPair) => ({ publicKey: publicKeyText(pair.publicKey), secretKey: pair.secretKey })

/**
 * The crypto scalars are the seam between the schema and the stack, and a schema constraint
 * is only as sound as the function it calls. These are the floor under every other test.
 */

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
		expect(digest('a', 'b', 'c')).toBe(toText(canonicalDigest(['a', 'b', 'c'])))
	})

	it('is byte-for-byte what the schema computes, because it is the same function', async () => {
		// The guarantee `SPEC.md` § 4 is about. The schema's `digest` is the stack's
		// (`@optimystic/quereus-plugin-crypto`); this one must agree with it on every field
		// type the schema signs -- text, integers, and NULL.
		const db = new Database()
		await registerCrypto(db)
		const inSql = await row<{ d: string }>(db, "select digest('tally:1', 'F', 18000, null) as d")
		expect(inSql?.d).toBe(digest('tally:1', 'F', 18000, null))
	})

	it('distinguishes text from the integer that prints the same', () => {
		// The tagged encoding is what makes this true; a naive join would collide.
		expect(digest('18000')).not.toBe(digest(18000))
	})

	it('refuses a value the encoding cannot represent, rather than truncating', () => {
		expect(() => digest(1.5)).toThrow(/non-integer/)
	})
})

/**
 * The schema's signature check is the stack's `verify`, called as
 * `verify(digest(...), Signature, Key, 'ed25519')`. These pin what Taleus's signing path
 * has to produce for that call to accept it -- through a real database, so the test is of
 * the function the schema actually runs.
 */
describe('verify, as the schema calls it', () => {
	async function sqlVerify(d: string, signature: string, key: string, curve = "'ed25519'") {
		const db = new Database()
		await registerCrypto(db)
		const result = await row<{ ok: unknown }>(db, `select verify(?, ?, ?${curve ? `, ${curve}` : ''}) as ok`, [d, signature, key])
		return Boolean(result?.ok)
	}

	it('accepts a real signature over the digest it covers', async () => {
		const keys = generateKeyPair()
		const d = digest('tally:1', 'F', 18000, '2026-03-02')
		await expect(sqlVerify(d, signText(asText(keys), d), publicKeyText(keys.publicKey))).resolves.toBe(true)
	})

	it('refuses a signature over different content', async () => {
		const keys = generateKeyPair()
		const signed = digest('tally:1', 'F', 18000, '2026-03-02')
		const other = digest('tally:1', 'F', 99999, '2026-03-02')
		await expect(sqlVerify(other, signText(asText(keys), signed), publicKeyText(keys.publicKey))).resolves.toBe(false)
	})

	it('refuses another party’s key', async () => {
		const mine = generateKeyPair()
		const theirs = generateKeyPair()
		const d = digest('tally:1')
		await expect(sqlVerify(d, signText(asText(mine), d), publicKeyText(theirs.publicKey))).resolves.toBe(false)
	})

	it('refuses rubbish rather than throwing', async () => {
		await expect(sqlVerify('d', 'not base64url!!', 'also not')).resolves.toBe(false)
	})

	it('refuses a genuine signature when the curve is left out -- the default is secp256k1', async () => {
		// The trap every `verify` in the schema has to avoid, and the reason a schema-scanning
		// test in `strand.test.ts` insists each one names the curve.
		const keys = generateKeyPair()
		const d = digest('tally:1')
		await expect(sqlVerify(d, signText(asText(keys), d), publicKeyText(keys.publicKey), '')).resolves.toBe(false)
	})
})
