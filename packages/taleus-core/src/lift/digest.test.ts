import { digest as stackDigest } from '@optimystic/quereus-plugin-crypto'
import { generateKeyPair, sign, verify } from '../crypto/index.js'
import {
	bytesToHex,
	fromText,
	toText,
	digest,
	hexToBytes,
	liftTermsDigest,
	liftVoidDigest,
	publicKeyText,
	signLiftTerms,
	signLiftVoid,
	verifyLiftTerms,
	verifyLiftVoid,
	type LiftEdgeTerms,
} from './digest.js'

const terms: LiftEdgeTerms = {
	cid: 'tally-cid-1',
	liftId: 'L1',
	refereeKey: 'referee-key',
	issuer: 'F',
	units: 1500n,
	date: '2026-07-13',
	expiry: '2026-07-20',
}

describe('canonical digest', () => {
	it('is deterministic for the same field list', () => {
		expect(bytesToHex(digest(['a', 1n, 'b']))).toBe(bytesToHex(digest(['a', 1n, 'b'])))
	})

	it('is field-order sensitive (order is the schema Digest() argument order)', () => {
		expect(bytesToHex(digest(['a', 'b']))).not.toBe(bytesToHex(digest(['b', 'a'])))
	})

	it('cannot collide across field boundaries (length prefix)', () => {
		// A bare delimiter would let ("12","3") collide with ("1","23"); the u32be length prefix forbids it.
		expect(bytesToHex(digest(['12', '3']))).not.toBe(bytesToHex(digest(['1', '23'])))
	})

	it('cannot collide across types (integer 123 vs text "123")', () => {
		expect(bytesToHex(digest([123n]))).not.toBe(bytesToHex(digest(['123'])))
	})

	it('treats bigint and equal number integers identically', () => {
		expect(bytesToHex(digest([123]))).toBe(bytesToHex(digest([123n])))
	})

	it('rejects a non-integer number field', () => {
		expect(() => digest([1.5])).toThrow(/not an integer/)
	})
})

describe('hex codec', () => {
	it('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array([0x00, 0x0f, 0xa5, 0xff, 0x10])
		expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes)
	})

	it('rejects odd-length and non-hex input', () => {
		expect(() => hexToBytes('abc')).toThrow(/odd-length/)
		expect(() => hexToBytes('zz')).toThrow(/non-hex/)
	})

	it('rejects a valid leading nibble followed by junk (parseInt prefix-parse laxness)', () => {
		// Number.parseInt('0g',16) === 0 and parseInt(' a',16) === 10 — a naive decoder would
		// silently accept these. Per-nibble validation must reject them.
		expect(() => hexToBytes('0g')).toThrow(/non-hex/)
		expect(() => hexToBytes('a!')).toThrow(/non-hex/)
		expect(() => hexToBytes(' a')).toThrow(/non-hex/)
	})
})

describe('lift-terms digest byte-parity with the schema constraint form', () => {
	// The make-or-break: the digest the referee signs here must be byte-identical to what the
	// schema's Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry) recomputes.
	it('equals an explicit schema-order field digest', () => {
		const schemaForm = digest([terms.cid, terms.liftId, terms.refereeKey, terms.issuer, terms.units, terms.date, terms.expiry])
		expect(bytesToHex(liftTermsDigest(terms))).toBe(bytesToHex(schemaForm))
	})

	it('a referee signature verifies against the schema constraint form (Ledger.LiftFinalize)', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const refKey = publicKeyText(publicKey)
		const t = { ...terms, refereeKey: refKey }
		// Referee signs the lift-terms digest; the schema's LiftFinalize recomputes it and verifies.
		const refereeSig = signLiftTerms(secretKey, t)
		expect(verifyLiftTerms(refKey, t, refereeSig)).toBe(true)
	})

	it('the issuer pledge signature and the referee commit signature are over the SAME digest', () => {
		// PendingLift.SignatureValid (issuer key) and Ledger.LiftFinalize (referee key) verify the
		// identical digest — two signatures, one digest, different keys.
		const issuer = generateKeyPair()
		const refereeKp = generateKeyPair()
		const refKey = publicKeyText(refereeKp.publicKey)
		const t = { ...terms, refereeKey: refKey }
		const issuerSig = signLiftTerms(issuer.secretKey, t)
		const refereeSig = signLiftTerms(refereeKp.secretKey, t)
		expect(verifyLiftTerms(publicKeyText(issuer.publicKey), t, issuerSig)).toBe(true)
		expect(verifyLiftTerms(refKey, t, refereeSig)).toBe(true)
	})

	it('a signature over a permuted field order does NOT verify (drift is caught)', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const refKey = publicKeyText(publicKey)
		const t = { ...terms, refereeKey: refKey }
		// Sign a wrong-order digest (Issuer/Units swapped) and confirm the schema form rejects it.
		const wrong = digest([t.cid, t.liftId, t.refereeKey, t.units, t.issuer, t.date, t.expiry])
		const badSig = toText(sign(secretKey, wrong))
		expect(verifyLiftTerms(refKey, t, badSig)).toBe(false)
	})
})

describe('void digest is distinct from the commit digest (no cross-replay)', () => {
	it('a commit signature does not verify as a void, and vice versa', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const refKey = publicKeyText(publicKey)
		const t = { ...terms, refereeKey: refKey }
		const commitSig = signLiftTerms(secretKey, t)
		const voidSig = signLiftVoid(secretKey, t.cid, t.liftId)

		// Commit signature cannot satisfy the void check…
		expect(verifyLiftVoid(refKey, t.cid, t.liftId, commitSig)).toBe(false)
		// …and the void signature cannot satisfy the finalize check.
		expect(verifyLiftTerms(refKey, t, voidSig)).toBe(false)
		// Each verifies against its own form.
		expect(verify(publicKey, liftTermsDigest(t), fromText(commitSig))).toBe(true)
		expect(verify(publicKey, liftVoidDigest(t.cid, t.liftId), fromText(voidSig))).toBe(true)
	})
})

describe('the schema\u2019s text form', () => {
	it('round-trips raw bytes through base64url', () => {
		const bytes = new Uint8Array([0, 1, 62, 63, 250, 251, 254, 255])
		expect(fromText(toText(bytes))).toEqual(bytes)
		expect(toText(bytes)).toMatch(/^[A-Za-z0-9_-]+$/)
	})

	it('is the form the stack\u2019s digest emits, byte for byte', () => {
		// The schema compares these as text; a padding or alphabet difference would be a
		// mismatch that looks like a bad signature.
		const fields = ['tally:1', 'F', 18000n, null]
		expect(toText(digest(fields))).toBe(stackDigest(fields, 'sha256', 'base64url'))
	})

	it('refuses text that is not base64url', () => {
		expect(() => fromText('not base64url!')).toThrow()
	})

	it('refuses a non-canonical twin, as the schema’s verify does', () => {
		// 'f' and 'e' differ only in bits a 64-byte signature's final character does not use,
		// so both decode to the same bytes. The stack's verify refuses the twin; if this
		// accepted it, Taleus would trust a signature every replica rejects.
		const bytes = new Uint8Array(64).fill(7)
		const text = toText(bytes)
		const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
		const twin = text.slice(0, -1) + alphabet[alphabet.indexOf(text.at(-1)!) ^ 1]
		expect(twin).not.toBe(text)
		expect(() => fromText(twin)).toThrow(/non-canonical/)
	})
})
